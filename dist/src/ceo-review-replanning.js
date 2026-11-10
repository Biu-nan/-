import {ceoContentHash} from './ceo-operating-context.js';
export const replanErrorCodes=['REPLAN_NOT_READY','REPLAN_INPUT_CHANGED','REPLAN_BINDING_INVALID','REPLAN_IN_FLIGHT','REPLAN_REQUIRES_NEW_PLAN','PLAN_REVIEW_LINK_CONFLICT'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const choices=t=>t.receipt?.outcome==='UNKNOWN'||['RUNNING','PENDING_VERIFICATION'].includes(t.status)?['WAIT']:t.status==='DONE'?['OBSERVE']:['REPLAN','DEFER'];
export const operatingTasks=tasks=>tasks.filter(t=>typeof t.taskId==='string'&&t.taskId.startsWith('store-400370-')&&t.definition?.storeRef?.environmentId==='400370').sort((a,b)=>a.taskId.localeCompare(b.taskId));

export function buildCeoReplanningBrief({context,brief,reviews,tasks}){
 const current=operatingTasks(tasks),review=reviews.find(r=>r.storeId==='400370')??null;
 const reviewHash=review?ceoContentHash(review):null,expectedTaskVersions=Object.fromEntries(current.map(t=>[t.taskId,t.version]));
 let status='AVAILABLE';
 if(brief?.status!=='AVAILABLE'||brief.readOnly!==true||brief.plan?.isExpired)status='SOURCE_UNAVAILABLE';
 else if(current.length>100)status='TASK_LIMIT';
 else if(!review)status='NEEDS_REVIEW';
 else if(review.contextId!==context.contextId||review.sourceId!==brief.sourceId||review.goalId!==context.goal.goalId||review.goalVersion!==context.goal.version)status='REVIEW_STALE';
 const snapshots=new Map((review?.taskSnapshots??[]).map(t=>[t.taskId,t]));
 const packetId=ceoContentHash({contextId:context.contextId,sourceId:brief?.sourceId??null,reviewHash,tasks:current,status});
 return{schema:'ceo-replanning-brief/v1',status,canSubmit:status==='AVAILABLE',readOnly:true,contextId:context.contextId,sourceId:brief?.sourceId??null,packetId,reviewHash,goal:context.goal,gaps:context.gaps,
  review:review?{reviewId:review.reviewId,date:review.date,createdAt:review.createdAt,note:review.note,dailyActionCompletionVerified:false}:null,
  expectedTaskVersions,changedSinceReview:review?current.filter(t=>snapshots.get(t.taskId)?.version!==t.version||snapshots.get(t.taskId)?.status!==t.status).map(t=>t.taskId):[],
  tasks:current.slice(0,100).map(t=>({taskId:t.taskId,title:t.definition.title,status:t.status,version:t.version,attempt:t.attempt,allowedChoices:choices(t),contextChanged:t.contextId!==context.contextId,reviewAt:t.reviewAt,
   receipt:t.receipt?{outcome:t.receipt.outcome,summary:t.receipt.summary,at:t.receipt.at,evidenceCount:t.receipt.evidence?.length??0}:null})),businessEffectStatus:'PENDING_OBSERVATION',externalExecution:false};
}

export function validateReviewReplanBinding({packet,binding,candidates}){
 if(!exact(binding,['reviewId','reviewHash','packetId','expectedTaskVersions','dispositions','rationale'])||!text(binding.rationale,2000)||!object(binding.expectedTaskVersions)||!Array.isArray(binding.dispositions)||binding.dispositions.length>100)fail('REPLAN_BINDING_INVALID');
 if(!packet.canSubmit)fail(packet.status==='NEEDS_REVIEW'?'REPLAN_NOT_READY':'REPLAN_INPUT_CHANGED');
 if(binding.reviewId!==packet.review.reviewId||binding.reviewHash!==packet.reviewHash||binding.packetId!==packet.packetId)fail('REPLAN_INPUT_CHANGED');
 if(ceoContentHash(binding.expectedTaskVersions)!==ceoContentHash(packet.expectedTaskVersions))fail('REPLAN_BINDING_INVALID');
 if(!Array.isArray(candidates)||candidates.length>20)fail('REPLAN_BINDING_INVALID');
 const dispositions=new Map();
 for(const d of binding.dispositions){if(!exact(d,['taskId','choice','reason'])||!text(d.reason,1000)||dispositions.has(d.taskId))fail('REPLAN_BINDING_INVALID');dispositions.set(d.taskId,d);}
 if(dispositions.size!==packet.tasks.length)fail('REPLAN_BINDING_INVALID');
 const candidateIds=new Set(candidates.map(c=>c.taskId));if(candidateIds.size!==candidates.length)fail('REPLAN_BINDING_INVALID');
 for(const task of packet.tasks){const d=dispositions.get(task.taskId);if(!d)fail('REPLAN_BINDING_INVALID');if(!task.allowedChoices.includes(d.choice))fail(task.allowedChoices.includes('WAIT')?'REPLAN_IN_FLIGHT':'REPLAN_BINDING_INVALID');if((d.choice==='REPLAN')!==candidateIds.has(task.taskId))fail('REPLAN_BINDING_INVALID');}
 if(candidates.some(c=>!packet.tasks.some(t=>t.taskId===c.taskId)))fail('REPLAN_BINDING_INVALID');
 return{schema:'ceo-plan-review-link/v1',reviewId:binding.reviewId,reviewHash:binding.reviewHash,reviewDate:packet.review.date,packetId:binding.packetId,contextId:packet.contextId,sourceId:packet.sourceId,expectedTaskVersions:binding.expectedTaskVersions,dispositions:binding.dispositions,rationale:binding.rationale,scheduled:false,taskWritePerformed:false};
}
