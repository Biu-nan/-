/**
 * UNAPPROVED shadow analysis over a freshly collected batch.
 *
 * Deliberately NOT a gate product: the G2-B1 gate requires approved source
 * policy + verified store mapping, so no fact here can be VERIFIED. Instead of
 * faking a Context, this emits a clearly labelled UNAPPROVED analysis that reuses
 * the batch's source evidence and the report's claim/priority shape.
 *
 * Invariants enforced here:
 *  - a failed batch produces a FAILED analysis; there is no fallback to an older batch
 *  - metrics with unverified periods are grouped separately and never summed or ranked
 *  - metrics from different windows are never compared
 *  - missing metrics stay null with a reason
 *  - nothing is created: no tasks, no workflow calls
 */

const SCHEMA='ceo-unapproved-shadow-analysis/v1';

const PERIOD_GROUPS={
 PLATFORM_FIELD_NAME:'平台字段名自带窗口',
 PLATFORM_META_WINDOW:'平台 meta 声明的默认窗口',
 POINT_IN_TIME_SNAPSHOT:'采集时点快照（无窗口）',
 UNVERIFIED_PERIOD:'窗口未证实',
 COLLECTOR_DEFAULT:'采集器默认标签，未获平台佐证'
};

const groupOf=m=>PERIOD_GROUPS[m.periodStatus]??'未知';

export function buildUnapprovedShadow({batch,question,now=new Date()}={}){
 if(!batch||typeof batch!=='object')throw Object.assign(new Error('INVALID_BATCH'),{code:'INVALID_BATCH'});
 if(!(now instanceof Date)||!Number.isFinite(+now))throw Object.assign(new Error('INVALID_CLOCK'),{code:'INVALID_CLOCK'});

 const usable=(batch.metrics??[]).filter(m=>m.availability==='AVAILABLE'&&!m.suspects?.length);

 if(batch.status==='FAILED'||usable.length===0){
  return Object.freeze({
   schema:SCHEMA,status:'FAILED',question:question??null,
   batchId:batch.batchId,collectedAt:batch.collectedAt,
   reason:'本批次未取得任何可用指标；按规则不回退到旧批次',
   metrics:[],periodGroups:{},unavailable:[],anomalies:[],priorities:[],
   noTasks:true,noWorkflow:true,gateStatus:'NOT_ELIGIBLE',
   note:'采集失败不等于数据为零，也不等于上次的结果。'
  });
 }

 const byPeriod={};
 for(const m of usable){
  const g=groupOf(m);
  byPeriod[g]=byPeriod[g]??[];
  byPeriod[g].push({caliber:m.caliber,window:m.effectiveWindow,value:m.value,unit:m.unit,platformWindow:m.platformWindow??null,sourceField:m.sourceField??null});
 }

 const unavailable=(batch.metrics??[]).filter(m=>m.availability!=='AVAILABLE')
  .map(m=>({caliber:m.caliber,window:m.window,reason:m.unavailableReason}));

 const get=(caliber,win)=>usable.find(m=>m.caliber===caliber&&(win===undefined||m.effectiveWindow===win))?.value??null;

 const qtyToday=get('sales.qty.total','today');
 const qty30d=get('sales.qty.total','30d');
 const gmv=get('sales.amount.gmv');
 const pv=get('traffic.pv');
 const uv=get('traffic.uv');
 const transit=get('inventory.transit');
 const actual=get('inventory.actual');
 const platformItems=get('catalog.platformItems');
 const activeSkus=get('lifecycle.activeSkus');

 const anomalies=[];
 const sameWindow=(a,b)=>{const x=usable.find(m=>m.caliber===a),y=usable.find(m=>m.caliber===b);return x&&y&&x.periodStatus===y.periodStatus&&x.effectiveWindow&&x.effectiveWindow===y.effectiveWindow;};
 if(sameWindow('inventory.transit','inventory.actual')&&Number.isFinite(transit)&&Number.isFinite(actual)&&actual>0&&transit>actual){
  anomalies.push({id:'TRANSIT_GT_STOCK',detail:`在途 ${transit} 件 > 现货 ${actual} 件`,implication:'仅本页库存样本；到仓延期是待核实假设，不能推出全店断货结论'});
 }
 if(sameWindow('traffic.pv','traffic.uv')&&Number.isFinite(pv)&&Number.isFinite(uv)&&pv<uv)anomalies.push({id:'PV_LT_UV',detail:`PV ${pv} < UV ${uv}`,implication:'口径异常，需复查'});

 const priorities=[];
 if(Number.isFinite(gmv)){
  priorities.push({title:'先澄清金额指标窗口，再谈任何金额结论',kind:'INVESTIGATE',
   evidence:`本批次 ${batch.batchId} 的 sales.amount.gmv=${gmv}；统计区间尚无平台证据，保持 UNVERIFIED_PERIOD`,
   acceptance:'平台侧确认 sumPaymentAmount 统计区间；或改用带明确窗口的金额字段'});
 }
 if(unavailable.length){
  priorities.push({title:`补齐本次缺失的 ${unavailable.length} 项指标后再做趋势判断`,kind:'INVESTIGATE',
   evidence:`缺失: ${[...new Set(unavailable.map(u=>u.caliber))].join(', ')}`,
   acceptance:'连续三次采集均无缺失，或确认这些字段本身不可得'});
 }
 if(sameWindow('inventory.transit','inventory.actual')&&Number.isFinite(transit)&&Number.isFinite(actual)&&transit>actual){
  priorities.push({title:'核实在途批次到仓时间，锁定断货风险',kind:'INVESTIGATE',
   evidence:`本批次 ${batch.batchId} 的本页样本在途 ${transit} > 现货 ${actual}；不代表全店`,
   acceptance:'给出在途到仓计划与逾期批次清单'});
 }

 return Object.freeze({
  schema:SCHEMA,status:'UNAPPROVED',question:question??null,
  generatedAt:now.toISOString(),
  batchId:batch.batchId,collectedAt:batch.collectedAt,
  sourceEvidence:{
   sourceSystem:batch.sourceSystem,sourceAccount:batch.sourceAccount,
   storeIdentity:batch.storeIdentity,sourceEndpointOrPage:batch.sourceEndpointOrPage,
   sourceHash:batch.sourceHash,collectorVersion:batch.collectorVersion??null,
   accessMode:batch.accessMode
  },
  periodGroups:byPeriod,unavailable,anomalies,priorities:priorities.slice(0,3).map(p=>({...p,evidenceRefs:[{batchId:batch.batchId,sourceHash:batch.sourceHash}]})),
  factsUsable:usable.length,factsTotal:(batch.metrics??[]).length,
  noTasks:true,noWorkflow:true,gateStatus:'NOT_ELIGIBLE',
  gateReason:'来源策略与店铺映射仍未核准，任何事实都不能标为 VERIFIED；本产物仅为 UNAPPROVED 只读影子分析',
  note:'窗口不同的指标已分组隔离，不做跨组比较、不做求和。'
 });
}
