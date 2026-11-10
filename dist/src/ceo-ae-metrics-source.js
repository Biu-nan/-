import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdirSync,lstatSync} from 'node:fs';

/**
 * CEO-side evidence envelope around the existing AliExpress collector.
 *
 * This does NOT re-implement collection. It runs the already authorised script
 * in --dry-run --keep-open mode, which reads the store's own
 * backend session through 稳卖 openEnv and preserves the existing browser, then wraps the
 * observed facts with batch identity and provenance.
 *
 * Guarantees:
 *  - read-only: only --dry-run is allowed; write mode is refused
 *  - no cookie/token access: the child process owns the session, we only parse stdout
 *  - no fabrication: a metric that the collector reports as FETCH_MISS stays null
 *  - fail closed: a non-zero exit does not yield metrics
 */

const REPO='F:/yikuaborder-deploy';
const SCRIPT=`${REPO}/scripts/fetch-ae-metrics.mjs`;
const V2=fileURLToPath(new URL('./collectors/ae-metrics.v2.mjs',import.meta.url));

export function buildCollectorInvocation({envId='400370',scriptPath=SCRIPT,batchId='',env=process.env}={}){
 if(!/^[0-9]{1,20}$/.test(String(envId)))throw new Error('INVALID_ENV_ID');
 if(typeof scriptPath!=='string'||![SCRIPT,V2].some(p=>path.resolve(p)===path.resolve(scriptPath)))throw Object.assign(new Error('SCRIPT_NOT_ALLOWED'),{code:'SCRIPT_NOT_ALLOWED'});
 if(!/^[a-zA-Z0-9-]{1,100}$/.test(batchId))throw new Error('INVALID_BATCH_ID');
 const runtimeDirectory=path.join(fileURLToPath(new URL('../../output/ceo-g2b3/collector-runtime/',import.meta.url)),batchId);
 const clean={...env,TMP:runtimeDirectory,TEMP:runtimeDirectory,TMPDIR:runtimeDirectory};
 for(const key of Object.keys(clean))if(/^(AE_|NODE_OPTIONS$|NODE_PATH$|NODE_V8_COVERAGE$)/i.test(key))delete clean[key];
 return {runtimeDirectory,args:['--permission','--allow-fs-read=*','--allow-fs-write='+runtimeDirectory,scriptPath,String(envId),'--dry-run','--keep-open',...(path.resolve(scriptPath)===path.resolve(V2)?['--ceo-batch='+batchId]:[])],env:clean};
}

const sha=s=>createHash('sha256').update(s).digest('hex');

const CALIBER_META={
 'sales.amount.gmv':{unit:'CNY',definition:'平台原始 sumPaymentAmount 转元（cent/100）；统计期间 UNVERIFIED_PERIOD'},
 'sales.amount.pending':{unit:'CNY',definition:'待结算金额'},
 'sales.amount.net':{unit:'CNY',definition:'净额（平台口径，已扣退款/放款后）'},
 'traffic.pv':{unit:'次',definition:'店铺数据页访问量'},
 'traffic.uv':{unit:'人',definition:'店铺数据页访客数'},
 'conv.buyers':{unit:'人',definition:'支付买家数'},
 'conv.rate':{unit:'%',definition:'支付转化率'},
 'lifecycle.activeSkus':{unit:'个',definition:'在售活跃 SKU 数'},
 'sales.qty.total':{unit:'件',definition:'支付件数'},
 'catalog.brokenSize':{unit:'个',definition:'失效规格数'},
 'catalog.outOfStock':{unit:'个',definition:'缺货商品数'},
 'catalog.platformItems':{unit:'个',definition:'平台在架商品数'},
 'inventory.actual':{unit:'件',definition:'实际库存件数'},
 'inventory.occupied':{unit:'件',definition:'占用库存件数'},
 'inventory.transit':{unit:'件',definition:'在途库存件数'}
};

const LINE=/^\[ae\]\s+([a-zA-Z][a-zA-Z0-9.]*)\s+\[([^\]]+)\]\s+=\s+(.+)$/;

