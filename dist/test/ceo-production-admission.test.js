import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {
 PRODUCTION_ADMISSION_SCHEMA,
 PRODUCTION_APPROVAL_PURPOSE,
 SYNTHETIC_FIXTURE_MARKER,
 assessProductionAdmission,
 isAdmissionReason,
} from '../src/ceo-production-admission.js';
import {buildBindingApproval} from '../src/ceo-binding-approval.js';
import {createRuntimeManifest} from '../src/ceo-runtime-manifest.js';
import {createMainRuntimeInfo} from '../src/ceo-main-boundary.js';

const digest=v=>createHash('sha256').update(v).digest('hex');
const FUTURE='2099-01-01T00:00:00.000Z';
const PAST='2000-01-01T00:00:00.000Z';

// 手工 manifest：这一层测的是"准入判定"，不测 manifest 构建，所以指纹用常量。
// codeRoot/dataRoot 必须是绝对路径（准入会先做 realpath）。
const fakeManifest=({codeRoot,dataRoot,mode='PRODUCTION',fingerprint=digest('code-v1'),releaseId='g1-unreleased',storeId='400370'}={})=>({
 schema:'ceo-runtime-manifest/v1',releaseId,mode,storeId,codeRoot,dataRoot,
 files:[],fingerprint,
});

/** 造一对真分离的目录：<base>/code 与 <base>/data。 */
async function splitRoots(){
 const base=await mkdtemp(path.join(os.tmpdir(),'admission-'));
 const codeRoot=path.join(base,'code');
 const dataRoot=path.join(base,'data');
 await mkdir(codeRoot,{recursive:true});
 await mkdir(dataRoot,{recursive:true});
 return{base,codeRoot,dataRoot};
}

async function writeApproval(dataRoot,record,fileName='.ceo-binding-approval.json'){
 const file=path.join(dataRoot,fileName);
 await writeFile(file,typeof record==='string'?record:JSON.stringify(record));
 return file;
}

/** 生成一条与 manifest 严格绑定的批准并落盘，返回路径。 */
async function approve(manifest,dataRoot,{purpose=PRODUCTION_APPROVAL_PURPOSE,approvedAt=PAST,expiresAt=FUTURE}={}){
 const record=buildBindingApproval({manifest,approvedBy:'lance',approvedAt,expiresAt,purpose});
 return writeApproval(dataRoot,record);
}

/* ── ① 形状：manifest 本身 ───────────────────────────────────────────── */

test('manifest 缺失或 schema 不符时 fail-closed',async()=>{
 for(const bad of [undefined,null,{}, {schema:'other/v1'}]){
  const r=await assessProductionAdmission({manifest:bad});
  assert.equal(r.admitted,false);
  assert.equal(r.reason,'ADMISSION_MANIFEST_UNAVAILABLE');
 }
});

test('codeRoot/dataRoot 不是绝对路径时报 MANIFEST_UNAVAILABLE，而不是抛异常',async()=>{
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot:'rel/code',dataRoot:'rel/data'})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'ADMISSION_MANIFEST_UNAVAILABLE');
});

test('代码根不存在（realpath 失败）时报 MANIFEST_UNAVAILABLE',async()=>{
 const {base,dataRoot}=await splitRoots();
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot:path.join(base,'nope'),dataRoot})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'ADMISSION_MANIFEST_UNAVAILABLE');
});

/* ── ② mode 必须先立住，且先于任何证据 ─────────────────────────────── */

test('mode=SHADOW 时即使批准齐全也不给生产准入',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot,mode:'SHADOW'});
 // 故意把一份合法的 PRODUCTION_READINESS 批准也放在那，证明拒绝不是因为缺材料，
 // 而是因为这份部署的自我声明不是生产。
 await approve(manifest,dataRoot);
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'ADMISSION_MANIFEST_NOT_PRODUCTION');
});

test('mode=LEGACY_READ_ONLY 同样不给生产准入',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot,dataRoot,mode:'LEGACY_READ_ONLY'})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'ADMISSION_MANIFEST_NOT_PRODUCTION');
});

/* ── ③ 结构：双根 ─────────────────────────────────────────────────── */

test('单根部署（codeRoot === dataRoot）报 PRODUCTION_REQUIRES_SPLIT_ROOTS',async()=>{
 const {base}=await splitRoots();
 const root=path.join(base,'code'); // 同一个目录同时当代码根和数据根
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot:root,dataRoot:root})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'PRODUCTION_REQUIRES_SPLIT_ROOTS');
});

test('数据根嵌在代码根内也报 PRODUCTION_REQUIRES_SPLIT_ROOTS',async()=>{
 const {base,codeRoot}=await splitRoots();
 const nested=path.join(codeRoot,'data');
 await mkdir(nested,{recursive:true});
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot,dataRoot:nested})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'PRODUCTION_REQUIRES_SPLIT_ROOTS');
});

