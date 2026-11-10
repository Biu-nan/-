import {realpathSync,readdirSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);};

// Capture before awaited loaders; recheck synchronously inside the SQLite commit.
export function captureCeoReviewInputs({projectRoot}){
 const root=realpathSync(projectRoot);
 function read(relative,limit,boundary=root){
  const full=realpathSync(path.join(root,relative));if(!inside(boundary,full))fail('REVIEW_SOURCE_UNAVAILABLE');
  const fd=openSync(full,'r');try{const info=fstatSync(fd);if(!info.isFile()||info.size>limit)fail('REVIEW_SOURCE_UNAVAILABLE');const bytes=Buffer.alloc(limit+1);let n=0;while(n<bytes.length){const got=readSync(fd,bytes,n,bytes.length-n,null);if(!got)break;n+=got;}if(n>limit)fail('REVIEW_SOURCE_UNAVAILABLE');return{full,bytes:bytes.subarray(0,n)};}finally{closeSync(fd);}
 }
 function contextSignature(){
  try{
   const rows=[];for(const [name,limit] of [['config/ceo-store-400370.json',65536],['config/metrics-schema.json',1048576]]){const r=read(name,limit);rows.push([name,r.full,hash(r.bytes)]);}
   const relative='data/metrics/facts/aliexpress';let names=[];
   try{const dir=realpathSync(path.join(root,relative));if(!inside(root,dir))fail('CONTEXT_CHANGED');names=readdirSync(dir).filter(n=>n.endsWith('.jsonl')).sort();}catch(e){if(e.code!=='ENOENT')throw e;}
   if(names.length>100)fail('CONTEXT_CHANGED');let total=0;
   for(const name of names){const r=read(relative+'/'+name,1048576);total+=r.bytes.length;if(total>5*1048576)fail('CONTEXT_CHANGED');rows.push([name,r.full,hash(r.bytes)]);}
   return hash(JSON.stringify(rows));
  }catch{fail('CONTEXT_CHANGED');}
 }
 function briefSignature(){
  try{
   const data=realpathSync(path.join(root,'data'));if(!inside(root,data))fail('REVIEW_SOURCE_UNAVAILABLE');
   const manifest=read('data/ceo-operating/brief-manifest.json',8192,data),parsed=JSON.parse(manifest.bytes.toString('utf8')),rows=[[manifest.full,hash(manifest.bytes)]];
   for(const key of ['baseline','plan']){const relative=parsed.sources?.[key]?.path;if(typeof relative!=='string'||relative.length>500||!relative.startsWith('data/')||!relative.endsWith('.json')||relative.includes('\\')||path.isAbsolute(relative)||path.win32.isAbsolute(relative)||relative.split('/').some(p=>p==='..'||p==='.'))fail('REVIEW_SOURCE_UNAVAILABLE');const r=read(relative,262144,data);rows.push([relative,r.full,hash(r.bytes)]);}
   return hash(JSON.stringify(rows));
  }catch{fail('REVIEW_SOURCE_UNAVAILABLE');}
 }
 const context=contextSignature(),brief=briefSignature();
 return()=>{if(contextSignature()!==context)fail('CONTEXT_CHANGED');let current;try{current=briefSignature();}catch{fail('REVIEW_SOURCE_CHANGED');}if(current!==brief)fail('REVIEW_SOURCE_CHANGED');};
}
