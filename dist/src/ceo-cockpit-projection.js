import {contentHash,freeze,fail,exact,safeText,timestamp} from './ceo-vnext-common.js';

/**
 * Read-only projections for the two downstream surfaces (G2-B1, item G):
 *   - the 一跨 OS "今日驾驶舱" (today cockpit) view,
 *   - the WorkBuddy conversation entry.
 *
 * Both are pure functions over an already archived report plus its verification
 * checklist. They create nothing: no tasks, no workflow calls, no writes. A caller that
 * only has a projection cannot reconstruct authority, which is the point — WorkBuddy and
 * the cockpit are display surfaces, not write paths.
 */

const VALUE_CALIBERS={'orders.payment.count':{unit:'单',label:'支付订单数'},'orders.payment.units':{unit:'件',label:'支付件数'},'orders.payment.gross':{unit:'CNY',label:'支付原始金额（非净收入）'}};

export function projectCeoCockpit({verification,report,context,now=new Date()}={}){
 if(!(now instanceof Date)||!Number.isFinite(+now))fail('INVALID_COCKPIT_INPUT');
 if(!verification||typeof verification!=='object'||!Array.isArray(verification.checks)||typeof verification.status!=='string'||!safeText(verification.receipt??''))fail('INVALID_COCKPIT_INPUT');
 if(!report||typeof report!=='object'||!safeText(report.analysisId??'')||!Array.isArray(report.priorities)||!Array.isArray(report.claims)||!Array.isArray(report.dataGaps))fail('INVALID_COCKPIT_INPUT');
 if(!context||typeof context!=='object'||!Array.isArray(context.facts)||report.contextId!==context.contextId)fail('INVALID_COCKPIT_INPUT');
 if(!timestamp(report.createdAt))fail('INVALID_COCKPIT_INPUT');
 const verified=verification.status==='VERIFIED';
 const blocked=!verified;
 const facts=context.facts.map(f=>({
  factId:f.factId,
  caliber:f.caliber,
  label:VALUE_CALIBERS[f.caliber]?.label??f.caliber,
  value:blocked?null:f.value,
  unit:VALUE_CALIBERS[f.caliber]?.unit??f.unit,
  quality:blocked?'UNVERIFIED':f.quality,
  reasons:blocked?['VERIFICATION_NOT_VERIFIED']:[...f.reasons]
 }));
 const priorities=report.priorities.map(p=>({title:p.title,kind:p.kind,factIds:[...(p.factIds??[])],rationale:p.rationale??null,acceptance:p.acceptance??null}));
 const body={
  schema:'ceo-cockpit-projection/v1',
  status:blocked?'BLOCKED':'READY',
  storeAlias:verification.storeAlias??null,
  storeId:context.storeId,
  period:structuredClone(context.period),
  verification:{status:verification.status,receipt:verification.receipt,failed:(verification.failed??[]).map(f=>f.code??f.checkId),notEvaluated:[...(verification.notEvaluated??[])]},
  report:{reportId:report.reportId??null,analysisId:report.analysisId,contextId:report.contextId,createdAt:report.createdAt,revision:report.revision??null,correctsReportId:report.correctsReportId??null},
  facts,
  gaps:[...new Set(context.dataGaps.map(g=>g.gapId).filter(Boolean))].sort(),
  unverifiedFacts:context.facts.filter(f=>f.quality!=='VERIFIED').map(f=>({factId:f.factId,quality:f.quality,reasons:[...f.reasons]})),
  priorities,
  claimsSummary:Object.fromEntries(['SUPPORTED','CANNOT_DETERMINE','NOT_A_FACT'].map(s=>[s,report.claims.filter(c=>c.status===s).length])),
  actions:[],
  readOnly:true,
  formalTaskWrites:0,
  workflowExecutions:0,
  generatedAt:now.toISOString()
 };
 return freeze({...body,cockpitId:'cockpit-'+contentHash(body)});
}

/** WorkBuddy is allowed to ask and to read. It cannot carry authority into the CEO runtime. */
export function projectCeoWorkBuddyEntry({cockpit,report,now=new Date()}={}){
 if(!(now instanceof Date)||!Number.isFinite(+now))fail('INVALID_COCKPIT_INPUT');
 if(!cockpit||cockpit.schema!=='ceo-cockpit-projection/v1'||!safeText(cockpit.cockpitId??''))fail('INVALID_COCKPIT_INPUT');
 if(!report||!safeText(report.analysisId??''))fail('INVALID_COCKPIT_INPUT');
 const body={
  schema:'ceo-workbuddy-entry/v1',
  cockpitId:cockpit.cockpitId,
  reportId:report.reportId??null,
  analysisId:report.analysisId,
  status:cockpit.status,
  allowedIntents:['ASK_OPERATING_QUESTION','VIEW_COCKPIT'],
  questionTemplate:'分析纳物一店最近的经营情况，告诉我应该优先处理什么。',
  cannotSupply:['principal','dataApproval','context','versions','databasePath','executor','reportId'],
  authority:'NONE',
  productionWiringEnabled:false,
  writePath:null,
  readPath:{cockpit:'ceo-cockpit-projection/v1',report:'ceo-full-report-archive/v1'},
  generatedAt:now.toISOString()
 };
 return freeze({...body,entryId:'wb-entry-'+contentHash(body)});
}

