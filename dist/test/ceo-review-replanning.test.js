import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture,now,owner,agent} from './fixtures/ceo-task-fixture.js';
const module=await import('../src/ceo-review-replanning.js').catch(()=>({}));
const example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
export async function replanFixture(t){
 const x=await fixture(t),tasks=x.imported().tasks;
 const brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false,timeZone:'Asia/Shanghai'},days:[{date:'2026-10-27',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))},{date:'2026-10-28',theme:'次日建议',actions:tasks.map(t=>({sourceTaskRef:t.taskId}))}]};
 const review=x.workspace.saveDailyReview({brief,context:x.context,actor:owner,operationId:'replan-input-review',date:'2026-10-27',note:'合成复盘：费用仍待核，不执行让价',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(t=>[t.taskId,t.version])),now}).review;
 const input={context:x.context,brief,actor:agent,requestId:'replan-test-1',conversationRef:'test:ceo-replan',expectedContextId:x.context.contextId,decision:{...structuredClone(example.decision),decisionId:'review-bound-decision',goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'},candidates:tasks.map(t=>structuredClone(t.definition)),now,assertInputsCurrent:()=>{}};
 const packet=()=>x.workspace.getReplanningBrief({context:x.context,brief,now});
 const bind=()=>{const p=packet();return{reviewId:review.reviewId,reviewHash:p.reviewHash,packetId:p.packetId,expectedTaskVersions:p.expectedTaskVersions,dispositions:tasks.map(t=>({taskId:t.taskId,choice:'REPLAN',reason:'保留原工作继续补证'})),rationale:'依据已存档复盘，继续调查缺项，不编造利润。'};};
 return{...x,tasks,brief,review,input,packet,bind,save:(extra={})=>x.workspace.saveReviewReplan({...input,reviewBinding:bind(),...extra})};
}

test('packet explicitly needs a real review and excludes demo completion from operating work',async t=>{
 const x=await fixture(t),tasks=x.imported().tasks;assert.equal(typeof module.buildCeoReplanningBrief,'function');
 const r=module.buildCeoReplanningBrief({context:x.context,brief:{status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{isExpired:false}},reviews:[],tasks:[...tasks,{taskId:'DEMO-DONE',status:'DONE',definition:{storeRef:{environmentId:'400370'}}}],now});
 assert.equal(r.status,'NEEDS_REVIEW');assert.equal(r.canSubmit,false);assert.equal(r.tasks.length,3);assert.equal(r.businessEffectStatus,'PENDING_OBSERVATION');
});
test('review-bound draft is durable, visible with its link, idempotent and never imports tasks',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');
 const before=x.workspace.listTasks(),events=before.map(t=>x.workspace.getEvents(t.taskId)),binding=x.bind();
 const result=x.save({reviewBinding:binding});assert.equal(result.reviewLink.reviewId,x.review.reviewId);assert.equal(result.externalExecution,false);assert.equal(result.replayed,false);
 assert.equal(x.save({reviewBinding:binding}).replayed,true);assert.deepEqual(x.workspace.listTasks(),before);assert.deepEqual(before.map(t=>x.workspace.getEvents(t.taskId)),events);
 assert.equal(x.workspace.listPlans().find(p=>p.planId===result.planId).reviewLink.reviewId,x.review.reviewId);
 x.workspace.close();const reopen=new x.CeoTaskWorkspace({dbPath:path.join(x.dir,'tasks.sqlite')});x.resources.push(reopen);assert.deepEqual(reopen.getDraftRequest(x.input.requestId).reviewLink,result.reviewLink);
 assert.throws(()=>reopen.saveReviewReplan({...x.input,reviewBinding:{...binding,rationale:'不同判断'}}),{code:'OPERATION_CONFLICT'});
});
test('current task changes invalidate packet but remain visible as changed since the historical review',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.getReplanningBrief,'function');const binding=x.bind();
 x.command(x.tasks[0],'block',{kind:'DATA',reason:'新缺项'});assert.throws(()=>x.save({reviewBinding:binding}),{code:'REPLAN_INPUT_CHANGED'});
 const p=x.packet();assert.ok(p.changedSinceReview.includes(x.tasks[0].taskId));assert.equal(p.canSubmit,true);assert.equal(x.workspace.getDraftRequest(x.input.requestId),null);assert.equal(x.workspace.listPlans().length,1);
});
test('all current tasks have one explicit disposition and REPLAN candidates retain original IDs',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');
 const binding=x.bind();for(const bad of [{...binding,dispositions:binding.dispositions.slice(1)},{...binding,dispositions:[...binding.dispositions,binding.dispositions[0]]},{...binding,expectedTaskVersions:{}}])assert.throws(()=>x.save({reviewBinding:bad}),{code:'REPLAN_BINDING_INVALID'});
 const candidates=structuredClone(x.input.candidates),original=candidates[0].taskId;candidates[0].taskId='store-400370-copy-of-old-work';for(const c of candidates)c.dependsOn=c.dependsOn.map(id=>id===original?candidates[0].taskId:id);assert.throws(()=>x.save({candidates}),{code:'REPLAN_BINDING_INVALID'});
 assert.equal(x.workspace.listPlans().length,1);
});
test('running, pending verification and UNKNOWN tasks may only WAIT; DONE may only OBSERVE',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');
 let task=x.running();task=x.command(task,'report',{outcome:'UNKNOWN',summary:'尚不确定',evidence:[]}).task;
 const binding=x.bind();assert.throws(()=>x.save({reviewBinding:binding}),{code:'REPLAN_IN_FLIGHT'});
 binding.dispositions.find(d=>d.taskId===task.taskId).choice='WAIT';const result=x.save({reviewBinding:binding,candidates:x.input.candidates.filter(c=>c.taskId!==task.taskId)});
 assert.equal(result.plan.tasks.some(t=>t.taskId===task.taskId),false);assert.equal(x.workspace.getTask(task.taskId).receipt.outcome,'UNKNOWN');
 assert.ok(result.plan.blocked.some(t=>t.dependsOn.includes(task.taskId)&&t.reason==='DEPENDENCY_BLOCKED'));
});
test('new latest review, stale source/context, or guard drift cannot leave a new plan or entry receipt',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');const binding=x.bind();
 for(const extra of [{brief:{...x.brief,sourceId:'c'.repeat(64)}},{expectedContextId:'old'}])assert.throws(()=>x.save({...extra,reviewBinding:binding}),e=>['REPLAN_INPUT_CHANGED','CONTEXT_CHANGED'].includes(e.code));
 assert.throws(()=>x.save({assertInputsCurrent:()=>{throw Object.assign(new Error('CONTEXT_CHANGED'),{code:'CONTEXT_CHANGED'});}}),{code:'CONTEXT_CHANGED'});
 assert.throws(()=>x.save({assertInputsCurrent:()=>{throw Object.assign(new Error('REVIEW_SOURCE_CHANGED'),{code:'REVIEW_SOURCE_CHANGED'});}}),{code:'REVIEW_SOURCE_CHANGED'});
 assert.equal(x.workspace.listPlans().length,1);assert.equal(x.workspace.getDraftRequest(x.input.requestId),null);
 x.workspace.saveDailyReview({brief:x.brief,context:x.context,actor:owner,operationId:'updated-owner-review',date:'2026-10-27',note:'补充新的复盘说明',expectedContextId:x.context.contextId,expectedSourceId:x.brief.sourceId,expectedTaskVersions:binding.expectedTaskVersions,now:new Date(now.getTime()+1000)});
 assert.throws(()=>x.save({reviewBinding:binding}),{code:'REPLAN_INPUT_CHANGED'});assert.equal(x.workspace.listPlans().length,1);
});
test('existing unlinked draft cannot be relabeled as review-derived after the fact',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');
 const decision={...structuredClone(example.decision),goalVersion:x.context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 assert.throws(()=>x.save({decision}),{code:'REPLAN_REQUIRES_NEW_PLAN'});assert.equal(x.workspace.listPlans().length,1);
});
test('verified external dependency remains on the original definition without recreating the DONE task',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');
 let completed=x.running();completed=x.command(completed,'report',{outcome:'REPORTED',summary:'合成证据',evidence:x.evidence}).task;completed=x.command(completed,'verify',{accepted:true,note:'仅测试核验'}).task;
 const binding=x.bind();binding.dispositions.find(d=>d.taskId===completed.taskId).choice='OBSERVE';
 const r=x.save({reviewBinding:binding,candidates:x.input.candidates.filter(t=>t.taskId!==completed.taskId)});
 assert.equal(r.plan.tasks.some(t=>t.taskId===completed.taskId),false);assert.ok(r.plan.tasks.find(t=>t.dependsOn.includes(completed.taskId)));assert.equal(x.workspace.getTask(completed.taskId).status,'DONE');
});
test('owner cannot submit CEO replan and failed link insert rolls back all draft tables',async t=>{
 const x=await replanFixture(t);assert.equal(typeof x.workspace.saveReviewReplan,'function');assert.throws(()=>x.save({actor:owner}),{code:'FORBIDDEN'});
 x.workspace.db.exec("CREATE TRIGGER fail_replan_link BEFORE INSERT ON ceo_plan_review_links BEGIN SELECT RAISE(ABORT,'private location'); END;");
 assert.throws(()=>x.save(),e=>e.code==='STORAGE_FAILED'&&!e.message.includes('private'));
 assert.equal(x.workspace.listPlans().length,1);assert.equal(x.workspace.getDraftRequest(x.input.requestId),null);assert.equal(x.workspace.db.prepare('SELECT count(*) n FROM ceo_decision_versions WHERE decision_id=?').get(x.input.decision.decisionId).n,0);
});
