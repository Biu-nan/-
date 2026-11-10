import http from 'node:http';
import express from 'express';
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRuntimeManifest} from './ceo-runtime-manifest.js';
import {acquireRuntimeLease,runtimeHealth,stopOwnedRuntime} from './ceo-runtime-host.js';
import {createCeoOperationalConversation,readCeoConversationDependencies,bindCeoConversationVersion} from './ceo-conversation-entry.js';
import {createCeoGovernance,createCeoGateway} from './ceo-governance.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
/** Isolated Runtime. G1 routes by default; G2-B4 can explicitly add read-only collection through fixture identities. */
export async function startIsolatedCeoRuntime({codeRoot,dataRoot,files,releaseId,credentials,queries={},feedback=null,bindingConfirmed=false,port=0,dependencies=[],operationalConversation=null}={}){
 const root=await realpath(dataRoot);let marker;
 try{marker=JSON.parse(await readFile(path.join(root,'.ceo-isolated-fixture.json'),'utf8'));}catch{fail('ISOLATED_FIXTURE_REQUIRED');}
 if(marker.synthetic!==true||!Number.isSafeInteger(port)||port<0||port>65535||[3000,3173,8765,9223,9224].includes(port))fail('ISOLATED_FIXTURE_REQUIRED');
 const manifest=await createRuntimeManifest({codeRoot,dataRoot:root,files,releaseId,mode:'SHADOW',storeId:'400370'});
 const governance=createCeoGovernance({credentials});
 let conversation=null;
 if(operationalConversation!==null){
  if(port!==0||!operationalConversation||typeof operationalConversation!=='object'||Object.keys(operationalConversation).some(k=>!['sourceMode','sourceRunner'].includes(k))||Object.values(credentials).some(c=>!c.id.startsWith('fixture-')))fail('ISOLATED_CONVERSATION_REQUIRED');
  conversation=createCeoOperationalConversation({fixtureRoot:root,governance,runtimeBinding:bindCeoConversationVersion({fingerprint:manifest.fingerprint,releaseId:manifest.releaseId,externalDependencies:operationalConversation.sourceMode==='SYNTHETIC'?{}:await readCeoConversationDependencies()}),analysisPrincipal:governance.authenticateToken(credentials.shadow?.token),...operationalConversation});
 }
 const identity=Object.freeze({pid:process.pid,entryPath:fileURLToPath(import.meta.url),instanceId:randomUUID(),releaseId,startedAt:new Date().toISOString()});
 const leasePath=path.join(root,'ceo-runtime.lease.json'),lease=await acquireRuntimeLease({leasePath,identity}),app=express();
 app.disable('x-powered-by');app.use(express.json({limit:65536}));
 app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
 const health=()=>runtimeHealth({manifest,identity,dependencies,bindingConfirmed});
 app.get('/healthz',async(_req,res)=>{try{const result=await health();res.status(result.ready?200:503).json(result);}catch{res.status(503).json({ready:false,error:'HEALTH_UNAVAILABLE'});}});
 app.get('/api/version',async(_req,res)=>res.json(await health()));
 app.use(createCeoGateway({governance,resolveOperation:(req,pathname)=>conversation&&req.method==='POST'&&pathname==='/api/ceo/conversation'?'read':null}));
 if(conversation)app.post('/api/ceo/conversation',async(req,res)=>{
  try{
   const host=req.headers.host,port=req.socket.localPort;
   if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||(req.headers.origin&&req.headers.origin!==`http://${host}`))fail('FORBIDDEN');
   const cancellation=new AbortController();const onClosed=()=>{if(!res.writableEnded)cancellation.abort();};res.once('close',onClosed);
   let result;try{result=await conversation.ask({principal:req.ceoPrincipal,input:req.body,signal:cancellation.signal});}finally{res.removeListener('close',onClosed);}
   res.status(result.status==='FAILED'?502:200).json(result);
  }catch(e){const code=typeof e.code==='string'&&/^[A-Z_0-9]+$/.test(e.code)?e.code:'CONVERSATION_UNAVAILABLE';res.status(code==='UNAUTHORIZED'?401:code==='FORBIDDEN'?403:/REPLAY|CONFLICT|COOLDOWN|BUSY|LIMIT/.test(code)?409:/^INVALID/.test(code)?400:503).json({error:code,formalContextStatus:'NOT_ELIGIBLE'});}
 });
 app.get('/api/ceo/me',(req,res)=>res.json({actor:req.ceoPrincipal,mode:'SHADOW',externalExecution:false}));
 for(const [route,key]of [['/api/ceo/context','context'],['/api/ceo/tasks','tasks'],['/api/ceo/plans','plans'],['/api/system/state','state']])app.get(route,async(_req,res)=>{
  if(typeof queries[key]!=='function'){res.status(503).json({error:'READ_MODEL_UNCONFIGURED'});return;}
  try{res.json(await queries[key]());}catch{res.status(503).json({error:'READ_MODEL_UNAVAILABLE'});}
 });
 app.post('/api/ceo-shadow/feedback',async(req,res)=>{
  if(typeof feedback!=='function'){res.status(503).json({error:'FEEDBACK_UNCONFIGURED'});return;}
  try{res.json(await feedback({actor:req.ceoPrincipal,payload:structuredClone(req.body)}));}catch{res.status(503).json({error:'FEEDBACK_UNAVAILABLE'});}
 });
 app.use((_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
 app.use((_error,_req,res,_next)=>res.status(400).json({error:'INVALID_INPUT'}));
 const server=http.createServer(app);server.requestTimeout=10000;server.headersTimeout=10000;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){await lease.release();throw e;}
 let stopped=false;
 async function stop(){
  if(stopped)return;
  await stopOwnedRuntime({leasePath,identity,readProcessIdentity:async pid=>pid===process.pid?identity:null,probeIdentity:async()=>identity,requestStop:async()=>{
   await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  }});
  stopped=true;await lease.release();
 }
 return Object.freeze({identity,manifest,baseUrl:'http://127.0.0.1:'+server.address().port,stop});
}
