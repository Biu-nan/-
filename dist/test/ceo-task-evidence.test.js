import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
const module=await import('../src/ceo-task-evidence.js').catch(()=>({}));
const sha=s=>createHash('sha256').update(s).digest('hex');
async function setup(t){const root=await mkdtemp(path.join(os.tmpdir(),'ceo-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));const dir=path.join(root,'data','ceo-audits','2026-10-28-store-400370');await mkdir(dir,{recursive:true});const file=path.join(dir,'proof.json');await writeFile(file,'proof');const task={taskId:'store-400370-test',version:5,receipt:{outcome:'REPORTED',evidence:[{reference:path.relative(root,file),sha256:sha('proof'),summary:'合成证据'}]}};return{root,dir,file,task,check:()=>{assert.equal(typeof module.checkCeoTaskEvidence,'function');return module.checkCeoTaskEvidence({projectRoot:root,task});}};}
test('check binds task receipt and actual bytes without exposing contents; timestamp does not change ID',async t=>{
 const x=await setup(t),a=x.check(),b=x.check();assert.equal(a.status,'MATCH');assert.equal(a.checkId,b.checkId);assert.equal(a.files[0].actualSha256,sha('proof'));assert.equal(a.files[0].bytes,5);assert.equal(a.readOnly,true);assert.ok(!JSON.stringify(a).includes('"content"'));
 x.task.version++;assert.notEqual(x.check().checkId,a.checkId);x.task.version--;x.task.receipt.summary='changed';assert.notEqual(x.check().checkId,a.checkId);
 await writeFile(x.file,'changed');assert.equal(x.check().files[0].status,'MISMATCH');await rm(x.file);assert.equal(x.check().files[0].status,'MISSING');
});
test('refuses unscoped, cross-store, URL, UNC, drive alias, traversal and escaped references',async t=>{
 const x=await setup(t);for(const ref of ['https://example.test/proof','local-audit:test','//server/share/file','\\\\server\\share\\file','data/../data/ceo-audits/2026-10-28-store-400370/proof.json','data/ceo-audits/2026-10-28-store-400371/proof.json','data/ceo-audits/2026-10-28-store-4003700/proof.json','config/private.json','C:relative-file']){x.task.receipt.evidence[0].reference=ref;assert.equal(x.check().files[0].status,'UNSUPPORTED_REFERENCE',ref);}
 x.task.receipt.evidence=[];assert.equal(x.check().status,'NO_EVIDENCE');
});
test('bounded file and aggregate reads fail closed and normal check remains usable',async t=>{
 const x=await setup(t);await writeFile(x.file,Buffer.alloc(10*1024*1024+1));assert.equal(x.check().files[0].status,'TOO_LARGE');
 await writeFile(x.file,Buffer.alloc(9*1024*1024));x.task.receipt.evidence=Array.from({length:4},()=>({...x.task.receipt.evidence[0]}));assert.equal(x.check().files[3].status,'TOTAL_LIMIT');
 await writeFile(x.file,'proof');x.task.receipt.evidence=x.task.receipt.evidence.slice(0,1);assert.equal(x.check().status,'MATCH');
});
test('junction or symlink to another directory is never followed',async t=>{
 const x=await setup(t),outside=path.join(x.root,'elsewhere');await mkdir(outside);await writeFile(path.join(outside,'proof.json'),'secret');await symlink(outside,path.join(x.dir,'link'),process.platform==='win32'?'junction':'dir');x.task.receipt.evidence[0].reference=path.relative(x.root,path.join(x.dir,'link','proof.json'));assert.equal(x.check().files[0].status,'UNSUPPORTED_REFERENCE');
});
test('growing input is bounded at limit plus one byte and fd is closed on failure',async t=>{
 const x=await setup(t),originalRead=fs.readSync,originalClose=fs.closeSync;let bytes=0,closed=0,first=true,readerFd;
 t.mock.method(fs,'readSync',(...args)=>{readerFd=args[0];if(first){first=false;fs.appendFileSync(x.file,Buffer.alloc(11*1024*1024));}const n=originalRead(...args);bytes+=n;return n;});t.mock.method(fs,'closeSync',(...args)=>{if(args[0]===readerFd)closed++;return originalClose(...args);});
 assert.equal(x.check().files[0].status,'TOO_LARGE');assert.ok(bytes<=10*1024*1024+1);assert.equal(closed,1);
});
test('nested foreign store scope cannot be disguised by a second store marker',async t=>{
 const x=await setup(t),nested=path.join(x.root,'data','store-400371','store-400370');await mkdir(nested,{recursive:true});await writeFile(path.join(nested,'proof'),'private');x.task.receipt.evidence[0].reference=path.relative(x.root,path.join(nested,'proof'));assert.equal(x.check().files[0].status,'UNSUPPORTED_REFERENCE');
});
test('file names cannot impersonate a store-scoped parent directory',async t=>{
 const x=await setup(t),dir=path.join(x.root,'data','shared');await mkdir(dir);
 for(const name of ['store-400370-proof.json','store-400370']){const file=path.join(dir,name);await writeFile(file,'proof');x.task.receipt.evidence[0].reference=path.relative(x.root,file);assert.equal(x.check().files[0].status,'UNSUPPORTED_REFERENCE');}
});
test('replacing a parent between path check and open cannot bind an outside fd to the original path',async t=>{
 const x=await setup(t),outside=path.join(x.root,'outside-proof');await writeFile(outside,'outside');x.task.receipt.evidence[0].sha256=sha('outside');
 const open=fs.openSync,close=fs.closeSync;let externalFd,closed=false;
 // Deterministic model of a junction swap at open, restored before the next path lookup.
 t.mock.method(fs,'openSync',(file,...args)=>{externalFd=open(outside,...args);return externalFd;});t.mock.method(fs,'closeSync',(fd,...args)=>{if(fd===externalFd)closed=true;return close(fd,...args);});
 assert.equal(x.check().files[0].status,'CHANGED_DURING_READ');assert.equal(closed,true);
});
