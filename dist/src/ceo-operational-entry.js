/** G2-B3 local, read-only operational entry. No formal Context, task, or Workflow authority. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,writeFile,readFile,unlink,lstat} from 'node:fs/promises';
import {collectStoreIdentity} from './ceo-wenmai-identity-source.js';
import {collectAliExpressStoreMetrics} from './ceo-ae-metrics-source.js';
import {buildUnapprovedShadow} from './ceo-unapproved-shadow.js';

export const CEO_OPERATIONAL_QUESTION='分析纳物一店最近的经营情况，告诉我应该优先处理什么。';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const OUTPUT=path.join(ROOT,'output','ceo-g2b3');
const COLLECTOR=fileURLToPath(new URL('./collectors/ae-metrics.v2.mjs',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const FIELDS={today:'todaySalesNum','7d':'recent7dSalesNum','30d':'recent30dSalesNum'};
const SPECS=[...Object.keys(FIELDS).map(window=>({caliber:'sales.qty.total',window,unit:'件'})),...Object.entries({'catalog.brokenSize':'个','catalog.outOfStock':'个','catalog.platformItems':'个','inventory.actual':'件','inventory.occupied':'件','inventory.transit':'件','sales.amount.gmv':'CNY','sales.amount.pending':'CNY','sales.amount.net':'CNY','traffic.pv':'次','traffic.uv':'人','conv.buyers':'人','conv.rate':'%','lifecycle.activeSkus':'个'}).map(([caliber,unit])=>({caliber,window:'today',unit}))];
const ROUTES={sales:'/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice',fund:'/m_apps/fund/onestop',store:'/m_apps/one-stop-service-sycm/store-overview'};
const APIS=['mtop.global.merchant.shop.sales.summary','mtop.global.merchant.sales.summary','mtop.global.merchant.sales.query','mtop.ae.merchant.fund.accounting.queryfundoverview','mtop.aliexpress.seller.data.delay.plan','mtop.aliexpress.dps.query'];
const key=m=>`${m.caliber}@${m.window}`;

export function validateOperationalBatch({identity,batch,requestStartedAt,now=new Date()}={}){
 const errors=[],warnings=[],checks={};
 const check=(name,ok)=>{checks[name]=!!ok;if(!ok)errors.push(name);};
 const start=Date.parse(requestStartedAt),end=+now;
 const fresh=t=>Number.isFinite(Date.parse(t))&&Date.parse(t)>=start&&Date.parse(t)<=end;
 check('clock',Number.isFinite(start)&&Number.isFinite(end)&&end>=start&&end-start<=360000);
 check('identity',identity?.status==='COLLECTED'&&identity.accessMode==='READ_ONLY'&&identity.storeIdentity?.envId==='400370'&&identity.storeIdentity?.name==='纳物-箱包全托1店'&&identity.storeIdentity?.platform==='全球速卖通'&&fresh(identity.collectedAt));
 check('batch',batch?.schema==='ceo-ae-metrics-batch/v1'&&typeof batch.batchId==='string'&&batch.batchId.startsWith('aeb-')&&batch.status==='COLLECTED'&&batch.exitCode===0&&fresh(batch.requestedAt)&&fresh(batch.collectedAt)&&Date.parse(batch.collectedAt)>=Date.parse(batch.requestedAt));
 check('store',batch?.storeIdentity?.envId==='400370');
 check('source',batch?.accessMode==='READ_ONLY'&&batch.verificationStatus==='UNAPPROVED'&&!batch.approvalRef&&batch.collectorVersion==='v2'&&/^[a-f0-9]{64}$/.test(batch.sourceHash??''));
 const session=batch?.session;
 check('session',session?.batchId===batch?.batchId&&session?.envId==='400370'&&session?.channelId==='2358891'&&Number.isInteger(session?.cdpPort)&&session.cdpPort>=1024&&session.cdpPort<=65535&&session?.openEnv?.envId==='400370'&&session.openEnv.cdpPort===session.cdpPort&&Number.isInteger(session.openEnv.pid)&&session.openEnv.pid>0&&session.openEnv.method==='openEnv'&&session.openEnv.endpoint==='http://127.0.0.1:3980/openEnv'&&session.browser?.port===session.cdpPort&&typeof session.browser.product==='string'&&session?.cacheDisabled===true&&session?.dryRun===true&&session?.keepOpen===true);
 check('browserIdentity',session?.browserIdentity?.status==='MATCHED'&&session.browserIdentity.envId==='400370'&&session.browserIdentity.cdpPort===session.cdpPort&&session.browserIdentity.claimedPid===session.openEnv?.pid&&session.browserIdentity.observedPid===session.openEnv?.pid&&session.browserIdentity.product===session.browser?.product&&fresh(session.browserIdentity.observedAt));
 check('routes',['sales','fund','store'].every(name=>session?.routes?.some(r=>r.name===name))&&session?.routes?.every(r=>r.pathname===ROUTES[r.name]&&r.host==='csp.aliexpress.com'&&r.channelId==='2358891'&&fresh(r.observedAt)));
 check('responses',session?.responseEvidence?.length>0&&session.responseEvidence.every(r=>APIS.includes(r.api)&&(r.host==='csp.aliexpress.com'||r.host==='acs.aliexpress.com'||r.host==='seller-acs.aliexpress.com')&&(!r.channelId||r.channelId==='2358891')&&fresh(r.observedAt)&&/^[a-f0-9]{64}$/.test(r.payloadHash??'')));
 check('timezone',['PST','PDT'].includes(session?.platformTimezone)&&batch?.period?.timezone===session?.platformTimezone);
 // The observed abbreviation does not establish its UTC offset or DST rules.
 warnings.push('UNVERIFIED_TIMEZONE_OFFSET:仅记录本次平台时区原文，不推定本地业务日界');
 const supplied=Array.isArray(batch?.metrics)?batch.metrics:[];
 const business=supplied.filter(m=>m.subject!=='DATA_FRESHNESS');
 const expected=new Set(SPECS.map(key)),seen=new Set();
 for(const m of business){
  check(`metric:${key(m)}`,expected.has(key(m))&&!seen.has(key(m))&&m.subject==='STORE'&&m.storeId==='env:400370'&&SPECS.find(s=>key(s)===key(m))?.unit===m.unit);
  seen.add(key(m));
 }
 const metrics=SPECS.map(spec=>{
  const m=business.find(m=>key(m)===key(spec));
  if(!m){warnings.push(`MISSING:${key(spec)}`);return {...spec,subject:'STORE',storeId:'env:400370',value:null,effectiveWindow:null,periodStatus:'UNVERIFIED_PERIOD',availability:'UNAVAILABLE',unavailableReason:'MISSING_IN_BATCH'};}
  const v={...m};
  if(m.value===null||!Number.isFinite(m.value)||m.value<0||m.availability!=='AVAILABLE'||m.suspects?.length||m.unavailableReason||m.caliber==='conv.rate'&&m.value>100){v.value=null;v.availability='UNAVAILABLE';v.unavailableReason=m.unavailableReason??(m.suspects?.length?'SUSPECT_VALUE':'INVALID_OR_MISSING_VALUE');warnings.push(`UNAVAILABLE:${key(spec)}`);}
  if(m.caliber.startsWith('sales.amount.')){v.periodStatus='UNVERIFIED_PERIOD';v.effectiveWindow=null;warnings.push(`UNVERIFIED_PERIOD:${key(spec)}`);}
  else if(m.caliber==='sales.qty.total'){
   if(m.sourceField!==FIELDS[m.window]){v.periodStatus='COLLECTOR_DEFAULT';v.effectiveWindow=null;warnings.push(`UNVERIFIED_FIELD_WINDOW:${key(spec)}`);}
   else{v.periodStatus='PLATFORM_FIELD_NAME';v.effectiveWindow=m.window;}
  }else if(/^(catalog|inventory)\./.test(m.caliber)){v.periodStatus='POINT_IN_TIME_SNAPSHOT';v.effectiveWindow='as_of_collection';}
  else{
   // v2's meta.window='platform_default_30d' is assigned by collector code, not extracted page evidence.
   v.periodStatus='COLLECTOR_DEFAULT';v.effectiveWindow=null;warnings.push(`UNVERIFIED_PLATFORM_WINDOW:${key(spec)}`);
  }
  if(m.caliber.startsWith('inventory.'))v.scope='PAGE_1_SAMPLE_ONLY';
  const api=m.caliber==='sales.qty.total'?APIS[0]:m.caliber.startsWith('inventory.')?APIS[2]:m.caliber.startsWith('sales.amount.')?APIS[3]:m.caliber.startsWith('catalog.')?APIS[1]:null;
  const domName=m.caliber.startsWith('catalog.')&&m.extractedBy==='dom'?'sales':!api?'store':null;
  const evidence=domName?session?.domEvidence?.filter(r=>r.name===domName&&r.channelId==='2358891'&&fresh(r.observedAt)).at(-1):session?.responseEvidence?.filter(r=>r.api===api).at(-1);
  v.sourceEvidence=evidence?{batchId:batch.batchId,type:domName?'DOM':'RESPONSE',source:domName??api,payloadHash:evidence.payloadHash,observedAt:evidence.observedAt}:null;
  if(!evidence&&v.availability==='AVAILABLE'){v.value=null;v.availability='UNAVAILABLE';v.unavailableReason='SOURCE_EVIDENCE_MISSING';warnings.push(`SOURCE_EVIDENCE_MISSING:${key(spec)}`);}
  v.verificationStatus='UNAPPROVED';
  return v;
 });
 check('businessFacts',metrics.some(m=>m.availability==='AVAILABLE'));
 if(supplied.some(m=>m.subject==='DATA_FRESHNESS'&&m.value==='DELAYED'))warnings.push('PLATFORM_DECLARED_DELAY');
 return {status:errors.length?'REJECTED':'PASS',verificationStatus:'UNAPPROVED',formalContextStatus:'NOT_ELIGIBLE',checks,errors,warnings,metrics,storeMappingStatus:'UNVERIFIED',environment:{authority:'WENMAI_OPEN_ENV',cdpPort:session?.cdpPort??null,browser:session?.browser??null,openEnv:session?.openEnv??null},timezone:{label:session?.platformTimezone??null,offsetStatus:'UNVERIFIED'}};
}

async function safeOutputDirectory(directory){
 const resolved=path.resolve(directory),relative=path.relative(OUTPUT,resolved);
 if(relative.startsWith('..')||path.isAbsolute(relative))throw fail('OUTPUT_OUTSIDE_ISOLATED_DIRECTORY');
 // Refuse junctions/symlinks, including existing ancestors, rather than following one into production.
 for(let cursor=resolved;;cursor=path.dirname(cursor)){
  try{if((await lstat(cursor)).isSymbolicLink())throw fail('OUTPUT_LINK_DENIED');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(path.dirname(cursor)===cursor)break;
 }
 await mkdir(resolved,{recursive:true});
 return resolved;
}

export async function runOperationalQuery({question=CEO_OPERATIONAL_QUESTION,outputRoot=OUTPUT,signal}={}){
 if(signal?.aborted)throw fail('COLLECTION_ABORTED');
 if(question!==CEO_OPERATIONAL_QUESTION)throw fail('QUESTION_NOT_ALLOWED');
 if(process.platform!=='win32'||Number(process.versions.node.split('.')[0])<22)throw fail('WINDOWS_RUNTIME_REQUIRED');
 const dir=await safeOutputDirectory(outputRoot);
 const lockPath=path.join(OUTPUT,'.collection.lock');
 let lock;
 try{lock=await open(lockPath,'wx');}catch(e){if(e.code==='EEXIST')throw fail('COLLECTION_BUSY');throw e;}
 let started=false;
 try{
  await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
  try{const last=JSON.parse(await readFile(path.join(OUTPUT,'.last-collection.json'),'utf8'));if(Date.now()-Date.parse(last.completedAt)<40000)throw fail('COLLECTION_COOLDOWN_40_SECONDS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const requestId=`ceo-op-${randomUUID()}`,requestedAt=new Date().toISOString();
  const reportDir=path.join(dir,requestId);await mkdir(reportDir); // unique, never overwrite an earlier report
  const bindings={node:process.version,worktree:ROOT,files:{}};
  for(const name of ['dist/src/ceo-operational-entry.js','dist/src/ceo-ae-metrics-source.js','dist/src/ceo-unapproved-shadow.js','dist/src/ceo-live-source-contract.js','dist/src/collectors/ae-metrics.v2.mjs','config/ceo-knowledge.v1.json','config/metrics-schema.json','config/ceo-g2b1-connection-contract.v1.json'])bindings.files[name]=hash(await readFile(path.join(ROOT,name)));
  let identity=null,batch=null,validation=null,shadow=null,environment=null,failure=null;
  try{
   if(signal?.aborted)throw fail('COLLECTION_ABORTED');
   identity=await collectStoreIdentity({expectedEnvId:'400370'});
   if(identity.status!=='COLLECTED'||identity.storeIdentity?.envId!=='400370'||identity.storeIdentity?.name!=='纳物-箱包全托1店'||identity.storeIdentity?.platform!=='全球速卖通')throw fail('STORE_IDENTITY_REJECTED');
   if(signal?.aborted)throw fail('COLLECTION_ABORTED');
   started=true;
   batch=await collectAliExpressStoreMetrics({envId:'400370',scriptPath:COLLECTOR,collectorVersion:'v2',signal});
   validation=validateOperationalBatch({identity,batch,requestStartedAt:requestedAt});
   environment=validation.environment;
   if(validation.status!=='PASS')throw fail('BATCH_VALIDATION_REJECTED');
   if(batch.collectorHash!==bindings.files['dist/src/collectors/ae-metrics.v2.mjs'])throw fail('COLLECTOR_CHANGED_DURING_RUN');
   shadow=buildUnapprovedShadow({batch:{...batch,metrics:validation.metrics},question});
   if(shadow.status==='FAILED')throw fail('SHADOW_ANALYSIS_FAILED');
  }catch(e){failure=typeof e.code==='string'&&/^[A-Z_0-9]+$/.test(e.code)?e.code:'COLLECTION_FAILED';}
  const report={schema:'ceo-operational-report/v1',reportId:requestId,question,requestedAt,completedAt:new Date().toISOString(),status:failure?'FAILED':'UNAPPROVED',failure,verificationStatus:'UNAPPROVED',formalContextStatus:'NOT_ELIGIBLE',formalGateReason:'来源策略、权威店铺映射及 Human 核准未满足；未构建正式 Context',environment,bindings,identity,batch,validation,shadow,
   facts:failure?[]:validation.metrics.filter(m=>m.availability==='AVAILABLE').map(m=>({...m,evidenceRef:{batchId:batch.batchId,sourceHash:batch.sourceHash,metric:key(m)}})),
   hypotheses:failure?[]:(shadow?.anomalies??[]).map(a=>({...a,status:'HYPOTHESIS',evidenceRef:{batchId:batch.batchId,sourceHash:batch.sourceHash}})),
   priorities:failure?[]:(shadow?.priorities??[]),
   effects:{mode:'READ_ONLY',formalTasksCreated:0,workflowExecutorCalls:0,productionDataWrites:0,productionLogWrites:0,browserEnvironmentClosed:false},
   limitation:'本次读取后台当前呈现值，不等于平台实时更新；本页库存样本不能代表全店；没有订单明细或利润数据时不作这些诊断。'};
  const body=JSON.stringify(report,null,2)+'\n';
  await writeFile(path.join(reportDir,'report.json'),body,{flag:'wx'});
  const lines=[`# CEO 经营影子报告 ${requestId}`,'',`问句：${question}`,`状态：${report.status}；正式 Context：NOT_ELIGIBLE`, `采集批次：${batch?.batchId??'未取得'}；来源哈希：${batch?.sourceHash??'未取得'}`,`本轮时间：${requestedAt} → ${report.completedAt}`,'','事实、假设、建议与每项验收条件见同目录 report.json。',...report.priorities.map((p,i)=>`${i+1}. ${p.title}\n   依据：${p.evidence}\n   验收：${p.acceptance}`),'',`数据缺口：${validation?.warnings?.join('；')??failure??'无'}`,report.limitation];
  await writeFile(path.join(reportDir,'report.md'),lines.join('\n')+'\n',{flag:'wx'});
  await writeFile(path.join(reportDir,'receipt.json'),JSON.stringify({reportId:requestId,reportHash:hash(body),batchId:batch?.batchId??null,status:report.status},null,2)+'\n',{flag:'wx'});
  return {report,reportDirectory:reportDir};
 }finally{
  // This local coordination file is not an operational log or a production data store.
  try{if(started)await writeFile(path.join(OUTPUT,'.last-collection.json'),JSON.stringify({completedAt:new Date().toISOString()}));}finally{await lock.close();await unlink(lockPath);}
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length>1){console.error('USAGE: node dist/src/ceo-operational-entry.js "'+CEO_OPERATIONAL_QUESTION+'"');process.exitCode=2;}
 else try{
  const {report,reportDirectory}=await runOperationalQuery({question:args[0]??CEO_OPERATIONAL_QUESTION});
  console.log(JSON.stringify({reportId:report.reportId,status:report.status,failure:report.failure,batchId:report.batch?.batchId,available:report.facts.length,total:17,priorities:report.priorities,verificationStatus:report.verificationStatus,formalContextStatus:report.formalContextStatus,evidence:reportDirectory},null,2));
  if(report.status==='FAILED')process.exitCode=1;
 }catch(e){console.error(e.code??'OPERATIONAL_ENTRY_FAILED');process.exitCode=1;}
}
