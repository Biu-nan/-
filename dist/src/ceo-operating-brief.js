import {open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const text=(v,max=1000)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const requireValue=(ok,code='INVALID_BRIEF_SOURCE')=>{if(!ok)fail(code);};
const sum=values=>values.reduce((a,b)=>a+b,0);
const addDay=(date,days)=>new Date(Date.parse(date)+days*86400000).toISOString().slice(0,10);
function localDate(now,zone){const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`;}
const within=(root,target)=>{const diff=path.relative(root,target);return diff!==''&&diff!=='..'&&!diff.startsWith(`..${path.sep}`)&&!path.isAbsolute(diff);};

// Bound the actual read, even if a file grows after stat; always close its handle.
export async function readBoundedBriefFile(file,limit,openFile=open){
 const handle=await openFile(file,'r');
 try{
  const info=await handle.stat();requireValue(info.isFile(),'INVALID_BRIEF_SOURCE');requireValue(info.size<=limit,'SOURCE_LIMIT');
  const bytes=Buffer.alloc(limit+1);let length=0;
  while(length<bytes.length){const {bytesRead}=await handle.read(bytes,length,bytes.length-length,null);if(!bytesRead)break;length+=bytesRead;}
  requireValue(length<=limit,'SOURCE_LIMIT');return bytes.subarray(0,length);
 }finally{await handle.close();}
}

// Read-only derivative of local evidence; never upgrades facts or imports tasks.
export async function loadCeoOperatingBrief({projectRoot,context,tasks=[],now=new Date()}){
 const schema='ceo-operating-brief/v1';let readingManifest=true;
 try{
  const root=await realpath(projectRoot),dataRoot=await realpath(path.join(root,'data')),goal=context?.goal;
  requireValue(within(root,dataRoot),'UNSAFE_SOURCE');
  requireValue(goal?.storeRef?.environmentId==='400370'&&text(context.contextId)&&now instanceof Date&&Number.isFinite(now.getTime()),'BRIEF_CONTEXT_CHANGED');
  async function read(relative,limit){
   requireValue(text(relative,500)&&!path.isAbsolute(relative)&&!path.win32.isAbsolute(relative)&&!relative.includes('\\')&&relative.startsWith('data/')&&relative.endsWith('.json')&&!relative.split('/').some(p=>p==='..'||p==='.'),'UNSAFE_SOURCE');
   const full=await realpath(path.join(root,relative));
   requireValue(within(dataRoot,full),'UNSAFE_SOURCE');
   return readBoundedBriefFile(full,limit);
  }
  const manifestBytes=await read('data/ceo-operating/brief-manifest.json',8192),manifest=JSON.parse(manifestBytes.toString('utf8'));
  readingManifest=false;
  requireValue(manifest?.schema==='ceo-brief-manifest/v1'&&object(manifest.sources));
  requireValue(manifest.storeId==='400370'&&manifest.goalId===goal.goalId&&manifest.goalVersion===goal.version&&manifest.contextId===context.contextId,'BRIEF_CONTEXT_CHANGED');
  const source={},sourceHashes={};
  for(const name of ['baseline','plan']){
   const ref=manifest.sources[name];requireValue(object(ref)&&/^[a-f0-9]{64}$/.test(ref.sha256));
   const bytes=await read(ref.path,262144);requireValue(hash(bytes)===ref.sha256,'SOURCE_HASH_MISMATCH');
   source[name]=JSON.parse(bytes.toString('utf8'));sourceHashes[name]=ref.sha256;
  }
  const b=source.baseline,p=source.plan;
  requireValue(b?.schema==='ceo-operating-baseline-observation/v1'&&p?.schema==='ceo-seven-day-operating-advisory/v1');
  requireValue(b.storeId==='400370'&&b.goalVersion===goal.version&&b.goal?.goalId===goal.goalId&&b.goal?.version===goal.version&&p.goalId===goal.goalId&&p.goalVersion===goal.version,'BRIEF_CONTEXT_CHANGED');
  requireValue(b.formalGoalMetricVerified===false&&b.dataIsLiveCurrentSnapshot===false&&b.monthlyOperatingNetProfitCNY===null&&b.formalDailyTargetGap===null&&b.formalProfitTargetGap===null);
  requireValue(p.status==='DRAFT_FOR_REVIEW'&&p.isAuthoritativeTaskStore===false&&p.notImportedOrScheduled===true&&p.taskServiceWritePerformed===false&&p.externalBusinessWritePerformed===false&&p.productionFactsWritten===false&&p.finalHumanAcceptanceGranted===false);
  requireValue(p.timezone===goal.period?.timeZone&&p.qualityPenaltiesExcluded===true);
  const dailyTarget=goal.targets?.find(t=>t.targetId==='daily-paid-items')?.value;
  const profitTarget=goal.targets?.find(t=>t.targetId==='monthly-operating-profit-ex-quality-penalty')?.value;
  requireValue(integer(dailyTarget)&&dailyTarget>0&&p.dailyPaidTarget===dailyTarget&&Number(p.monthlyOperatingNetProfitCNYTarget)===profitTarget);
  requireValue(Array.isArray(b.periodAsDisplayed)&&b.periodAsDisplayed.length===2&&b.periodAsDisplayed.every(validDate)&&text(b.sourceTimezoneLabel,80));
  requireValue(Array.isArray(b.daily)&&b.daily.length>0&&b.daily.length<=31&&b.daily.every((d,i)=>object(d)&&validDate(d.date)&&integer(d.paidItems)&&d.date===addDay(b.periodAsDisplayed[0],i)));
  requireValue(b.daily.at(-1).date===b.periodAsDisplayed[1]&&integer(b.paidUnitsTotal)&&sum(b.daily.map(d=>d.paidItems))===b.paidUnitsTotal);
  requireValue(integer(b.paidProductCount)&&integer(b.paidSkuCount)&&object(b.channelTotals)&&Object.values(b.channelTotals).every(integer)&&sum(Object.values(b.channelTotals))===b.paidUnitsTotal);
  requireValue(Array.isArray(p.tiers)&&p.tiers.length>0&&p.tiers.length<=5&&p.tiers.every(t=>object(t)&&text(t.tier,80)&&integer(t.products)&&integer(t.historicalPaidUnits)&&integer(t.dailyTargetProposal)));
  requireValue(sum(p.tiers.map(t=>t.products))===b.paidProductCount&&sum(p.tiers.map(t=>t.historicalPaidUnits))===b.paidUnitsTotal&&sum(p.tiers.map(t=>t.dailyTargetProposal))===dailyTarget);
  requireValue(Array.isArray(p.mainCandidates)&&p.mainCandidates.length<=20&&p.mainCandidates.every(c=>object(c)&&/^\d{1,30}$/.test(c.productId)&&text(c.readingName,300)&&integer(c.historicalPaidUnits)&&integer(c.dailyDecemberTargetProposal)));
  requireValue(sum(p.mainCandidates.map(c=>c.dailyDecemberTargetProposal))===p.tiers[0].dailyTargetProposal);
  requireValue(Array.isArray(p.period)&&p.period.length===2&&p.period.every(validDate)&&p.period[1]===addDay(p.period[0],6)&&Array.isArray(p.schedule)&&p.schedule.length===7);
  requireValue(integer(goal.capacityMinutes)&&integer(goal.bufferMinutes)&&goal.bufferMinutes<=goal.capacityMinutes);
  const taskMap=new Map(tasks.filter(t=>t.definition?.storeRef?.environmentId==='400370').map(t=>[t.taskId,t]));
  const days=p.schedule.map((day,i)=>{
   requireValue(object(day)&&day.date===addDay(p.period[0],i)&&text(day.theme,300)&&Array.isArray(day.actions)&&day.actions.length>0&&day.actions.length<=3);
   requireValue(integer(day.coreMinutes)&&integer(day.routineOperationsReserveMinutes)&&integer(day.emergencyReserveMinutes)&&day.emergencyReserveMinutes>=goal.bufferMinutes&&day.coreMinutes+day.routineOperationsReserveMinutes+day.emergencyReserveMinutes<=goal.capacityMinutes);
   const actions=day.actions.map(a=>{
    requireValue(object(a)&&text(a.title,300)&&integer(a.estimatedMinutes)&&a.estimatedMinutes>0&&/^store-400370-[A-Za-z0-9_-]{1,120}$/.test(a.sourceTaskRef));
    requireValue(Array.isArray(a.steps)&&a.steps.length>0&&a.steps.length<=10&&a.steps.every(s=>text(s,1000))&&text(a.acceptance)&&text(a.ifBlocked));
    const live=taskMap.get(a.sourceTaskRef);
    return{title:a.title,estimatedMinutes:a.estimatedMinutes,sourceTaskRef:a.sourceTaskRef,steps:a.steps,acceptance:a.acceptance,ifBlocked:a.ifBlocked,
     liveTask:live?{status:live.status,version:live.version,attempt:live.attempt}:null};
   });
   requireValue(sum(actions.map(a=>a.estimatedMinutes))===day.coreMinutes);
   return{date:day.date,theme:day.theme,coreMinutes:day.coreMinutes,routineMinutes:day.routineOperationsReserveMinutes,emergencyMinutes:day.emergencyReserveMinutes,actions};
  });
  const today=localDate(now,p.timezone);
  return{schema,status:'AVAILABLE',readOnly:true,loadedAt:now.toISOString(),sourceId:hash(manifestBytes),sourceHashes,
   plan:{fromDate:p.period[0],toDate:p.period[1],timeZone:p.timezone,today,isExpired:today>p.period[1],isUpcoming:today<p.period[0],status:'DRAFT_FOR_REVIEW'},
   baseline:{period:b.periodAsDisplayed,sourceTimeZone:b.sourceTimezoneLabel,paidUnitsTotal:b.paidUnitsTotal,dailyAverage:Number((b.paidUnitsTotal/b.daily.length).toFixed(2)),products:b.paidProductCount,skus:b.paidSkuCount,netProfitCNY:null,formalTargetGap:null,formalMetricVerified:false},
   tiers:p.tiers.map(t=>({name:t.tier,products:t.products,historicalPaidUnits:t.historicalPaidUnits,dailyTargetProposal:t.dailyTargetProposal})),
   candidates:p.mainCandidates.map(c=>({productId:c.productId,name:c.readingName,historicalPaidUnits:c.historicalPaidUnits,dailyTargetProposal:c.dailyDecemberTargetProposal})),days};
 }catch(e){
  if(readingManifest&&e.code==='ENOENT')return{schema,status:'NOT_CONFIGURED',readOnly:true};
  const known=new Set(['UNSAFE_SOURCE','SOURCE_LIMIT','SOURCE_HASH_MISMATCH','BRIEF_CONTEXT_CHANGED','INVALID_BRIEF_SOURCE']);
  return{schema,status:'UNAVAILABLE',readOnly:true,reason:known.has(e.code)?e.code:'SOURCE_UNAVAILABLE'};
 }
}
