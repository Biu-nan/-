/** Bounded WorkBuddy stdio tool surface. No HTTP listener, credentials, or authority in tool arguments. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,realpath,lstat} from 'node:fs/promises';
import readline from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {authenticateWorkBuddyHost,readWorkBuddyCallContext,readWorkBuddyNativeContext} from './ceo-workbuddy-host.js';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const DEFAULT_STATE=path.join(ROOT,'output','ceo-g2b41');
const QUESTION='CEO，检查纳物一店最新经营情况，告诉我今天最需要处理的三个问题。';
const CANONICAL='分析纳物一店最近的经营情况，告诉我应该优先处理什么。';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const errorResult=code=>({isError:true,content:[{type:'text',text:'CEO 只读请求未完成：'+code+'。没有回退旧报告。'}],structuredContent:{schema:'ceo-workbuddy-adapter-result/v1',status:'FAILED',error:code,reportId:null,batchId:null,formalContextStatus:'NOT_ELIGIBLE',formalTaskWrites:0,workflowExecutions:0,productionDataWrites:0,productionLogWrites:0,statuses:{backendConnection:{status:'NOT_EVALUATED'},collection:{status:'NOT_EVALUATED'},metricTrust:{status:'UNVERIFIED',amountPeriod:'UNVERIFIED_PERIOD'},storeIdentityApproval:{status:'UNVERIFIED'},humanApproval:{status:'UNAPPROVED'}}}});
export const WORKBUDDY_TOOLS=[{name:'ceo_operational_analyze',description:'CEO：查询纳物一店真实后台并生成新批次的只读经营影子报告。适用于“'+QUESTION+'”。不创建任务、不执行Workflow。身份与会话由宿主提供，参数只能传经营问句。金额期间未知时明确标注；缺失不补零；最多三项建议。',inputSchema:{type:'object',properties:{question:{type:'string',minLength:1,maxLength:500}},required:['question'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:false,openWorldHint:false}},{name:'ceo_capabilities',description:'查看 CEO 候选适配器的只读能力及禁用扩展，不访问经营后台。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}];
function presentation(r){
 const out=['CEO 经营影子报告（'+r.status+'）','执行：只读；正式 Context：NOT_ELIGIBLE','来源：纳物一店 AliExpress 全托管后台 / 稳卖 env400370','新采集批次：'+r.batchId,'报告：'+r.reportId,'会话标识完整性：'+(r.adapter?.hostContext?.contextIntegrityStatus??'HOST_METADATA_NOT_FORMALLY_APPROVED'),'五项核验：'+Object.entries(r.statuses).map(([k,v])=>k+'='+v.status).join('；')];
 const observations=(r.facts??[]).filter(f=>f.caliber==='sales.qty.total').map(f=>`${f.caliber}@${f.effectiveWindow}: ${f.value} ${f.unit}（后台观察，未正式核准）`);out.push(...observations);
 for(const [i,p]of(r.priorities??[]).slice(0,3).entries())out.push(`${i+1}. ${p.title}\n依据：${p.evidence}\n验收：${p.acceptance}`);
 out.push('待人工确认：权威店铺映射、来源与口径/时区核准；金额 UNVERIFIED_PERIOD；数据缺口 '+(r.gaps??[]).join('；'),'证据：'+(r.sourceReportHash??'')+' / '+(r.evidence?.sourceHash??''),'本地归档：'+(r.archiveDirectory??''));return out.join('\n');
}
export async function verifyWorkBuddyResultEvidence(r,{expectedRoot,conversationRef,requestId}){
 const dir=await realpath(r.archiveDirectory),expected=path.join(expectedRoot,r.reportId);
 if(dir!==expected||!/^ceo-op-[a-f0-9-]{36}$/.test(r.reportId??''))fail('EVIDENCE_INVALID');
 if(r.conversationRef!==conversationRef||r.requestId!==requestId)fail('EVIDENCE_CONTEXT_MISMATCH');
 const source=await readFile(path.join(dir,'report.json')),receipt=JSON.parse(await readFile(path.join(dir,'conversation-receipt.json'),'utf8')),linked=await readFile(path.join(dir,'conversation-entry.json'));
 const {archiveDirectory,...returned}=r;
 if(sha(source)!==r.sourceReportHash||sha(linked)!==receipt.conversationHash||!isDeepStrictEqual(JSON.parse(linked),returned)||receipt.reportId!==r.reportId||receipt.batchId!==r.batchId||receipt.sourceReportHash!==r.sourceReportHash||receipt.entryId!==r.entryId)fail('EVIDENCE_INVALID');
 if(r.formalContextStatus!=='NOT_ELIGIBLE'||r.authority!=='NONE'||r.statuses?.humanApproval?.status!=='UNAPPROVED'||[r.formalTaskWrites,r.workflowExecutions,r.productionDataWrites,r.productionLogWrites].some(x=>x!==0))fail('EVIDENCE_INVALID');
 return true;
}
export async function acceptWorkBuddyRuntimeResponse(response,binding){
 if(response.httpStatus!==200&&!(response.httpStatus===502&&response.result?.status==='FAILED'&&response.result?.archiveDirectory))fail(response.result?.error??'COLLECTION_FAILED');
 await verifyWorkBuddyResultEvidence(response.result,binding);return response.result;
}
async function realRun({context,question,signal}){
 const {startCeoConversationCandidate}=await import('./ceo-conversation-cli.js');
 const candidate=await startCeoConversationCandidate();
 try{
  const requestId='wb-'+context.hostRequestId;
  const response=await candidate.ask({question:QUESTION,conversationRef:context.conversationRef,requestId,signal});
  return await acceptWorkBuddyRuntimeResponse(response,{expectedRoot:path.join(ROOT,'output','ceo-g2b3'),conversationRef:context.conversationRef,requestId});
 }finally{await candidate.stop();}
}
export function createWorkBuddyToolSession({stateRoot=DEFAULT_STATE,sourceMode='REAL_READ_ONLY',authenticateHost=authenticateWorkBuddyHost,run,timeoutMs=285000,contextTransport='MCP_STDIO',nativeEnvironment}={}){
 if(!['MCP_STDIO','NATIVE_TOOL_ENV'].includes(contextTransport))fail('INVALID_ADAPTER_CONFIGURATION');
 if(!['REAL_READ_ONLY','SYNTHETIC'].includes(sourceMode)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)fail('INVALID_ADAPTER_CONFIGURATION');
 if(sourceMode==='REAL_READ_ONLY'&&(nativeEnvironment!==undefined||run!==undefined||authenticateHost!==authenticateWorkBuddyHost||path.resolve(stateRoot)!==path.resolve(DEFAULT_STATE)))fail('SOURCE_OVERRIDE_FORBIDDEN');
 if(sourceMode==='SYNTHETIC'&&typeof run!=='function')fail('SYNTHETIC_SOURCE_REQUIRED');
 const execute=run??realRun,pending=new Map();
 async function call(params,rpcId){
  let timer,reserved=null,controller=new AbortController();pending.set(rpcId,controller);
  try{
   const host=await authenticateHost();
   if(controller.signal.aborted)fail('REQUEST_CANCELLED');
   if(host?.status!=='HOST_PROCESS_VERIFIED')fail('WORKBUDDY_HOST_UNAUTHENTICATED');
   if(params?.name==='ceo_capabilities')return{isError:false,content:[{type:'text',text:'仅启用首店只读经营分析。专业Agent、Taskboard与Workflow均未启用。'}],structuredContent:{schema:'ceo-workbuddy-capabilities/v1',readOnly:true,extensions:{specialistAgent:'NOT_ENABLED',taskboard:'NOT_ENABLED',workflow:'NOT_ENABLED'},authority:'NONE'}};
   if(params?.name!=='ceo_operational_analyze')fail('EXTENSION_NOT_ENABLED');
   const args=params.arguments;
   if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||typeof args.question!=='string')fail('INVALID_TOOL_ARGUMENTS');
   if(/二店|2店|416488|其他店/.test(args.question))fail('CROSS_STORE_FORBIDDEN');
   if(![QUESTION,CANONICAL].includes(args.question.trim()))fail('UNSUPPORTED_QUESTION');
   const context=contextTransport==='NATIVE_TOOL_ENV'?readWorkBuddyNativeContext({host,env:nativeEnvironment??process.env}):readWorkBuddyCallContext({meta:params._meta,rpcId,host});
   const requestKey=sha(context.sessionId+'\n'+context.hostRequestId);
   for(let p=path.resolve(stateRoot);;p=path.dirname(p)){try{if((await lstat(p)).isSymbolicLink())fail('UNSAFE_ADAPTER_STATE');}catch(e){if(e.code!=='ENOENT')throw e;}if(path.dirname(p)===p)break;}
   await mkdir(stateRoot,{recursive:true});
   reserved=path.join(stateRoot,requestKey);
   try{await writeFile(reserved+'.request.json',JSON.stringify({schema:'ceo-workbuddy-request/v1',context,host,question:args.question,sourceMode,receivedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});}catch(e){if(e.code==='EEXIST')fail('REPLAY_REJECTED');throw e;}
   let expired=false;
   const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Object.assign(new Error('REQUEST_TIMEOUT'),{code:'REQUEST_TIMEOUT'}));},timeoutMs);});
   const cancelled=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Object.assign(new Error('REQUEST_CANCELLED'),{code:'REQUEST_CANCELLED'})),{once:true}));
   const running=execute({context,question:args.question,signal:controller.signal});
   let result;try{result=await Promise.race([running,timeout,cancelled]);}catch(e){if(expired){let cleanupTimer;try{await Promise.race([running.catch(()=>{}),new Promise(r=>{cleanupTimer=setTimeout(r,5000);})]);}finally{clearTimeout(cleanupTimer);}fail('REQUEST_TIMEOUT');}if(controller.signal.aborted)fail('REQUEST_CANCELLED');throw e;}
   if(controller.signal.aborted)fail('REQUEST_CANCELLED');
   if(sourceMode==='REAL_READ_ONLY'&&result.sourceMode!=='REAL_READ_ONLY')fail('EVIDENCE_INVALID');
   const body={...result,adapter:{schema:'ceo-workbuddy-adapter/v1',sourceMode,synthetic:sourceMode==='SYNTHETIC',hostAuthentication:'LOCAL_SIGNED_PROCESS',hostContext:context},extensions:{specialistAgent:'NOT_ENABLED',taskboard:'NOT_ENABLED',workflow:'NOT_ENABLED'}};
   await writeFile(reserved+'.outcome.json',JSON.stringify({status:'RESULT_ARCHIVED',executionStatus:result.status,deliveryStatus:'UNCONFIRMED',result:body,completedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
   if(controller.signal.aborted)fail('REQUEST_CANCELLED');
   return{isError:result.status==='FAILED',content:[{type:'text',text:presentation(body)}],structuredContent:body};
  }catch(e){
   const code=typeof e.code==='string'&&/^[A-Z_0-9]+$/.test(e.code)?e.code:e.message==='AUTH_FAILED'?'WORKBUDDY_HOST_UNAUTHENTICATED':'ADAPTER_UNAVAILABLE';
   if(reserved)try{await writeFile(reserved+'.failure-'+randomUUID()+'.json',JSON.stringify({status:'FAILED',error:code,at:new Date().toISOString(),noFallback:true})+'\n',{flag:'wx'});}catch{}
   return errorResult(code);
  }finally{if(timer)clearTimeout(timer);pending.delete(rpcId);}
 }
 return Object.freeze({call,cancel:id=>pending.get(id)?.abort(),close:()=>{for(const c of pending.values())c.abort();}});
}
export async function dispatchWorkBuddyMessage(message,{session,authenticate=authenticateWorkBuddyHost}={}){
 const id=message?.id;
 if(message?.method==='notifications/cancelled'){session.cancel(message.params?.requestId);return null;}
 if(id===undefined)return null;
 if(message.jsonrpc!=='2.0'||!['string','number'].includes(typeof id)||typeof message.method!=='string')return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'INVALID_REQUEST'}};
 if(message.method==='initialize'){
  try{await authenticate();return {jsonrpc:'2.0',id,result:{protocolVersion:['2025-11-25','2025-06-18','2025-03-26','2024-11-05'].includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'yikua-ceo-readonly-candidate',version:'0.1.0-g2b41'},instructions:'仅首店只读影子分析，不授予正式业务或数据审批权限。'}};}catch{return {jsonrpc:'2.0',id,error:{code:-32001,message:'WORKBUDDY_HOST_UNAUTHENTICATED'}};}
 }
 if(message.method==='ping')return {jsonrpc:'2.0',id,result:{}};
 if(message.method==='tools/list'){try{await authenticate();return {jsonrpc:'2.0',id,result:{tools:WORKBUDDY_TOOLS}};}catch{return {jsonrpc:'2.0',id,error:{code:-32001,message:'WORKBUDDY_HOST_UNAUTHENTICATED'}};}}
 if(message.method==='tools/call')return {jsonrpc:'2.0',id,result:await session.call(message.params,id)};
 return {jsonrpc:'2.0',id,error:{code:-32601,message:'METHOD_NOT_FOUND'}};
}
async function serve(){
 const session=createWorkBuddyToolSession(),lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 const send=x=>{if(x&&!process.stdout.destroyed)process.stdout.write(JSON.stringify(x)+'\n');};
 process.stdout.on('error',()=>session.close());
 try{for await(const line of lines){
  if(Buffer.byteLength(line)>65536){send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'REQUEST_TOO_LARGE'}});continue;}
  let message;try{message=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'PARSE_ERROR'}});continue;}
  dispatchWorkBuddyMessage(message,{session}).then(send).catch(()=>send({jsonrpc:'2.0',id:message.id??null,error:{code:-32000,message:'ADAPTER_UNAVAILABLE'}}));
 }}finally{session.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>2){console.error('STDIO_ONLY_NO_ARGUMENTS');process.exitCode=2;}else await serve();
}
