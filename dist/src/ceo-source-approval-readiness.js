/** Preparation only: this module grants no authority and writes no reviewer registry. */
import {contentHash,freeze,fail} from './ceo-vnext-common.js';
export function buildCeoOperationalApprovalRequest(conversation){
 if(conversation?.schema!=='ceo-workbuddy-operational-entry/v1'||!['REAL_READ_ONLY','SYNTHETIC'].includes(conversation.sourceMode))fail('INVALID_APPROVAL_PREPARATION');
 const body={schema:'ceo-operational-source-approval-request/v1',status:'DRAFT',sourceMode:conversation.sourceMode,
  humanReviewer:null,approvalRef:null,registerReviewer:false,
  authorityRecord:{status:'UNVERIFIED',envId:conversation.storeObservation.envId,envName:conversation.storeObservation.envName,channelId:conversation.storeObservation.channelId,platformShopId:null,ownerDesignation:null,approvedAt:null},
  evidence:{reportId:conversation.reportId,batchId:conversation.batchId,reportHash:conversation.sourceReportHash,sourceHash:conversation.evidence.sourceHash,collectorHash:conversation.evidence.collectorHash},
  versionBindings:structuredClone(conversation.versionBindings??null),entryRuntime:structuredClone(conversation.entryRuntime??null),observedStatuses:structuredClone(conversation.statuses),
  periodAuthority:{paymentQuantityWindows:['today','7d','30d'],paymentQuantityBasis:'PLATFORM_FIELD_NAME_ONLY',amountPeriod:'UNVERIFIED_PERIOD',domMetricPeriod:'UNVERIFIED',timezoneLabel:conversation.storeObservation.timezone?.label??null,timezoneOffset:null,inventoryScope:'PAGE_1_SAMPLE_ONLY'},
  storageAuthority:{status:'UNVERIFIED',taskboardDesignation:null,logExclusiveWriter:null,authenticatedAdoptionInterface:null},
  humanDecisions:[
   {id:'STORE_AUTHORITY',required:'由经营所有者指定env/channel与权威平台shopId的对应记录，绑定证据哈希'},
   {id:'SOURCE_POLICY',required:'核准首域、来源、字段、期间、时区、单位、覆盖/新鲜度规则及数据核准人'},
   {id:'REVIEWER_AUTHORITY',required:'由Human通过正式独立治理登记或指定核准人；本请求不代为登记'},
   {id:'METRIC_SCOPE',required:'明确可批准的数量/样本指标；金额与未知DOM期间继续排除，除非补齐权威证据'},
   {id:'STORAGE_OWNER',required:'指定现有存储所有者及认证接收接口，批准后接线；不得新建第二套生产库'},
   {id:'DEPLOYMENT',required:'单独审批入口版本、身份接入、部署范围和回滚；数据核准不等于部署批准'}
  ],
  deploymentApproval:'NOT_APPROVED',businessWriteAuthority:[],automaticScheduling:false,formalContextStatus:'NOT_ELIGIBLE'
 };
 return freeze({...body,requestId:'source-approval-'+contentHash(body)});
}