test('代码根嵌在数据根内同样报 PRODUCTION_REQUIRES_SPLIT_ROOTS',async()=>{
 const {base,dataRoot}=await splitRoots();
 const nested=path.join(dataRoot,'code');
 await mkdir(nested,{recursive:true});
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot:nested,dataRoot})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'PRODUCTION_REQUIRES_SPLIT_ROOTS');
});

/* ── ④ 诚实性：生产不许跑在合成夹具上 ─────────────────────────────── */

test('数据根带 synthetic:true 标记时报 PRODUCTION_ON_SYNTHETIC_FIXTURE',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 await writeFile(path.join(dataRoot,SYNTHETIC_FIXTURE_MARKER),JSON.stringify({synthetic:true}));
 await approve(manifest,dataRoot); // 批准齐全也不放行
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'PRODUCTION_ON_SYNTHETIC_FIXTURE');
});

test('标记存在但 synthetic 不是 true、或内容不是 JSON —— 都视为没有标记',async()=>{
 for(const body of [JSON.stringify({synthetic:false}),'not json','{}']){
  const {codeRoot,dataRoot}=await splitRoots();
  const manifest=fakeManifest({codeRoot,dataRoot});
  await writeFile(path.join(dataRoot,SYNTHETIC_FIXTURE_MARKER),body);
  const r=await assessProductionAdmission({manifest});
  // 关键：拒绝原因不能是"夹具"，而应该是缺批准 —— 证明标记判定本身没误伤。
  assert.equal(r.admitted,false);
  assert.equal(r.reason,'BINDING_APPROVAL_MISSING');
 }
});

/* ── ⑤ 证据：绑定批准 + 用途 ─────────────────────────────────────── */

test('双根但没有任何批准记录时报 BINDING_APPROVAL_MISSING（且不重复前缀）',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const r=await assessProductionAdmission({manifest:fakeManifest({codeRoot,dataRoot})});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'BINDING_APPROVAL_MISSING');
 assert.ok(!r.reason.startsWith('BINDING_BINDING_'),'原因码不应被拼成 BINDING_BINDING_*');
});

test('批准绑定的是别的指纹时报 BINDING_FINGERPRINT_MISMATCH',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 const stale=buildBindingApproval({
  manifest:{...manifest,fingerprint:digest('code-old')},
  approvedBy:'lance',approvedAt:PAST,expiresAt:FUTURE,purpose:PRODUCTION_APPROVAL_PURPOSE,
 });
 await writeApproval(dataRoot,stale);
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'BINDING_FINGERPRINT_MISMATCH');
});

test('批准已过期时报 BINDING_APPROVAL_EXPIRED',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 await approve(manifest,dataRoot,{approvedAt:'2020-01-01T00:00:00.000Z',expiresAt:'2020-06-01T00:00:00.000Z'});
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'BINDING_APPROVAL_EXPIRED');
});

test('批准记录被放在数据根之外时报 BINDING_APPROVAL_OUT_OF_SCOPE',async()=>{
 const {base,codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 const outside=path.join(base,'stray-approval.json');
 await writeFile(outside,JSON.stringify(buildBindingApproval({
  manifest,approvedBy:'lance',approvedAt:PAST,expiresAt:FUTURE,purpose:PRODUCTION_APPROVAL_PURPOSE,
 })));
 const r=await assessProductionAdmission({manifest,approvalPath:outside});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'BINDING_APPROVAL_OUT_OF_SCOPE');
});

// 这条是 A2c 的核心否定用例：绑定校验本身放行 SHADOW_BOOT（它是合法 purpose），
// 但准入必须再挡一次，否则"影子启动的批准"会顺延成"允许以生产身份运行"。
test('purpose=SHADOW_BOOT 的批准不能换到生产准入',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 await approve(manifest,dataRoot,{purpose:'SHADOW_BOOT'});
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,false);
 assert.equal(r.reason,'PRODUCTION_APPROVAL_PURPOSE_MISMATCH');
});

/* ── ⑥ 放行 ─────────────────────────────────────────────────────── */

test('双根 + 无夹具标记 + PRODUCTION_READINESS 批准 → admitted:true',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 await approve(manifest,dataRoot);
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,true);
 assert.equal(r.reason,null);
 assert.equal(r.schema,PRODUCTION_ADMISSION_SCHEMA);
 assert.equal(r.approval.purpose,PRODUCTION_APPROVAL_PURPOSE);
 assert.equal(r.approval.manifestFingerprint,manifest.fingerprint);
 assert.equal(r.approval.approvedBy,'lance');
});

