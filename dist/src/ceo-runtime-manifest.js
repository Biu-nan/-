import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const digest=v=>createHash('sha256').update(v).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const within=(root,p)=>{const rel=path.relative(root,p);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
const groups=['code','frontend','contracts','policy'];
function fingerprint(m){return digest(JSON.stringify({schema:m.schema,releaseId:m.releaseId,mode:m.mode,storeId:m.storeId,codeRoot:m.codeRoot,dataRoot:m.dataRoot,files:m.files}));}
function safeRelative(name){
 if(typeof name!=='string'||!name||name.includes('\\')||path.posix.isAbsolute(name)||path.win32.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..'))fail('INVALID_MANIFEST_PATH');
 if(/(?:^|\/)(?:\.env[^/]*|\.secretary-llm\.json|[^/]*(?:credentials|token|secret|private-key)[^/]*\.(?:json|pem|key|txt))$/i.test(name))fail('SENSITIVE_MANIFEST_PATH');
}
export async function createRuntimeManifest({codeRoot,dataRoot,releaseId,mode='SHADOW',storeId='400370',files}={}){
 // PRODUCTION 是 A2c 新增的合法值：生产要能如实自报身份，而不是被迫用 SHADOW 顶替
 // （否则 /api/version 会把生产说成影子，自证材料失真）。
 // 注意：允许声明 PRODUCTION 不等于允许以生产身份运行——真正的准入在
 // ceo-production-admission.js（双根 + PRODUCTION_READINESS 批准 + 指纹绑定）。
 if(typeof releaseId!=='string'||!/^[A-Za-z0-9._-]{1,100}$/.test(releaseId)||!['SHADOW','LEGACY_READ_ONLY','PRODUCTION'].includes(mode)||storeId!=='400370'||!path.isAbsolute(dataRoot??''))fail('INVALID_MANIFEST');
 const code=await realpath(codeRoot),data=path.resolve(dataRoot);
 if(code.toLowerCase()===data.toLowerCase()||within(code,data)||within(data,code))fail('CODE_DATA_OVERLAP');
 if(!files||groups.some(g=>!Array.isArray(files[g])||!files[g].length)||Object.keys(files).some(g=>!groups.includes(g)))fail('INCOMPLETE_MANIFEST');
 const entries=[],seen=new Set();
 for(const group of groups)for(const relative of [...files[group]].sort()){
  safeRelative(relative);if(seen.has(relative.toLowerCase()))fail('DUPLICATE_MANIFEST_FILE');seen.add(relative.toLowerCase());
  const file=await realpath(path.join(code,relative));if(!within(code,file))fail('UNSAFE_MANIFEST_FILE');
  const info=await stat(file);if(!info.isFile()||info.size>16*1024*1024)fail('INVALID_MANIFEST_FILE');
  const bytes=await readFile(file);if(bytes.length>16*1024*1024)fail('INVALID_MANIFEST_FILE');
  entries.push({group,path:relative,sha256:digest(bytes),bytes:bytes.length});
 }
 const m={schema:'ceo-runtime-manifest/v1',releaseId,mode,storeId,codeRoot:code,dataRoot:data,files:entries};
 return freeze({...m,fingerprint:fingerprint(m)});
}
export async function verifyRuntimeManifest(m){
 try{
  if(!m||m.schema!=='ceo-runtime-manifest/v1'||fingerprint(m)!==m.fingerprint)return{ok:false,reason:'MANIFEST_CHANGED'};
  const files=Object.fromEntries(groups.map(g=>[g,m.files.filter(f=>f.group===g).map(f=>f.path)]));
  const fresh=await createRuntimeManifest({...m,files});
  return fresh.fingerprint===m.fingerprint?{ok:true}:{ok:false,reason:'RELEASE_BYTES_CHANGED'};
 }catch{return{ok:false,reason:'RELEASE_UNAVAILABLE'};}
}
