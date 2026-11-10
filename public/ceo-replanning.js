const statuses={AVAILABLE:'可提交接续计划草案',NEEDS_REVIEW:'等待首份真实复盘',REVIEW_STALE:'目标或来源已变化，需要重新核对复盘',SOURCE_UNAVAILABLE:'经营来源暂不可用，接续入口待恢复',TASK_LIMIT:'经营任务超过本入口处理范围，需要先整理'};
const choices={REPLAN:'沿用原ID重排',WAIT:'等待原回执或核验',DEFER:'本草案暂缓，原任务保留',OBSERVE:'仅观察经营效果'};
const states={PROPOSED:'待审批',READY:'可领作',RUNNING:'处理中',PENDING_VERIFICATION:'待核验',DONE:'已核验完成',BLOCKED:'受阻',FAILED:'失败'};
function builder(root){const el=(tag,text)=>{const n=root.ownerDocument.createElement(tag);if(text!==undefined)n.textContent=text;return n;};return el;}
export function renderCeoReplanning(root,packet,{onTask=()=>{}}={}){
 const el=builder(root);root.replaceChildren(el('h2','CEO 接续工作包'),el('p',statuses[packet?.status]??statuses.SOURCE_UNAVAILABLE));
 root.append(el('p','CEO依据复盘和当前任务提出下一版草案；本入口未导入、未排程，也不会自动执行店铺动作。'));
 if(packet?.status==='NEEDS_REVIEW')root.append(el('p','请先由经营者保存真实日终复盘。系统不会代填说明或虚构经营结果。'));
 if(packet?.review)root.append(el('p',`关联复盘：${packet.review.date} · ${packet.review.reviewId}`),el('p',packet.review.note));
 if(packet?.changedSinceReview?.length)root.append(el('p',`复盘后有 ${packet.changedSinceReview.length} 项任务已变化；提交将核对当前版本。`));
 for(const task of packet?.tasks??[]){const item=el('details');item.append(el('summary',`${task.title} · ${states[task.status]??task.status} · 版本 ${task.version}`),el('p',`可选处理：${task.allowedChoices.map(c=>choices[c]??c).join('；')}`));const b=el('button','查看原任务');b.type='button';b.onclick=()=>onTask(task.taskId);item.append(b);root.append(item);}
 if(packet?.canSubmit)root.append(el('p','本机CEO入口可读取 replanning 工作包，再通过 replan 提交关联草案。经营者仍在原任务中具体审批。'));
}
export function appendCeoReviewLink(root,link){
 if(!link)return;const el=builder(root),details=el('details');details.append(el('summary',`承接复盘 ${link.reviewDate} · 存档时未导入、未排程`),el('p','这是草案存档时的记录；当前执行与核验状态请查看原任务。'),el('p',link.rationale));
 for(const d of link.dispositions)details.append(el('p',`${d.taskId} · ${choices[d.choice]??d.choice} · ${d.reason}`));root.append(details);
}
