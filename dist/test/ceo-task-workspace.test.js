import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fixture,agent,owner,now,evidence} from './fixtures/ceo-task-fixture.js';
import {ceoContextId} from '../src/ceo-operating-context.js';
import {readFile} from 'node:fs/promises';
const example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));

test('only allocated investigation tasks import; repeated import survives restart',async t=>{
 const x=await fixture(t),r=x.imported();assert.equal(r.tasks.length,3);assert.ok(r.tasks.every(v=>v.status==='PROPOSED'));
 assert.equal(x.workspace.importPlan(x.input).replayed,true);x.workspace.close();
 const again=new x.CeoTaskWorkspace({dbPath:path.join(x.dir,'tasks.sqlite')});x.resources.push(again);
 assert.equal(again.listTasks().length,3);assert.equal(again.getTask(r.tasks[0].taskId).effectStatus,'PENDING_OBSERVATION');
});
test('draft with unknown capacity does not become committed tasks',async t=>{
 const x=await fixture(t);x.context.goal.capacityMinutes=null;x.context.goal.version++;x.context.contextId=ceoContextId(x.context);
 const decision={...structuredClone(example.decision),decisionId:'uncommitted',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 const r=x.workspace.saveDraft({context:x.context,decision,candidates:example.candidates,expectedContextId:x.context.contextId,now});
 assert.throws(()=>x.workspace.importPlan({...x.input,context:x.context,planId:r.planId}),{code:'PLAN_NOT_COMMITTED'});
});
test('stale context and expired decision cannot import',async t=>{
 const x=await fixture(t);assert.throws(()=>x.workspace.importPlan({...x.input,context:{...x.context,contextId:'changed'}}),{code:'CONTEXT_CHANGED'});
 assert.throws(()=>x.workspace.importPlan({...x.input,now:new Date('2026-10-29T00:00:00Z')}),{code:'DECISION_EXPIRED'});
});
test('request role cannot approve and cross-store identity cannot read or write',async t=>{
 const x=await fixture(t),task=x.imported().tasks[0];
 assert.throws(()=>x.command(task,'approve',{expiresAt:'2026-10-27T07:00:00Z'},{actor:agent}),{code:'FORBIDDEN'});
 assert.throws(()=>x.workspace.importPlan({...x.input,actor:{...agent,storeId:'other'}}),{code:'FORBIDDEN'});
});
test('approval start report verify is durable and report alone is never done',async t=>{
 const x=await fixture(t),running=x.running();assert.equal(running.status,'RUNNING');assert.equal(running.attempt,1);
 const report=x.command(running,'report',{outcome:'REPORTED',summary:'人工工作已报告',evidence}).task;
 assert.equal(report.status,'PENDING_VERIFICATION');assert.equal(report.verification,null);
 assert.throws(()=>x.command(report,'verify',{accepted:true,note:'已审核'},{actor:agent}),{code:'FORBIDDEN'});
 const done=x.command(report,'verify',{accepted:true,note:'已核对验收及证据'}).task;
 assert.equal(done.status,'DONE');assert.equal(done.verification.kind,'HUMAN_ATTESTED');assert.equal(done.effectStatus,'PENDING_OBSERVATION');
 assert.equal(x.workspace.getEvents(done.taskId).length,5);
});
test('empty evidence or same actor verification cannot complete a task',async t=>{
 const x=await fixture(t),running=x.running();
 assert.throws(()=>x.command(running,'report',{outcome:'REPORTED',summary:'done',evidence:[]}),{code:'INVALID_EVIDENCE'});
 const report=x.command(running,'report',{outcome:'REPORTED',summary:'done',evidence}).task;
 assert.throws(()=>x.command(report,'verify',{accepted:true,note:'checked'},{actor:{...owner,id:agent.id}}),{code:'SELF_VERIFICATION'});
});
test('optimistic versions and repeated operations cannot create duplicate attempts',async t=>{
 const x=await fixture(t),ready=x.approved(),r=x.command(ready,'start',{}, {operationId:'start-one'});
 const retry=x.command(ready,'start',{}, {operationId:'start-one'});assert.equal(retry.replayed,true);assert.equal(retry.task.attempt,1);
 assert.throws(()=>x.command(ready,'start'),{code:'VERSION_CONFLICT'});
 assert.throws(()=>x.command(ready,'start',{different:true},{operationId:'start-one'}),{code:'OPERATION_CONFLICT'});
 assert.equal(x.workspace.getEvents(ready.taskId).filter(v=>v.command==='start').length,1);
});
test('approval expiry and changed context block start without changing task state',async t=>{
 const x=await fixture(t),ready=x.approved();
 assert.throws(()=>x.command(ready,'start',{}, {now:new Date('2026-10-27T07:00:01Z')}),{code:'APPROVAL_EXPIRED'});
 assert.throws(()=>x.command(ready,'start',{}, {context:{...x.context,contextId:'new-context'}}),{code:'CONTEXT_CHANGED'});
 assert.equal(x.workspace.getTask(ready.taskId).status,'READY');
});
test('dependency must be verified before starting dependent work',async t=>{
 const x=await fixture(t),task=x.imported().tasks.find(r=>r.definition.dependsOn.length);
 assert.throws(()=>x.command(task,'approve',{expiresAt:'2026-10-27T07:00:00Z'}),{code:'DEPENDENCY_BLOCKED'});
});
test('unknown outcome survives reopen and cannot be retried or approved',async t=>{
 const x=await fixture(t),running=x.running(),report=x.command(running,'report',{outcome:'UNKNOWN',summary:'结果未知',evidence:[]}).task;
 assert.equal(report.status,'PENDING_VERIFICATION');
 for(const c of ['start','approve','verify'])assert.throws(()=>x.command(report,c,{expiresAt:'2026-10-27T07:00:00Z',accepted:true,note:'checked'}),{code:'RESULT_UNKNOWN'});
 x.workspace.close();const other=new x.CeoTaskWorkspace({dbPath:path.join(x.dir,'tasks.sqlite')});x.resources.push(other);
 assert.equal(other.getTask(report.taskId).receipt.outcome,'UNKNOWN');
 const resolved=other.command({taskId:report.taskId,expectedVersion:report.version,command:'resolve-unknown',args:{result:'NOT_APPLIED',note:'已核对，没有产生结果',evidence},context:x.context,actor:owner,operationId:'resolve',now}).task;
 assert.equal(resolved.status,'BLOCKED');assert.equal(resolved.blocked.reason,'RESULT_NOT_APPLIED');
});
test('four blocker classes stay visible without implying task completion',async t=>{
 for(const kind of ['PERSON','DATA','DEPENDENCY','RESOURCE']){
  const x=await fixture(t),task=x.imported().tasks[0],r=x.command(task,'block',{kind,reason:'等待核验'}).task;
  assert.equal(r.status,'BLOCKED');assert.equal(r.blocked.kind,kind);assert.equal(r.verification,null);
 }
});
test('interrupting running work requires result reconciliation before a second attempt',async t=>{
 const x=await fixture(t),running=x.running();
 const stopped=x.command(running,'block',{kind:'RESOURCE',reason:'执行窗口中断，实际结果待查'}).task;
 assert.equal(stopped.status,'PENDING_VERIFICATION');assert.equal(stopped.receipt.outcome,'UNKNOWN');
 assert.equal(stopped.attempt,1);
 assert.throws(()=>x.command(stopped,'approve',{expiresAt:'2026-10-27T07:00:00Z'}),{code:'RESULT_UNKNOWN'});
 assert.throws(()=>x.command(stopped,'start'),{code:'RESULT_UNKNOWN'});
 const reconciled=x.command(stopped,'resolve-unknown',{result:'NOT_APPLIED',note:'证据确认未产生效果',evidence}).task;
 const approved=x.command(reconciled,'approve',{expiresAt:'2026-10-27T07:00:00Z'}).task;
 assert.equal(x.command(approved,'start').task.attempt,2);
});
test('replanning retains unfinished task ID and history while invalidating old approval',async t=>{
 const x=await fixture(t),ready=x.approved(),oldId=ready.taskId;
 x.context.dictionaryHash='updated-dictionary';x.context.contextId=ceoContextId(x.context);
 const decision={...structuredClone(example.decision),decisionId:'replanned-decision',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 const next=x.workspace.saveDraft({context:x.context,decision,candidates:example.candidates,expectedContextId:x.context.contextId,now});
 const expectedVersions=Object.fromEntries(x.workspace.listTasks().map(t=>[t.taskId,t.version]));
 const r=x.workspace.importPlan({...x.input,planId:next.planId,context:x.context,expectedVersions,operationId:'import-replan'});
 const revised=r.tasks.find(v=>v.taskId===oldId);
 assert.equal(revised.taskId,oldId);assert.equal(revised.version,ready.version+1);assert.equal(revised.contextId,x.context.contextId);
 assert.equal(revised.status,'PROPOSED');assert.equal(revised.approval,null);assert.equal(x.workspace.listTasks().length,3);
 assert.ok(x.workspace.getEvents(oldId).some(e=>e.command==='revise'&&e.args.previousTask.approval));
 assert.throws(()=>x.command(revised,'start'),{code:'INVALID_TRANSITION'});
});
test('replanning cannot replace a running or unknown-result attempt',async t=>{
 const x=await fixture(t),running=x.running();x.context.dictionaryHash='new';x.context.contextId=ceoContextId(x.context);
 const decision={...structuredClone(example.decision),decisionId:'unsafe-replan',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 const next=x.workspace.saveDraft({context:x.context,decision,candidates:example.candidates,expectedContextId:x.context.contextId,now});
 assert.throws(()=>x.workspace.importPlan({...x.input,planId:next.planId,context:x.context,operationId:'unsafe-import'}),{code:'TASK_IN_FLIGHT'});
 assert.equal(x.workspace.getTask(running.taskId).version,running.version);
});
test('stale import cannot replace a newer plan under the same operating context',async t=>{
 const x=await fixture(t),initial=x.imported(),expectedVersions=Object.fromEntries(initial.tasks.map(t=>[t.taskId,t.version]));
 const decision={...structuredClone(example.decision),decisionId:'newer-same-context',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 const candidates=structuredClone(example.candidates);candidates[0].title='Newer reviewed task definition';
 const next=x.workspace.saveDraft({context:x.context,decision,candidates,expectedContextId:x.context.contextId,now});
 x.workspace.importPlan({...x.input,planId:next.planId,expectedVersions,operationId:'newer-import'});
 const newTask=x.workspace.getTask(initial.tasks[0].taskId);
 assert.throws(()=>x.workspace.importPlan({...x.input,expectedVersions,operationId:'stale-old-page'}),{code:'VERSION_CONFLICT'});
 assert.throws(()=>x.workspace.importPlan({...x.input,operationId:'missing-expectations'}),{code:'VERSION_CONFLICT'});
 assert.deepEqual(x.workspace.getTask(newTask.taskId),newTask);
});
test('transaction failure rolls back state event and operation receipt',async t=>{
 const x=await fixture(t),task=x.imported().tasks[0],db=new DatabaseSync(path.join(x.dir,'tasks.sqlite'));x.resources.push(db);
 db.exec("CREATE TRIGGER event_fail BEFORE INSERT ON ceo_task_events WHEN NEW.command='approve' BEGIN SELECT RAISE(ABORT,'secret-location'); END;");
 assert.throws(()=>x.command(task,'approve',{expiresAt:'2026-10-27T07:00:00Z'}),e=>e.code==='STORAGE_FAILED'&&!e.message.includes('secret'));
 assert.equal(x.workspace.getTask(task.taskId).version,1);assert.equal(x.workspace.getTask(task.taskId).status,'PROPOSED');
 assert.equal(x.workspace.getEvents(task.taskId).length,1);
});
