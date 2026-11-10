import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {
 BINDING_APPROVAL_SCHEMA,
 buildBindingApproval,
 verifyBindingApproval,
 isBindingReason,
 defaultBindingApprovalPath,
} from '../src/ceo-binding-approval.js';
import {createMainRuntimeInfo} from '../src/ceo-main-boundary.js';
import {runtimeHealth} from '../src/ceo-runtime-host.js';

const digest=v=>createHash('sha256').update(v).digest('hex');
const FUTURE='2099-01-01T00:00:00.000Z';
const PAST='2000-01-01T00:00:00.000Z';

// 用一份手工构造的 manifest 做单元测试：不跑 manifest 构建，保持这套用例只测"批准校验"。
const fakeManifest=({fingerprint=digest('code-v1'),releaseId='g1-unreleased',storeId='400370',dataRoot}={})=>({
 schema:'ceo-runtime-manifest/v1',releaseId,mode:'SHADOW',storeId,dataRoot,
 files:[],fingerprint,
});

async function roots(){
 const base=await mkdtemp(path.join(os.tmpdir(),'binding-'));
 const dataRoot=path.join(base,'data');
 await mkdir(dataRoot,{recursive:true});
 return{base,dataRoot};
}

async function writeApproval(dataRoot,record,fileName='.ceo-binding-approval.json'){
 const file=path.join(dataRoot,fileName);
 await writeFile(file,typeof record==='string'?record:JSON.stringify(record));
 return file;
}

