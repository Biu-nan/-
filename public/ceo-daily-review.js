const drafts=new WeakMap();
const pendingKey='yikua.ceo.pending-daily-review.v1';
function browserStorage(){try{return typeof sessionStorage==='undefined'?null:sessionStorage;}catch{return null;}}
function restore(storage){try{const raw=storage?.getItem(pendingKey);if(!raw)return null;if(raw.length>8192)throw new Error();const p=JSON.parse(raw);if(typeof p.operationId!=='string'||typeof p.note!=='string'||!p.note.trim()||p.note.length>2000||!/^\d{4}-\d{2}-\d{2}$/.test(p.date))throw new Error();return p;}catch{return{invalid:true};}}
function forget(controller){try{controller.storage?.removeItem(pendingKey);controller.pending=null;return true;}catch{return false;}}
const labels={RECONCILE_UNKNOWN:'先核对未知结果，禁止直接重试',VERIFY_RECEIPT:'核对原回执和证据',WAIT_FOR_RECEIPT:'等候原执行回执，不重复领作',OBSERVE_EFFECT:'原任务已核验，继续观察经营效果',REASSESS_CONTEXT:'上下文已变化，请CEO重新判断',REASSESS_DECISION:'原决定或期限已失效，请CEO重评',REASSESS_APPROVAL:'审批已失效，须重新核对',REASSESS_BLOCKER:'检查失败或受阻原因后再决定',AWAIT_APPROVAL:'保留原任务，等待具体审批'};
const states={PROPOSED:'待审批',READY:'可领作',RUNNING:'处理中',PENDING_VERIFICATION:'待核验',DONE:'已核验完成',BLOCKED:'受阻',FAILED:'失败'};
export function clearCeoDailyReview(root,{preservePending=false}={}){const controller=drafts.get(root);if(!preservePending){if(controller)forget(controller);else try{browserStorage()?.removeItem(pendingKey);}catch{}}drafts.delete(root);root.replaceChildren();}
export function businessTaskCounts(tasks){const business=tasks.filter(t=>t.taskId.startsWith('store-400370-')),other=tasks.filter(t=>!t.taskId.startsWith('store-400370-'));return{businessTotal:business.length,businessDone:business.filter(t=>t.status==='DONE').length,otherTotal:other.length,otherDone:other.filter(t=>t.status==='DONE').length};}

