import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const api=await import('../src/ceo-isolated-runtime.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
async function setup(t){
 assert.equal(typeof api.startIsolatedCeoRuntime,'function','guarded runtime entry missing');
 const root=await mkdtemp(path.join(os.tmpdir(),'g1-entry-')),codeRoot=path.join(root,'code'),dataRoot=path.join(root,'data');await mkdir(codeRoot);await mkdir(dataRoot);
 await writeFile(path.join(dataRoot,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 const files={code:['entry.js'],frontend:['panel.js'],contracts:['schema.json'],policy:['policy.json']};for(const f of Object.values(files).flat())await writeFile(path.join(codeRoot,f),'fixture');
 const credentials={legacy:{id:'legacy',profile:'legacy',role:'agent',storeId:'400370',token:'l'.repeat(48)},shadow:{id:'shadow',profile:'shadow',role:'agent',storeId:'400370',token:'s'.repeat(48)},human:{id:'human',profile:'human',role:'owner',storeId:'400370',token:'h'.repeat(48)}};
 const effects=[],snapshot={contextId:'fixture-context',observedAt:'2026-11-05T00:00:00Z'},tasks=[{taskId:'synthetic-task',version:3,status:'PENDING_VERIFICATION'}];
 const options={codeRoot,dataRoot,files,credentials,releaseId:'isolated-g1',bindingConfirmed:true,queries:{context:async()=>snapshot,tasks:async()=>({tasks})},feedback:async x=>{effects.push(x);return{saved:true};}};
 const runtime=await api.startIsolatedCeoRuntime(options);t.after(()=>runtime.stop());
 const request=(route,{profile='legacy',method='GET',body,headers={}}={})=>fetch(runtime.baseUrl+route,{method,headers:{authorization:'Bearer '+credentials[profile].token,...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
 return{root,codeRoot,dataRoot,files,options,runtime,request,tasks,snapshot,effects};
}
test('actual guarded runtime serves version, healthy state and fixture queries from one owned instance',async t=>{
 const x=await setup(t),before=await readdir(x.dataRoot);
 const h=await(await fetch(x.runtime.baseUrl+'/healthz')).json();assert.equal(h.ready,true);assert.equal(h.releaseId,'isolated-g1');assert.equal(h.instanceId,x.runtime.identity.instanceId);
 assert.deepEqual(await(await x.request('/api/ceo/context')).json(),x.snapshot);assert.deepEqual(await(await x.request('/api/ceo/tasks')).json(),{tasks:x.tasks});assert.deepEqual(await readdir(x.dataRoot),before);
});
test('a second launch cannot displace the original listener; shutdown releases only its own lease',async t=>{
 const x=await setup(t);await assert.rejects(()=>api.startIsolatedCeoRuntime(x.options),{code:'INSTANCE_ALREADY_RUNNING'});
 assert.equal((await fetch(x.runtime.baseUrl+'/healthz')).status,200);await x.runtime.stop();
 const restarted=await api.startIsolatedCeoRuntime(x.options);assert.notEqual(restarted.identity.instanceId,x.runtime.identity.instanceId);await restarted.stop();
});
test('runtime denies every unregistered mutation and unsafe legacy GET before query or workflow effects',async t=>{
 const x=await setup(t);for(const profile of ['legacy','shadow'])for(const [method,route]of [['POST','/api/ceo/import'],['POST','/api/ceo/tasks/synthetic-task/commands'],['POST','/api/draft/execute'],['POST','/api/listing/run'],['GET','/api/status'],['GET','/api/events']]){
  const r=await x.request(route,{profile,method,body:method==='POST'?{role:'owner',command:'approve',operationId:'forged',commit:true}:undefined});assert.equal(r.status,403,route);
 }assert.deepEqual(x.effects,[]);
});
test('runtime preserves human feedback rights and rejects spoofed owner and duplicate request',async t=>{
 const x=await setup(t),body={operationId:'feedback-1',storeId:'400370',note:'synthetic human feedback'};
 assert.equal((await x.request('/api/ceo-shadow/feedback',{profile:'shadow',method:'POST',body:{...body,role:'owner'}})).status,403);
 assert.equal((await x.request('/api/ceo-shadow/feedback',{profile:'human',method:'POST',body})).status,200);
 assert.equal((await x.request('/api/ceo-shadow/feedback',{profile:'human',method:'POST',body})).status,409);
 assert.equal(x.effects.length,1);assert.equal(x.effects[0].actor.id,'human');
});
test('launch refuses absent fixture marker and leaves unknown directories untouched',async t=>{
 const x=await setup(t),unconfirmed=path.join(x.root,'unconfirmed');await mkdir(unconfirmed);const before=await readdir(unconfirmed);
 await assert.rejects(()=>api.startIsolatedCeoRuntime({...x.options,dataRoot:unconfirmed}),{code:'ISOLATED_FIXTURE_REQUIRED'});assert.deepEqual(await readdir(unconfirmed),before);
});
