import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fixture,now} from './fixtures/ceo-task-fixture.js';
import {mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const credentials={owner:{id:'owner-local',storeId:'400370',token:'o'.repeat(48)},agent:{id:'agent-local',storeId:'400370',token:'a'.repeat(48)}};
test('local evidence GET is authenticated and read-only; acceptance rechecks inside transaction and replay survives lost originals',async t=>{
 const module=await import('../src/ceo-task-evidence.js').catch(()=>({}));
 let root;const x=await setup(t,{checkEvidence:task=>module.checkCeoTaskEvidence({projectRoot:root,task})});root=x.dir;
 const dir=path.join(root,'data','audit-store-400370');await mkdir(dir,{recursive:true});const file=path.join(dir,'proof.txt');await writeFile(file,'original');
 const ev=[{reference:path.relative(root,file),sha256:createHash('sha256').update('original').digest('hex'),summary:'合成记录'}];
 const task=x.command(x.running(),'report',{outcome:'REPORTED',summary:'合成回执',evidence:ev}).task;
 const endpoint=`/api/ceo/tasks/${encodeURIComponent(task.taskId)}/evidence-check`,cmd=`/api/ceo/tasks/${encodeURIComponent(task.taskId)}/commands`;
 assert.equal((await fetch(x.base+endpoint)).status,401);const before=x.workspace.getEvents(task.taskId);
 const first=await x.request(endpoint);assert.equal(first.status,200);const check=await first.json();assert.equal(check.status,'MATCH');assert.deepEqual(x.workspace.getEvents(task.taskId),before);assert.deepEqual(x.workspace.getTask(task.taskId),task);
 const payload={command:'verify',expectedVersion:task.version,operationId:'evidence-verify',args:{accepted:true,note:'人工核对业务验收',evidenceCheckId:check.checkId}};
 assert.equal((await x.request(cmd,{...payload,args:{accepted:true,note:'漏查原件'}},'owner')).status,409);
 const wrong=await x.request(cmd,{...payload,args:{...payload.args,evidenceCheckId:'0'.repeat(64)}},'owner');assert.equal(wrong.status,409);assert.equal((await wrong.json()).error,'EVIDENCE_CHECK_STALE');
 await writeFile(file,'changed');const stale=await x.request(cmd,payload,'owner');assert.equal(stale.status,409);assert.equal((await stale.json()).error,'EVIDENCE_CHECK_FAILED');assert.deepEqual(x.workspace.getTask(task.taskId),task);assert.deepEqual(x.workspace.getEvents(task.taskId),before);
 assert.equal(x.workspace.db.prepare('SELECT count(*) n FROM ceo_task_operations WHERE operation_id=?').get(payload.operationId).n,0);
 await writeFile(file,'original');const accepted=await x.request(cmd,payload,'owner');assert.equal(accepted.status,200);const receipt=await accepted.json();assert.equal(receipt.task.status,'DONE');assert.equal(receipt.task.verification.evidenceIntegrity.checkId,check.checkId);assert.equal(receipt.task.effectStatus,'PENDING_OBSERVATION');
 await rm(file);assert.equal((await(await x.request(cmd,payload,'owner')).json()).replayed,true);
});
test('business acceptance fails closed without configured checker while negative human verdict remains possible',async t=>{
 const x=await setup(t),task=x.command(x.running(),'report',{outcome:'REPORTED',summary:'合成回执',evidence:x.evidence}).task;
 assert.match(task.taskId,/^store-400370-/);
 const route=`/api/ceo/tasks/${encodeURIComponent(task.taskId)}/commands`,payload={command:'verify',expectedVersion:task.version,operationId:'unconfigured-verify',args:{accepted:true,note:'人工核验'}};
 const r=await x.request(route,payload,'owner');assert.equal(r.status,409);assert.equal((await r.json()).error,'EVIDENCE_CHECK_UNAVAILABLE');
 assert.equal((await x.request(route,{...payload,args:{accepted:false,note:'资料不足退回'}},'owner')).status,200);assert.equal(x.workspace.getTask(task.taskId).status,'BLOCKED');
});
async function setup(t,options={}){
 const x=await fixture(t),{createCeoTaskServer}=await import('../src/ceo-task-http.js');
 const server=createCeoTaskServer({workspace:x.workspace,manualFixtureRoot:x.dir,loadContext:async()=>x.context,captureReviewInputs:()=>()=>{},credentials,now:()=>now,...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(route,body,role='agent',headers={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${credentials[role].token}`,...(body===undefined?{}:{'content-type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return{...x,base,server,request};
}
test('API import and direct local reads share one durable task record',async t=>{
 const x=await setup(t),r=await x.request('/api/ceo/import',{planId:x.plan.planId,operationId:'api-import'});assert.equal(r.status,200);
 const receipt=await r.json();assert.equal(receipt.tasks.length,3);
 const list=await(await x.request('/api/ceo/tasks')).json();assert.equal(list.tasks.length,3);
 assert.equal(x.workspace.getTask(receipt.tasks[0].taskId).version,1);
 assert.equal((await(await x.request('/api/ceo/plans')).json()).plans.length,1);
});

test('daily review route is owner-only, rejects injected identity, and GET never creates a review',async t=>{
 const x=await setup(t);assert.equal((await x.request('/api/ceo/daily-reviews')).status,200);
 assert.deepEqual(await(await x.request('/api/ceo/daily-reviews')).json(),{reviews:[]});
 assert.equal((await fetch(x.base+'/api/ceo/daily-reviews')).status,401);
 const input={operationId:'review-route-1',date:'2026-10-27',expectedContextId:x.context.contextId,expectedSourceId:'b'.repeat(64),expectedTaskVersions:{},note:'合成复盘'};
 assert.equal((await x.request('/api/ceo/daily-reviews',input)).status,403);
 assert.equal((await x.request('/api/ceo/daily-reviews',{...input,actor:{role:'owner'}},'owner')).status,400);
 assert.equal((await x.request('/api/ceo/daily-reviews',input,'owner')).status,409);
 assert.deepEqual(x.workspace.listDailyReviews(),[]);
});

test('daily review API uses current server tasks and preserves request idempotency',async t=>{
 let brief;
 const x=await setup(t,{loadBrief:async()=>brief}),tasks=x.imported().tasks;
 brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false},days:[{date:'2026-10-27',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))}]};
 const before=x.workspace.listTasks(),input={operationId:'review-save-1',date:'2026-10-27',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(t=>[t.taskId,t.version])),note:'合成复盘，不是经营结果'};
 const r=await x.request('/api/ceo/daily-reviews',input,'owner');assert.equal(r.status,200);const first=await r.json();assert.equal(first.replayed,false);
 assert.equal((await(await x.request('/api/ceo/daily-reviews',input,'owner')).json()).replayed,true);
 assert.deepEqual((await(await x.request('/api/ceo/daily-reviews')).json()).reviews,[first.review]);assert.deepEqual(x.workspace.listTasks(),before);
 const conflict=await x.request('/api/ceo/daily-reviews',{...input,note:'不同内容'},'owner');assert.equal(conflict.status,409);
});
test('daily review commit rejects source or context drift during awaited input loading',async t=>{
 for(const code of ['CONTEXT_CHANGED','REVIEW_SOURCE_CHANGED']){
  let generation=1,brief;
  const x=await setup(t,{captureReviewInputs:()=>{const captured=generation;return()=>{if(generation!==captured)throw Object.assign(new Error(code),{code});};},loadBrief:async()=>{generation++;return brief;}}),tasks=x.imported().tasks;
  brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false},days:[{date:'2026-10-27',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))}]};
  const input={operationId:'drift-review-'+code,date:'2026-10-27',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(t=>[t.taskId,t.version])),note:'漂移拒绝测试'};
  const r=await x.request('/api/ceo/daily-reviews',input,'owner');assert.equal(r.status,409);assert.equal((await r.json()).error,code);assert.deepEqual(x.workspace.listDailyReviews(),[]);
  assert.equal(x.workspace.db.prepare('SELECT count(*) n FROM ceo_task_operations WHERE operation_id=?').get(input.operationId).n,0);
 }
});
test('replanning reads real review and agent draft stores its immutable link without task writes',async t=>{
 let brief,inputsAvailable=true;const x=await setup(t,{captureReviewInputs:()=>{if(!inputsAvailable)throw Object.assign(new Error(),{code:'REVIEW_SOURCE_UNAVAILABLE'});return()=>{};},loadBrief:async()=>brief}),tasks=x.imported().tasks;
 brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false},days:[{date:'2026-10-27',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))}]};
 const get=()=>x.request('/api/ceo/replanning-brief');assert.equal((await get()).status,200);assert.equal((await(await get()).json()).status,'NEEDS_REVIEW');
 const review=x.workspace.saveDailyReview({brief,context:x.context,actor:{id:'owner-local',role:'owner',storeId:'400370'},operationId:'http-replan-review',date:'2026-10-27',note:'合成复盘仍缺证',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(t=>[t.taskId,t.version])),now}).review;
 const packet=await(await get()).json(),example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
 const input={requestId:'http-replan-1',conversationRef:'test:ceo',expectedContextId:x.context.contextId,decision:{...example.decision,goalVersion:x.context.goal.version,decisionId:'http-replan-decision',reviewAt:'2026-10-28T06:00:00Z'},candidates:tasks.map(t=>t.definition),reviewBinding:{reviewId:review.reviewId,reviewHash:packet.reviewHash,packetId:packet.packetId,expectedTaskVersions:packet.expectedTaskVersions,dispositions:tasks.map(t=>({taskId:t.taskId,choice:'REPLAN',reason:'继续补证'})),rationale:'缺证时保留调查，不执行价格变更'}};
 assert.equal((await x.request('/api/ceo/replans',input,'owner')).status,403);assert.equal((await x.request('/api/ceo/replans',{...input,actor:{role:'owner'}})).status,400);
 assert.equal((await fetch(x.base+'/api/ceo/replanning-brief')).status,401);
 const before=x.workspace.listTasks(),saved=await x.request('/api/ceo/replans',input);assert.equal(saved.status,200);const receipt=await saved.json();assert.equal(receipt.reviewLink.reviewId,review.reviewId);assert.equal((await(await x.request('/api/ceo/replans',input)).json()).replayed,true);assert.deepEqual(x.workspace.listTasks(),before);
 assert.ok((await(await x.request('/api/ceo/plans')).json()).plans.some(p=>p.reviewLink?.reviewId===review.reviewId));
 inputsAvailable=false;const replay=await x.request('/api/ceo/replans',input);assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
 const changed=await x.request('/api/ceo/replans',{...input,reviewBinding:{...input.reviewBinding,rationale:'不同判断'}});assert.equal(changed.status,409);assert.equal((await changed.json()).error,'OPERATION_CONFLICT');
});
test('replan awaited-source drift rolls back draft and entry rather than committing stale reasoning',async t=>{
 let generation=1,brief;
 const x=await setup(t,{captureReviewInputs:()=>{const at=generation;return()=>{if(at!==generation)throw Object.assign(new Error(),{code:'REVIEW_SOURCE_CHANGED'});};},loadBrief:async()=>{generation++;return brief;}}),tasks=x.imported().tasks;
 brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false},days:[{date:'2026-10-27',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))}]};
 x.workspace.saveDailyReview({brief,context:x.context,actor:{id:'owner-local',role:'owner',storeId:'400370'},operationId:'http-drift-review',date:'2026-10-27',note:'合成复盘',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(t=>[t.taskId,t.version])),now});
 const packet=x.workspace.getReplanningBrief({context:x.context,brief}),example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
 const input={requestId:'http-drift-replan',conversationRef:'test:ceo',expectedContextId:x.context.contextId,decision:{...example.decision,goalVersion:x.context.goal.version,decisionId:'http-drift-decision',reviewAt:'2026-10-28T06:00:00Z'},candidates:tasks.map(t=>t.definition),reviewBinding:{reviewId:packet.review.reviewId,reviewHash:packet.reviewHash,packetId:packet.packetId,expectedTaskVersions:packet.expectedTaskVersions,dispositions:tasks.map(t=>({taskId:t.taskId,choice:'REPLAN',reason:'继续补证'})),rationale:'继续调查'}};
 const r=await x.request('/api/ceo/replans',input);assert.equal(r.status,409);assert.equal((await r.json()).error,'REVIEW_SOURCE_CHANGED');assert.equal(x.workspace.listPlans().length,1);assert.equal(x.workspace.getDraftRequest(input.requestId),null);
});
test('unauthenticated calls and actor injection fail without mutation',async t=>{
 const x=await setup(t);assert.equal((await fetch(x.base+'/api/ceo/tasks')).status,401);
 const r=await x.request('/api/ceo/import',{planId:x.plan.planId,operationId:'forged',actor:{role:'owner'}});assert.equal(r.status,400);
 assert.equal(x.workspace.listTasks().length,0);
});
test('agent cannot approve by sending owner-looking fields or credentials',async t=>{
 const x=await setup(t),task=x.imported().tasks[0];
 const r=await x.request(`/api/ceo/tasks/${task.taskId}/commands`,{expectedVersion:1,command:'approve',args:{expiresAt:'2026-10-27T07:00:00Z'},operationId:'agent-approve'});
 assert.equal(r.status,403);assert.equal(x.workspace.getTask(task.taskId).status,'PROPOSED');
});
test('host rebinding and foreign Origin requests are rejected',async t=>{
 const x=await setup(t);
 const status=await new Promise((resolve,reject)=>{const r=http.get(x.base+'/api/ceo/tasks',{headers:{host:'evil.example',authorization:`Bearer ${credentials.agent.token}`}},s=>{s.resume();s.on('end',()=>resolve(s.statusCode));});r.on('error',reject);});
 assert.equal(status,403);
 assert.equal((await x.request('/api/ceo/import',{planId:x.plan.planId,operationId:'foreign'},'agent',{origin:'https://evil.example'})).status,403);
});
test('browser session cookies are HttpOnly and require same Origin for writes',async t=>{
 const x=await setup(t),r=await fetch(x.base+'/api/ceo/session',{method:'POST',headers:{'content-type':'application/json',origin:x.base},body:JSON.stringify({token:credentials.owner.token})});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const auth=await fetch(x.base+'/api/ceo/tasks',{headers:{cookie}});assert.equal(auth.status,200);
 const task=x.imported().tasks[0],body={command:'approve',expectedVersion:1,operationId:'session-approve',args:{expiresAt:'2026-10-27T07:00:00Z'}};
 const noOrigin=await fetch(x.base+`/api/ceo/tasks/${task.taskId}/commands`,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(noOrigin.status,403);
 const okay=await fetch(x.base+`/api/ceo/tasks/${task.taskId}/commands`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:x.base},body:JSON.stringify(body)});assert.equal(okay.status,200);
});
test('oversized or malformed JSON and unknown routes never import tasks',async t=>{
 const x=await setup(t);
 const huge=await x.request('/api/ceo/import',{planId:'x'.repeat(70000),operationId:'huge'});assert.equal(huge.status,413);
 const bad=await fetch(x.base+'/api/ceo/import',{method:'POST',headers:{authorization:`Bearer ${credentials.agent.token}`,'content-type':'application/json'},body:'not json'});assert.equal(bad.status,400);
 assert.equal((await x.request('/api/ceo/execute-store',{operationId:'no'})).status,404);assert.equal(x.workspace.listTasks().length,0);
});
test('configuration rejects reused identities and tokens',async t=>{
 const x=await fixture(t),{createCeoTaskServer}=await import('../src/ceo-task-http.js');
 for(const bad of [{...credentials,owner:{...credentials.owner,id:credentials.agent.id}},{...credentials,owner:{...credentials.owner,token:credentials.agent.token}}])
  assert.throws(()=>createCeoTaskServer({workspace:x.workspace,loadContext:async()=>x.context,credentials:bad}),{code:'INVALID_CREDENTIALS'});
});

test('operating brief uses existing authentication and repeated GET never mutates task records',async t=>{
 let reads=0;
 const x=await setup(t,{loadBrief:async({tasks})=>{reads++;return{schema:'ceo-operating-brief/v1',status:'AVAILABLE',taskCount:tasks.length};}});
 const before=structuredClone(x.workspace.listTasks());
 assert.equal((await fetch(x.base+'/api/ceo/operating-brief')).status,401);
 for(const role of ['owner','agent']){
  const response=await x.request('/api/ceo/operating-brief',undefined,role);assert.equal(response.status,200);
  assert.equal((await response.json()).status,'AVAILABLE');
 }
 assert.equal(reads,2);assert.deepEqual(x.workspace.listTasks(),before);
 assert.equal((await x.request('/api/ceo/operating-brief',{},'agent')).status,404);
});

test('unconfigured operating brief does not break existing task API',async t=>{
 const x=await setup(t),r=await x.request('/api/ceo/operating-brief');assert.equal(r.status,200);
 assert.equal((await r.json()).status,'NOT_CONFIGURED');assert.equal((await x.request('/api/ceo/tasks')).status,200);
});
test('trusted command center can preflight and authenticate but origin is never authority',async t=>{
 const origin='http://127.0.0.1:3000',x=await setup(t,{commandCenterOrigins:[origin]});
 const pre=await fetch(x.base+'/api/ceo/session',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
 assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),origin);assert.equal(pre.headers.get('access-control-allow-credentials'),'true');
 const noAuth=await fetch(x.base+'/api/ceo/tasks',{headers:{origin}});assert.equal(noAuth.status,401);
 const login=await fetch(x.base+'/api/ceo/session',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:credentials.owner.token})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');
 const task=x.imported().tasks[0];
 const approve=await fetch(x.base+`/api/ceo/tasks/${task.taskId}/commands`,{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({command:'approve',args:{expiresAt:'2026-10-27T07:00:00Z'},expectedVersion:1,operationId:'embedded-owner'})});
 assert.equal(approve.status,200);assert.equal(x.workspace.getTask(task.taskId).status,'READY');
 assert.equal((await fetch(x.base+'/api/ceo/tasks',{headers:{origin:'http://evil.example:3000',cookie}})).status,403);
 assert.equal((await fetch(x.base+'/api/ceo/tasks',{headers:{origin:'http://localhost:3000',cookie}})).status,403);
});
