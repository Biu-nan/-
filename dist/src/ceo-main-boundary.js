import {readFileSync,realpathSync,statSync} from 'node:fs';
import path from 'node:path';
import {createCeoGovernance,createCeoGateway} from './ceo-governance.js';
import {readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRuntimeManifest} from './ceo-runtime-manifest.js';
import {runtimeHealth} from './ceo-runtime-host.js';
import {verifyBindingApproval} from './ceo-binding-approval.js';
import {assessProductionAdmission} from './ceo-production-admission.js';

export function requireG1FixtureRoot({fixtureRoot,dataRoot,projectRoot}){
 if(!fixtureRoot||!path.isAbsolute(fixtureRoot)||realpathSync(fixtureRoot)!==realpathSync(dataRoot))throw Error('G1_DEPLOYMENT_NOT_APPROVED');
 if(projectRoot!==undefined&&realpathSync(projectRoot)!==realpathSync(fixtureRoot))throw Error('G1_DEPLOYMENT_NOT_APPROVED');
 const root=realpathSync(fixtureRoot),file=path.join(root,'.ceo-isolated-fixture.json');
 if(path.dirname(realpathSync(file))!==root||statSync(file).size>1024||JSON.parse(readFileSync(file,'utf8')).synthetic!==true)throw Error('ISOLATED_FIXTURE_REQUIRED');
 return root;
}

export function requireG1FixturePath(file,fixtureRoot){
 const root=requireG1FixtureRoot({fixtureRoot,dataRoot:fixtureRoot}),target=path.resolve(file);
 const within=p=>{const rel=path.relative(root,p);return rel!==''&&!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);};
 if(!within(target))throw Error('G1_DEPLOYMENT_NOT_APPROVED');
 let existing=target;
 while(true){try{if(realpathSync(existing)!==root&&!within(realpathSync(existing)))throw Error('G1_DEPLOYMENT_NOT_APPROVED');break;}catch(e){if(e.code!=='ENOENT')throw e;existing=path.dirname(existing);}}
 return target;
}

/** No credentials are discovered. Only explicitly marked, local synthetic fixture principals can be loaded in G1. */
export function installCeoMainBoundary(app,{fixtureRoot=null}={}){
 let credentials={},isolated=false;
 if(fixtureRoot!==null){
  if(!path.isAbsolute(fixtureRoot))throw Error('ISOLATED_FIXTURE_REQUIRED');
  const root=realpathSync(fixtureRoot),marker=path.join(root,'.ceo-isolated-fixture.json'),principals=path.join(root,'synthetic-principals.json');
  for(const file of [marker,principals]){const resolved=realpathSync(file);if(path.dirname(resolved)!==root||statSync(file).size>16384)throw Error('ISOLATED_FIXTURE_REQUIRED');}
  if(JSON.parse(readFileSync(marker,'utf8')).synthetic!==true)throw Error('ISOLATED_FIXTURE_REQUIRED');
  credentials=JSON.parse(readFileSync(principals,'utf8'));
  if(Object.values(credentials).some(p=>!p.id?.startsWith('fixture-')))throw Error('SYNTHETIC_PRINCIPALS_REQUIRED');
  isolated=true;
 }
 const governance=createCeoGovernance({credentials,allowIsolatedHumanManual:isolated});
 const gateway=createCeoGateway({governance,resolveOperation:(req,pathname)=>{
  // G1 preserves only local fixture operations. Registered real executors are still forbidden.
  const localOnly=(req.method==='POST'&&/^\/api\/agent\/(?:status|claim|report|intake-task)$/i.test(pathname))||(req.method==='GET'&&/^\/api\/(?:status|events|action-log|today-dashboard)$/i.test(pathname));
  const registered=app._router?.stack.some(layer=>layer.route&&layer.route.methods[req.method.toLowerCase()]&&layer.regexp.test(pathname));
  return registered&&isolated&&localOnly?'human.manual':null;
 }});
 app.use((req,res,next)=>{const pathname=new URL(req.originalUrl??req.url,'http://localhost').pathname;if(/^\/api(?:\/|$)/i.test(pathname))gateway(req,res,next);else next();});
 return Object.freeze({policyVersion:governance.policyVersion,credentialSource:isolated?'SYNTHETIC_FIXTURE_ONLY':'NONE',productionIdentityMigration:false});
}

