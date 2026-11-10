// 启动期租约获取：正常拿锁，只在拿到"上一个实例确实不在了"的证据时才接管。
//
// 为什么需要这一层
// ----------------
// server.js 原本是裸的 `await acquireRuntimeLease(...)`：文件已存在就直接抛
// INSTANCE_ALREADY_RUNNING，没有任何恢复路径。ceo-runtime-host.js 里其实导出了
// recoverRuntimeLease，但全代码库零调用。
//
// 后果在生产是致命的：看门狗用 `taskkill /F` 杀进程（Windows 下 SIGTERM 处理器根本不触发，
// 租约不会被 release），租约文件留在数据根 → 下次启动立刻 INSTANCE_ALREADY_RUNNING →
// 服务永远起不来。也就是说"自动拉起"会把一次普通重启变成永久宕机。
//
// 但恢复不能靠猜。这里给 recoverRuntimeLease 提供它要求的 confirmStale 证据：
//   process  = 租约里的 pid 还在不在（process.kill(pid,0)）
//   listener = 本实例要用的端口还被占不占（连一下看是否被拒）
// 两条都必须是 ABSENT 才接管；任一条 PRESENT 或"判不了"就按 PRESENT 处理，拒绝接管。
// 宁可要一次需要人来看的启动失败，也不要两个实例同时写同一个数据根。

import net from 'node:net';
import {acquireRuntimeLease,recoverRuntimeLease} from './ceo-runtime-host.js';

const PROBE_TIMEOUT_MS=1500;

/** pid 是否仍存在。EPERM 表示存在但无权限 → 按存在处理（fail-closed）。 */
export function processPresent(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(pid,0);return true;}catch(error){return error?.code==='EPERM';}
}

/** 端口是否仍被监听。连上=占用；明确拒绝=空闲；其它错误/超时=判不了，按占用处理。 */
export function portPresent(port,{host='127.0.0.1',timeout=PROBE_TIMEOUT_MS}={}){
 return new Promise(resolve=>{
  if(!Number.isInteger(port)||port<=0||port>65535){resolve(true);return;}
  const socket=net.connect({host,port});
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
  socket.setTimeout(timeout);
  socket.once('connect',()=>finish(true));
  socket.once('timeout',()=>finish(true));
  socket.once('error',error=>{
   // ECONNREFUSED = 明确没人监听 = 端口空闲（present:false）。
   // 其它错误（ENOTFOUND/EHOSTUNREACH…）说明环境本身有问题，判不了，按占用处理（present:true）。
   finish(error?.code!=='ECONNREFUSED');
  });
 });
}

async function probe(lease,port){
 const processState=processPresent(lease?.pid)?'PRESENT':'ABSENT';
 const listenerState=(await portPresent(port))?'PRESENT':'ABSENT';
 return{process:processState,listener:listenerState};
}

/**
 * 拿租约；仅在证据充分时接管陈旧租约。
 * 返回 {lease, recovered, staleLeaseId}。
 */
export async function acquireOrRecoverLease({leasePath,identity,port,recovery=true,onEvent=null}={}){
 try{
  const lease=await acquireRuntimeLease({leasePath,identity});
  return Object.freeze({lease,recovered:false,staleLeaseId:null});
 }catch(error){
  if(error?.code!=='INSTANCE_ALREADY_RUNNING'||!recovery)throw error;
  onEvent?.({event:'lease.recovery_attempt',leasePath});
  const seen=[];
  const confirmStale=async lease=>{
   const proof=await probe(lease,port);
   seen.push({leaseId:lease?.leaseId??null,pid:lease?.pid??null,...proof});
   onEvent?.({event:'lease.recovery_probe',...seen.at(-1)});
   return proof;
  };
  try{
   const lease=await recoverRuntimeLease({leasePath,identity,confirmStale});
   onEvent?.({event:'lease.recovered',staleLeaseId:seen[0]?.leaseId??null,probes:seen.length});
   return Object.freeze({lease,recovered:true,staleLeaseId:seen[0]?.leaseId??null});
  }catch(recoveryError){
   const last=seen.at(-1);
   // 证据显示"老实例还活着"时，结论仍然是 INSTANCE_ALREADY_RUNNING。
   // 换成 RECOVERY_UNVERIFIED 会让运维以为锁坏了，而实际上只是有一个正常运行的实例。
   // 外部契约（启动期"第二个实例必须带这个码退出"）也依赖这一点。
   if(last?.process==='PRESENT'){
    const running=new Error(`INSTANCE_ALREADY_RUNNING: lease held by live pid ${last.pid??'unknown'}`);
    running.code='INSTANCE_ALREADY_RUNNING';
    running.details=Object.freeze({leasePath,holderPid:last.pid??null,probes:Object.freeze(seen.map(p=>Object.freeze({...p})))});
    throw running;
   }
   // 恢复失败必须带上"为什么不接管"，否则运维只能看到同一个笼统错误码
   const detail=last?`process=${last.process} listener=${last.listener}`:'no-probe';
   const wrapped=new Error(`${recoveryError?.code??'LEASE_RECOVERY_FAILED'}: lease not recoverable (${detail})`);
   wrapped.code=recoveryError?.code??'LEASE_RECOVERY_FAILED';
   wrapped.details=Object.freeze({leasePath,probes:Object.freeze(seen.map(p=>Object.freeze({...p})))});
   throw wrapped;
  }
 }
}
