const labels={MATCH:'摘要一致',MISMATCH:'内容已变化',MISSING:'原件缺失',UNSUPPORTED_REFERENCE:'引用不在支持的首店本机目录',TOO_LARGE:'文件超过 10MB',TOTAL_LIMIT:'本次原件总量超过 32MB',UNREADABLE:'无法读取原件',INVALID_DIGEST:'摘要格式无效',CHANGED_DURING_READ:'读取期间原件变化'};
export function ceoVerificationArgs(task,{verdict,note,checkId}){
 if(!['yes','no'].includes(verdict))throw new Error('请先选择核验结论。');
 if(verdict==='yes'&&task.taskId.startsWith('store-400370-')){
  if(!/^[a-f0-9]{64}$/.test(checkId??''))throw new Error('请先核对本机原件；全部一致后再判断是否满足业务验收要求。');
  return{accepted:true,note,evidenceCheckId:checkId};
 }
 return{accepted:verdict==='yes',note};
}
export function mountCeoEvidenceCheck(root,task,{onCheck,onError=()=>{}}={}){
 const el=(tag,text)=>{const n=root.ownerDocument.createElement(tag);if(text!==undefined)n.textContent=text;return n;};let checkId=null;
 const heading=el('h3','证据原件核对'),help=el('p','只读取回执已登记的本机首店证据，不上传文件。文件一致后，仍需按业务验收要求判断。'),button=el('button','核对本机原件'),result=el('div');button.type='button';
 root.append(heading,help,button,result);
 button.onclick=async()=>{
  checkId=null;button.disabled=true;result.replaceChildren(el('p','正在核对原件…'));
  try{
   const check=await onCheck();const matched=check.status==='MATCH'&&check.taskId===task.taskId&&check.taskVersion===task.version&&/^[a-f0-9]{64}$/.test(check.checkId??'');
   checkId=matched?check.checkId:null;
   result.replaceChildren(el('p',matched?'文件与回执摘要一致；仍需逐项判断是否满足业务验收要求。':'原件核对未通过，不能据此通过任务验收。请补充原件或退回补证。'));
   const list=el('ul');for(const file of check.files??[]){const row=el('li',`${labels[file.status]??'未通过'} · ${file.reference}${Number.isSafeInteger(file.bytes)?` · ${file.bytes} 字节`:''}`);list.append(row);}result.append(list);
   if(!check.files?.length)result.append(el('p','没有可核对的证据原件。'));
  }catch(e){result.replaceChildren(el('p','原件核对未完成，请恢复连接后重试。'));onError(e);}
  finally{button.disabled=false;}
 };
 return{getCheckId:()=>checkId};
}
