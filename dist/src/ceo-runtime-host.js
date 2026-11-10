import http from 'node:http';
import {open,readFile,stat,unlink,mkdir,rename,rmdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyRuntimeManifest} from './ceo-runtime-manifest.js';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const identityKeys=['pid','entryPath','instanceId','releaseId','startedAt'];
const validIdentity=v=>v&&Number.isSafeInteger(v.pid)&&v.pid>0&&path.isAbsolute(v.entryPath??'')&&['instanceId','releaseId','startedAt'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<256)&&Number.isFinite(Date.parse(v.startedAt));
const same=(a,b)=>validIdentity(a)&&validIdentity(b)&&identityKeys.every(k=>a[k]===b[k]);
async function readLease(file){const info=await stat(file);if(!info.isFile()||info.size>8192)fail('INVALID_LEASE');const bytes=await readFile(file);if(bytes.length>8192)fail('INVALID_LEASE');let v;try{v=JSON.parse(bytes);}catch{fail('INVALID_LEASE');}if(!validIdentity(v)||typeof v.leaseId!=='string')fail('INVALID_LEASE');return v;}
export async function acquireRuntimeLease({leasePath,identity}){
 if(!path.isAbsolute(leasePath??'')||!validIdentity(identity))fail('INVALID_LEASE');
 const value={...Object.fromEntries(identityKeys.map(k=>[k,identity[k]])),leaseId:randomUUID()};
 let handle;try{handle=await open(leasePath,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('INSTANCE_ALREADY_RUNNING');throw e;}
 try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
 return Object.freeze({identity:Object.freeze({...identity}),async release(){const current=await readLease(leasePath);if(!same(current,value)||current.leaseId!==value.leaseId)fail('INSTANCE_IDENTITY_CHANGED');await unlink(leasePath);}});
}
export async function stopOwnedRuntime({leasePath,identity,readProcessIdentity,probeIdentity,requestStop}){
 const lease=await readLease(leasePath);
 if(!same(lease,identity)||typeof readProcessIdentity!=='function'||typeof probeIdentity!=='function'||typeof requestStop!=='function')fail('INSTANCE_IDENTITY_CHANGED');
 if(!same(await readProcessIdentity(identity.pid),identity)||!same(await probeIdentity(),identity)||!same(await readLease(leasePath),identity))fail('INSTANCE_IDENTITY_CHANGED');
 // No PID/port kill fallback: the verified instance receives a graceful request.
 await requestStop(Object.freeze({...identity}));return{requested:true,instanceId:identity.instanceId};
}
export async function recoverRuntimeLease({leasePath,identity,confirmStale}){
 const original=await readLease(leasePath);if(typeof confirmStale!=='function')fail('RECOVERY_UNVERIFIED');
 const proof=await confirmStale(original);if(proof?.process!=='ABSENT'||proof?.listener!=='ABSENT')fail('RECOVERY_UNVERIFIED');
 const guard=leasePath+'.recovery';try{await mkdir(guard);}catch{fail('RECOVERY_IN_PROGRESS');}
 try{
  const current=await readLease(leasePath),again=await confirmStale(current);
  if(current.leaseId!==original.leaseId||!same(current,original)||again?.process!=='ABSENT'||again?.listener!=='ABSENT')fail('RECOVERY_UNVERIFIED');
  await rename(leasePath,leasePath+'.stale-'+original.leaseId);
  return await acquireRuntimeLease({leasePath,identity});
 }finally{await rmdir(guard);}
}
export async function runtimeHealth({manifest,identity,dependencies=[],bindingConfirmed=false,inFlight=false,bindingReason=null}){
 const reasons=[];const verified=await verifyRuntimeManifest(manifest);if(!verified.ok)reasons.push(verified.reason);
 if(!validIdentity(identity)||identity.releaseId!==manifest.releaseId)reasons.push('INSTANCE_IDENTITY_CHANGED');
 // bindingReason 由调用方给出具体原因（缺批准文件 / 指纹不符 / 已过期…）。
 // 但它来自外部输入，只接受 ^[A-Z_0-9:]+$ 的白名单形态，否则退回固定文案，
 // 避免把任意文本塞进健康响应。默认行为与原实现完全一致。
 if(!bindingConfirmed)reasons.push(typeof bindingReason==='string'&&/^[A-Z_0-9:]+$/.test(bindingReason)?bindingReason:'BINDING_UNCONFIRMED');
 const dependenciesState=[];
 for(const dependency of dependencies){
  let ok=false;try{const info=await stat(dependency.path);ok=dependency.kind==='directory'?info.isDirectory():info.isFile();}catch{}
  dependenciesState.push({id:dependency.id,ok});if(!ok)reasons.push('DEPENDENCY_UNAVAILABLE:'+dependency.id);
 }
 return{schema:'ceo-runtime-health/v1',ready:reasons.length===0,readOnly:true,releaseId:manifest.releaseId,mode:manifest.mode,storeId:manifest.storeId,fingerprint:manifest.fingerprint,instanceId:identity.instanceId,pid:identity.pid,startedAt:identity.startedAt,inFlight:Boolean(inFlight),dependencies:dependenciesState,reasons};
}
export function createRuntimeHealthServer(options){
 return http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  if(req.method!=='GET'){res.writeHead(405);res.end(JSON.stringify({error:'READ_ONLY_ENDPOINT'}));return;}
  if(!['/healthz','/api/version'].includes(req.url)){res.writeHead(404);res.end(JSON.stringify({error:'NOT_FOUND'}));return;}
  try{const health=await runtimeHealth(options);res.writeHead(req.url==='/healthz'&&!health.ready?503:200);res.end(JSON.stringify(health));}
  catch{res.writeHead(503);res.end(JSON.stringify({ready:false,error:'HEALTH_UNAVAILABLE'}));}
 });
}