test('没有批准记录时 fail-closed，并报 BINDING_APPROVAL_MISSING',async()=>{
 const {dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 const result=await verifyBindingApproval({manifest});
 assert.equal(result.confirmed,false);
 assert.equal(result.reason,'BINDING_APPROVAL_MISSING');
 assert.equal(result.approval,null);
});

test('默认路径落在数据根，且路径本身可被外部覆盖',async()=>{
 const {dataRoot}=await roots();
 assert.equal(defaultBindingApprovalPath(dataRoot),path.join(dataRoot,'.ceo-binding-approval.json'));
 const manifest=fakeManifest({dataRoot});
 const result=await verifyBindingApproval({manifest,approvalPath:path.join(dataRoot,'custom.json')});
 assert.equal(result.reason,'BINDING_APPROVAL_MISSING');
 assert.equal(result.path,path.join(dataRoot,'custom.json'));
});

test('合法批准记录使 confirmed 为真，并原样回传可审计字段',async()=>{
 const {dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 const record=buildBindingApproval({manifest,approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE});
 await writeApproval(dataRoot,record);
 const result=await verifyBindingApproval({manifest,now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(result.confirmed,true);
 assert.equal(result.reason,null);
 assert.equal(result.approval.approvedBy,'lance');
 assert.equal(result.approval.manifestFingerprint,manifest.fingerprint);
 assert.equal(result.approval.purpose,'SHADOW_BOOT');
});

test('指纹不符即失效：换一个字节的代码不能沿用旧批准',async()=>{
 const {dataRoot}=await roots();
 const approved=buildBindingApproval({manifest:fakeManifest({dataRoot,fingerprint:digest('code-v1')}),approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE});
 await writeApproval(dataRoot,approved);
 const drifted=fakeManifest({dataRoot,fingerprint:digest('code-v2')});
 const result=await verifyBindingApproval({manifest:drifted,now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(result.confirmed,false);
 assert.equal(result.reason,'BINDING_FINGERPRINT_MISMATCH');
});

test('release 或店铺不符即失效，且不被误报成过期',async()=>{
 const {dataRoot}=await roots();
 const approved=buildBindingApproval({manifest:fakeManifest({dataRoot}),approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE});
 await writeApproval(dataRoot,approved);
 const wrongRelease=await verifyBindingApproval({manifest:fakeManifest({dataRoot,releaseId:'other-release'}),now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(wrongRelease.reason,'BINDING_RELEASE_MISMATCH');
 const wrongStore=await verifyBindingApproval({manifest:fakeManifest({dataRoot,storeId:'999999'}),now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(wrongStore.reason,'BINDING_STORE_MISMATCH');
});

test('过期与未来时间都被拒，边界在当下这一刻',async()=>{
 const {dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 await writeApproval(dataRoot,buildBindingApproval({manifest,approvedBy:'lance',approvedAt:'2026-01-01T00:00:00.000Z',expiresAt:'2026-11-10T00:00:00.000Z'}));
 assert.equal((await verifyBindingApproval({manifest,now:new Date('2026-11-10T00:00:01.000Z')})).reason,'BINDING_APPROVAL_EXPIRED');
 assert.equal((await verifyBindingApproval({manifest,now:new Date('2026-11-10T00:00:00.000Z')})).reason,'BINDING_APPROVAL_EXPIRED');

 const {dataRoot:data2}=await roots();
 await writeApproval(data2,buildBindingApproval({manifest:fakeManifest({dataRoot:data2}),approvedBy:'lance',approvedAt:'2099-01-01T00:00:00.000Z',expiresAt:'2099-02-01T00:00:00.000Z'}));
 const future=await verifyBindingApproval({manifest:fakeManifest({dataRoot:data2}),now:new Date('2026-11-10T00:00:00.000Z')});
 assert.equal(future.reason,'BINDING_APPROVAL_FUTURE_DATED');
});

test('结构缺陷一律拒绝：坏 JSON / 空文件 / 数组 / 缺字段 / 用途越界 / 批准人为空',async()=>{
 const {dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 const base=buildBindingApproval({manifest,approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE});
 const cases=[
  ['不是 JSON','{not json','BINDING_APPROVAL_UNREADABLE'],
  ['空文件','','BINDING_APPROVAL_UNREADABLE'],
  ['数组','[]','BINDING_APPROVAL_INVALID'],
  ['schema 不对',JSON.stringify({...base,schema:'other/v1'}),'BINDING_APPROVAL_INVALID'],
  ['用途越界',JSON.stringify({...base,purpose:'PRODUCTION_DEPLOY'}),'BINDING_APPROVAL_INVALID'],
  ['批准人为空',JSON.stringify({...base,approvedBy:'   '}),'BINDING_APPROVAL_INVALID'],
  ['时间不可解析',JSON.stringify({...base,expiresAt:'not-a-date'}),'BINDING_APPROVAL_INVALID'],
  ['有效期早于批准时间',JSON.stringify({...base,expiresAt:PAST}),'BINDING_APPROVAL_INVALID'],
  ['指纹不是 64 位十六进制',JSON.stringify({...base,manifestFingerprint:'ZZZ'}),'BINDING_APPROVAL_INVALID'],
 ];
 for(const [label,payload,expected]of cases){
  await writeApproval(dataRoot,payload);
  const result=await verifyBindingApproval({manifest,now:new Date('2026-11-10T06:00:00.000Z')});
  assert.equal(result.confirmed,false,label);
  assert.equal(result.reason,expected,label);
 }
});

test('批准记录放在代码根（数据根之外）必须拒绝：禁止把批准提交进版本库',async()=>{
 const {base,dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 const outside=path.join(base,'committed-approval.json');
 await writeFile(outside,JSON.stringify(buildBindingApproval({manifest,approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE})));
 const result=await verifyBindingApproval({manifest,now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(result.reason,'BINDING_APPROVAL_MISSING');
 const explicit=await verifyBindingApproval({manifest,approvalPath:outside,now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(explicit.confirmed,false);
 assert.equal(explicit.reason,'BINDING_APPROVAL_OUT_OF_SCOPE');
});

test('超过 8KB 的批准文件不被接受（防止拿大文件塞满解析）',async()=>{
 const {dataRoot}=await roots();
 const manifest=fakeManifest({dataRoot});
 const padded=JSON.stringify({...buildBindingApproval({manifest,approvedBy:'lance',approvedAt:'2026-11-10T00:00:00.000Z',expiresAt:FUTURE}),note:'x'.repeat(9000)});
 await writeApproval(dataRoot,padded);
 const result=await verifyBindingApproval({manifest,now:new Date('2026-11-10T06:00:00.000Z')});
 assert.equal(result.reason,'BINDING_APPROVAL_UNREADABLE');
});

test('runtimeHealth 接受具体原因，但只接受白名单形态，默认文案保持不变',async()=>{
 const manifest=fakeManifest({dataRoot:'/tmp/none'});
 const identity={pid:process.pid,entryPath:'/tmp/x/dist/src/server.js',instanceId:'i-1',releaseId:'g1-unreleased',startedAt:new Date().toISOString()};
 // manifest 是假的，verifyRuntimeManifest 会报 RELEASE_UNAVAILABLE；这里只关心 binding 那一条
 const withReason=await runtimeHealth({manifest,identity,bindingConfirmed:false,bindingReason:'BINDING_APPROVAL_MISSING'});
 assert.ok(withReason.reasons.includes('BINDING_APPROVAL_MISSING'));
 assert.ok(!withReason.reasons.includes('BINDING_UNCONFIRMED'));
 const junk=await runtimeHealth({manifest,identity,bindingConfirmed:false,bindingReason:'有中文 和空格; rm -rf /'});
 assert.ok(junk.reasons.includes('BINDING_UNCONFIRMED'));
 assert.ok(!junk.reasons.some(r=>r.includes('rm -rf')));
 const legacy=await runtimeHealth({manifest,identity});
 assert.ok(legacy.reasons.includes('BINDING_UNCONFIRMED'));
});

test('所有原因码都符合白名单，可直接进 /healthz',async()=>{
 for(const code of ['BINDING_APPROVAL_MISSING','BINDING_APPROVAL_UNREADABLE','BINDING_APPROVAL_INVALID','BINDING_APPROVAL_OUT_OF_SCOPE','BINDING_STORE_MISMATCH','BINDING_RELEASE_MISMATCH','BINDING_FINGERPRINT_MISMATCH','BINDING_APPROVAL_EXPIRED','BINDING_APPROVAL_FUTURE_DATED','BINDING_MANIFEST_UNAVAILABLE']){
  assert.equal(isBindingReason(code),true,code);
 }
 assert.equal(isBindingReason('lower case'),false);
 assert.equal(isBindingReason(''),false);
 assert.equal(isBindingReason(null),false);
});

test('端到端：createMainRuntimeInfo 从数据根的批准文件派生就绪状态',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'binding-e2e-'));
 const codeRoot=path.join(base,'code'),dataRoot=path.join(base,'data');
 await mkdir(codeRoot);await mkdir(dataRoot);
 for(const relative of ['dist/src/server.js','listing-agent/src/agent-client.js','listing-agent/package.json','package.json','package-lock.json','public/index.html','schemas/contract.json','prompts/core.md','config/ceo-capabilities.v1.json']){
  const file=path.join(codeRoot,relative);
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,'fixture');
 }

 // 1) 没有批准文件：未就绪，且原因是"缺批准"而不是笼统的"未绑定"
 const before=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-1'});
 assert.equal(before.binding.confirmed,false);
 const healthBefore=await before.health();
 assert.equal(healthBefore.ready,false);
 assert.ok(healthBefore.reasons.includes('BINDING_APPROVAL_MISSING'));

 // 2) 写入与本次 manifest 指纹严格绑定的批准：就绪
 const record=buildBindingApproval({manifest:before.manifest,approvedBy:'lance',approvedAt:new Date().toISOString(),expiresAt:FUTURE});
 await writeFile(defaultBindingApprovalPath(dataRoot),JSON.stringify(record));
 const after=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-1'});
 assert.equal(after.binding.confirmed,true);
 const healthAfter=await after.health();
 assert.equal(healthAfter.ready,true,JSON.stringify(healthAfter.reasons));
 assert.deepEqual(healthAfter.reasons,[]);

 // 3) 代码改一个字节：指纹变，旧批准自动失效（不需要人工撤回）
 await writeFile(path.join(codeRoot,'listing-agent/src/agent-client.js'),'changed-import');
 const drifted=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-1'});
 assert.notEqual(drifted.manifest.fingerprint,before.manifest.fingerprint);
 assert.equal(drifted.binding.confirmed,false);
 assert.equal(drifted.binding.reason,'BINDING_FINGERPRINT_MISMATCH');
 assert.equal((await drifted.health()).ready,false);

 await rm(base,{recursive:true,force:true});
});
