const states={PROPOSED:'待审批',READY:'可领作',RUNNING:'处理中',PENDING_VERIFICATION:'待核验',DONE:'已核验完成',BLOCKED:'受阻',FAILED:'失败'};
const reasons={SOURCE_HASH_MISMATCH:'来源内容已变化，需要重新核对并登记证据。',BRIEF_CONTEXT_CHANGED:'经营目标或上下文已变化，需要CEO重新判断。',INVALID_BRIEF_SOURCE:'来源结构或计划容量未通过检查。',SOURCE_LIMIT:'来源文件超出读取范围。',UNSAFE_SOURCE:'来源位置未通过检查。'};

export function renderCeoOperatingBrief(root,brief,{onTask=()=>{},onDay=()=>{}}={}){
 const doc=root.ownerDocument;
 const el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
 const paragraph=text=>el('p',text);
 root.replaceChildren();root.classList.add('operating-brief');
 root.append(el('h2','经营基线与七天草案'));
 if(brief?.status!=='AVAILABLE'){
  root.append(paragraph(brief?.status==='NOT_CONFIGURED'?'尚未接入经营简报。已有任务仍可继续查看。':'经营简报暂不可用。已有任务与审批入口仍保留。'));
  if(reasons[brief?.reason])root.append(paragraph(reasons[brief.reason]));return;
 }
 const {baseline:b,plan:p}=brief;
 root.append(paragraph(`${p.fromDate} 至 ${p.toDate} · ${p.timeZone} · ${p.isExpired?'历史草案已过期':p.isUpcoming?'未来草案':'待审核草案'} · 未排入执行队列`));
 root.append(el('p','历史观察不是正式目标基线；目标分摊草案不是销量预测。缺少的利润和目标差距继续待核。','notice'));
 const metrics=el('div',undefined,'brief-metrics');
 for(const [label,value] of [['观察周支付商品',`${b.paidUnitsTotal} 件`],['按来源显示日均',`${b.dailyAverage} 件`],['月经营净利润',b.netProfitCNY===null?'待核':`¥${b.netProfitCNY}`]]){
  const box=el('article',undefined,'brief-stat');box.append(el('span',label),el('strong',value));metrics.append(box);
 }
 root.append(metrics,paragraph(`历史观察：${b.period[0]} 至 ${b.period[1]} · 来源日界 ${b.sourceTimeZone} · ${b.products} 个有支付商品 / ${b.skus} 个SKU。不是当前库存或当前日销量。`));
 function table(headings,rows){
  const wrap=el('div',undefined,'brief-table-wrap'),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');
  for(const label of headings)tr.append(el('th',label));head.append(tr);table.append(head);
  for(const row of rows){const tr=el('tr');for(const value of row)tr.append(el('td',value));body.append(tr);}table.append(body);wrap.append(table);return wrap;
 }
 root.append(el('h3','商品组合 · 目标分摊草案'),table(['候选组','商品数','历史支付件数','每日目标分摊'],brief.tiers.map(t=>[t.name,t.products,t.historicalPaidUnits,t.dailyTargetProposal])));
 const candidates=el('details'),summary=el('summary',`查看 ${brief.candidates.length} 个主推候选`);candidates.append(summary);
 candidates.append(table(['商品','商品ID','历史支付件数','每日目标分摊'],brief.candidates.map(c=>[c.name,c.productId,c.historicalPaidUnits,c.dailyTargetProposal])));
 root.append(candidates,paragraph('候选组合仍待完整利润和当前供给核准，不作为采购或让价依据。'));
 root.append(el('h3','七天行动卡'),paragraph('日期切换仅查看草案。原任务当前状态不代表该日动作已完成；批准、领作和核验仍在原任务详情中处理。'));
 const nav=el('div',undefined,'brief-days'),body=el('div',undefined,'brief-actions'),buttons=[];
 root.append(nav,body);
 let selected=brief.days.some(d=>d.date===root.dataset.briefDay)?root.dataset.briefDay:(brief.days.find(d=>d.date===p.today)?.date??brief.days[0].date);
 function show(day){
  selected=day.date;root.dataset.briefDay=selected;
  for(const item of buttons){item.button.className=item.date===selected?'brief-day selected':'brief-day secondary';item.button.setAttribute('aria-pressed',String(item.date===selected));}
  body.replaceChildren(el('h3',`${day.date} · ${day.theme}`),paragraph(`核心 ${day.coreMinutes} 分钟 · 常规运营预留 ${day.routineMinutes} 分钟 · 应急 ${day.emergencyMinutes} 分钟`));
  for(const a of day.actions){
   const card=el('article',undefined,'brief-action');
   card.append(el('h4',a.title),paragraph(`预计 ${a.estimatedMinutes} 分钟 · 原任务当前状态：${a.liveTask?`${states[a.liveTask.status]??a.liveTask.status}（版本 ${a.liveTask.version}）`:'尚未建立或不可用'}`));
   const steps=el('ol');for(const step of a.steps)steps.append(el('li',step));card.append(steps);
   const details=el('details');details.append(el('summary','验收与受阻处理'),paragraph(`验收：${a.acceptance}`),paragraph(`受阻时：${a.ifBlocked}`));card.append(details);
   if(a.liveTask){const link=el('button','查看原任务','secondary');link.type='button';link.onclick=()=>onTask(a.sourceTaskRef);card.append(link);}
   body.append(card);
  }
  onDay(day.date);
 }
 for(const day of brief.days){
  const button=el('button',`${day.date}${day.date===p.today?' · 今天':''}`);button.type='button';button.onclick=()=>show(day);buttons.push({date:day.date,button});nav.append(button);
 }
 show(brief.days.find(d=>d.date===selected));
}
