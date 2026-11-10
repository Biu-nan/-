import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {replanErrorCodes} from './ceo-review-replanning.js';
import {requireCeoEvidenceCheck} from './ceo-task-evidence.js';
import {requireG1FixtureRoot} from './ceo-main-boundary.js';

const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const codes=new Set(['FORBIDDEN','INVALID_OPERATION','OPERATION_CONFLICT','PLAN_NOT_FOUND','PLAN_NOT_COMMITTED','NO_ALLOCATED_TASKS','CONTEXT_CHANGED','INVALID_CONTEXT','UNSUPPORTED_CAPABILITY','TASK_VERSION_CONFLICT','TASK_IN_FLIGHT','DECISION_EXPIRED','DEADLINE_PASSED','STORAGE_FAILED','INVALID_COMMAND','TASK_NOT_FOUND','VERSION_CONFLICT','RESULT_UNKNOWN','INVALID_TRANSITION','DEPENDENCY_BLOCKED','INVALID_APPROVAL','APPROVAL_EXPIRED','INVALID_RECEIPT','INVALID_EVIDENCE','SELF_VERIFICATION','INVALID_VERIFICATION','INVALID_BLOCKER','INVALID_RESOLUTION','INVALID_TIME','INVALID_INPUT','BODY_TOO_LARGE','UNAUTHORIZED']);
for(const code of ['REVIEW_SOURCE_UNAVAILABLE','REVIEW_SOURCE_CHANGED','INVALID_REVIEW_DATE'])codes.add(code);
for(const code of replanErrorCodes)codes.add(code);
const evidenceCodes=['EVIDENCE_CHECK_UNAVAILABLE','EVIDENCE_CHECK_REQUIRED','EVIDENCE_CHECK_FAILED','EVIDENCE_CHECK_STALE'];
for(const code of evidenceCodes)codes.add(code);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const tokenOK=v=>typeof v==='string'&&v.length>=32&&v.length<=256;
const draftCodes=new Set(['INVALID_DECISION','GOAL_VERSION_CONFLICT','DECISION_VERSION_CONFLICT','DECISION_CONTEXT_CONFLICT','PLAN_VERSION_CONFLICT','DRAFT_REQUEST_NOT_FOUND']);
const equals=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function body(req){return new Promise((resolve,reject)=>{
 if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')){req.resume();reject(Object.assign(new Error(),{code:'INVALID_INPUT'}));return;}
 let size=0,oversized=false;const chunks=[];
 req.on('data',c=>{size+=c.length;if(size>65536){oversized=true;chunks.length=0;}else if(!oversized)chunks.push(c);});
 req.on('error',()=>reject(Object.assign(new Error(),{code:'INVALID_INPUT'})));
 req.on('end',()=>{if(oversized){reject(Object.assign(new Error(),{code:'BODY_TOO_LARGE'}));return;}try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))fail('INVALID_INPUT');resolve(v);}catch{reject(Object.assign(new Error(),{code:'INVALID_INPUT'}));}});
});}
export function createCeoTaskServer({workspace,loadContext,loadBrief=async()=>({schema:'ceo-operating-brief/v1',status:'NOT_CONFIGURED',readOnly:true}),captureReviewInputs=null,checkEvidence=null,credentials,publicDir=fileURLToPath(new URL('../../public/',import.meta.url)),now=()=>new Date(),commandCenterOrigins=[],manualFixtureRoot=null}){
 if(!workspace||typeof loadContext!=='function')fail('INVALID_CREDENTIALS');
 for(const role of ['owner','agent']){const c=credentials?.[role];if(!c||typeof c.id!=='string'||!c.id||c.storeId!=='400370'||!tokenOK(c.token))fail('INVALID_CREDENTIALS');}
 if(credentials.owner.id===credentials.agent.id||credentials.owner.token===credentials.agent.token)fail('INVALID_CREDENTIALS');
 const manualFixture=manualFixtureRoot!==null;
 if(manualFixture)requireG1FixtureRoot({fixtureRoot:manualFixtureRoot,dataRoot:path.dirname(workspace.dbPath)});
 if(!Array.isArray(commandCenterOrigins)||commandCenterOrigins.some(o=>!['http://localhost:3000','http://127.0.0.1:3000'].includes(o)))fail('INVALID_CREDENTIALS');
 const sessions=new Map(),principals=Object.entries(credentials).map(([role,c])=>({token:c.token,actor:{id:c.id,role,storeId:c.storeId}}));
 function findToken(token){return principals.find(c=>equals(token,c.token))?.actor??null;}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
  try{
   const host=req.headers.host,port=req.socket.localPort;
   if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`)fail('FORBIDDEN');
   const origin=`http://${host}`;
   const caller=req.headers.origin;
   const allowedOrigin=caller===origin||(commandCenterOrigins.includes(caller)&&new URL(caller).hostname===new URL(origin).hostname);
   if(caller&&!allowedOrigin)fail('FORBIDDEN');
   if(caller&&caller!==origin){res.setHeader('Access-Control-Allow-Origin',caller);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');}
   const url=new URL(req.url,origin),route=url.pathname;
   if(url.search)fail('INVALID_INPUT');
   if(req.method==='OPTIONS'){
    const requestedHeaders=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    if(!allowedOrigin||!route.startsWith('/api/ceo/')||!['GET','POST','DELETE'].includes(req.headers['access-control-request-method'])||requestedHeaders.some(h=>!['authorization','content-type'].includes(h)))fail('FORBIDDEN');
    res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, DELETE','Access-Control-Allow-Headers':'content-type, authorization'});res.end();return;
   }
   const staticFiles={'/':'ceo-tasks.html','/ceo-tasks.html':'ceo-tasks.html','/ceo-tasks.js':'ceo-tasks.js','/ceo-task-layout.js':'ceo-task-layout.js','/ceo-operating-brief.js':'ceo-operating-brief.js','/ceo-daily-review.js':'ceo-daily-review.js','/ceo-replanning.js':'ceo-replanning.js','/ceo-evidence-check.js':'ceo-evidence-check.js','/ceo-tasks.css':'ceo-tasks.css'};
   if(req.method==='GET'&&staticFiles[route]){
    const file=staticFiles[route],data=await readFile(path.join(publicDir,file));
    res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});res.end(data);return;
   }
   if(route==='/api/ceo/session'&&req.method==='POST'){
    if(!allowedOrigin)fail('FORBIDDEN');const input=await body(req);
    if(!exact(input,['token']))fail('INVALID_INPUT');const actor=findToken(input.token);if(!actor)fail('UNAUTHORIZED');
    for(const [key,s] of sessions)if(s.expires<=now().getTime())sessions.delete(key);
    if(sessions.size>=100)fail('FORBIDDEN');
    const sid=randomBytes(32).toString('hex');sessions.set(sid,{actor,expires:now().getTime()+3600000});
    res.setHeader('Set-Cookie',`ceo_session=${sid}; HttpOnly; SameSite=Strict; Path=/api/ceo; Max-Age=3600`);send(200,{actor});return;
   }
   const bearer=req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):null;
   const sid=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ceo_session='))?.slice(12);
   const session=sessions.get(sid);if(session&&session.expires<=now().getTime())sessions.delete(sid);
   const actor=bearer?findToken(bearer):sessions.get(sid)?.actor;
   if(!actor)fail('UNAUTHORIZED');
    // Existing investigative writes are available only to explicitly marked synthetic regression fixtures.
    // Production binding is unconfirmed in G1; default GETs must not lazily create a task database.
    if(!manualFixture){
     if(req.method!=='GET'&&!(route==='/api/ceo/session'&&req.method==='DELETE'))fail('FORBIDDEN');
     if(!['/api/ceo/me','/api/ceo/context','/api/ceo/session'].includes(route)){send(503,{error:'READ_MODEL_UNCONFIGURED'});return;}
    }
   if(req.method!=='GET'&&!bearer&&!allowedOrigin)fail('FORBIDDEN');
   if(route==='/api/ceo/session'&&req.method==='DELETE'){sessions.delete(sid);res.setHeader('Set-Cookie','ceo_session=; HttpOnly; SameSite=Strict; Path=/api/ceo; Max-Age=0');send(200,{loggedOut:true});return;}
    if(route==='/api/ceo/me'&&req.method==='GET'){send(200,{actor,capabilities:manualFixture?['manual.investigation']:['read'],externalExecution:false});return;}
   if(route==='/api/ceo/context'&&req.method==='GET'){const c=await loadContext();send(200,{contextId:c.contextId,loadedAt:c.loadedAt,goal:c.goal,gaps:c.gaps});return;}
   if(route==='/api/ceo/operating-brief'&&req.method==='GET'){send(200,await loadBrief({context:await loadContext(),tasks:workspace.listTasks(),now:now()}));return;}
   if(route==='/api/ceo/replanning-brief'&&req.method==='GET'){
    const context=await loadContext(),brief=await loadBrief({context,tasks:workspace.listTasks(),now:now()});send(200,workspace.getReplanningBrief({context,brief}));return;
   }
   if(route==='/api/ceo/replans'&&req.method==='POST'){
    if(actor.role!=='agent')fail('FORBIDDEN');const input=await body(req);if(!exact(input,['requestId','conversationRef','expectedContextId','decision','candidates','reviewBinding']))fail('INVALID_INPUT');
    const replay=workspace.getReviewReplanReplay({...input,actor});if(replay){send(200,replay);return;}
    const guard=typeof captureReviewInputs==='function'?captureReviewInputs():()=>fail('REVIEW_SOURCE_UNAVAILABLE');
    const context=await loadContext(),brief=await loadBrief({context,tasks:workspace.listTasks(),now:now()});send(200,workspace.saveReviewReplan({...input,actor,context,brief,assertInputsCurrent:guard,now:now()}));return;
   }
   if(route==='/api/ceo/daily-reviews'&&req.method==='GET'){send(200,{reviews:workspace.listDailyReviews()});return;}
   if(route==='/api/ceo/daily-reviews'&&req.method==='POST'){
    if(actor.role!=='owner')fail('FORBIDDEN');const input=await body(req);
    if(!exact(input,['operationId','date','expectedContextId','expectedSourceId','expectedTaskVersions','note']))fail('INVALID_INPUT');
    const guard=typeof captureReviewInputs==='function'?captureReviewInputs():()=>fail('REVIEW_SOURCE_UNAVAILABLE');
    const context=await loadContext(),at=now(),brief=await loadBrief({context,tasks:workspace.listTasks(),now:at});
    send(200,workspace.saveDailyReview({...input,context,brief,actor,assertInputsCurrent:guard,now:now()}));return;
   }
   if(route==='/api/ceo/plans'&&req.method==='GET'){send(200,{plans:workspace.listPlans()});return;}
   if(route==='/api/ceo/drafts'&&req.method==='POST'){
    if(actor.role!=='agent')fail('FORBIDDEN');const input=await body(req);
    if(!exact(input,['requestId','conversationRef','expectedContextId','decision','candidates']))fail('INVALID_INPUT');
    const{requestId,conversationRef,expectedContextId,decision,candidates}=input;
    send(200,workspace.saveDraft({context:await loadContext(),decision,candidates,expectedContextId,now:now(),entryRequest:{requestId,conversationRef,actorId:actor.id}}));return;
   }
   const draftRequest=route.match(/^\/api\/ceo\/draft-requests\/([^/]+)$/);
   if(draftRequest&&req.method==='GET'){
    const receipt=workspace.getDraftRequest(decodeURIComponent(draftRequest[1]));if(!receipt)fail('DRAFT_REQUEST_NOT_FOUND');
    if(actor.role!=='owner'&&receipt.entry.actorId!==actor.id)fail('FORBIDDEN');send(200,receipt);return;
   }
   if(route==='/api/ceo/tasks'&&req.method==='GET'){send(200,{tasks:workspace.listTasks(),effectStatus:'PENDING_OBSERVATION'});return;}
   const evidenceCheck=route.match(/^\/api\/ceo\/tasks\/([^/]+)\/evidence-check$/);
   if(evidenceCheck&&req.method==='GET'){
    const task=workspace.getTask(decodeURIComponent(evidenceCheck[1]));if(!task)fail('TASK_NOT_FOUND');
    if(!checkEvidence)fail('EVIDENCE_CHECK_UNAVAILABLE');send(200,checkEvidence(task));return;
   }
   const detail=route.match(/^\/api\/ceo\/tasks\/([^/]+)$/);
   if(detail&&req.method==='GET'){const id=decodeURIComponent(detail[1]),task=workspace.getTask(id);if(!task)fail('TASK_NOT_FOUND');send(200,{task,events:workspace.getEvents(id)});return;}
   if(route==='/api/ceo/import'&&req.method==='POST'){
    if(actor.role!=='agent')fail('FORBIDDEN');const input=await body(req);if(!exact(input,['planId','operationId'])&&!exact(input,['planId','operationId','expectedVersions']))fail('INVALID_INPUT');
    send(200,workspace.importPlan({...input,actor,context:await loadContext(),now:now()}));return;
   }
   const command=route.match(/^\/api\/ceo\/tasks\/([^/]+)\/commands$/);
   if(command&&req.method==='POST'){
    const input=await body(req);if(!exact(input,['expectedVersion','command','args','operationId']))fail('INVALID_INPUT');
    const context=['approve','start'].includes(input.command)?await loadContext():null;
    send(200,workspace.command({...input,taskId:decodeURIComponent(command[1]),context,actor,now:now(),verifyEvidence:(task,args)=>requireCeoEvidenceCheck({task,args,checkEvidence})}));return;
   }
   send(404,{error:'NOT_FOUND'});
  }catch(e){
   const code=codes.has(e.code)||draftCodes.has(e.code)?e.code:'SERVICE_UNAVAILABLE';
   const status=['FORBIDDEN','SELF_VERIFICATION'].includes(code)?403:code==='UNAUTHORIZED'?401:code==='BODY_TOO_LARGE'?413:['TASK_NOT_FOUND','PLAN_NOT_FOUND','DRAFT_REQUEST_NOT_FOUND'].includes(code)?404:[...evidenceCodes,'VERSION_CONFLICT','OPERATION_CONFLICT','CONTEXT_CHANGED','RESULT_UNKNOWN','TASK_VERSION_CONFLICT','GOAL_VERSION_CONFLICT','DECISION_VERSION_CONFLICT','DECISION_CONTEXT_CONFLICT','PLAN_VERSION_CONFLICT','REVIEW_SOURCE_UNAVAILABLE','REVIEW_SOURCE_CHANGED','REPLAN_NOT_READY','REPLAN_INPUT_CHANGED','REPLAN_IN_FLIGHT','REPLAN_REQUIRES_NEW_PLAN','PLAN_REVIEW_LINK_CONFLICT'].includes(code)?409:['SERVICE_UNAVAILABLE','STORAGE_FAILED'].includes(code)?503:400;
   if(!res.headersSent)send(status,{error:code});else res.end();
  }
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
 return server;
}
