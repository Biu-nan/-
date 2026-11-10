// 绑定确认（bindingConfirmed）的可验证来源。
//
// 为什么不是一个开关
// ------------------
// 候选代码原本在 ceo-main-boundary.js 里写死 `bindingConfirmed:false`，于是 /healthz 永远
// ready:false。运维和看门狗因此无法区分"正在启动"和"结构上永远不可能就绪"。
// 但把它改成环境变量或常量 true 更糟：任何人一次赋值就能让就绪信号变成绿灯，
// 这个信号就从"事实"退化成"声明"，健康检查失去意义。
//
// 所以这里把 bindingConfirmed 定义为**派生事实**：
//   读一份落在数据根（不是代码根）的批准记录，校验它是否真的批准了"正在跑的这份代码"。
// 判据全部可审计：schema、用途、店铺、release、manifest 指纹、批准人、批准时间、有效期。
// 任一项不成立 → confirmed:false，并给出**具体原因码**，让 /healthz 说清楚缺什么。
// 文件缺失 = 未批准，默认关闭；不存在任何绕过参数。
//
// 指纹绑定是这套设计的关键：批准记录里写的是 manifest.fingerprint，而该指纹覆盖
// releaseId + codeRoot + dataRoot + 每个文件的 sha256。代码换一个字节、换一个 release，
// 指纹就变，旧批准自动失效——批准不能"顺延"给下一版。

import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export const BINDING_APPROVAL_SCHEMA='ceo-binding-approval/v1';

/** 只承认这两种用途。刻意不含"允许上架/允许改价"之类的措辞——绑定 ≠ 授权。 */
export const BINDING_APPROVAL_PURPOSES=Object.freeze(['SHADOW_BOOT','PRODUCTION_READINESS']);

const MAX_BYTES=8192;
const FUTURE_TOLERANCE_MS=5*60*1000;
const HEX64=/^[0-9a-f]{64}$/;
const REASON=/^[A-Z_0-9:]+$/;
const APPROVER_MAX=128;

const within=(root,p)=>{const rel=path.relative(root,p);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const deny=(reason,checkedPath=null)=>Object.freeze({confirmed:false,reason,approval:null,path:checkedPath});

export function defaultBindingApprovalPath(dataRoot){
 return path.join(dataRoot,'.ceo-binding-approval.json');
}

/** 供运维/测试生成一条与当前 manifest 严格绑定的记录；不写盘，只返回对象。 */
export function buildBindingApproval({manifest,approvedBy,approvedAt,expiresAt,purpose='SHADOW_BOOT'}){
 if(!manifest||manifest.schema!=='ceo-runtime-manifest/v1')throw Error('BINDING_MANIFEST_UNAVAILABLE');
 return{
  schema:BINDING_APPROVAL_SCHEMA,
  purpose,
  storeId:manifest.storeId,
  releaseId:manifest.releaseId,
  manifestFingerprint:manifest.fingerprint,
  approvedBy,
  approvedAt,
  expiresAt,
 };
}

/**
 * 校验批准记录。所有失败路径都是 fail-closed，且原因码有界（匹配 ^[A-Z_0-9:]+$），
 * 可以直接进 /healthz 的 reasons 数组而不污染响应结构。
 */
export async function verifyBindingApproval({manifest,approvalPath=null,now=new Date()}={}){
 if(!manifest||manifest.schema!=='ceo-runtime-manifest/v1'||typeof manifest.fingerprint!=='string'||!HEX64.test(manifest.fingerprint)){
  return deny('BINDING_MANIFEST_UNAVAILABLE');
 }
 if(typeof manifest.dataRoot!=='string'||!path.isAbsolute(manifest.dataRoot))return deny('BINDING_MANIFEST_UNAVAILABLE');

 const target=path.resolve(approvalPath??defaultBindingApprovalPath(manifest.dataRoot));
 const nowMs=now instanceof Date?now.getTime():Date.parse(now);
 if(!Number.isFinite(nowMs))return deny('BINDING_APPROVAL_INVALID',target);

 // 批准记录必须落在数据根内：放代码根就等于把"批准"提交进版本库，随代码一起复制，
 // 那样批准就不再是针对某一次部署的决定。
 let root,real;
 try{root=await realpath(manifest.dataRoot);}catch{return deny('BINDING_APPROVAL_MISSING',target);}
 try{real=await realpath(target);}catch{return deny('BINDING_APPROVAL_MISSING',target);}
 if(!within(root,real))return deny('BINDING_APPROVAL_OUT_OF_SCOPE',real);

 let info;
 try{info=await stat(real);}catch{return deny('BINDING_APPROVAL_MISSING',real);}
 if(!info.isFile()||info.size===0||info.size>MAX_BYTES)return deny('BINDING_APPROVAL_UNREADABLE',real);

 let record;
 try{record=JSON.parse(await readFile(real,'utf8'));}catch{return deny('BINDING_APPROVAL_UNREADABLE',real);}
 if(!record||typeof record!=='object'||Array.isArray(record))return deny('BINDING_APPROVAL_INVALID',real);

 if(record.schema!==BINDING_APPROVAL_SCHEMA)return deny('BINDING_APPROVAL_INVALID',real);
 if(!BINDING_APPROVAL_PURPOSES.includes(record.purpose))return deny('BINDING_APPROVAL_INVALID',real);
 if(typeof record.approvedBy!=='string'||record.approvedBy.trim()===''||record.approvedBy.length>APPROVER_MAX){
  return deny('BINDING_APPROVAL_INVALID',real);
 }
 const approvedAt=Date.parse(record.approvedAt);
 const expiresAt=Date.parse(record.expiresAt);
 if(!Number.isFinite(approvedAt)||!Number.isFinite(expiresAt))return deny('BINDING_APPROVAL_INVALID',real);
 if(expiresAt<=approvedAt)return deny('BINDING_APPROVAL_INVALID',real);

 // 顺序有意义：先比"是不是同一家店/同一版/同一份字节"，最后才比时间。
 // 反过来会让"过期的旧批准"被报成过期，掩盖掉它其实还绑错了 release。
 if(record.storeId!==manifest.storeId)return deny('BINDING_STORE_MISMATCH',real);
 if(record.releaseId!==manifest.releaseId)return deny('BINDING_RELEASE_MISMATCH',real);
 if(typeof record.manifestFingerprint!=='string'||!HEX64.test(record.manifestFingerprint))return deny('BINDING_APPROVAL_INVALID',real);
 if(record.manifestFingerprint!==manifest.fingerprint)return deny('BINDING_FINGERPRINT_MISMATCH',real);

 if(approvedAt-nowMs>FUTURE_TOLERANCE_MS)return deny('BINDING_APPROVAL_FUTURE_DATED',real);
 if(expiresAt<=nowMs)return deny('BINDING_APPROVAL_EXPIRED',real);

 return Object.freeze({
  confirmed:true,
  reason:null,
  path:real,
  approval:Object.freeze({
   schema:record.schema,
   purpose:record.purpose,
   storeId:record.storeId,
   releaseId:record.releaseId,
   manifestFingerprint:record.manifestFingerprint,
   approvedBy:record.approvedBy,
   approvedAt:record.approvedAt,
   expiresAt:record.expiresAt,
  }),
 });
}

/** 判断一个字符串能否安全地放进 /healthz 的 reasons（runtimeHealth 会用同一规则再挡一次）。 */
export const isBindingReason=value=>typeof value==='string'&&REASON.test(value);