export async function createMainRuntimeInfo({codeRoot,dataRoot,releaseId='g1-unreleased',instanceId=randomUUID(),startedAt=new Date().toISOString(),bindingApprovalPath=null,mode='SHADOW',now=new Date()}={}){
 async function list(directory,extensions){
  const result=[];
  async function visit(relative){for(const entry of await readdir(path.join(codeRoot,relative),{withFileTypes:true})){const name=relative+'/'+entry.name;if(entry.isDirectory())await visit(name);else if(entry.isFile()&&extensions.some(ext=>name.endsWith(ext)))result.push(name);}}
  await visit(directory);return result.sort();
 }
 const files={code:[...await list('dist/src',['.js']),...await list('listing-agent/src',['.js']),'listing-agent/package.json','package.json','package-lock.json'],frontend:await list('public',['.js','.css','.html']),contracts:[...await list('schemas',['.json']),...await list('prompts',['.md'])],policy:['config/ceo-capabilities.v1.json']};
 let manifest;
 try{manifest=await createRuntimeManifest({codeRoot,dataRoot,releaseId,mode,storeId:'400370',files});}
 catch(error){
  // 默认路径（SHADOW）原样抛出，保持既有行为逐字节不变。
  if(mode!=='PRODUCTION')throw error;
  // 生产模式下「清单都构建不出来」本身就是一次准入拒绝，而不是启动顺序问题。
  // 这不是假想：F:\yikuaborder-run 缺 config/ceo-capabilities.v1.json（policy 组是硬要求），
  // 于是它结构上是双根、实质不是一份完整代码根 —— 准入必须能如实报出这一点。
  // CODE_DATA_OVERLAP 单独映射：它和准入层的 PRODUCTION_REQUIRES_SPLIT_ROOTS 是同一件事
  // （部署形态不对），同一个条件就该用同一个原因码，否则运维要背两套词汇。
  const reason=error?.code==='CODE_DATA_OVERLAP'?'PRODUCTION_REQUIRES_SPLIT_ROOTS':'RUNTIME_MANIFEST_UNAVAILABLE';
  throw Object.assign(new Error(`PRODUCTION_ADMISSION_DENIED:${reason}:${error?.code??'UNKNOWN'}`),{code:'PRODUCTION_ADMISSION_DENIED',reason,cause:error?.code??null});
 }
 const identity={pid:process.pid,entryPath:path.join(codeRoot,'dist/src/server.js'),instanceId,releaseId,startedAt};
 // 绑定确认不再是写死的 false，而是从一份可审计的批准记录派生（见 ceo-binding-approval.js）。
 // 默认路径 <dataRoot>/.ceo-binding-approval.json；文件不存在 = 未批准 = fail-closed，
 // 且 /healthz 会明确报 BINDING_APPROVAL_MISSING 而不是笼统的 BINDING_UNCONFIRMED。
 // 生产模式（A2c）走的是更严的一层：admission 在 binding 之外还要求双根、非合成夹具、
 // 且 purpose 必须是 PRODUCTION_READINESS（见 ceo-production-admission.js）。
 // 两者共用 runtimeHealth 的 bindingConfirmed/bindingReason 两个入参，因此健康响应结构不变。
 let binding,admission=null,bindingConfirmed,bindingReason;
 if(mode==='PRODUCTION'){
  admission=await assessProductionAdmission({manifest,approvalPath:bindingApprovalPath,now});
  bindingConfirmed=admission.admitted;
  bindingReason=admission.reason;
  binding=Object.freeze({confirmed:admission.admitted,reason:admission.reason,approval:admission.approval,path:null});
 }else{
  binding=await verifyBindingApproval({manifest,approvalPath:bindingApprovalPath});
  bindingConfirmed=binding.confirmed;
  bindingReason=binding.reason;
 }
 return Object.freeze({manifest,identity,binding,admission,health:()=>runtimeHealth({manifest,identity,bindingConfirmed,bindingReason,dependencies:[]})});
}