test('admitted:true 只表示准入通过，不携带任何鉴权/网关结论',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 const manifest=fakeManifest({codeRoot,dataRoot});
 await approve(manifest,dataRoot);
 const r=await assessProductionAdmission({manifest});
 // 刻意断言"没有这些键"：若哪天有人把 admitted 解释成"网关可以开"，
 // 就会往结果里塞 gateway/credentials/scopes，这条会立刻失败。
 for(const forbidden of ['gateway','credentials','scopes','principals','authorized','token']){
  assert.ok(!(forbidden in r),`准入结果不应包含 ${forbidden}`);
 }
});

test('真实 manifest（createRuntimeManifest 产出的指纹）也能通过准入',async()=>{
 const {codeRoot,dataRoot}=await splitRoots();
 await writeFile(path.join(codeRoot,'code.mjs'),'export const v=1;\n');
 await writeFile(path.join(codeRoot,'app.js'),'console.log(1);\n');
 await writeFile(path.join(codeRoot,'contract.json'),'{}\n');
 await writeFile(path.join(codeRoot,'policy.json'),'{}\n');
 const manifest=await createRuntimeManifest({
  codeRoot,dataRoot,releaseId:'a2c-test',mode:'PRODUCTION',
  files:{code:['code.mjs'],frontend:['app.js'],contracts:['contract.json'],policy:['policy.json']},
 });
 assert.equal(manifest.mode,'PRODUCTION');
 await approve(manifest,dataRoot);
 const r=await assessProductionAdmission({manifest});
 assert.equal(r.admitted,true);
 assert.equal(r.approval.manifestFingerprint,manifest.fingerprint);
});

/* ── ⑦ 原因码契约 ─────────────────────────────────────────────────── */

test('所有失败原因码都能安全放进 /healthz 的 reasons',async()=>{
 const {base,codeRoot,dataRoot}=await splitRoots();
 const cases=[
  [undefined,{}],
  [fakeManifest({codeRoot,dataRoot,mode:'SHADOW'}),{}],
  [fakeManifest({codeRoot:codeRoot,dataRoot:codeRoot}),{}],
  [fakeManifest({codeRoot,dataRoot}),{}],
 ];
 for(const [manifest,extra] of cases){
  const r=await assessProductionAdmission({manifest,...extra});
  assert.equal(r.admitted,false);
  assert.ok(isAdmissionReason(r.reason),`原因码 ${r.reason} 不符合 ^[A-Z_0-9:]+$`);
 }
 // 批准过期/purpose 不符这两条也走一遍
 for(const opts of [{approvedAt:'2020-01-01T00:00:00.000Z',expiresAt:'2020-06-01T00:00:00.000Z'},{purpose:'SHADOW_BOOT'}]){
  const {codeRoot:c,dataRoot:d}=await splitRoots();
  const m=fakeManifest({codeRoot:c,dataRoot:d});
  await approve(m,d,opts);
  const r=await assessProductionAdmission({manifest:m});
  assert.equal(r.admitted,false);
  assert.ok(isAdmissionReason(r.reason),`原因码 ${r.reason} 不符合 ^[A-Z_0-9:]+$`);
 }
 assert.equal(isAdmissionReason(''),false);
 assert.equal(isAdmissionReason('lower case'),false);
 assert.equal(isAdmissionReason(42),false);
});

/* ── ⑧ 与 createMainRuntimeInfo 的联动（生产模式）───────────────────── */

const MANIFEST_FILES=[
 'dist/src/server.js','listing-agent/src/agent-client.js','listing-agent/package.json',
 'package.json','package-lock.json','public/index.html','schemas/contract.json',
 'prompts/core.md','config/ceo-capabilities.v1.json',
];

/** 造一份"完整代码根 + 空数据根"，两目录分离。 */
async function completeRoots({omit=[]}={}){
 const base=await mkdtemp(path.join(os.tmpdir(),'admission-e2e-'));
 const codeRoot=path.join(base,'code'),dataRoot=path.join(base,'data');
 await mkdir(codeRoot,{recursive:true});await mkdir(dataRoot,{recursive:true});
 for(const relative of MANIFEST_FILES){
  if(omit.includes(relative))continue;
  const file=path.join(codeRoot,relative);
  await mkdir(path.dirname(file),{recursive:true});
  await writeFile(file,`// ${relative}\n`);
 }
 return{base,codeRoot,dataRoot};
}

