import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../../scripts/ceo-task-loop.mjs',import.meta.url));
function run(args,entry=cli){return new Promise(resolve=>{const env={...process.env};delete env.CEO_G1_FIXTURE_ROOT;const c=spawn(process.execPath,[entry,...args],{env,windowsHide:true});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('close',code=>resolve({code,out,err}));});}
test('legacy CLI cannot initialize credentials or serve an unconfirmed binding outside an explicit fixture',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cli-safety-')),before=await readdir(root);
 for(const args of [['init-credentials','--out',path.join(root,'access')],['serve','--root',root,'--db',path.join(root,'must-not-create.sqlite'),'--credentials',path.join(root,'must-not-read.json'),'--port','0']]){
  const r=await run(args);assert.equal(r.code,1);assert.match(r.err,/G1_DEPLOYMENT_NOT_APPROVED/);assert.equal(r.out,'');
 }assert.deepEqual(await readdir(root),before);
});
test('legacy standalone draft CLI cannot open an unconfirmed database',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'draft-cli-safety-')),before=await readdir(root),entry=fileURLToPath(new URL('../../scripts/ceo-workspace.mjs',import.meta.url));
 const r=await run(['save-draft','--root',root,'--db',path.join(root,'no.sqlite'),'--input',path.join(root,'no.json'),'--expected-context','x'],entry);
 assert.equal(r.code,1);assert.match(r.err,/G1_DEPLOYMENT_NOT_APPROVED/);assert.deepEqual(await readdir(root),before);
});
