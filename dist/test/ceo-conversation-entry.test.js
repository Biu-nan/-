import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {fixture,now} from './fixtures/ceo-task-fixture.js';
import {ceoContextId} from '../src/ceo-operating-context.js';
import {createCeoTaskServer} from '../src/ceo-task-http.js';

const example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
const credentials={owner:{id:'owner-local',storeId:'400370',token:'o'.repeat(48)},agent:{id:'agent-local',storeId:'400370',token:'a'.repeat(48)}};
async function setup(t){
 const x=await fixture(t);
 const server=createCeoTaskServer({workspace:x.workspace,manualFixtureRoot:x.dir,loadContext:async()=>x.context,credentials,now:()=>now});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const input={requestId:'entry-20261027-1',conversationRef:'test:ceo-business-chat',expectedContextId:x.context.contextId,
  decision:{...structuredClone(example.decision),decisionId:'decision-entry-1',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'},candidates:structuredClone(example.candidates)};
 const request=(payload=input,token=credentials.agent.token)=>fetch(base+'/api/ceo/drafts',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload)});
 const get=(id=input.requestId,token=credentials.agent.token)=>fetch(base+`/api/ceo/draft-requests/${id}`,{headers:{authorization:`Bearer ${token}`}});
 return{...x,base,input,request,get};
}

test('conversation draft is durably visible in the same plans API without importing or executing',async t=>{
 const x=await setup(t),response=await x.request();assert.equal(response.status,200);
 const receipt=await response.json();assert.equal(receipt.schema,'ceo-draft-receipt/v1');assert.equal(receipt.replayed,false);
 assert.deepEqual(receipt.entry,{requestId:x.input.requestId,conversationRef:x.input.conversationRef,actorId:'agent-local'});
 assert.equal(receipt.externalExecution,false);assert.equal(receipt.plan.capacity.availableMinutes,240);
 assert.equal(x.workspace.listTasks().length,0);x.workspace.close();
 assert.equal(x.workspace.getDraftRequest(x.input.requestId).planId,receipt.planId);
 const list=await(await fetch(x.base+'/api/ceo/plans',{headers:{authorization:`Bearer ${credentials.owner.token}`}})).json();
 assert.ok(list.plans.some(p=>p.planId===receipt.planId));assert.equal((await(await x.get()).json()).planId,receipt.planId);
});

test('same request replays the original receipt even after context changes without creating a new plan',async t=>{
 const x=await setup(t),first=await(await x.request()).json();assert.equal(first.replayed,false);
 x.context.goal.version++;x.context.contextId=ceoContextId(x.context);
 const again=await x.request();assert.equal(again.status,200);const result=await again.json();
 assert.equal(result.replayed,true);assert.equal(result.planId,first.planId);assert.equal(result.contextId,first.contextId);
 assert.equal(x.workspace.listPlans().length,2);
});

test('same request ID with changed content or conversation is rejected atomically',async t=>{
 const x=await setup(t);assert.equal((await x.request()).status,200);
 for(const changed of [{...x.input,conversationRef:'another-chat'},{...x.input,decision:{...x.input.decision,assumptions:['changed']}}]){
  const r=await x.request(changed);assert.equal(r.status,409);assert.equal((await r.json()).error,'OPERATION_CONFLICT');
 }
 assert.equal(x.workspace.listPlans().length,2);
});

test('unauthenticated, owner and request-body identity injections cannot submit drafts',async t=>{
 const x=await setup(t);
 assert.equal((await x.request(x.input,null)).status,401);
 assert.equal((await x.request(x.input,credentials.owner.token)).status,403);
 for(const extra of [{actor:{id:'owner-local'}},{facts:[]},{entryRequest:{actorId:'owner-local'}}])assert.equal((await x.request({...x.input,...extra})).status,400);
 assert.equal(x.workspace.listPlans().length,1);
});

test('stale context and invalid decisions cannot leave a request receipt',async t=>{
 const x=await setup(t);
 const stale=await x.request({...x.input,expectedContextId:'old-context'});assert.equal(stale.status,409);assert.equal((await stale.json()).error,'CONTEXT_CHANGED');
 const bad=await x.request({...x.input,decision:{}});assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_DECISION');
 assert.equal(x.workspace.getDraftRequest(x.input.requestId),null);assert.equal(x.workspace.listPlans().length,1);
});

test('draft is capacity bounded and external actions are never executed',async t=>{
 const x=await setup(t);x.input.candidates[0].estimatedMinutes=300;
 const r=await x.request();assert.equal(r.status,200);const result=await r.json();
 assert.ok(result.plan.capacity.usedMinutes<=240);assert.ok(result.plan.deferred.some(t=>t.reason==='CAPACITY_EXCEEDED'));
 assert.equal(result.externalExecution,false);assert.equal(x.workspace.listTasks().length,0);
});

test('receipt write failure rolls back draft, decision and context insertion',async t=>{
 const x=await setup(t);x.workspace.ready();
 x.workspace.db.exec("CREATE TRIGGER entry_failure BEFORE INSERT ON ceo_entry_draft_requests BEGIN SELECT RAISE(ABORT,'test receipt failure'); END");
 const r=await x.request();assert.equal(r.status,503);assert.equal((await r.json()).error,'STORAGE_FAILED');
 assert.equal(x.workspace.listPlans().length,1);assert.equal(x.workspace.getDraftRequest(x.input.requestId),null);
 assert.equal(x.workspace.db.prepare('SELECT count(*) AS n FROM ceo_decision_versions WHERE decision_id=?').get(x.input.decision.decisionId).n,0);
});

test('missing receipt and malformed request IDs have explicit safe errors',async t=>{
 const x=await setup(t);assert.equal((await x.get('missing')).status,404);
 for(const requestId of ['', '../x', 'x'.repeat(161)])assert.equal((await x.request({...x.input,requestId})).status,400);
 assert.equal(x.workspace.listPlans().length,1);
});

test('a different authenticated agent cannot read or reuse another entry request',async t=>{
 const x=await setup(t);assert.equal((await x.request()).status,200);
 const other={...credentials,agent:{...credentials.agent,id:'other-agent',token:'b'.repeat(48)}};
 const server=createCeoTaskServer({workspace:x.workspace,manualFixtureRoot:x.dir,loadContext:async()=>x.context,credentials:other,now:()=>now});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`,headers={authorization:`Bearer ${other.agent.token}`};
 assert.equal((await fetch(base+`/api/ceo/draft-requests/${x.input.requestId}`,{headers})).status,403);
 const r=await fetch(base+'/api/ceo/drafts',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(x.input)});assert.equal(r.status,409);
});
