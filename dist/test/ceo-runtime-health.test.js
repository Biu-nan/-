import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
const api=await import('../src/ceo-runtime-host.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const manifestApi=await import('../src/ceo-runtime-manifest.js').catch(()=>({}));
async function fixture(t){
 assert.equal(typeof api.acquireRuntimeLease,'function','runtime lifecycle feature is missing');
 const root=await mkdtemp(path.join(os.tmpdir(),'runtime-')),leasePath=path.join(root,'runtime.lease.json');
 const identity={pid:process.pid,entryPath:path.resolve('dist/src/ceo-runtime-host.js'),instanceId:'fixture-1',releaseId:'fixture-r1',startedAt:'2026-11-05T00:00:00Z'};
 return{root,leasePath,identity};
}
test('two real Node processes competing for one lease cannot both own the instance',async t=>{
 const x=await fixture(t),url=new URL('../src/ceo-runtime-host.js',import.meta.url).href;
 const source=`import {acquireRuntimeLease} from ${JSON.stringify(url)};try {await acquireRuntimeLease({leasePath:process.argv[1],identity:{pid:process.pid,entryPath:process.argv[2],instanceId:process.argv[3],releaseId:'r1',startedAt:'2026-11-05T00:00:00Z'}});console.log('ACQUIRED');}catch(e){console.log(e.code);process.exitCode=2;}`;
 const run=id=>new Promise(resolve=>{const c=spawn(process.execPath,['--input-type=module','-e',source,x.leasePath,x.identity.entryPath,id],{windowsHide:true});let out='';c.stdout.on('data',d=>out+=d);c.on('close',code=>resolve({code,out}));});
 const results=await Promise.all([run('one'),run('two')]);assert.equal(results.filter(x=>x.code===0).length,1);assert.equal(results.filter(x=>x.code===2).length,1);
});
test('release never removes a lease replaced by a different owner',async t=>{
 const x=await fixture(t),lease=await api.acquireRuntimeLease(x);
 const foreign={...JSON.parse(await readFile(x.leasePath)),instanceId:'someone-else'};await writeFile(x.leasePath,JSON.stringify(foreign));
 await assert.rejects(()=>lease.release(),{code:'INSTANCE_IDENTITY_CHANGED'});assert.equal(JSON.parse(await readFile(x.leasePath)).instanceId,'someone-else');
});
test('stop validates process identity and service identity before requesting graceful shutdown',async t=>{
 const x=await fixture(t),lease=await api.acquireRuntimeLease(x);let stopped=0;
 const common={...x,readProcessIdentity:async()=>x.identity,probeIdentity:async()=>x.identity,requestStop:async()=>{stopped++;}};
 await assert.rejects(()=>api.stopOwnedRuntime({...common,readProcessIdentity:async()=>({...x.identity,pid:999})}),{code:'INSTANCE_IDENTITY_CHANGED'});
 await assert.rejects(()=>api.stopOwnedRuntime({...common,probeIdentity:async()=>({...x.identity,releaseId:'foreign'})}),{code:'INSTANCE_IDENTITY_CHANGED'});
 assert.equal(stopped,0);await api.stopOwnedRuntime(common);assert.equal(stopped,1);await lease.release();
});
test('recovery requires explicit absent process and absent listener proof; unknown is never stale',async t=>{
 const x=await fixture(t);await api.acquireRuntimeLease(x);let stopped=0;
 const identity={...x.identity,instanceId:'recovered'};
 await assert.rejects(()=>api.recoverRuntimeLease({...x,identity,confirmStale:async()=>({process:'UNKNOWN',listener:'ABSENT'})}),{code:'RECOVERY_UNVERIFIED'});
 const lease=await api.recoverRuntimeLease({...x,identity,confirmStale:async()=>({process:'ABSENT',listener:'ABSENT'})});
 assert.equal(JSON.parse(await readFile(x.leasePath)).instanceId,'recovered');assert.equal(stopped,0);await lease.release();
});
test('malformed existing lease fails closed and survives attempted recovery',async t=>{
 const x=await fixture(t);await writeFile(x.leasePath,'broken');
 await assert.rejects(()=>api.recoverRuntimeLease({...x,confirmStale:async()=>({process:'ABSENT',listener:'ABSENT'})}));assert.equal(await readFile(x.leasePath,'utf8'),'broken');
});
test('real health endpoint is read-only, unready for missing dependencies and rejects mutation methods',async t=>{
 const x=await fixture(t),codeRoot=path.join(x.root,'code'),dataRoot=path.join(x.root,'data');await mkdir(codeRoot);
 const files={code:['entry.js'],frontend:['panel.js'],contracts:['schema.json'],policy:['policy.json']};for(const f of Object.values(files).flat())await writeFile(path.join(codeRoot,f),'fixture');
 const manifest=await manifestApi.createRuntimeManifest({codeRoot,dataRoot,files,releaseId:'r1',mode:'SHADOW',storeId:'400370'});
 const server=api.createRuntimeHealthServer({manifest,identity:x.identity,bindingConfirmed:false,dependencies:[{id:'taskboard',path:path.join(dataRoot,'missing.sqlite'),kind:'file'}]});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port,before=await readdir(x.root);
 const r=await fetch(base+'/healthz'),health=await r.json();assert.equal(r.status,503);assert.equal(health.ready,false);assert.ok(health.reasons.includes('BINDING_UNCONFIRMED'));
 assert.equal((await fetch(base+'/healthz',{method:'POST'})).status,405);assert.deepEqual(await readdir(x.root),before);
 const version=await(await fetch(base+'/api/version')).json();assert.equal(version.releaseId,'r1');assert.equal(version.fingerprint,manifest.fingerprint);
});