/** Contract gate for the projection layer itself: no actions, no writes, no wiring. */
export function assertReadOnlyProjection(projection){
 if(!projection||typeof projection!=='object')fail('INVALID_PROJECTION');
 if(projection.productionWiringEnabled===true)fail('PRODUCTION_WIRING_FORBIDDEN');
 if(projection.authority!==undefined&&projection.authority!=='NONE')fail('PROJECTION_NOT_READ_ONLY');
 if(projection.schema==='ceo-workbuddy-entry/v1'){
  if(projection.writePath!==null)fail('PROJECTION_NOT_READ_ONLY');
  return projection;
 }
 if(projection.readOnly!==true||projection.formalTaskWrites!==0||projection.workflowExecutions!==0)fail('PROJECTION_NOT_READ_ONLY');
 if(Array.isArray(projection.actions)&&projection.actions.length)fail('PROJECTION_NOT_READ_ONLY');
 return projection;
}

/** G2-B4 observation projection; deliberately distinct from the formally gated cockpit schema. */
export function projectCeoOperationalConversation({report,question,requestId,conversationRef,sourceMode}={}){
 if(!report||report.schema!=='ceo-operational-report/v1'||!['REAL_READ_ONLY','SYNTHETIC'].includes(sourceMode)||report.verificationStatus!=='UNAPPROVED'||report.formalContextStatus!=='NOT_ELIGIBLE')fail('INVALID_OPERATIONAL_PROJECTION');
 const failed=report.status==='FAILED',session=report.batch?.session,metrics=report.validation?.metrics??[];
 const facts=failed?[]:structuredClone(report.facts??[]),priorities=failed?[]:structuredClone(report.priorities??[]).slice(0,3);
 if(priorities.some(p=>typeof p.acceptance!=='string'||!p.acceptance||!p.evidence))fail('INVALID_OPERATIONAL_PROJECTION');
 const connected=session?.browserIdentity?.status==='MATCHED'&&session.browserIdentity.observedPid===session.openEnv?.pid&&session.cacheDisabled===true;
 const complete=!failed&&metrics.length===17&&facts.length===17;
 const gaps=structuredClone(report.validation?.warnings??[]);
 const body={
  schema:'ceo-workbuddy-operational-entry/v1',sourceMode,synthetic:sourceMode==='SYNTHETIC',
  requestId,conversationRef,question,canonicalAnalysisQuestion:report.question,
  reportId:report.reportId,batchId:report.batch?.batchId??null,status:failed?'FAILED':'UNAPPROVED',
  requestedAt:report.requestedAt,completedAt:report.completedAt,
  statuses:{
   backendConnection:{status:connected?'CONNECTED':'FAILED',browserProcessMatched:connected},
   collection:{status:failed?'FAILED':complete?'COMPLETE':'PARTIAL',available:facts.length,expected:17},
   metricTrust:{status:failed?'UNVERIFIED':gaps.length?'CHECKED_WITH_GAPS':'CHECKED',amountPeriod:'UNVERIFIED_PERIOD',allFactsFormallyVerified:false},
   storeIdentityApproval:{status:'UNVERIFIED',platformShopId:null},
   humanApproval:{status:'UNAPPROVED',approvalRef:null}
  },
  storeObservation:{envId:'400370',envName:report.identity?.storeIdentity?.name??null,channelId:session?.channelId??null,browserIdentity:structuredClone(session?.browserIdentity??null),timezone:structuredClone(report.validation?.timezone??null)},
  facts,hypotheses:failed?[]:structuredClone(report.hypotheses??[]),priorities,gaps,
  evidence:{sourceHash:report.batch?.sourceHash??null,collectorHash:report.batch?.collectorHash??null,reportId:report.reportId,batchId:report.batch?.batchId??null},
  versionBindings:structuredClone(report.bindings??null),
  formalContextStatus:'NOT_ELIGIBLE',authority:'NONE',productionWiringEnabled:false,
  actions:[],formalTaskWrites:0,workflowExecutions:0,productionDataWrites:0,productionLogWrites:0,
  note:'后台观察、业务口径与正式核准分开；请求三个问题不代表必须凑足三条建议。'
 };
 return freeze({...body,entryId:'wb-operational-'+contentHash(body)});
}
