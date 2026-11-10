/** Pure read-side checks shared by the live collector and offline safety tests. */
export function assertLivePageIdentity(actual,expected){
 try{
  const a=new URL(actual),e=new URL(expected);
  if(a.protocol==='https:'&&a.hostname==='csp.aliexpress.com'&&a.hostname===e.hostname&&a.pathname===e.pathname&&a.searchParams.get('channelId')==='2358891'&&e.searchParams.get('channelId')==='2358891')return '2358891';
 }catch{}
 throw Object.assign(new Error('PAGE_IDENTITY_MISMATCH'),{code:'PAGE_IDENTITY_MISMATCH'});
}
export function summarizeInventorySample(itemPage){
 const list=itemPage?.list,total=itemPage?.total??itemPage?.totalCount??null;
 const valid=Array.isArray(list),emptyKnown=valid&&list.length===0&&total===0;
 const sum=field=>emptyKnown?0:valid&&list.length>0&&list.every(x=>Number.isFinite(x?.[field])&&x[field]>=0)?list.reduce((n,x)=>n+x[field],0):null;
 return {real:sum('realWarehouseInventoryNum'),locked:sum('lockedInventoryNum'),transit:sum('inRoadInventoryNum'),sampleSize:valid?list.length:null,total,coverage:!valid||!Number.isFinite(total)?'UNKNOWN':total===list.length?'FULL':'PARTIAL'};
}

/** Prove the CDP browser process is the one returned for the requested Wenmai environment. */
export function assertLiveBrowserIdentity({envId,opened,connected}={}){
 const validPort=n=>Number.isInteger(n)&&n>=1024&&n<=65535;
 const validPid=n=>Number.isSafeInteger(n)&&n>0;
 if(envId!=='400370'||!validPort(opened?.cdpPort)||!validPid(opened?.pid)||connected?.cdpPort!==opened.cdpPort||connected?.pid!==opened.pid||typeof connected?.product!=='string'||!connected.product||connected.product!==connected.observedProduct)throw Object.assign(new Error('CDP_BROWSER_IDENTITY_MISMATCH'),{code:'CDP_BROWSER_IDENTITY_MISMATCH'});
 return Object.freeze({status:'MATCHED',envId,cdpPort:opened.cdpPort,claimedPid:opened.pid,observedPid:connected.pid,product:connected.product,method:'CDP_SystemInfo.getProcessInfo_Browser.getVersion',observedAt:new Date().toISOString()});
}
