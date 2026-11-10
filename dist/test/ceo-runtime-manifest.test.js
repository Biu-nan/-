import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const api=await import('../src/ceo-runtime-manifest.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
async function setup(){
 assert.equal(typeof api.createRuntimeManifest,'function','runtime manifest feature is missing');
 const root=await mkdtemp(path.join(os.tmpdir(),'manifest-')),codeRoot=path.join(root,'code'),dataRoot=path.join(root,'data');
 const files={code:['dist/src/entry.js'],frontend:['public/panel.js'],contracts:['schemas/report.json'],policy:['config/capabilities.json']};
 for(const name of Object.values(files).flat()){await mkdir(path.dirname(path.join(codeRoot,name)),{recursive:true});await writeFile(path.join(codeRoot,name),'fixture:'+name);}
 return{root,codeRoot,dataRoot,files,releaseId:'ceo-g1-fixture',mode:'SHADOW',storeId:'400370'};
}
test('manifest binds code, frontend, contract and policy bytes without creating data directories',async()=>{
 const x=await setup(),before=await readdir(x.root),m=await api.createRuntimeManifest(x);
 assert.equal(m.schema,'ceo-runtime-manifest/v1');assert.equal(m.mode,'SHADOW');assert.equal(m.storeId,'400370');
 assert.match(m.fingerprint,/^[a-f0-9]{64}$/);assert.equal(m.files.length,4);assert.deepEqual(await readdir(x.root),before);
 assert.equal((await api.verifyRuntimeManifest(m)).ok,true);
});
for(const [group,name]of [['code','dist/src/entry.js'],['frontend','public/panel.js'],['contracts','schemas/report.json'],['policy','config/capabilities.json']]){
 test(`readiness rejects changed ${group} bytes under an unchanged release label`,async()=>{
  const x=await setup(),m=await api.createRuntimeManifest(x);await writeFile(path.join(x.codeRoot,name),'different');
  assert.equal((await api.verifyRuntimeManifest(m)).ok,false);
 });
}
test('manifest fingerprint survives caller mutation and file order changes',async()=>{
 const x=await setup(),m=await api.createRuntimeManifest(x),old=m.fingerprint;
 x.files.code.push('outside.js');assert.equal(m.files.length,4);assert.equal(m.fingerprint,old);assert.ok(Object.isFrozen(m));
 const y=await setup();y.files.code=['dist/src/entry.js','public/panel.js'];
 await assert.rejects(()=>api.createRuntimeManifest(y),{code:'DUPLICATE_MANIFEST_FILE'});
});
test('manifest rejects omitted categories, traversal, credentials and code/data root overlap',async()=>{
 const x=await setup();
 for(const patch of [{files:{...x.files,policy:[]}},{files:{...x.files,code:['../escape.js']}},{dataRoot:x.codeRoot}])await assert.rejects(()=>api.createRuntimeManifest({...x,...patch}));
 await writeFile(path.join(x.codeRoot,'config/server-credentials.json'),'synthetic-only');
 await assert.rejects(()=>api.createRuntimeManifest({...x,files:{...x.files,policy:['config/server-credentials.json']}}),{code:'SENSITIVE_MANIFEST_PATH'});
});
test('manifest rejects forged metadata even if stored file hashes still match',async()=>{
 const x=await setup(),m=await api.createRuntimeManifest(x);
 assert.equal((await api.verifyRuntimeManifest({...m,mode:'CONTROLLED'})).ok,false);
});
