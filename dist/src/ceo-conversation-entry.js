/** Host adapter from the existing conversation surface to the G2-B3 read-only collector. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {requireG1FixtureRoot,requireG1FixturePath} from './ceo-main-boundary.js';
import {contentHash,exact,fail} from './ceo-vnext-common.js';
import {CEO_OPERATIONAL_QUESTION,runOperationalQuery,validateOperationalBatch} from './ceo-operational-entry.js';
import {buildCeoOperationalApprovalRequest} from './ceo-source-approval-readiness.js';
import {projectCeoOperationalConversation} from './ceo-cockpit-projection.js';
export const CEO_CONVERSATION_QUESTION='CEO，检查纳物一店最新经营情况，告诉我今天最需要处理的三个问题。';
const outputRoot=fileURLToPath(new URL('../../output/ceo-g2b3/',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(x);

export async function readCeoConversationDependencies(){
 const installedEntry=fileURLToPath(import.meta.resolve('playwright-core'));
 const paths={mainClient:'F:/yikuaborder-deploy/nawu-fetch/lib/wenmai-api.cjs',metricsStore:'F:/yikuaborder-deploy/scripts/metrics-store.mjs',playwrightEntry:installedEntry,playwrightPackage:path.join(path.dirname(installedEntry),'package.json')};
 const result={};
 for(const [id,file]of Object.entries(paths)){const bytes=await readFile(file);result[id]={path:file,sha256:sha(bytes),...(id==='playwrightPackage'?{version:JSON.parse(bytes).version}:{})};}
 return result;
}
export function bindCeoConversationVersion({fingerprint,releaseId,externalDependencies={}}){
 const body={fingerprint,releaseId,nodeVersion:process.version,externalDependencies:structuredClone(externalDependencies),dependencyIntegrityScope:'EXACT_PROJECT_FILES_AND_EXTERNAL_ENTRY_METADATA; clean dependency install remains unverified'};
 return Object.freeze({...body,integrationFingerprint:contentHash(body)});
}

export function createCeoOperationalConversation({fixtureRoot,governance,analysisPrincipal,sourceMode='REAL_READ_ONLY',sourceRunner,runtimeBinding=null}={}){
 const root=requireG1FixtureRoot({fixtureRoot,dataRoot:fixtureRoot});
 if(!['REAL_READ_ONLY','SYNTHETIC'].includes(sourceMode)||!governance)fail('INVALID_CONVERSATION_HOST');
 governance.authorize({principal:analysisPrincipal,operation:'analyze',storeId:'400370'});
 if(sourceMode==='REAL_READ_ONLY'&&sourceRunner!==undefined)fail('SOURCE_OVERRIDE_FORBIDDEN');
 if(sourceMode==='SYNTHETIC'&&typeof sourceRunner!=='function')fail('SYNTHETIC_SOURCE_REQUIRED');
 const run=sourceMode==='REAL_READ_ONLY'?runOperationalQuery:sourceRunner,seen=new Map(),usedBatches=new Set();
 async function ask({principal,input,signal}={}){
  governance.authorize({principal,operation:'read',storeId:'400370'});
  if(!['human','shadow'].includes(principal.profile))fail('FORBIDDEN');
  if(principal.profile==='shadow')governance.authorize({principal,operation:'analyze',storeId:'400370'});
  if(!exact(input,['requestId','conversationRef','question'])||!identifier(input.requestId)||!identifier(input.conversationRef)||input.question!==CEO_CONVERSATION_QUESTION)fail('INVALID_CONVERSATION_REQUEST');
  const op=principal.id+':'+input.requestId,signature=contentHash(input),old=seen.get(op);
  if(old)fail(old===signature?'REPLAY_REJECTED':'OPERATION_CONFLICT');
  if(seen.size>=1000)fail('OPERATION_LIMIT');seen.set(op,signature);
  governance.authorize({principal:analysisPrincipal,operation:'analyze',storeId:'400370'});
  if(sourceMode==='REAL_READ_ONLY'&&runtimeBinding?.externalDependencies&&contentHash(await readCeoConversationDependencies())!==contentHash(runtimeBinding.externalDependencies))fail('DEPENDENCY_CHANGED');
  const startedAt=new Date().toISOString();
  if(signal?.aborted)fail('COLLECTION_ABORTED');
  const result=await run({question:CEO_OPERATIONAL_QUESTION,signal});
  if(sourceMode==='REAL_READ_ONLY'&&runtimeBinding?.externalDependencies&&contentHash(await readCeoConversationDependencies())!==contentHash(runtimeBinding.externalDependencies))fail('DEPENDENCY_CHANGED');
  const report=result?.report;
  if(!report||report.schema!=='ceo-operational-report/v1'||!/^ceo-op-[a-f0-9-]{36}$/.test(report.reportId??'')||!['UNAPPROVED','FAILED'].includes(report.status))fail('INVALID_CONVERSATION_RESULT');
  if(!Number.isFinite(Date.parse(report.requestedAt))||Date.parse(report.requestedAt)<Date.parse(startedAt)||Date.parse(report.completedAt)>Date.now())fail('STALE_CONVERSATION_RESULT');
  if(report.batch?.batchId&&usedBatches.has(report.batch.batchId))fail('STALE_CONVERSATION_RESULT');
  let directory;
  if(sourceMode==='SYNTHETIC')directory=requireG1FixturePath(result.reportDirectory,root);
  else{
   directory=await realpath(result.reportDirectory);
   const relative=path.relative(await realpath(outputRoot),directory);
   if(relative.startsWith('..')||path.isAbsolute(relative)||relative!==report.reportId||path.resolve(result.reportDirectory)!==directory)fail('UNTRUSTED_REPORT_DIRECTORY');
  }
  let receipt,bytes;
  try{bytes=await readFile(path.join(directory,'report.json'));receipt=JSON.parse(await readFile(path.join(directory,'receipt.json'),'utf8'));}catch{fail('REPORT_ARCHIVE_UNAVAILABLE');}
  if(receipt.reportHash!==sha(bytes)||receipt.reportId!==report.reportId||contentHash(JSON.parse(bytes))!==contentHash(report))fail('REPORT_ARCHIVE_MISMATCH');
  if(report.batch?.batchId)usedBatches.add(report.batch.batchId);
  if(Object.values(report.effects??{}).some(v=>typeof v==='number'&&v!==0))fail('BUSINESS_WRITE_FORBIDDEN');
  if(report.status!=='FAILED'){
   const verified=validateOperationalBatch({identity:report.identity,batch:report.batch,requestStartedAt:startedAt});
   if(verified.status!=='PASS'||report.validation?.status!=='PASS')fail('BATCH_VALIDATION_REJECTED');
  }
  const projection=projectCeoOperationalConversation({report,...input,sourceMode});
  const linked={...projection,entryRuntime:structuredClone(runtimeBinding),sourceReportHash:receipt.reportHash,requestActorId:principal.id,analysisActorId:analysisPrincipal.id,requestOrigin:'CALLER_DECLARED_CONVERSATION_REF',readOnly:true};
  const body=JSON.stringify(linked,null,2)+'\n';
  try{
   await writeFile(path.join(directory,'conversation-entry.json'),body,{flag:'wx'});
   await writeFile(path.join(directory,'source-approval-request.json'),JSON.stringify(buildCeoOperationalApprovalRequest(linked),null,2)+'\n',{flag:'wx'});
   await writeFile(path.join(directory,'conversation-receipt.json'),JSON.stringify({entryId:projection.entryId,reportId:report.reportId,batchId:report.batch?.batchId??null,sourceReportHash:receipt.reportHash,conversationHash:sha(body)},null,2)+'\n',{flag:'wx'});
  }catch{fail('CONVERSATION_ARCHIVE_FAILED');}
  return Object.freeze({...linked,archiveDirectory:directory});
 }
 return Object.freeze({ask,sourceMode});
}
