import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,writeFile,mkdir} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {acquireRuntimeLease} from '../src/ceo-runtime-host.js';
import {acquireOrRecoverLease,processPresent,portPresent} from '../src/ceo-lease-boot.js';

const identity=()=>({pid:process.pid,entryPath:path.resolve('dist/src/server.js'),instanceId:randomUUID(),releaseId:'rel-1',startedAt:new Date().toISOString()});

async function leaseDir(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'lease-'));
 return{dir,leasePath:path.join(dir,'runtime.lease.json')};
}

/** 找一个确实已被占用的端口（由本进程监听，用完关掉） */
async function occupiedPort(){
 const server=net.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 return{port,close:()=>new Promise(resolve=>server.close(resolve))};
}

/** 找一个当前没人监听的端口。
 *  注意不能用 0：portPresent(0) 按"非法端口不敢判定"返回占用，这是刻意的 fail-closed，
 *  所以测试必须传一个真实且空闲的端口，否则恢复逻辑永远走"拒绝接管"。 */
async function freePort(){
 const {port,close}=await occupiedPort();
 await close();
 return port;
}

/** 拿一个刚刚退出、因此必然不存在的 pid */
async function deadPid(){
 const child=spawn(process.execPath,['-e','0'],{stdio:'ignore'});
 const pid=child.pid;
 await new Promise(resolve=>child.once('exit',resolve));
 return pid;
}

/** 写一份指向指定 pid 的陈旧租约 */
async function writeLease(leasePath,pid){
 const value={pid,entryPath:path.resolve('dist/src/server.js'),instanceId:randomUUID(),releaseId:'rel-old',startedAt:new Date().toISOString(),leaseId:randomUUID()};
 await writeFile(leasePath,JSON.stringify(value));
 return value;
}

test('没有租约时正常获取，不需要恢复',async()=>{
 const {leasePath}=await leaseDir();
 const result=await acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort()});
 assert.equal(result.recovered,false);
 assert.equal(result.staleLeaseId,null);
 assert.ok((await stat(leasePath)).isFile());
 const written=JSON.parse(await readFile(leasePath,'utf8'));
 assert.equal(written.releaseId,'rel-1');
});

test('陈旧租约（pid 已退出 + 端口空闲）被接管，旧租约归档而不是删除',async()=>{
 const {dir,leasePath}=await leaseDir();
 const pid=await deadPid();
 assert.equal(processPresent(pid),false,'前置：该 pid 必须已不存在');
 const stale=await writeLease(leasePath,pid);

 const events=[];
 const result=await acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort(),onEvent:e=>events.push(e)});
 assert.equal(result.recovered,true);
 assert.equal(result.staleLeaseId,stale.leaseId);

 const files=await readdir(dir);
 assert.ok(files.includes(`runtime.lease.json.stale-${stale.leaseId}`),`应归档为 .stale-，实际：${files.join(',')}`);
 const fresh=JSON.parse(await readFile(leasePath,'utf8'));
 assert.equal(fresh.releaseId,'rel-1');
 assert.notEqual(fresh.leaseId,stale.leaseId);

 assert.ok(events.some(e=>e.event==='lease.recovery_probe'&&e.process==='ABSENT'&&e.listener==='ABSENT'));
 assert.ok(events.some(e=>e.event==='lease.recovered'));
});

test('活着的进程持有租约时拒绝接管（不做抢夺）',async()=>{
 const {dir,leasePath}=await leaseDir();
 // 用自己当"活着的进程"：pid 一定存在
 const stale=await writeLease(leasePath,process.pid);
 await assert.rejects(
  async()=>acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort()}),
  error=>{
   // 老实例还活着 = 就是"已经在跑"，不是"锁坏了"。错误码必须保持可识别，
   // 否则运维和既有启动期契约都会误判。
   assert.equal(error.code,'INSTANCE_ALREADY_RUNNING');
   assert.match(error.message,/live pid/);
   assert.equal(error.details.holderPid,process.pid);
   assert.equal(error.details.probes.at(-1).process,'PRESENT');
   return true;
  }
 );
 // 拒绝之后必须原样保留：不能把别人的租约删了或改名
 const files=await readdir(dir);
 assert.deepEqual(files,['runtime.lease.json']);
 const still=JSON.parse(await readFile(leasePath,'utf8'));
 assert.equal(still.leaseId,stale.leaseId);
});