test('生产模式：双根齐全 + PRODUCTION_READINESS 批准 → 就绪且 mode 如实报 PRODUCTION',async()=>{
 const {codeRoot,dataRoot}=await completeRoots();
 // 两阶段引导不可避免：指纹覆盖了 mode，所以生产清单的指纹只能在「按生产形态构建一次」之后拿到。
 // 这也顺带证明了影子批准无法顺延给生产（见下一条用例）。
 const probe=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod',mode:'PRODUCTION'});
 assert.equal(probe.admission.admitted,false);
 assert.equal(probe.admission.reason,'BINDING_APPROVAL_MISSING');
 await approve(probe.manifest,dataRoot,{purpose:PRODUCTION_APPROVAL_PURPOSE});
 const info=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod',mode:'PRODUCTION'});
 assert.equal(info.admission.admitted,true);
 assert.equal(info.binding.confirmed,true);
 const health=await info.health();
 assert.equal(health.mode,'PRODUCTION');
 assert.equal(health.ready,true,JSON.stringify(health.reasons));
 assert.deepEqual(health.reasons,[]);
});

// 指纹把 mode 也算进去，因此"给影子签的批准"在字节层面就绑不到生产清单上。
// 这一条是准入与绑定两层叠加后才有的保证，单独测任一层都测不出来。
test('生产模式：针对 SHADOW 清单签发的批准不能顺延给生产清单',async()=>{
 const {codeRoot,dataRoot}=await completeRoots();
 const shadow=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod'}); // 默认 SHADOW
 assert.equal(shadow.manifest.mode,'SHADOW');
 await approve(shadow.manifest,dataRoot,{purpose:PRODUCTION_APPROVAL_PURPOSE});
 const prod=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod',mode:'PRODUCTION'});
 assert.notEqual(prod.manifest.fingerprint,shadow.manifest.fingerprint);
 assert.equal(prod.admission.admitted,false);
 assert.equal(prod.admission.reason,'BINDING_FINGERPRINT_MISMATCH');
});

test('生产模式：缺批准记录 → 不准入，health 报出具体 BINDING_* 原因',async()=>{
 const {codeRoot,dataRoot}=await completeRoots();
 const info=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod',mode:'PRODUCTION'});
 assert.equal(info.admission.admitted,false);
 assert.equal(info.admission.reason,'BINDING_APPROVAL_MISSING');
 const health=await info.health();
 assert.equal(health.ready,false);
 assert.ok(health.reasons.includes('BINDING_APPROVAL_MISSING'),JSON.stringify(health.reasons));
});

// 对应真实发现：F:\yikuaborder-run 结构上是双根，但缺 config/ceo-capabilities.v1.json，
// 所以它不是一份完整代码根。生产模式必须当场拒绝，而不是"少个文件照样跑"。
test('生产模式：代码根缺 policy 文件 → 抛 PRODUCTION_ADMISSION_DENIED:RUNTIME_MANIFEST_UNAVAILABLE',async()=>{
 const {codeRoot,dataRoot}=await completeRoots({omit:['config/ceo-capabilities.v1.json']});
 await assert.rejects(
  ()=>createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-prod',mode:'PRODUCTION'}),
  (error)=>{
   assert.equal(error.code,'PRODUCTION_ADMISSION_DENIED');
   assert.equal(error.reason,'RUNTIME_MANIFEST_UNAVAILABLE');
   assert.match(error.message,/PRODUCTION_ADMISSION_DENIED:RUNTIME_MANIFEST_UNAVAILABLE:/);
   return true;
  },
 );
});

test('生产模式：单根部署在清单层就被挡住，且原因码沿用 PRODUCTION_REQUIRES_SPLIT_ROOTS',async()=>{
 const {base}=await completeRoots();
 const same=path.join(base,'code'); // 代码根 = 数据根
 await assert.rejects(
  ()=>createMainRuntimeInfo({codeRoot:same,dataRoot:same,releaseId:'rel-prod',mode:'PRODUCTION'}),
  (error)=>{
   // 同一个条件（部署形态不是双根）在准入层和清单层必须给出同一个原因码，
   // 否则运维得同时认两套词汇。原始 CODE_DATA_OVERLAP 保留在 cause 里供排查。
   assert.equal(error.code,'PRODUCTION_ADMISSION_DENIED');
   assert.equal(error.reason,'PRODUCTION_REQUIRES_SPLIT_ROOTS');
   assert.equal(error.cause,'CODE_DATA_OVERLAP');
   return true;
  },
 );
});

test('默认 SHADOW 路径不产生 admission，且行为与改造前一致',async()=>{
 const {codeRoot,dataRoot}=await completeRoots();
 const info=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'rel-1'});
 assert.equal(info.admission,null);
 assert.equal(info.manifest.mode,'SHADOW');
 assert.equal(info.binding.confirmed,false);
 assert.equal(info.binding.reason,'BINDING_APPROVAL_MISSING');
 const health=await info.health();
 assert.equal(health.mode,'SHADOW');
 assert.equal(health.ready,false);
});