function batchId(d){
 const p=n=>String(n).padStart(2,'0');
 return `aeb-${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${randomUUID().slice(0,6)}`;
}

export function observeOwnedCollectorCancellation(child,signal){
 let aborted=false,disposed=false;
 const cancel=()=>{if(disposed||aborted)return;aborted=true;try{child.kill('SIGTERM');}catch{}};
 if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 return {get aborted(){return aborted;},dispose(){disposed=true;signal?.removeEventListener('abort',cancel);}};
}

export async function collectAliExpressStoreMetrics({envId='400370',now=new Date(),timeoutMs=270000,scriptPath=SCRIPT,collectorVersion='v1',signal  }={}){
 if(signal?.aborted)throw Object.assign(new Error('COLLECTION_ABORTED'),{code:'COLLECTION_ABORTED'});
 if(!/^[0-9]{1,20}$/.test(String(envId)))throw Object.assign(new Error('INVALID_ENV_ID'),{code:'INVALID_ENV_ID'});
 const id=batchId(now);
 const startedAt=new Date();
 const t0=Date.now();

 const invocation=buildCollectorInvocation({envId,scriptPath,batchId:id});
 for(let cursor=invocation.runtimeDirectory;;cursor=path.dirname(cursor)){try{if(lstatSync(cursor).isSymbolicLink())throw new Error('RUNTIME_LINK_DENIED');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(cursor)===cursor)break;}
 mkdirSync(invocation.runtimeDirectory,{recursive:true});
 const collectorHash=sha(readFileSync(scriptPath));
 const child=spawn(process.execPath,invocation.args,{cwd:REPO,windowsHide:true,env:invocation.env});
 const cancellation=observeOwnedCollectorCancellation(child,signal);
 let out='',spawnError=null,timedOut=false,stderrCode=null;
 child.stdout.on('data',d=>{out+=d;if(out.length>2_000_000)child.kill();});
 child.stderr.on('data',d=>{stderrCode??=(String(d).match(/FATALCODE ([A-Z_0-9]+)/)?.[1]??String(d).match(/\bERR_[A-Z_]+\b/)?.[0])??null;});
 child.on('error',()=>{spawnError='SPAWN_FAILED';});
 const timer=setTimeout(()=>{timedOut=true;try{child.kill('SIGKILL');}catch{}},timeoutMs);

 const code=await new Promise(res=>child.on('close',res));
 clearTimeout(timer);cancellation.dispose();
 const elapsedMs=Date.now()-t0;

 // 优先解析 v2 的机器可读行；退化为 v1 的文本行
 const facts=[];
 const jsonLines=[];
 let session=null;
 for(const raw of out.split(/\r?\n/)){const m=raw.match(/^\[ae\] SESSIONJSON (.+)$/);if(m){try{session=JSON.parse(m[1]);}catch{}}}
 for(const raw of out.split(/\r?\n/)){
  const jm=raw.match(/\[ae\] FACTJSON (.+)$/);
  if(jm){try{jsonLines.push(JSON.parse(jm[1]));}catch{}}
 }
 if(jsonLines.length){
  for(const j of jsonLines){
   const isMiss=j.value===null||j.reason==='FETCH_MISS'||j.reason==='SUSPECT_VALUE'||!!j.suspects?.length;
   const meta=CALIBER_META[j.caliber]??{unit:'UNKNOWN',definition:'UNMAPPED'};
   const isAmount=j.caliber.startsWith('sales.amount.');
   // 口径判定：平台字段名 > 平台 meta > 采集器默认
   let effectiveWindow=j.window, periodStatus='COLLECTOR_DEFAULT';
   if(isAmount){periodStatus='UNVERIFIED_PERIOD';effectiveWindow=null;}
   else if(/^sales\.qty\.total$/.test(j.caliber)&&j.subject==='STORE')periodStatus='PLATFORM_FIELD_NAME';
   else if(j.metaWindow){effectiveWindow=j.metaWindow;periodStatus='PLATFORM_META_WINDOW';}
   else if(/^(catalog|inventory)\./.test(j.caliber)){effectiveWindow='as_of_collection';periodStatus='POINT_IN_TIME_SNAPSHOT';}
   facts.push({
    caliber:j.caliber, window:j.window, platformWindow:j.metaWindow??null, effectiveWindow,
    periodStatus,
    subject:j.subject, value:isMiss?null:j.value, unit:meta.unit,
    metricDefinition:meta.definition, sourceField:j.sourceField??null,
    extractedBy:j.extractedBy??null, suspects:j.suspects??null,
    storeId:j.storeId??null,statDate:j.statDate??null,meta:j.meta??null,
    availability:isMiss?'UNAVAILABLE':'AVAILABLE',
    unavailableReason:isMiss?(j.reason??'FETCH_MISS'):null
   });
  }
 }else{
  for(const raw of out.split(/\r?\n/)){
   const m=raw.match(LINE);
   if(!m)continue;
   const [,caliber,windowLabel,rest]=m;
   const flagM=rest.match(/\((\w+)\)\s*$/);
   const flag=flagM?flagM[1]:null;
   const valueText=rest.replace(/\(\w+\)\s*$/,'').trim();
   const isMiss=flag==='FETCH_MISS'||valueText==='null';
   const meta=CALIBER_META[caliber]??{unit:'UNKNOWN',definition:'UNMAPPED'};
   facts.push({
    caliber, window:windowLabel.split('/')[0], platformWindow:null,
    effectiveWindow:windowLabel.split('/')[0], periodStatus:'COLLECTOR_DEFAULT',
    subject:windowLabel.split('/')[1]??'STORE',
    value:isMiss?null:Number(valueText), unit:meta.unit,
    metricDefinition:meta.definition, sourceField:null, extractedBy:null, suspects:null,
    availability:isMiss?'UNAVAILABLE':'AVAILABLE',
    unavailableReason:isMiss?'FETCH_MISS':null
   });
  }
 }
 const usable=facts.filter(f=>f.subject==='STORE'&&f.availability==='AVAILABLE'&&Number.isFinite(f.value));
 const envelope={
  schema:'ceo-ae-metrics-batch/v1',
  batchId:id,
  collectorVersion,
  status:usable.length&&code===0&&!timedOut&&!spawnError&&!cancellation.aborted?'COLLECTED':'FAILED',
  exitCode:code,
  failureReason:cancellation.aborted?'COLLECTION_ABORTED':timedOut?'TIMEOUT':spawnError??stderrCode??(out.match(/\b(CDP_IDENTITY_MISMATCH|CEO_READ_SCOPE_DENIED|FRESH_COLLECTION_CACHE_GUARD_FAILED|PAGE_IDENTITY_MISMATCH)\b/)?.[1])??(code!==0?'COLLECTOR_NONZERO':null),
  collectorHash,session,rawOutputHash:sha(out),
  filesystemPermission:{mode:'NODE_PERMISSION_MODEL',writeAllowedOnly:invocation.runtimeDirectory,productionWritesAllowed:false},
  requestedAt:startedAt.toISOString(),
  collectedAt:new Date().toISOString(),
  elapsedMs,
  sourceSystem:'AliExpress 全托管卖家后台（经稳卖 openEnv 授权会话）',
  sourceAccount:`稳卖 env ${envId} / channelId 2358891`,
  storeIdentity:{envId, alias:'纳物-箱包全托1店', platform:'全球速卖通'},
  sourceEndpointOrPage:'csp.aliexpress.com 店铺数据 / 财务管理 / 销售管理 页面自身 mtop 响应（旁听，不构造请求）',
  accessMode:'READ_ONLY',
  period:{window:'today', note:'窗口标签由采集器按平台返回字段给出，未二次解释', timezone:session?.platformTimezone??null},
  metrics:facts,
  metricCount:facts.length,
  availableCount:usable.length,
  stepErrors:(out.match(/\[ae\] 错误: (.+)/)?.[1]??null),
  sourceHash:sha(JSON.stringify({facts,session,storeIdentity:envId,collectorHash})),
  verificationStatus:'UNAPPROVED',
  approvalRef:null
 };
 return Object.freeze(envelope);
}
