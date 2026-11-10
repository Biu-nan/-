import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('real main entry uses code-bound frontend and pure health; governed writes preserve the original Human handler only in fixtures',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'g1-main-entry-'));
 await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 await writeFile(path.join(root,'synthetic-principals.json'),JSON.stringify({legacy:{id:'fixture-legacy',profile:'legacy',storeId:'400370',token:'l'.repeat(48)},human:{id:'fixture-human',role:'owner',profile:'human',storeId:'400370',token:'h'.repeat(48)}}));
 const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url))],{cwd:root,env:{...process.env,USER_DATA_DIR:root,PORT:String(port),HOST:'127.0.0.1',CEO_G1_FIXTURE_ROOT:root,CEO_RELEASE_ID:'g1-main-test'},windowsHide:true});
 let errors='';child.stderr.on('data',d=>errors+=d);child.stdout.resume();
 t.after(()=>new Promise(resolve=>{if(child.exitCode!==null){resolve();return;}child.once('exit',resolve);child.kill('SIGTERM');}));
 const base='http://127.0.0.1:'+port;let version;
 for(let n=0;n<200;n++){
  if(child.exitCode!==null)assert.fail('synthetic main entry exited: '+errors.slice(-1000));
  try{const r=await fetch(base+'/api/version');if(r.ok){version=await r.json();break;}}catch{}
  await new Promise(r=>setTimeout(r,25));
 }
 assert.ok(version,'synthetic entry must start');assert.equal(version.releaseId,'g1-main-test');assert.match(version.fingerprint,/^[a-f0-9]{64}$/);
 const before=await readFile(path.join(root,'run-state.json'),'utf8');
 const duplicate=spawn(process.execPath,[fileURLToPath(new URL('../src/server.js',import.meta.url))],{cwd:root,env:{...process.env,USER_DATA_DIR:root,PORT:'0',HOST:'127.0.0.1',CEO_G1_FIXTURE_ROOT:root,CEO_RELEASE_ID:'g1-main-test'},windowsHide:true});duplicate.stdout.resume();let duplicateError='';duplicate.stderr.on('data',d=>duplicateError+=d);
 const duplicateResult=await Promise.race([once(duplicate,'exit').then(([code])=>({code})),new Promise(r=>setTimeout(()=>r({alive:true}),10000))]);
 if(duplicateResult.alive){duplicate.kill('SIGTERM');await once(duplicate,'exit');}
 assert.equal(duplicateResult.code,1,'second main entry must fail before starting or rewriting fixture state');assert.match(duplicateError,/INSTANCE_ALREADY_RUNNING/);
 assert.equal(await readFile(path.join(root,'run-state.json'),'utf8'),before);
 assert.equal((await fetch(base+'/healthz')).status,503,'unconfirmed formal binding must not become ready');assert.equal(await readFile(path.join(root,'run-state.json'),'utf8'),before);
 const asset=await fetch(base+'/ceo-command-center.js');assert.equal(asset.status,200);assert.equal(await asset.text(),await readFile(new URL('../../public/ceo-command-center.js',import.meta.url),'utf8'));
 const call=(token,id,storeId='400370')=>fetch(base+'/api/agent/status',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({operationId:id,storeId,status:'ready'})});
 assert.equal((await call('l'.repeat(48),'legacy')).status,403);
 assert.equal((await call('h'.repeat(48),'human')).status,200);
 assert.equal((await call('h'.repeat(48),'human')).status,409);
 assert.equal((await call('h'.repeat(48),'cross','400371')).status,403);
 assert.equal(JSON.parse(await readFile(path.join(root,'.agent/STATE.json'),'utf8')).status,'ready');
 assert.ok(!(await readdir(root)).some(n=>n.endsWith('.sqlite')),'health must not create a Taskboard database');
});
