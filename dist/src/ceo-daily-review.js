import {ceoContentHash} from './ceo-operating-context.js';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const states=new Set(['PROPOSED','READY','RUNNING','PENDING_VERIFICATION','DONE','BLOCKED','FAILED']);
const iso=v=>typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
function dateAt(now,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
function reason(task,context,now){
 if(task.receipt?.outcome==='UNKNOWN')return'RECONCILE_UNKNOWN';
 if(task.status==='PENDING_VERIFICATION')return'VERIFY_RECEIPT';
 if(task.status==='RUNNING')return'WAIT_FOR_RECEIPT';
 if(task.status==='DONE')return task.verification?.accepted===true?'OBSERVE_EFFECT':'VERIFY_RECEIPT';
 if(task.contextId!==context.contextId)return'REASSESS_CONTEXT';
 if(!iso(task.reviewAt)||Date.parse(task.reviewAt)<=now.getTime()||(task.definition.deadline&&(!iso(task.definition.deadline)||Date.parse(task.definition.deadline)<=now.getTime())))return'REASSESS_DECISION';
 if(task.status==='READY'&&(!iso(task.approval?.expiresAt)||Date.parse(task.approval.expiresAt)<=now.getTime()))return'REASSESS_APPROVAL';
 if(task.status==='FAILED'||task.status==='BLOCKED')return'REASSESS_BLOCKER';
 return'AWAIT_APPROVAL';
}

// Snapshot of original tasks, never a claim that a particular day's actions occurred.
export function buildCeoDailyReview({brief,context,tasks,date,note,actor,operationId,now=new Date()}){
 if(actor?.role!=='owner'||actor.storeId!=='400370')fail('FORBIDDEN');
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail('INVALID_TIME');
 if(brief?.status!=='AVAILABLE'||brief.readOnly!==true||brief.plan?.isExpired||!/^[a-f0-9]{64}$/.test(brief.sourceId??'')||!Array.isArray(brief.days)||!brief.days.length)fail('REVIEW_SOURCE_UNAVAILABLE');
 const today=dateAt(now,context.goal.period.timeZone),day=brief.days.find(d=>d.date===date);
 if(today>brief.days.at(-1).date)fail('REVIEW_SOURCE_UNAVAILABLE');
 if(typeof date!=='string'||!day||date>today)fail('INVALID_REVIEW_DATE');
 if(typeof note!=='string'||!note.trim()||note.length>2000)fail('INVALID_INPUT');
 const ids=[...new Set(day.actions.map(a=>a.sourceTaskRef))];if(!ids.length||ids.length>3)fail('INVALID_INPUT');
 const selected=ids.map(id=>{const task=tasks.find(t=>t.taskId===id);if(!task)fail('TASK_NOT_FOUND');if(task.definition?.storeRef?.environmentId!=='400370')fail('FORBIDDEN');if(!states.has(task.status))fail('INVALID_INPUT');return task;});
 const next=brief.days[brief.days.indexOf(day)+1];
 return{schema:'ceo-daily-review/v1',reviewId:'ceo_review_'+ceoContentHash({actorId:actor.id,operationId}).slice(0,32),operationId,storeId:'400370',date,createdAt:now.toISOString(),actorId:actor.id,goalId:context.goal.goalId,goalVersion:context.goal.version,contextId:context.contextId,sourceId:brief.sourceId,note:note.trim(),dailyActionCompletionVerified:false,businessEffectStatus:'PENDING_OBSERVATION',
  taskSnapshots:selected.map(t=>({taskId:t.taskId,title:t.definition.title,status:t.status,version:t.version,attempt:t.attempt,receipt:t.receipt?{outcome:t.receipt.outcome,summary:t.receipt.summary,at:t.receipt.at,evidenceCount:t.receipt.evidence?.length??0}:null,verification:t.verification?{accepted:t.verification.accepted,note:t.verification.note,at:t.verification.at}:null})),
  handoff:{scheduled:false,nextDate:next?.date??null,nextTheme:next?.theme??null,candidates:selected.map(t=>({taskId:t.taskId,reason:reason(t,context,now)}))}};
}
