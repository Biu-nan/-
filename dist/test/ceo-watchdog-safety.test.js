import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('G1 watchdog refuses unconfigured startup before probing or killing any existing port',async()=>{
 const entry=fileURLToPath(new URL('../../watchdog.js',import.meta.url));
 const result=await new Promise(resolve=>{const env={...process.env};delete env.CEO_G1_FIXTURE_ROOT;const c=spawn(process.execPath,[entry],{env,windowsHide:true});let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);c.on('close',code=>resolve({code,out,err}));});
 assert.equal(result.code,1);assert.match(result.err,/G1_FIXTURE_REQUIRED/);assert.doesNotMatch(result.out,/拉起|终止|restart|started/i);
});
