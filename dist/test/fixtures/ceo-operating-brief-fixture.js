import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

export const briefNow=new Date('2026-10-28T02:00:00Z');
export async function briefFixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'ceo-brief-'));
 t.after(async()=>{const rel=path.relative(os.tmpdir(),root);if(!rel.startsWith('ceo-brief-')||rel.includes(path.sep))throw new Error('UNSAFE_TEST_CLEANUP');await rm(root,{recursive:true,force:true});});
 const context={contextId:'context-brief-test',goal:{goalId:'goal-brief-test',version:2,storeRef:{environmentId:'400370',platform:'aliexpress-choice'},period:{fromDate:'2026-12-01',toDate:'2026-12-31',timeZone:'Asia/Shanghai'},targets:[{targetId:'daily-paid-items',value:200},{targetId:'monthly-operating-profit-ex-quality-penalty',value:12000}],capacityMinutes:300,bufferMinutes:60}};
 const baseline={schema:'ceo-operating-baseline-observation/v1',storeId:'400370',goalVersion:2,goal:context.goal,
  periodAsDisplayed:['2026-10-19','2026-10-25'],sourceTimezoneLabel:'PST',ianaTimezone:null,formalGoalMetricVerified:false,dataIsLiveCurrentSnapshot:false,
  daily:Array.from({length:7},(_,i)=>({date:`2026-10-${19+i}`,paidItems:i+1})),paidUnitsTotal:28,
  averagePaidUnitsPerDisplayedDay:'4.00',channelTotals:{AliExpress:28},paidProductCount:2,paidSkuCount:3,
  monthlyOperatingNetProfitCNY:null,formalDailyTargetGap:null,formalProfitTargetGap:null,
  privateNotes:{token:'NEVER_RETURN_THIS_TOKEN',file:'C:/private/raw.json'}};
 const taskId='store-400370-brief-test';
 const plan={schema:'ceo-seven-day-operating-advisory/v1',status:'DRAFT_FOR_REVIEW',isAuthoritativeTaskStore:false,notImportedOrScheduled:true,
  period:['2026-10-28','2026-11-03'],timezone:'Asia/Shanghai',goalId:context.goal.goalId,goalVersion:2,dailyPaidTarget:200,monthlyOperatingNetProfitCNYTarget:'12000',qualityPenaltiesExcluded:true,
  tiers:[{tier:'主推候选',products:1,historicalPaidUnits:20,dailyTargetProposal:140},{tier:'辅助候选',products:1,historicalPaidUnits:8,dailyTargetProposal:60}],
  mainCandidates:[{productId:'10001',readingName:'合成商品<script>',historicalPaidUnits:20,dailyDecemberTargetProposal:140}],
  schedule:Array.from({length:7},(_,i)=>({date:new Date(Date.UTC(2026,9,28+i)).toISOString().slice(0,10),theme:`第${i+1}日核对`,coreMinutes:30,routineOperationsReserveMinutes:120,emergencyReserveMinutes:60,
   actions:[{title:`检查证据${i+1}`,estimatedMinutes:30,sourceTaskRef:taskId,steps:['读取合成来源'],acceptance:'保留原件',ifBlocked:'记录缺项'}]})),
  taskServiceWritePerformed:false,externalBusinessWritePerformed:false,productionFactsWritten:false,finalHumanAcceptanceGranted:false};
 const tasks=[{taskId,status:'PENDING_VERIFICATION',version:5,attempt:1,definition:{storeRef:{environmentId:'400370'}}}];
 const manifest={schema:'ceo-brief-manifest/v1',storeId:'400370',goalId:context.goal.goalId,goalVersion:2,contextId:context.contextId,
  sources:{baseline:{path:'data/ceo-operating/baseline.json',sha256:''},plan:{path:'data/ceo-operating/plan.json',sha256:''}}};
 const writeManifest=async()=>{await mkdir(path.join(root,'data/ceo-operating'),{recursive:true});await writeFile(path.join(root,'data/ceo-operating/brief-manifest.json'),JSON.stringify(manifest));};
 const save=async()=>{
  await mkdir(path.join(root,'data/ceo-operating'),{recursive:true});
  for(const [key,value] of [['baseline',baseline],['plan',plan]]){const bytes=JSON.stringify(value);await writeFile(path.join(root,manifest.sources[key].path),bytes);manifest.sources[key].sha256=createHash('sha256').update(bytes).digest('hex');}
  await writeManifest();
 };
 await save();return{root,context,baseline,plan,tasks,manifest,save,writeManifest,now:briefNow};
}
