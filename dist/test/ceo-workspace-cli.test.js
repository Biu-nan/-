import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const cliUrl=new URL('../../scripts/ceo-workspace.mjs',import.meta.url),cli=fileURLToPath(cliUrl);
const config=await readFile(new URL('../../config/ceo-store-400370.json',import.meta.url),'utf8');
const example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
const run=args=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,NODE_NO_WARNINGS:'1',...(args.includes('--root')?{CEO_G1_FIXTURE_ROOT:args[args.indexOf('--root')+1]}:{})}});
async function setup(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'ceo-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'config'));
 await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 await writeFile(path.join(root,'config/ceo-store-400370.json'),config);await writeFile(path.join(root,'config/metrics-schema.json'),'{"calibers":{}}');
 const input=path.join(root,'input.json'),db=path.join(root,'draft.sqlite');
 const value={decision:structuredClone(example.decision),candidates:example.candidates};value.decision.reviewAt=new Date(Date.now()+86400000).toISOString();
 await writeFile(input,JSON.stringify(value));return{root,input,db,value};
}
test('inspect is read only and produces the host goal with quarantined facts',async t=>{
 const x=await setup(t),before=await readdir(x.root);const r=run([cli,'inspect','--root',x.root]);
 assert.equal(r.status,0,r.stderr);const c=JSON.parse(r.stdout);assert.equal(c.goal.capacityMinutes,null);assert.deepEqual(c.facts,[]);
 assert.deepEqual(await readdir(x.root),before);
});
test('save-draft persists once using the inspected host context',async t=>{
 const x=await setup(t),c=JSON.parse(run([cli,'inspect','--root',x.root]).stdout),before=await readFile(x.input,'utf8');
 const args=[cli,'save-draft','--root',x.root,'--db',x.db,'--input',x.input,'--expected-context',c.contextId];
 const a=run(args),b=run(args);assert.equal(a.status,0,a.stderr);assert.equal(b.status,0,b.stderr);
 assert.equal(JSON.parse(a.stdout).created,true);assert.equal(JSON.parse(b.stdout).created,false);
 assert.equal(await readFile(x.input,'utf8'),before);
});
test('agent cannot supply goal facts or clock in draft input',async t=>{
 const x=await setup(t),c=JSON.parse(run([cli,'inspect','--root',x.root]).stdout);
 for(const key of ['goal','facts','now']){
  await writeFile(x.input,JSON.stringify({...x.value,[key]:{private:'secret'}}));
  const r=run([cli,'save-draft','--root',x.root,'--db',x.db,'--input',x.input,'--expected-context',c.contextId]);
  assert.equal(r.status,1);assert.match(r.stderr,/INVALID_INPUT/);assert.doesNotMatch(r.stderr,/secret/);
 }
});
test('stale context is rejected before opening database',async t=>{
 const x=await setup(t),r=run([cli,'save-draft','--root',x.root,'--db',x.db,'--input',x.input,'--expected-context','stale']);
 assert.equal(r.status,1);assert.match(r.stderr,/CONTEXT_CHANGED/);assert.ok(!(await readdir(x.root)).includes('draft.sqlite'));
});
test('CLI imports inertly and errors do not echo raw data',async t=>{
 const imported=run(['--input-type=module','-e',`await import(${JSON.stringify(cliUrl.href)});console.log('OK')`]);
 assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout.trim(),'OK');
 const r=run([cli,'private-sensitive-invalid']);assert.equal(r.status,1);assert.doesNotMatch(r.stderr,/private-sensitive|Error:|at /);
});
