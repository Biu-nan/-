import {createCeoTaskLayout} from './ceo-task-layout.js';
export function mountCeoTaskWorkspace(root,{apiBase='/api/ceo/'}={}){
 if(!root||root.dataset.ceoMounted)return;
 root.dataset.ceoMounted='true';root.classList.add('ceo-task-surface');createCeoTaskLayout(root);
const $=id=>root.querySelector('[data-ceo="'+id+'"]');
const names={PROPOSED:'待审批',READY:'可领作',RUNNING:'处理中',PENDING_VERIFICATION:'待核验',DONE:'已核验完成',BLOCKED:'受阻',FAILED:'失败'};
const commands={import:'转为任务',revise:'修订未完成任务',approve:'批准本项任务',start:'开始处理',report:'提交人工回执',verify:'核验回执',block:'登记受阻','resolve-unknown':'登记未知结果核对'};
const errors={UNAUTHORIZED:'连接已失效，请重新连接。',FORBIDDEN:'当前入口没有该操作权限。',VERSION_CONFLICT:'任务已被另一入口更新，请刷新后重新查看。',CONTEXT_CHANGED:'经营上下文已变化，需要重新生成并核对计划。',RESULT_UNKNOWN:'结果仍未知，请先核对，不能重复执行。',DEPENDENCY_BLOCKED:'前置任务尚未核验完成。',APPROVAL_EXPIRED:'具体审批已到期，请重新核对。',DECISION_EXPIRED:'这份决定已到复盘期限，请重新判断。',OPERATION_CONFLICT:'操作标识已用于不同内容，请刷新核对。',INVALID_EVIDENCE:'请附上证据文件及可追溯的引用。'};
let actor=null,context=null,tasks=[],selected=null;
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function message(text,error=false){$('message').textContent=text;$('message').className=error?'error':'';$('message').style.display='block';}
async function api(route,body,method){
 const r=await fetch(apiBase+route,{method:method??(body?'POST':'GET'),headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'include',signal:AbortSignal.timeout(10000)});
 const result=await r.json();if(!r.ok){const error=new Error(errors[result.error]??`操作未完成（${result.error}）`);error.code=result.error;throw error;}return result;
}
async function run(work){for(const b of root.querySelectorAll('button'))b.disabled=true;try{await work();}catch(e){message(e.message==='The operation was aborted due to timeout'?'结果尚未确认，请刷新查看，勿重复处理。':e.message,true);if(e.code==='UNAUTHORIZED'){actor=null;$('workspace').hidden=true;$('login').hidden=false;}}finally{for(const b of root.querySelectorAll('button'))b.disabled=false;}}
function button(text,fn,cls=''){const b=el('button',text,cls);b.type='button';b.onclick=()=>run(fn);return b;}
function field(form,title,type='text',value=''){const label=el('label',title),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value;input.required=true;label.append(input);form.append(label);return input;}
function pair(list,label,value){list.append(el('dt',label),el('dd',String(value??'待核')));}
function badge(status){return el('span',names[status]??status,`badge ${status}`);}
function showPlans(plans){
 $('plans').replaceChildren();if(!plans.length){$('plans').append(el('p','尚无已存档草案。由 CEO 命令入口读取受控上下文并保存计划后，可在这里查看。'));return;}
 for(const row of plans){const box=el('div',undefined,'plan'),p=row.plan;
  box.append(el('strong',`已排 ${p.tasks.length} 项 · 延期 ${p.deferred.length} 项 · 受阻 ${p.blocked.length} 项`),el('p',`预计 ${p.capacity.usedMinutes} 分钟 / 可用 ${p.capacity.availableMinutes??'待确认'} 分钟`));
  const details=el('details'),summary=el('summary','查看草案及未排项目');details.append(summary);
  for(const [bucket,label] of [['tasks','已排'],['deferred','延期'],['blocked','受阻']])for(const t of p[bucket])details.append(el('p',`${label} · ${t.title}${t.reason?' · '+t.reason:''}`));
  box.append(details);
  if(actor.role==='agent'&&row.contextId===context.contextId&&p.commitment==='WITHIN_CAPACITY'&&p.tasks.length)box.append(button('将已排项目转为待审批任务',async()=>{const expectedVersions=Object.fromEntries(tasks.filter(t=>p.tasks.some(candidate=>candidate.taskId===t.taskId)).map(t=>[t.taskId,t.version]));await api('import',{planId:row.planId,operationId:crypto.randomUUID(),expectedVersions});await refresh();message('已转入共享任务库；尚未批准执行。');}));
  $('plans').append(box);
 }
}
async function refresh(){
 const [who,c,list,plans]=await Promise.all([api('me'),api('context'),api('tasks'),api('plans')]);actor=who.actor;context=c;tasks=list.tasks;
 $('login').hidden=true;$('workspace').hidden=false;$('identity').textContent=actor.role==='owner'?'经营者 · 审批与核验':'CEO 入口 · 领作与回执';
 $('capacity').textContent=`${context.goal.capacityMinutes-context.goal.bufferMinutes} 分钟`;
 $('counts').textContent=`${tasks.filter(t=>t.status==='DONE').length} / ${tasks.length} 已核验`;
 $('gaps').textContent=context.gaps.length?`经营数据有 ${context.gaps.length} 类待核项；不据此宣称利润或目标达成。`:'上下文已读取；经营效果另行观察。';
 showPlans(plans.plans);$('task-list').replaceChildren();if(!tasks.length)$('task-list').append(el('p','尚无任务。已存档的计划仍保留，转入后会在这里显示。'));
 for(const t of tasks){const b=button('',()=>showTask(t.taskId),'task'+(t.taskId===selected?' selected':''));b.append(el('strong',t.definition.title),badge(t.status),el('p',`${t.definition.estimatedMinutes} 分钟 · 版本 ${t.version}`));$('task-list').append(b);}
 if(selected)await showTask(selected);
}
async function evidenceFrom(form,summary){
 const reference=form.querySelector('[data-reference]').value.trim(),file=form.querySelector('[data-file]').files[0];
 if(!file||!reference)throw new Error('请填写证据引用并选择对应证据文件。');
 if(file.size>10*1024*1024)throw new Error('单份证据文件请控制在 10MB 内。');
 const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
 return[{reference,sha256:Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join(''),summary}];
}
function evidenceFields(form){const ref=field(form,'证据引用（本地文件位置或文档标识）');ref.dataset.reference='true';const file=field(form,'选择证据文件（保留原件，工作台只记录引用和校验摘要）','file');file.dataset.file='true';return file;}
async function send(task,command,args){const result=await api(`tasks/${encodeURIComponent(task.taskId)}/commands`,{command,args,expectedVersion:task.version,operationId:crypto.randomUUID()});await refresh();message(`${commands[command]}已记录。${result.task.status==='DONE'?'本项为人工核验，经营效果仍待观察。':''}`);}
function actionForm(task,command){
 const form=el('form'),title=el('h3',commands[command]);form.append(title);let build;
 if(command==='approve'){
  const end=new Date(Math.min(Date.now()+3600000,Date.parse(task.reviewAt))),local=new Date(end.getTime()-end.getTimezoneOffset()*60000).toISOString().slice(0,16);
  const expires=field(form,'本次审批有效至','datetime-local',local);
  form.append(el('p','仅批准这项人工调查及当前内容，不授予调价、采购或发布权限。'));build=async()=>({expiresAt:new Date(expires.value).toISOString()});
 }else if(command==='start'){form.append(el('p','登记开始处理；平台实际操作由获授权的人完成。'));build=async()=>({});
 }else if(command==='report'){
  const label=el('label','处理结果'),select=el('select');for(const [value,text] of [['REPORTED','已报告，等待核验'],['UNKNOWN','结果未知'],['FAILED','明确失败']]){const o=el('option',text);o.value=value;select.append(o);}label.append(select);form.append(label);
  const note=field(form,'处理说明','textarea');const file=evidenceFields(form);file.required=false;form.querySelector('[data-reference]').required=false;
  build=async()=>({outcome:select.value,summary:note.value,evidence:select.value==='REPORTED'?await evidenceFrom(form,note.value):[]});
 }else if(command==='verify'){
  const label=el('label','核验结论'),select=el('select');for(const [v,text] of [['yes','证据符合任务验收要求'],['no','证据不足，退回补充']]){const o=el('option',text);o.value=v;select.append(o);}label.append(select);form.append(label);
  const note=field(form,'已核对的内容与结论','textarea');form.append(el('p','请先核对证据原件与验收条件。这里记录经营者核验，不是平台自动回读。'));build=async()=>({accepted:select.value==='yes',note:note.value});
 }else if(command==='block'){
  const label=el('label','受阻原因'),select=el('select');for(const [v,text] of [['PERSON','等待人员'],['DATA','等待数据'],['DEPENDENCY','等待前置任务'],['RESOURCE','等待资源']]){const o=el('option',text);o.value=v;select.append(o);}label.append(select);form.append(label);const note=field(form,'具体说明','textarea');build=async()=>({kind:select.value,reason:note.value});
 }else{
  const note=field(form,'核对结果：确认未产生实际效果的依据','textarea');evidenceFields(form);form.append(el('p','仅确认未生效后，才可退回受阻状态。若已生效或仍不确定，保持待核验，交由人工处理。'));build=async()=>({result:'NOT_APPLIED',note:note.value,evidence:await evidenceFrom(form,note.value)});
 }
 const submit=el('button',commands[command]);submit.type='submit';form.append(submit);form.onsubmit=e=>{e.preventDefault();run(async()=>send(task,command,await build()));};return form;
}
async function showTask(id){
 selected=id;const{task,events}=await api(`tasks/${encodeURIComponent(id)}`),box=$('detail');box.replaceChildren(el('h2',task.definition.title),badge(task.status));
 const list=el('dl');pair(list,'验收要求',task.definition.acceptance);pair(list,'处理入口',task.assignedTo);pair(list,'预计投入',`${task.definition.estimatedMinutes} 分钟`);pair(list,'任务期限',task.definition.deadline??'未设置硬期限');pair(list,'当前版本',task.version);pair(list,'任务编号',task.taskId);pair(list,'经营效果','待观察，与任务完成分别判断');box.append(list);
 if(task.contextId!==context.contextId)box.append(el('p','此任务对应旧上下文，审批与领作会被阻止；请先由 CEO 重新判断。'));
 if(task.blocked)box.append(el('p',`受阻：${task.blocked.reason}`));
 if(task.receipt){box.append(el('h3','处理回执'),el('p',task.receipt.summary));for(const e of task.receipt.evidence??[])box.append(el('p',`证据：${e.reference} · ${e.summary}`));}
 if(task.verification)box.append(el('p',`人工核验：${task.verification.note}`));
 const choices=[];
 if(actor.role==='owner'){
  if(['PROPOSED','BLOCKED'].includes(task.status))choices.push('approve');
  if(task.status==='PENDING_VERIFICATION')choices.push(task.receipt?.outcome==='UNKNOWN'?'resolve-unknown':'verify');
 }else if(actor.id===task.assignedTo){if(task.status==='READY')choices.push('start');if(task.status==='RUNNING')choices.push('report');}
 if(['PROPOSED','READY','RUNNING','BLOCKED'].includes(task.status))choices.push('block');
 for(const c of choices)box.append(actionForm(task,c));
 const history=el('details'),summary=el('summary',`查看 ${events.length} 条操作记录`);history.append(summary);for(const e of events)history.append(el('div',`${e.at} · ${commands[e.command]??e.command} · ${e.actorId} · ${names[e.status]??e.status} · 版本 ${e.version}`,'event'));box.append(history);
 for(const b of $('task-list').children)b.classList.toggle('selected',b.querySelector('strong')?.textContent===task.definition.title);
}
$('login-form').onsubmit=e=>{e.preventDefault();run(async()=>{const token=$('token').value;$('token').value='';await api('session',{token});await refresh();message('已连接共享任务库。');});};
$('refresh').onclick=()=>run(refresh);$('logout').onclick=()=>run(async()=>{await api('session',null,'DELETE');actor=null;selected=null;$('workspace').hidden=true;$('login').hidden=false;$('identity').textContent='尚未连接';message('已退出。');});
refresh().catch(e=>{if(e.code!=='UNAUTHORIZED')message('经营任务服务暂未连接，请确认本机工作空间已启动。',true);});

}
const standalone=typeof document==='undefined'?null:document.querySelector('[data-ceo-standalone]');
if(standalone)mountCeoTaskWorkspace(standalone);
