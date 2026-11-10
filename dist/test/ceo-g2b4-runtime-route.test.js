import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startIsolatedCeoRuntime} from '../src/ceo-isolated-runtime.js';
import {syntheticConversationRun} from './fixtures/ceo-conversation-fixture.js';
const Q='CEO，检查纳物一店最新经营情况，告诉我今天最需要处理的三个问题。';
const ROOT=path.resolve('.');
async function setup(t,{enabled=true}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'g2b4-runtime-'));await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 const credentials=Object.fromEntries(['legacy','shadow','human'].map((profile,i)=>[profile,{id:'fixture-'+profile,profile,role:profile==='human'?'owner':'agent',storeId:'400370',token:String(i).repeat(48)}]));
 let calls=0,options={};
 const runtime=await startIsolatedCeoRuntime({codeRoot:ROOT,dataRoot:root,files:{code:['dist/src/ceo-isolated-runtime.js'],frontend:['public/ceo-command-center.js'],contracts:['schemas/ceo-cockpit-projection.schema.json'],policy:['config/ceo-capabilities.v1.json']},releaseId:'g2b4-isolated-test',credentials,...(enabled?{operationalConversation:{sourceMode:'SYNTHETIC',sourceRunner:async()=>{calls++;return syntheticConversationRun(root,options);}}}:{})});t.after(()=>runtime.stop());
 const input={requestId:'route-request-1',conversationRef:'fixture:workbuddy-chat',question:Q};
 const send=(payload=input,profile='human',extra={})=>fetch(runtime.baseUrl+'/api/ceo/conversation',{method:'POST',headers:{'content-type':'application/json',...(profile?{authorization:'Bearer '+credentials[profile].token}:{}),...extra},body:JSON.stringify(payload)});
 return{root,runtime,input,send,calls:()=>calls,setOptions:x=>options=x,credentials};
}
test('existing Runtime handles a Human operating message through the isolated WorkBuddy route',async t=>{const x=await setup(t),r=await x.send();assert.equal(r.status,200);const body=await r.json();assert.equal(body.question,Q);assert.equal(body.sourceMode,'SYNTHETIC');assert.equal(body.formalContextStatus,'NOT_ELIGIBLE');assert.equal(x.calls(),1);assert.equal((await(await fetch(x.runtime.baseUrl+'/healthz')).json()).ready,false);});
test('conversation routing is disabled by default without changing legacy reads',async t=>{const x=await setup(t,{enabled:false});assert.equal((await x.send()).status,403);const me=await fetch(x.runtime.baseUrl+'/api/ceo/me',{headers:{authorization:'Bearer '+x.credentials.legacy.token}});assert.equal(me.status,200);assert.equal(x.calls(),0);});
test('missing auth, legacy and caller supplied authority do not reach backend',async t=>{const x=await setup(t);assert.equal((await x.send(x.input,null)).status,401);assert.equal((await x.send(x.input,'legacy')).status,403);assert.equal((await x.send({...x.input,principal:{profile:'human'}})).status,400);assert.equal(x.calls(),0);});
test('cross-origin conversation requests are rejected before collection',async t=>{const x=await setup(t);assert.equal((await x.send(x.input,'human',{origin:'https://foreign.invalid'})).status,403);assert.equal(x.calls(),0);});
test('an identical HTTP request is refused, never replayed from cache',async t=>{const x=await setup(t);assert.equal((await x.send()).status,200);assert.equal((await x.send()).status,409);assert.equal(x.calls(),1);});
test('a failed backend produces an error status and no business advice',async t=>{const x=await setup(t);x.setOptions({failed:true});const r=await x.send();assert.equal(r.status,502);const b=await r.json();assert.equal(b.status,'FAILED');assert.deepEqual(b.priorities,[]);});
test('no task or Workflow write route is introduced',async t=>{const x=await setup(t);for(const route of ['/api/ceo/import','/api/ceo/tasks/test/commands','/api/workflow/execute']){const r=await fetch(x.runtime.baseUrl+route,{method:'POST',headers:{authorization:'Bearer '+x.credentials.shadow.token,'content-type':'application/json'},body:JSON.stringify({requestId:'unsafe',storeId:'400370'})});assert.equal(r.status,403);}assert.equal(x.calls(),0);});
