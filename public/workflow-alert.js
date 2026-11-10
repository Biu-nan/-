(function installWorkflowAlerts(global){
 'use strict';
 const rendered=new WeakMap();
 const flows={standard_listing:'商品上品流程',luxury_insert:'内胆上品流程',bag_charm:'包挂上品流程'};
 const phases={READY_FOR_LOGIN:'浏览器启动 / 登录准备',VALIDATING_INPUT:'校验素材',CREATING_CHAT:'创建商品对话',UPLOADING_IMAGES:'上传产品图片',SENDING_PROMPT:'发送请求',WAITING_FOR_RESPONSE:'等待网页回复',RESEARCHING:'市场调研',PLANNING:'视觉规划',GENERATING_IMAGES:'生成图片',WRITING_LISTING:'撰写商品文案'};
 function build(state){
  if(!state||state.stage!=='FAILED'||!state.error)return null;
  const detail=String(state.error).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').slice(0,12000);
  const navigation=/navigation.*interrupted by another navigation/i.test(detail),flow=flows[state.workflowMode]??'自动化流程';
  const stopped=state.running===false&&state.autoRun!==true;
  let recordedAt='记录时间待确认';const date=typeof state.updatedAt==='string'&&state.updatedAt.trim()?new Date(state.updatedAt):null;
  if(date&&Number.isFinite(date.getTime()))recordedAt=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date)+'（上海时间）';
  return{title:flow+(stopped?'已停止':'出现异常'),status:stopped?'已停止 · 待处理':'状态待核对',recordedAt,phase:phases[state.interruptedStage]??'执行阶段待确认',
   summary:navigation?'浏览器页面跳转被中断':'流程遇到异常，需要核查',
   explanation:navigation?'网页尚未加载完成，又发生了一次跳转，流程未能继续。':'详细原因已保留在技术详情中，请先核对任务状态。',
   next:navigation?'先确认目标网页已稳定，再前往所属工作区检查恢复入口。':'前往所属工作区查看任务详情，确认原因后再决定是否继续。',detail,targetView:flows[state.workflowMode]?'materials':null};
 }
 function render(root,state,{onOpenTask,onOpenDetails}={}){
  if(!root)return;const model=build(state);root.classList.toggle('hidden',!model);
  if(!model){root.replaceChildren();rendered.delete(root);return;}
  const key=JSON.stringify(model);if(rendered.get(root)===key)return;rendered.set(root,key);
  const el=(tag,text,cls)=>{const node=root.ownerDocument.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const heading=el('div',undefined,'workflow-alert__heading');heading.append(el('span','任务提醒','workflow-alert__badge'),el('strong',model.title),el('span',model.status,'workflow-alert__status'));
  const meta=el('p',`记录时间：${model.recordedAt} · 停在：${model.phase}`,'workflow-alert__meta');
  const summary=el('p',model.summary,'workflow-alert__summary'),explanation=el('p',model.explanation),next=el('p','建议：'+model.next),actions=el('div',undefined,'workflow-alert__actions');
  if(model.targetView&&typeof onOpenTask==='function'){const button=el('button','前往上品工作区');button.type='button';button.onclick=()=>onOpenTask(model.targetView);actions.append(button);}
  if(typeof onOpenDetails==='function'){const button=el('button','查看运行详情');button.type='button';button.onclick=onOpenDetails;actions.append(button);}
  const details=el('details',undefined,'workflow-alert__details');details.append(el('summary','技术详情'),el('pre',model.detail));
  root.replaceChildren(heading,meta,summary,explanation,next,actions,details);
 }
 global.WorkflowAlerts=Object.freeze({build,render});
})(globalThis);