export function renderCeoDailyReview(root,data,{onSave=async()=>{throw new Error('复盘入口尚未连接');},onSaved=()=>{},onTask=()=>{},storage=browserStorage()}={}){
 const options={onSave,onSaved,onTask,storage},doc=root.ownerDocument;
 const el=(tag,text)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 let controller=drafts.get(root);if(!controller){controller={epoch:0,days:new Map(),storage,pending:restore(storage),busy:false};drafts.set(root,controller);}const epoch=++controller.epoch;
 const key=`${data.contextId}:${data.brief?.sourceId}:${data.date}`;
 let state=controller.days.get(key);if(!state){state={note:'',message:''};controller.days.set(key,state);}
 // A successful but lost POST response can be confirmed by the shared history.
 if(controller.pending&&!controller.pending.invalid&&data.reviews.some(r=>r.operationId===controller.pending.operationId)){if(forget(controller)){state.note='';state.message='复盘已存档，已从共享记录核对。';}}
 root.replaceChildren(el('h2','日终复盘与次日接续'),el('p',`${data.date??'未选择日期'} · 保存的是经营者说明和原任务快照，不代表当日动作已完成。`));
 if(state.message)root.append(el('p',state.message));
 if(controller.pending)root.append(el('p',controller.pending.invalid?'待确认操作无法读取，请先核对共享历史并重新连接，暂不创建新操作。':`${controller.pending.date} 有待确认复盘。核对或重试完成前，不创建新的操作。`));
 const day=data.brief?.days?.find(d=>d.date===data.date),canSave=data.actor?.role==='owner'&&data.brief?.status==='AVAILABLE'&&!data.brief.plan.isExpired&&day&&data.date<=data.brief.plan.today;
 if((canSave||controller.pending)&&!controller.pending?.invalid&&data.actor?.role==='owner'){
  const form=el('form'),label=el('label',controller.pending?`待确认复盘原说明（${controller.pending.date}）`:'今日核对、变化与未完成原因'),area=el('textarea');area.value=controller.pending?.note??state.note;area.maxLength=2000;area.required=true;area.disabled=!!controller.pending;area.oninput=()=>{state.note=area.value;};label.append(area);form.append(label);
  const submit=el('button',controller.pending?'重试保存同一次复盘':'保存复盘及接续建议');submit.type='submit';submit.disabled=controller.busy;form.append(submit);
  form.onsubmit=async event=>{
   event.preventDefault();if(controller.busy)return;
   if(!controller.pending){const note=area.value.trim();if(!note){state.message='请填写今日复盘说明。';renderCeoDailyReview(root,data,options);return;}
    const ids=[...new Set(day.actions.map(a=>a.sourceTaskRef))];
    state.note=note;const payload={operationId:crypto.randomUUID(),date:data.date,expectedContextId:data.contextId,expectedSourceId:data.brief.sourceId,expectedTaskVersions:Object.fromEntries(ids.map(id=>[id,data.tasks.find(t=>t.taskId===id)?.version??0])),note};
    try{if(!storage)throw new Error();storage.setItem(pendingKey,JSON.stringify(payload));controller.pending=payload;}catch{state.message='尚未提交：当前页面无法保留待确认操作，请确认浏览器会话存储可用后重试。';renderCeoDailyReview(root,data,options);return;}
   }
   controller.busy=true;submit.disabled=true;area.disabled=true;
   try{const result=await onSave(controller.pending);forget(controller);state.note='';state.message='复盘已存档；接续建议未批准、未排程。';data.reviews=[result.review,...data.reviews.filter(r=>r.reviewId!==result.review.reviewId)];onSaved(result.review);}
   catch(e){if(['VERSION_CONFLICT','CONTEXT_CHANGED','REVIEW_SOURCE_CHANGED','REVIEW_SOURCE_UNAVAILABLE','INVALID_REVIEW_DATE','INVALID_INPUT','FORBIDDEN'].includes(e.code)){forget(controller);state.message='未保存：任务、来源或权限已变化，请刷新核对后再提交。';}else state.message='保存结果尚未确认。请先刷新核对共享历史；若仍无记录，重试会沿用同一次操作。';}
   finally{controller.busy=false;if(drafts.get(root)===controller&&controller.epoch===epoch)renderCeoDailyReview(root,data,options);}
  };
  root.append(form,el('p','不会自动顺延、批准任务、报名、改价或采购。复盘说明属于人工报告，经营效果仍待观察。'));
 }else root.append(el('p',data.actor?.role==='owner'?'当前日期或来源不可存档；未来日和过期草案仅可查看。':'仅经营者可存档复盘；CEO入口可读取接续建议。'));
 root.append(el('h3','已存档复盘'));
 const reviews=data.reviews.filter(r=>r.date===data.date);
 if(!reviews.length)root.append(el('p','该日期尚无复盘记录。'));
 for(const review of reviews){
  const item=el('details');item.append(el('summary',`${review.date} · 存档于 ${review.createdAt}`),el('p',review.note),el('p','以下为存档时原任务状态；历史记录不会随当前任务变化。'));
  for(const task of review.taskSnapshots){const box=el('article');box.append(el('h4',task.title),el('p',`${states[task.status]??task.status} · 版本 ${task.version}`));if(task.receipt)box.append(el('p',task.receipt.summary),el('p',`已登记证据 ${task.receipt.evidenceCount} 份；此处未重新读取原件。`));if(task.verification)box.append(el('p',`原任务核验记录：${task.verification.note??'见原任务'}`));const b=el('button','查看原任务');b.type='button';b.onclick=()=>onTask(task.taskId);box.append(b);item.append(box);}
  item.append(el('h4',`接续建议 · ${review.handoff.nextDate??'下一周期待定'} · 未排程`));
  for(const c of review.handoff.candidates)item.append(el('p',`${c.taskId}：${labels[c.reason]??'请CEO重新判断'}`));root.append(item);
 }
}