test('端口仍被监听时拒绝接管（即使 pid 已经不在了）',async()=>{
 const {dir,leasePath}=await leaseDir();
 const occupied=await occupiedPort();
 try{
  const pid=await deadPid();
  await writeLease(leasePath,pid);
  await assert.rejects(
   ()=>acquireOrRecoverLease({leasePath,identity:identity(),port:occupied.port}),
   error=>{
    assert.equal(error.code,'RECOVERY_UNVERIFIED');
    assert.match(error.message,/listener=PRESENT/);
    return true;
   }
  );
  assert.deepEqual(await readdir(dir),['runtime.lease.json']);
 }finally{
  await occupied.close();
 }
});

test('恢复开关关闭时保持原行为：直接抛 INSTANCE_ALREADY_RUNNING',async()=>{
 const {leasePath}=await leaseDir();
 const pid=await deadPid();
 await writeLease(leasePath,pid);
 await assert.rejects(
  async()=>acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort(),recovery:false}),
  /INSTANCE_ALREADY_RUNNING/
 );
});

test('上一次恢复中途崩溃留下的 guard 目录会被明确报出，而不是被忽略',async()=>{
 const {dir,leasePath}=await leaseDir();
 const pid=await deadPid();
 await writeLease(leasePath,pid);
 await mkdir(leasePath+'.recovery');
 await assert.rejects(
  async()=>acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort()}),
  error=>{
   assert.equal(error.code,'RECOVERY_IN_PROGRESS');
   return true;
  }
 );
 const files=await readdir(dir);
 assert.ok(files.includes('runtime.lease.json.recovery'),'guard 目录不能被悄悄删掉');
 assert.ok(files.includes('runtime.lease.json'),'租约不能被提前改名');
});

test('恢复后再启动第二个实例会被挡住（接管不是无限让位）',async()=>{
 const {leasePath}=await leaseDir();
 const pid=await deadPid();
 await writeLease(leasePath,pid);
 const first=await acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort()});
 assert.equal(first.recovered,true);
 // 现在租约属于一个活着的 pid（自己），第二个实例必须拿不到
 await assert.rejects(
  async()=>acquireOrRecoverLease({leasePath,identity:identity(),port:await freePort()}),
  error=>{
   assert.equal(error.code,'INSTANCE_ALREADY_RUNNING');
   assert.equal(error.details.probes.at(-1).process,'PRESENT');
   return true;
  }
 );
});

test('processPresent / portPresent 的基本判定',async()=>{
 assert.equal(processPresent(process.pid),true);
 assert.equal(processPresent(0),false);
 assert.equal(processPresent(-1),false);
 assert.equal(processPresent(NaN),false);
 const occupied=await occupiedPort();
 try{
  assert.equal(await portPresent(occupied.port),true);
 }finally{
  await occupied.close();
 }
 // 空闲端口用"从来没监听过"的那个来测：刚 close 的端口在 Windows 上可能还有 TIME_WAIT，
 // 拿它当"空闲"样本会让断言随环境抖动，测的就不是判定逻辑了。
 assert.equal(await portPresent(await freePort()),false);
 assert.equal(await portPresent(0),true,'非法端口一律按占用处理');
});

test('verifyRuntimeLease 兼容：恢复后的租约可被正常 release',async()=>{
 const {leasePath}=await leaseDir();
 const id=identity();
 const lease=await acquireRuntimeLease({leasePath,identity:id});
 await lease.release();
 await assert.rejects(()=>stat(leasePath),/ENOENT/);
});
