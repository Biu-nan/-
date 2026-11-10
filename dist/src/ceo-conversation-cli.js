/** Temporary host adapter using the existing CEO Runtime; never attaches to a production listener. */
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startIsolatedCeoRuntime} from './ceo-isolated-runtime.js';
import {CEO_CONVERSATION_QUESTION} from './ceo-conversation-entry.js';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const CEO_CONVERSATION_FILES=Object.freeze({
  code:['dist/src/ceo-workbuddy-local.js','dist/src/ceo-workbuddy-host.js','dist/src/ceo-workbuddy-mcp.js','dist/src/ceo-isolated-runtime.js','dist/src/ceo-runtime-host.js','dist/src/ceo-runtime-manifest.js','dist/src/ceo-conversation-entry.js','dist/src/ceo-conversation-cli.js','dist/src/ceo-source-approval-readiness.js','dist/src/ceo-cockpit-projection.js','dist/src/ceo-operational-entry.js','dist/src/ceo-governance.js','dist/src/ceo-main-boundary.js','dist/src/ceo-wenmai-identity-source.js','dist/src/ceo-ae-metrics-source.js','dist/src/ceo-unapproved-shadow.js','dist/src/ceo-live-source-contract.js','dist/src/collectors/ae-metrics.v2.mjs','nawu-fetch/lib/wenmai-api.cjs','dist/src/ceo-vnext-common.js','package.json','package-lock.json'],
  frontend:['public/ceo-command-center.js'],contracts:['schemas/ceo-cockpit-projection.schema.json'],policy:['config/ceo-workbuddy-host.candidate.v1.json','config/ceo-capabilities.v1.json','config/ceo-knowledge.v1.json','config/metrics-schema.json','config/ceo-store-mapping.v1.json','config/ceo-paid-orders.real-policy.v1.json']});
export async function startCeoConversationCandidate(){
 const dataRoot=await mkdtemp(path.join(os.tmpdir(),'ceo-g2b4-runtime-'));
 await writeFile(path.join(dataRoot,'.ceo-isolated-fixture.json'),JSON.stringify({synthetic:true,purpose:'ISOLATED_AUTH_AND_RUNTIME_STORAGE_ONLY',businessObservationMode:'REAL_READ_ONLY'}));
 // Ephemeral fixture identities live only in memory; no real identity or credential is loaded or exported.
 const credentials=Object.fromEntries(['legacy','shadow','human'].map(profile=>[profile,{id:'fixture-g2b4-'+profile,profile,role:profile==='human'?'owner':'agent',storeId:'400370',token:randomBytes(32).toString('hex')} ]));
 const runtime=await startIsolatedCeoRuntime({codeRoot:ROOT,dataRoot,files:CEO_CONVERSATION_FILES,
  releaseId:'ceo-g2b4-isolated-candidate',credentials,operationalConversation:{sourceMode:'REAL_READ_ONLY'},bindingConfirmed:false,port:0});
 async function ask({question=CEO_CONVERSATION_QUESTION,conversationRef='isolated-cli:'+randomUUID(),requestId='chat-'+randomUUID(),signal}={}){
  const response=await fetch(runtime.baseUrl+'/api/ceo/conversation',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credentials.human.token},body:JSON.stringify({requestId,conversationRef,question}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(310000)]):AbortSignal.timeout(310000)});
  return {httpStatus:response.status,result:await response.json()};
 }
 return Object.freeze({runtime,dataRoot,ask,stop:()=>runtime.stop()});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log('CEO isolated conversation: node dist/src/ceo-conversation-cli.js "'+CEO_CONVERSATION_QUESTION+'" [conversationRef]');
 else if(args.length>2||(args[0]!==undefined&&args[0]!==CEO_CONVERSATION_QUESTION)){console.error('INVALID_CONVERSATION_REQUEST');process.exitCode=2;}
 else{
  let candidate;
  try{
   candidate=await startCeoConversationCandidate();
   const response=await candidate.ask({question:args[0]??CEO_CONVERSATION_QUESTION,...(args[1]?{conversationRef:args[1]}:{})});
   console.log(JSON.stringify({runtime:{instanceId:candidate.runtime.identity.instanceId,releaseId:candidate.runtime.identity.releaseId,fingerprint:candidate.runtime.manifest.fingerprint,isolatedEndpoint:candidate.runtime.baseUrl+'/api/ceo/conversation'},...response},null,2));
   if(response.httpStatus!==200)process.exitCode=1;
  }catch(e){console.error(typeof e.code==='string'&&/^[A-Z_0-9]+$/.test(e.code)?e.code:'CONVERSATION_UNAVAILABLE');process.exitCode=1;}
  finally{if(candidate)await candidate.stop();}
 }
}
