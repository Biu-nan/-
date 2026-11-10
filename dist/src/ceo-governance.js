import {readFileSync} from 'node:fs';
import {timingSafeEqual,createHash} from 'node:crypto';
const policy=JSON.parse(readFileSync(new URL('../../config/ceo-capabilities.v1.json',import.meta.url),'utf8'));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const sameToken=(a,b)=>{if(typeof a!=='string'||Buffer.byteLength(a)!==Buffer.byteLength(b))return false;return timingSafeEqual(Buffer.from(a),Buffer.from(b));};
const safeReads=[/^\/api\/system\/state$/, /^\/api\/ceo\/(?:me|context|plans|tasks|daily-reviews|operating-brief|replanning-brief)$/, /^\/api\/ceo\/tasks\/[^/]+(?:\/evidence-check)?$/, /^\/api\/ceo\/draft-requests\/[^/]+$/];
export function classifyCeoRequest(method,pathname){
 if(method==='GET'&&['/healthz','/api/version'].includes(pathname))return 'public.read';
 if(method==='GET'&&safeReads.some(re=>re.test(pathname)))return 'read';
 if(method==='POST'&&pathname==='/api/ceo-shadow/feedback')return 'human.review';
 if(method==='POST'&&pathname==='/api/ceo/vnext/shadow-analysis')return 'analyze';
 if(method==='POST'&&pathname==='/api/ceo/import')return 'task.import';
 if(method==='POST'&&/^\/api\/ceo\/tasks\/[^/]+\/commands$/.test(pathname))return 'task.command';
 return 'unsafe';
}
export function createCeoGovernance({credentials,now=()=>Date.now(),maxOperations=10000,allowIsolatedHumanManual=false}={}){
 if(!credentials||typeof credentials!=='object'||Array.isArray(credentials)||typeof now!=='function'||!Number.isSafeInteger(maxOperations)||maxOperations<1)fail('INVALID_CREDENTIALS');
 const issued=new WeakSet(),revoked=new Set(),operations=new Map(),ids=new Set(),tokens=new Set();
 const records=Object.entries(credentials).map(([key,c])=>{
  const profile=c?.profile??'legacy',role=c?.role??(key==='owner'?'owner':'agent');
  if(!c||typeof c.id!=='string'||!c.id||c.id.length>120||ids.has(c.id)||c.storeId!==policy.storeId||!Object.hasOwn(policy.profiles,profile)||!['owner','agent'].includes(role)||typeof c.token!=='string'||Buffer.byteLength(c.token)<32||Buffer.byteLength(c.token)>256||tokens.has(c.token)||(c.expiresAt!==undefined&&(!/(?:Z|[+-]\d{2}:\d{2})$/.test(c.expiresAt)||!Number.isFinite(Date.parse(c.expiresAt)))))fail('INVALID_CREDENTIALS');
  ids.add(c.id);tokens.add(c.token);const principal=Object.freeze({id:c.id,role,profile,storeId:c.storeId,...(c.expiresAt?{expiresAt:c.expiresAt}:{})});issued.add(principal);
  return{token:c.token,principal};
 });
 const grants=Object.fromEntries(Object.entries(policy.profiles).map(([k,v])=>[k,new Set(v)]));
 if(allowIsolatedHumanManual===true)grants.human.add('human.manual');
 function validate(principal){if(!issued.has(principal)||revoked.has(principal.id)||(principal.expiresAt&&Date.parse(principal.expiresAt)<=now()))fail('UNAUTHORIZED');}
 function authenticateToken(token){const record=records.find(r=>sameToken(token,r.token));if(!record)fail('UNAUTHORIZED');validate(record.principal);return record.principal;}
 function authorize({principal,operation,storeId=policy.storeId}){validate(principal);if(storeId!==principal.storeId||!grants[principal.profile].has(operation))fail('FORBIDDEN');return Object.freeze({allowed:true,policyVersion:policy.policyVersion,actorId:principal.id,operation,storeId});}
 function reserveOperation({principal,operation,storeId,operationId,payload}){
  authorize({principal,operation,storeId});if(typeof operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(operationId))fail('INVALID_OPERATION');
  const key=principal.id+':'+operationId,requestHash=hash({operation,storeId,payload}),old=operations.get(key);
  if(old)fail(old===requestHash?'REPLAY_REJECTED':'OPERATION_CONFLICT');if(operations.size>=maxOperations)fail('OPERATION_LIMIT');operations.set(key,requestHash);
 }
 return Object.freeze({authenticateToken,authorize,reserveOperation,revoke:id=>revoked.add(id),policyVersion:policy.policyVersion});
}
export function createCeoGateway({governance,resolveOperation=()=>null}={}){
 if(!governance)fail('GOVERNANCE_REQUIRED');
 return(req,res,next)=>{
  try{
   const raw=req.originalUrl??req.url;if(typeof raw!=='string'||/%(?:2f|5c|00|2e)/i.test(raw)||raw.includes('\\'))fail('FORBIDDEN');
   const url=new URL(raw,'http://localhost');if(url.search)fail('FORBIDDEN');
   const classified=classifyCeoRequest(req.method,url.pathname),operation=classified==='unsafe'?(resolveOperation(req,url.pathname)??'unsafe'):classified;
   if(operation==='public.read')return next();
   const token=/^Bearer ([^\s]+)$/.exec(req.headers.authorization??'')?.[1],principal=governance.authenticateToken(token);
   const pathStore=/\/stores\/([^/]+)/i.exec(url.pathname)?.[1];
   const declaredStores=[pathStore?decodeURIComponent(pathStore):undefined,req.body?.storeId,req.body?.storeRef?.environmentId].filter(v=>v!==undefined);
   if(declaredStores.some(v=>v!==principal.storeId))fail('FORBIDDEN');
   const requestedStore=declaredStores[0]??'400370';
   governance.authorize({principal,operation,storeId:requestedStore});
   if(req.method!=='GET')governance.reserveOperation({principal,operation,storeId:requestedStore,operationId:req.body?.operationId??req.body?.requestId,payload:{method:req.method,path:url.pathname,body:req.body}});
   Object.defineProperty(req,'ceoPrincipal',{value:principal,writable:false});next();
  }catch(e){const code=['UNAUTHORIZED','FORBIDDEN','INVALID_OPERATION','REPLAY_REJECTED','OPERATION_CONFLICT','OPERATION_LIMIT'].includes(e.code)?e.code:'FORBIDDEN';res.status(code==='UNAUTHORIZED'?401:code==='INVALID_OPERATION'?400:['REPLAY_REJECTED','OPERATION_CONFLICT','OPERATION_LIMIT'].includes(code)?409:403).json({error:code});}
 };
}
