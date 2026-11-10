import {CeoDraftWorkspace,ceoDraftEntryHash} from './ceo-draft-workspace.js';
import {ceoContentHash,ceoContextId} from './ceo-operating-context.js';
import {buildCeoDailyReview} from './ceo-daily-review.js';
import {buildCeoReplanningBrief,validateReviewReplanBinding,operatingTasks} from './ceo-review-replanning.js';

class TaskError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new TaskError(code);};
const text=(v,n=2000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const timestamp=v=>text(v,64)&&/(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const roles={approve:'owner',start:'agent',report:'agent',verify:'owner','resolve-unknown':'owner'};
const evidenceOK=v=>Array.isArray(v)&&v.length>0&&v.length<=8&&v.every(e=>text(e?.reference,512)&&/^[a-f0-9]{64}$/.test(e.sha256)&&text(e.summary,1000));

// Caller must inject authenticated principals and freshly loaded contexts, never request-body identities.
export class CeoTaskWorkspace extends CeoDraftWorkspace {
 ready(){
  super.ready();if(this.taskTablesReady)return;
  try{
   this.db.exec(`CREATE TABLE IF NOT EXISTS ceo_tasks(task_id TEXT PRIMARY KEY,version INTEGER NOT NULL,payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ceo_task_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,command TEXT NOT NULL,actor_id TEXT NOT NULL,created_at TEXT NOT NULL,payload_json TEXT NOT NULL,FOREIGN KEY(task_id) REFERENCES ceo_tasks(task_id));
    CREATE TABLE IF NOT EXISTS ceo_task_operations(operation_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,result_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ceo_daily_reviews(review_id TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ceo_plan_review_links(plan_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,FOREIGN KEY(plan_id) REFERENCES ceo_plan_versions(plan_id));`);
   this.taskTablesReady=true;
  }catch{fail('STORAGE_FAILED');}
 }
 close(){super.close();this.taskTablesReady=false;}
 getTask(taskId){this.ready();try{const row=this.db.prepare('SELECT payload_json FROM ceo_tasks WHERE task_id=?').get(taskId);return row?JSON.parse(row.payload_json):null;}catch{fail('STORAGE_FAILED');}}
 listTasks(){this.ready();try{return this.db.prepare('SELECT payload_json FROM ceo_tasks ORDER BY task_id').all().map(r=>JSON.parse(r.payload_json));}catch{fail('STORAGE_FAILED');}}
 listPlans(){this.ready();try{return this.db.prepare('SELECT p.plan_id,p.context_id,p.payload_json,p.created_at,l.payload_json AS link_json FROM ceo_plan_versions p LEFT JOIN ceo_plan_review_links l ON l.plan_id=p.plan_id ORDER BY p.created_at DESC LIMIT 100').all().map(r=>({planId:r.plan_id,contextId:r.context_id,createdAt:r.created_at,plan:JSON.parse(r.payload_json),...(r.link_json?{reviewLink:JSON.parse(r.link_json)}:{})}));}catch{fail('STORAGE_FAILED');}}
 getEvents(taskId){this.ready();try{return this.db.prepare('SELECT payload_json FROM ceo_task_events WHERE task_id=? ORDER BY event_id').all(taskId).map(r=>JSON.parse(r.payload_json));}catch{fail('STORAGE_FAILED');}}
 listDailyReviews(){this.ready();try{return this.db.prepare('SELECT payload_json FROM ceo_daily_reviews ORDER BY created_at DESC,review_id DESC LIMIT 30').all().map(r=>JSON.parse(r.payload_json));}catch{fail('STORAGE_FAILED');}}
 getReplanningBrief({context,brief}){return buildCeoReplanningBrief({context,brief,reviews:this.listDailyReviews(),tasks:this.listTasks()});}
 getReviewReplanReplay({actor,requestId,conversationRef,expectedContextId,decision,candidates,reviewBinding}){
  this.authorize(actor);if(actor.role!=='agent')fail('FORBIDDEN');
  const hash=ceoDraftEntryHash({entryRequest:{requestId,conversationRef,actorId:actor.id},expectedContextId,decision,candidates,requestBinding:{kind:'review-replan',reviewBinding}});this.ready();
  let row;try{row=this.db.prepare('SELECT request_hash,result_json FROM ceo_entry_draft_requests WHERE request_id=?').get(requestId);}catch{fail('STORAGE_FAILED');}
  if(!row)return null;if(row.request_hash!==hash)fail('OPERATION_CONFLICT');
  try{return{...JSON.parse(row.result_json),replayed:true};}catch{fail('STORAGE_FAILED');}
 }
 saveReviewReplan({context,brief,actor,requestId,conversationRef,expectedContextId,decision,candidates,reviewBinding,assertInputsCurrent=()=>{},now=new Date()}){
  this.authorize(actor);if(actor.role!=='agent')fail('FORBIDDEN');
  return this.saveDraft({context,decision,candidates,expectedContextId,now,existingDependencies:operatingTasks(this.listTasks()),entryRequest:{requestId,conversationRef,actorId:actor.id},requestBinding:{kind:'review-replan',reviewBinding},finalizeDraft:result=>{
   assertInputsCurrent();
   const packet=this.getReplanningBrief({context,brief}),link=validateReviewReplanBinding({packet,binding:reviewBinding,candidates}),hash=ceoContentHash(link);
   const old=this.db.prepare('SELECT payload_hash FROM ceo_plan_review_links WHERE plan_id=?').get(result.planId);
   if(old&&old.payload_hash!==hash)throw Object.assign(new Error('PLAN_REVIEW_LINK_CONFLICT'),{code:'PLAN_REVIEW_LINK_CONFLICT'});
   if(!old&&!result.created)throw Object.assign(new Error('REPLAN_REQUIRES_NEW_PLAN'),{code:'REPLAN_REQUIRES_NEW_PLAN'});
   if(!old)this.db.prepare('INSERT INTO ceo_plan_review_links VALUES(?,?,?)').run(result.planId,hash,JSON.stringify(link));
   return{...result,reviewLink:link};
  }});
 }
 saveDailyReview({brief,context,actor,operationId,date,note,expectedContextId,expectedSourceId,expectedTaskVersions,assertInputsCurrent=()=>{},now=new Date()}){
  this.authorize(actor);if(actor.role!=='owner')fail('FORBIDDEN');
  if(!expectedTaskVersions||typeof expectedTaskVersions!=='object'||Array.isArray(expectedTaskVersions)||Object.keys(expectedTaskVersions).length>3||Object.values(expectedTaskVersions).some(v=>!Number.isSafeInteger(v)||v<1))fail('INVALID_INPUT');
  return this.transact({actor,operationId,request:{type:'daily-review',date,note,expectedContextId,expectedSourceId,expectedTaskVersions}},()=>{
   this.checkContext(context,expectedContextId);
   if(brief?.status==='AVAILABLE'&&brief.sourceId!==expectedSourceId)fail('REVIEW_SOURCE_CHANGED');
   let review;try{assertInputsCurrent();review=buildCeoDailyReview({brief,context,tasks:this.listTasks(),date,note,actor,operationId,now});}catch(e){fail(e.code??'INVALID_INPUT');}
   if(Object.keys(expectedTaskVersions).length!==review.taskSnapshots.length||review.taskSnapshots.some(t=>expectedTaskVersions[t.taskId]!==t.version))fail('VERSION_CONFLICT');
   this.db.prepare('INSERT INTO ceo_daily_reviews VALUES(?,?,?)').run(review.reviewId,review.createdAt,JSON.stringify(review));
   return{review};
  });
 }
 authorize(actor){if(!text(actor?.id,120)||!['owner','agent'].includes(actor.role)||actor.storeId!=='400370')fail('FORBIDDEN');}
 transact({actor,operationId,request},work){
  this.authorize(actor);if(!text(operationId,160))fail('INVALID_OPERATION');this.ready();
  const hash=ceoContentHash({actor,request});let active=false;
  try{
   this.db.exec('BEGIN IMMEDIATE');active=true;
   const old=this.db.prepare('SELECT request_hash,result_json FROM ceo_task_operations WHERE operation_id=?').get(operationId);
   if(old){if(old.request_hash!==hash)fail('OPERATION_CONFLICT');const result=JSON.parse(old.result_json);this.db.exec('COMMIT');active=false;return{...result,replayed:true};}
   const result=work();
   this.db.prepare('INSERT INTO ceo_task_operations VALUES(?,?,?)').run(operationId,hash,JSON.stringify(result));
   this.db.exec('COMMIT');active=false;return{...result,replayed:false};
  }catch(e){if(active)try{this.db.exec('ROLLBACK');}catch{}if(e instanceof TaskError)throw e;fail('STORAGE_FAILED');}
 }
 checkContext(context,expected){
  if(!context||context.contextId!==expected)fail('CONTEXT_CHANGED');
  if(context.goal?.storeRef?.environmentId!=='400370'||context.contextId!==ceoContextId(context))fail('INVALID_CONTEXT');
 }
 checkTime(task,now){
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('INVALID_TIME');
  if(!timestamp(task.reviewAt)||Date.parse(task.reviewAt)<=now.getTime())fail('DECISION_EXPIRED');
  if(task.definition.deadline&&Date.parse(task.definition.deadline)<=now.getTime())fail('DEADLINE_PASSED');
 }
 checkDependencies(task){for(const id of task.definition.dependsOn){const dep=this.getTask(id);if(!dep||dep.status!=='DONE'||dep.contextId!==task.contextId)fail('DEPENDENCY_BLOCKED');}}
 event(task,command,actor,now,args={}){
  const event={taskId:task.taskId,version:task.version,command,actorId:actor.id,at:now.toISOString(),status:task.status,attempt:task.attempt,args};
  this.db.prepare('INSERT INTO ceo_task_events(task_id,command,actor_id,created_at,payload_json) VALUES(?,?,?,?,?)').run(task.taskId,command,actor.id,event.at,JSON.stringify(event));
 }
 importPlan({planId,context,actor,operationId,expectedVersions={},now=new Date()}){
  if(!expectedVersions||typeof expectedVersions!=='object'||Array.isArray(expectedVersions)||Object.keys(expectedVersions).length>20||Object.values(expectedVersions).some(v=>!Number.isSafeInteger(v)||v<1))fail('INVALID_INPUT');
  return this.transact({actor,operationId,request:{type:'import',planId,expectedVersions}},()=>{
   const row=this.db.prepare('SELECT context_id,decision_id,payload_json FROM ceo_plan_versions WHERE plan_id=?').get(planId);
   if(!row)fail('PLAN_NOT_FOUND');this.checkContext(context,row.context_id);
   const plan=JSON.parse(row.payload_json);
   if(plan.commitment!=='WITHIN_CAPACITY')fail('PLAN_NOT_COMMITTED');
   const decision=JSON.parse(this.db.prepare('SELECT payload_json FROM ceo_decision_versions WHERE decision_id=?').get(row.decision_id).payload_json);
   if(plan.tasks.length>20||!plan.tasks.length)fail('NO_ALLOCATED_TASKS');
   const tasks=[];
   for(const definition of plan.tasks){
    if(definition.mode!=='INVESTIGATION'||definition.storeRef?.environmentId!=='400370')fail('UNSUPPORTED_CAPABILITY');
    const binding={definition,planId,contextId:context.contextId,goalId:plan.goalId,goalVersion:plan.goalVersion,capability:'manual.investigation'};
    const contentHash=ceoContentHash(binding),existing=this.getTask(definition.taskId);
    if(existing&&existing.contentHash===contentHash){this.checkTime(existing,now);tasks.push(existing);continue;}
    if(existing&&['RUNNING','PENDING_VERIFICATION'].includes(existing.status))fail('TASK_IN_FLIGHT');
    if(existing&&existing.status==='DONE')fail('TASK_VERSION_CONFLICT');
    if(existing&&expectedVersions[existing.taskId]!==existing.version)fail('VERSION_CONFLICT');
    const task={...binding,taskId:definition.taskId,contentHash,version:(existing?.version??0)+1,status:'PROPOSED',assignedTo:actor.id,
     reviewAt:decision.reviewAt,approval:null,receipt:null,verification:null,blocked:null,attempt:0,
     effectStatus:'PENDING_OBSERVATION',createdAt:existing?.createdAt??now.toISOString(),updatedAt:now.toISOString()};
    task.attempt=existing?.attempt??0;
    this.checkTime(task,now);
    if(existing){const updated=this.db.prepare('UPDATE ceo_tasks SET version=?,payload_json=? WHERE task_id=? AND version=?').run(task.version,JSON.stringify(task),task.taskId,existing.version);if(updated.changes!==1)fail('VERSION_CONFLICT');}
    else this.db.prepare('INSERT INTO ceo_tasks VALUES(?,?,?)').run(task.taskId,task.version,JSON.stringify(task));
    this.event(task,existing?'revise':'import',actor,now,existing?{previousTask:existing}:{});tasks.push(task);
   }
   return{schema:'ceo-task-import/v1',planId,tasks};
  });
 }
 command({taskId,expectedVersion,command,args={},context,actor,operationId,now=new Date(),verifyEvidence=null}){
  this.authorize(actor);
  if(!['approve','start','report','verify','block','resolve-unknown'].includes(command))fail('INVALID_COMMAND');
  if(roles[command]&&actor.role!==roles[command])fail('FORBIDDEN');
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1||!args||Array.isArray(args)||typeof args!=='object')fail('INVALID_COMMAND');
  return this.transact({actor,operationId,request:{taskId,expectedVersion,command,args}},()=>{
   const task=this.getTask(taskId);if(!task)fail('TASK_NOT_FOUND');
   if(task.version!==expectedVersion)fail('VERSION_CONFLICT');
   if(task.receipt?.outcome==='UNKNOWN'&&!['resolve-unknown'].includes(command))fail('RESULT_UNKNOWN');
   if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('INVALID_TIME');
   if(command==='approve'){
    if(!['PROPOSED','BLOCKED'].includes(task.status))fail('INVALID_TRANSITION');
    this.checkContext(context,task.contextId);this.checkTime(task,now);this.checkDependencies(task);
    if(!timestamp(args.expiresAt)||Date.parse(args.expiresAt)<=now.getTime()||Date.parse(args.expiresAt)>Date.parse(task.reviewAt))fail('INVALID_APPROVAL');
    task.approval={ownerId:actor.id,taskVersion:task.version+1,contentHash:task.contentHash,contextId:task.contextId,expiresAt:args.expiresAt};task.blocked=null;task.status='READY';
   }else if(command==='start'){
    if(task.status!=='READY')fail('INVALID_TRANSITION');
    if(actor.id!==task.assignedTo)fail('FORBIDDEN');this.checkContext(context,task.contextId);this.checkTime(task,now);this.checkDependencies(task);
    if(!task.approval||task.approval.taskVersion!==task.version||task.approval.contentHash!==task.contentHash)fail('INVALID_APPROVAL');
    if(Date.parse(task.approval.expiresAt)<=now.getTime())fail('APPROVAL_EXPIRED');
    task.status='RUNNING';task.attempt++;task.receipt=null;task.verification=null;
   }else if(command==='report'){
    if(task.status!=='RUNNING')fail('INVALID_TRANSITION');if(actor.id!==task.assignedTo)fail('FORBIDDEN');
    if(!['REPORTED','UNKNOWN','FAILED'].includes(args.outcome)||!text(args.summary))fail('INVALID_RECEIPT');
    if(args.outcome==='REPORTED'&&!evidenceOK(args.evidence))fail('INVALID_EVIDENCE');
    if(args.outcome!=='REPORTED'&&!(Array.isArray(args.evidence)&&(!args.evidence.length||evidenceOK(args.evidence))))fail('INVALID_EVIDENCE');
    task.receipt={outcome:args.outcome,summary:args.summary,evidence:args.evidence,actorId:actor.id,at:now.toISOString(),attempt:task.attempt};
    task.status=args.outcome==='FAILED'?'FAILED':'PENDING_VERIFICATION';task.approval=null;
   }else if(command==='verify'){
    if(task.status!=='PENDING_VERIFICATION'||task.receipt?.outcome!=='REPORTED')fail('INVALID_TRANSITION');
    if(actor.id===task.receipt.actorId)fail('SELF_VERIFICATION');
    if(typeof args.accepted!=='boolean'||!text(args.note))fail('INVALID_VERIFICATION');
    if(args.accepted&&!evidenceOK(task.receipt.evidence))fail('INVALID_EVIDENCE');
    let integrity=null;
    if(args.accepted&&verifyEvidence)try{integrity=verifyEvidence(task,args);}catch(e){if(['EVIDENCE_CHECK_UNAVAILABLE','EVIDENCE_CHECK_REQUIRED','EVIDENCE_CHECK_FAILED','EVIDENCE_CHECK_STALE'].includes(e.code))fail(e.code);throw e;}
    task.verification={kind:'HUMAN_ATTESTED',accepted:args.accepted,note:args.note,actorId:actor.id,at:now.toISOString(),receiptHash:ceoContentHash(task.receipt)};
    if(integrity)task.verification.evidenceIntegrity=integrity;
    task.status=args.accepted?'DONE':'BLOCKED';task.blocked=args.accepted?null:{kind:'DATA',reason:'EVIDENCE_REJECTED'};
   }else if(command==='block'){
    if(!['PROPOSED','READY','RUNNING','BLOCKED'].includes(task.status))fail('INVALID_TRANSITION');
    if(!['PERSON','DATA','DEPENDENCY','RESOURCE'].includes(args.kind)||!text(args.reason))fail('INVALID_BLOCKER');
    if(task.status==='RUNNING'){
     task.receipt={outcome:'UNKNOWN',summary:args.reason,evidence:[],actorId:actor.id,at:now.toISOString(),attempt:task.attempt};
     task.status='PENDING_VERIFICATION';
    }else task.status='BLOCKED';
    task.blocked={kind:args.kind,reason:args.reason};task.approval=null;
   }else if(command==='resolve-unknown'){
    if(task.status!=='PENDING_VERIFICATION'||task.receipt?.outcome!=='UNKNOWN')fail('INVALID_TRANSITION');
    if(args.result!=='NOT_APPLIED'||!text(args.note)||!evidenceOK(args.evidence))fail('INVALID_RESOLUTION');
    task.receipt={...task.receipt,outcome:'NOT_APPLIED',resolution:{...args,actorId:actor.id,at:now.toISOString()}};
    task.status='BLOCKED';task.blocked={kind:'DATA',reason:'RESULT_NOT_APPLIED'};task.approval=null;
   }
   task.version++;task.updatedAt=now.toISOString();
   const changed=this.db.prepare('UPDATE ceo_tasks SET version=?,payload_json=? WHERE task_id=? AND version=?').run(task.version,JSON.stringify(task),taskId,expectedVersion);
   if(changed.changes!==1)fail('VERSION_CONFLICT');this.event(task,command,actor,now,args);
   return{schema:'ceo-task-receipt/v1',task};
  });
 }
}
