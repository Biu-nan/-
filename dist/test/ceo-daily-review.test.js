import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {fixture,now,owner,agent} from './fixtures/ceo-task-fixture.js';
import {ceoContextId} from '../src/ceo-operating-context.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {briefFixture} from './fixtures/ceo-operating-brief-fixture.js';
const module=await import('../src/ceo-daily-review.js').catch(()=>({}));
const guardModule=await import('../src/ceo-review-input-guard.js').catch(()=>({}));
async function setup(t){
 const x=await fixture(t),tasks=x.imported().tasks;
 const brief={status:'AVAILABLE',readOnly:true,sourceId:'b'.repeat(64),plan:{today:'2026-10-27',isExpired:false,timeZone:'Asia/Shanghai'},days:[{date:'2026-10-27',actions:tasks.map(task=>({sourceTaskRef:task.taskId}))},{date:'2026-10-28',theme:'次日待核',actions:tasks.map(task=>({sourceTaskRef:task.taskId}))}]};
 const input={brief,context:x.context,actor:owner,operationId:'review-1',date:'2026-10-27',note:'今日还有证据待核，不据此判断经营改善。',expectedContextId:x.context.contextId,expectedSourceId:brief.sourceId,expectedTaskVersions:Object.fromEntries(tasks.map(task=>[task.taskId,task.version])),now};
 return{...x,tasks,brief,input,save:(extra={})=>x.workspace.saveDailyReview({...input,...extra})};
}
test('review snapshot persists through restart, retries replay, task state and events stay unchanged',async t=>{
 const x=await setup(t);assert.equal(typeof x.workspace.saveDailyReview,'function');
 const before=x.workspace.listTasks(),events=before.map(t=>x.workspace.getEvents(t.taskId));
 const result=x.save();assert.equal(result.replayed,false);assert.equal(result.review.taskSnapshots.length,3);assert.equal(result.review.handoff.scheduled,false);
 assert.equal(x.save().replayed,true);assert.equal(x.workspace.listDailyReviews().length,1);
 assert.deepEqual(x.workspace.listTasks(),before);assert.deepEqual(before.map(t=>x.workspace.getEvents(t.taskId)),events);
 x.workspace.close();const reopened=new x.CeoTaskWorkspace({dbPath:path.join(x.dir,'tasks.sqlite')});x.resources.push(reopened);
 assert.deepEqual(reopened.listDailyReviews(),[result.review]);assert.equal(reopened.saveDailyReview(x.input).replayed,true);
 assert.throws(()=>reopened.saveDailyReview({...x.input,note:'不同说明'}),{code:'OPERATION_CONFLICT'});
});
test('only same-store owner may save; exact versions and context/source fingerprints are required',async t=>{
 const x=await setup(t);assert.equal(typeof x.workspace.saveDailyReview,'function');
 const wrongKeys={...x.input.expectedTaskVersions,other:1};delete wrongKeys[x.tasks[0].taskId];
 for(const [extra,code] of [[{actor:agent},'FORBIDDEN'],[{actor:{...owner,storeId:'another'}},'FORBIDDEN'],[{expectedContextId:'stale'},'CONTEXT_CHANGED'],[{expectedSourceId:'stale'},'REVIEW_SOURCE_CHANGED'],[{expectedTaskVersions:{}},'VERSION_CONFLICT'],[{expectedTaskVersions:wrongKeys},'VERSION_CONFLICT']])assert.throws(()=>x.save(extra),{code});
 const first=x.tasks[0];x.command(first,'block',{kind:'DATA',reason:'新缺口'});
 assert.throws(()=>x.save(),{code:'VERSION_CONFLICT'});assert.equal(x.workspace.listDailyReviews().length,0);
});
test('unknown results require reconciliation, current DONE is not proof of daily action completion',async t=>{
 const x=await setup(t);assert.equal(typeof module.buildCeoDailyReview,'function');
 const tasks=structuredClone(x.tasks);tasks[0].status='PENDING_VERIFICATION';tasks[0].receipt={outcome:'UNKNOWN',summary:'未知',evidence:[]};
 tasks[1].status='DONE';tasks[1].verification={accepted:true};tasks[2].reviewAt='2026-10-26T00:00:00Z';
 const r=module.buildCeoDailyReview({...x.input,tasks});
 assert.equal(r.handoff.candidates[0].reason,'RECONCILE_UNKNOWN');assert.equal(r.handoff.candidates[1].reason,'OBSERVE_EFFECT');assert.equal(r.handoff.candidates[2].reason,'REASSESS_DECISION');
 assert.equal(r.dailyActionCompletionVerified,false);assert.equal(r.businessEffectStatus,'PENDING_OBSERVATION');
});
test('Shanghai future day, invalid day, expired plan and unavailable source reject without a record',async t=>{
 const x=await setup(t);assert.equal(typeof x.workspace.saveDailyReview,'function');
 for(const [extra,code] of [[{date:'2026-10-28'},'INVALID_REVIEW_DATE'],[{date:'2026-10-26'},'INVALID_REVIEW_DATE'],[{brief:{...x.brief,plan:{...x.brief.plan,isExpired:true}}},'REVIEW_SOURCE_UNAVAILABLE'],[{brief:{status:'UNAVAILABLE'}},'REVIEW_SOURCE_UNAVAILABLE'],[{note:''},'INVALID_INPUT']])assert.throws(()=>x.save(extra),{code});
 const late=new Date('2026-10-27T16:00:00Z');assert.equal(x.save({date:'2026-10-28',now:late}).review.date,'2026-10-28');
});
test('missing or foreign tasks are not silently omitted; stale task context only proposes reassessment',async t=>{
 const x=await setup(t);assert.equal(typeof module.buildCeoDailyReview,'function');
 assert.throws(()=>module.buildCeoDailyReview({...x.input,tasks:[]}),{code:'TASK_NOT_FOUND'});
 const tasks=structuredClone(x.tasks);tasks[0].definition.storeRef.environmentId='foreign';assert.throws(()=>module.buildCeoDailyReview({...x.input,tasks}),{code:'FORBIDDEN'});
 tasks[0].definition.storeRef.environmentId='400370';tasks[0].contextId='old';assert.equal(module.buildCeoDailyReview({...x.input,tasks}).handoff.candidates[0].reason,'REASSESS_CONTEXT');
});
test('storage failure rolls back review and operation, then original operation can succeed once',async t=>{
 const x=await setup(t);assert.equal(typeof x.workspace.saveDailyReview,'function');x.workspace.listDailyReviews();
 const db=new DatabaseSync(path.join(x.dir,'tasks.sqlite'));x.resources.push(db);
 db.exec("CREATE TRIGGER review_fail BEFORE INSERT ON ceo_daily_reviews BEGIN SELECT RAISE(ABORT,'private-path'); END;");
 assert.throws(()=>x.save(),e=>e.code==='STORAGE_FAILED'&&!e.message.includes('private'));assert.equal(x.workspace.listDailyReviews().length,0);
 db.exec('DROP TRIGGER review_fail');assert.equal(x.save().replayed,false);assert.equal(x.workspace.listDailyReviews().length,1);
});
test('changed context identity is invalid even when request repeats its forged string',async t=>{
 const x=await setup(t);assert.equal(typeof x.workspace.saveDailyReview,'function');
 const changed=structuredClone(x.context);changed.goal.version++;assert.notEqual(ceoContextId(changed),changed.contextId);
 assert.throws(()=>x.save({context:changed}),{code:'INVALID_CONTEXT'});
});
test('synchronous commit guard detects real config, new fact and brief source changes',async t=>{
 assert.equal(typeof guardModule.captureCeoReviewInputs,'function');
 const b=await briefFixture(t);await mkdir(path.join(b.root,'config'));await writeFile(path.join(b.root,'config/ceo-store-400370.json'),'{}');await writeFile(path.join(b.root,'config/metrics-schema.json'),'{}');
 let guard=guardModule.captureCeoReviewInputs({projectRoot:b.root});guard();
 await writeFile(path.join(b.root,'config/ceo-store-400370.json'),' { }');assert.throws(guard,{code:'CONTEXT_CHANGED'});
 guard=guardModule.captureCeoReviewInputs({projectRoot:b.root});await mkdir(path.join(b.root,'data/metrics/facts/aliexpress'),{recursive:true});await writeFile(path.join(b.root,'data/metrics/facts/aliexpress/2026-10-28.jsonl'),'{}');assert.throws(guard,{code:'CONTEXT_CHANGED'});
 guard=guardModule.captureCeoReviewInputs({projectRoot:b.root});await writeFile(path.join(b.root,b.manifest.sources.baseline.path),'{}');assert.throws(guard,{code:'REVIEW_SOURCE_CHANGED'});
});
