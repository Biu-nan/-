import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';

/**
 * Minimal read-only collector for the 稳卖 local openEnv service.
 *
 * Reuses the existing client (nawu-fetch/lib/wenmai-api.cjs) instead of writing a
 * second HTTP stack. Only `queryEnv` is allowed: it lists environments and their
 * ids/names/platforms. `openEnv`, `closeEnv` and `deleteEnv` mutate runtime state
 * and are refused here, as are unknown methods.
 *
 * No cookie, token or credential is read, printed or stored. The collector fails
 * closed: on any transport error it returns status FAILED and never falls back to
 * a cached or previously collected value.
 */

const require=createRequire('F:/yikuaborder-deploy/nawu-fetch/package.json');
const {WenmaiApi}=require('F:/yikuaborder-deploy/nawu-fetch/lib/wenmai-api.cjs');

const ALLOWED_METHODS=new Set(['queryEnv']);
const SCHEMA='ceo-wenmai-identity-batch/v1';

const canonical=o=>JSON.stringify(o,Object.keys(o).sort());
const sha=o=>createHash('sha256').update(typeof o==='string'?o:canonical(o)).digest('hex');

function batchId(now){
 const p=n=>String(n).padStart(2,'0');
 const d=now;
 return `wmb-${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${randomUUID().slice(0,6)}`;
}

/**
 * @param {object} args
 * @param {string} args.baseUrl        e.g. http://127.0.0.1:3980
 * @param {string} args.expectedEnvId  the store environment id to confirm, e.g. '400370'
 * @param {Date}   [args.now]
 * @param {number} [args.timeoutMs]
 */
export async function collectStoreIdentity({baseUrl='http://127.0.0.1:3980',expectedEnvId,now=new Date(),timeoutMs=15000}={}){
 if(typeof expectedEnvId!=='string'||!/^[0-9]{1,20}$/.test(expectedEnvId))throw Object.assign(new Error('INVALID_EXPECTED_ENV_ID'),{code:'INVALID_EXPECTED_ENV_ID'});
 if(!(now instanceof Date)||!Number.isFinite(+now))throw Object.assign(new Error('INVALID_CLOCK'),{code:'INVALID_CLOCK'});
 const id=batchId(now);
 const startedAt=now.toISOString();
 const t0=process.hrtime.bigint();

 const api=new WenmaiApi(baseUrl,120);
 // Whitelist guard: a future edit cannot silently call openEnv/closeEnv/deleteEnv.
 const rawCall=api.call.bind(api);
 api.call=async(pathName,body)=>{
  const method=body?.method;
  if(!ALLOWED_METHODS.has(method))throw Object.assign(new Error(`METHOD_NOT_ALLOWED:${method}`),{code:'METHOD_NOT_ALLOWED'});
  return rawCall(pathName,body);
 };

 try{
  const timer=new Promise((_,rej)=>setTimeout(()=>rej(Object.assign(new Error('COLLECT_TIMEOUT'),{code:'COLLECT_TIMEOUT'})),timeoutMs).unref?.());
  const r=await Promise.race([api.queryEnv(1,100),timer]);
  const elapsedMs=Number(process.hrtime.bigint()-t0)/1e6;
  const envs=(r.envs??[]).map(e=>({envId:String(e.id),name:String(e.name??''),platform:String(e.platform??'')}));
  const target=envs.find(e=>e.envId===expectedEnvId)??null;
  const observed={
   serverCode:r.code,
   serverMsg:r.msg,
   total:r.total??envs.length,
   page:r.page??1,
   pageTotal:r.pageTotal??1,
   storeCount:envs.length
  };
  return Object.freeze({
   schema:SCHEMA,
   batchId:id,
   status:target?'COLLECTED':'TARGET_STORE_NOT_FOUND',
   collectedAt:new Date(now.getTime()+Math.round(elapsedMs)).toISOString(),
   requestedAt:startedAt,
   elapsedMs:Math.round(elapsedMs),
   sourceSystem:'稳卖 openEnv 本地服务',
   sourceEndpoint:`${baseUrl}/queryEnv`,
   sourceMethod:'queryEnv',
   accessMode:'READ_ONLY',
   target:{envId:expectedEnvId},
   storeIdentity:target,
   identityMatch:!!target,
   observed,
   httpServedBy:'127.0.0.1:3980',
   sourceHash:sha({observed,target,envs}),
   metricPayload:null,
   metricAvailability:'IDENTITY_ONLY',
   verificationStatus:'UNAPPROVED',
   approvalRef:null
  });
 }catch(error){
  const elapsedMs=Number(process.hrtime.bigint()-t0)/1e6;
  return Object.freeze({
   schema:SCHEMA,
   batchId:id,
   status:'FAILED',
   collectedAt:new Date(now.getTime()+Math.round(elapsedMs)).toISOString(),
   requestedAt:startedAt,
   elapsedMs:Math.round(elapsedMs),
   sourceSystem:'稳卖 openEnv 本地服务',
   sourceEndpoint:`${baseUrl}/queryEnv`,
   sourceMethod:'queryEnv',
   accessMode:'READ_ONLY',
   target:{envId:expectedEnvId},
   storeIdentity:null,
   identityMatch:false,
   observed:null,
   error:{code:error?.code??'COLLECT_ERROR',message:String(error?.message??error).slice(0,200)},
   sourceHash:null,
   metricPayload:null,
   metricAvailability:'UNAVAILABLE',
   verificationStatus:'UNAPPROVED',
   approvalRef:null,
   note:'采集失败时不返回任何历史值，调用方必须把失败当作失败处理。'
  });
 }
}
