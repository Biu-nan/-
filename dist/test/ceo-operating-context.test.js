import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const url = new URL('../src/ceo-operating-context.js', import.meta.url);
const example = JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json', import.meta.url), 'utf8'));
export async function project(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ceo-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'config'), { recursive: true });
  await mkdir(path.join(root, 'data/metrics/facts/aliexpress'), { recursive: true });
  const config = { schema: 'ceo-store-config/v1', goal: example.goal,
    resourceProposal: { status: 'PROPOSED_SCENARIO', operators: 1, capacityMinutes: 120, bufferMinutes: 30, basis: 'Initial estimate, not confirmed availability' } };
  await writeFile(path.join(root, 'config/ceo-store-400370.json'), JSON.stringify(config));
  await writeFile(path.join(root, 'config/metrics-schema.json'), JSON.stringify({version:'1',calibers:{'sales.qty.total':{unit:'件'},'sales.amount.net':{unit:'CNY'}}}));
  return root;
}
const row = (extra={}) => ({source:'aliexpress',storeId:'env:400370',caliber:'sales.qty.total',subject:'STORE',window:'7d',statDate:'2026-10-25',value:415,capturedAt:'2026-10-25T07:03:32Z',...extra});
const file = root => path.join(root,'data/metrics/facts/aliexpress/2026-10-25.jsonl');
const rows = (root, data) => writeFile(file(root), data.map(r=>JSON.stringify(r)).join('\n')+'\n');
const load = async root => (await import(url)).loadCeoOperatingContext({projectRoot:root,now:new Date('2026-10-26T09:00:00Z')});

test('controlled goal retains confirmed targets and separates proposed from actual capacity',async t=>{
 const root=await project(t), c=await load(root);
 assert.equal(c.goal.targets[0].value,200);assert.equal(c.goal.targets[1].value,12000);
 assert.equal(c.goal.capacityMinutes,null);assert.equal(c.resourceProposal.capacityMinutes,120);
 assert.equal(c.resourceProposal.status,'PROPOSED_SCENARIO');assert.deepEqual(c.facts,[]);
 assert.ok(c.gaps.includes('NO_LOCAL_FACTS'));assert.ok(c.gaps.includes('CAPACITY_UNCONFIRMED'));
});
test('missing source directory is explicit and does not create it',async t=>{
 const root=await project(t);await rm(path.join(root,'data'),{recursive:true});
 const c=await load(root);assert.ok(c.gaps.includes('NO_LOCAL_FACTS'));
 await assert.rejects(readFile(file(root)),{code:'ENOENT'});
});
test('historical observations are quarantined and cite exact file hash and line',async t=>{
 const root=await project(t);await rows(root,[row(),row({storeId:'env:other'})]);
 const c=await load(root);assert.equal(c.observations.length,1);assert.deepEqual(c.facts,[]);
 assert.equal(c.observations[0].value,415);assert.equal(c.observations[0].quality,'PENDING_VERIFICATION');
 assert.equal(c.observations[0].provenance.line,1);
 assert.equal(c.sourceManifest[0].sha256,createHash('sha256').update(await readFile(file(root))).digest('hex'));
 assert.ok(c.gaps.includes('PERIOD_AND_COVERAGE_UNVERIFIED'));
});
test('same files at a different load time keep context identity',async t=>{
 const root=await project(t);await rows(root,[row()]);const a=await load(root);
 const b=await(await import(url)).loadCeoOperatingContext({projectRoot:root,now:new Date('2026-10-27T09:00:00Z')});
 assert.equal(a.contextId,b.contextId);assert.notEqual(a.loadedAt,b.loadedAt);
});
test('crossing capture time changes diagnostic only, never immutable context identity',async t=>{
 const root=await project(t);await rows(root,[row({capturedAt:'2026-10-26T09:00:01Z'})]);
 const module=await import(url);
 const before=await module.loadCeoOperatingContext({projectRoot:root,now:new Date('2026-10-26T09:00:00Z')});
 const after=await module.loadCeoOperatingContext({projectRoot:root,now:new Date('2026-10-26T09:00:02Z')});
 assert.ok(before.observations[0].issues.includes('CAPTURE_FROM_FUTURE'));
 assert.ok(!after.observations[0].issues.includes('CAPTURE_FROM_FUTURE'));
 assert.equal(before.contextId,after.contextId);
});
test('source bytes or metric dictionary changes invalidate context identity',async t=>{
 const root=await project(t);await rows(root,[row()]);const a=await load(root);
 await rows(root,[row({value:416})]);const b=await load(root);assert.notEqual(a.contextId,b.contextId);
 await writeFile(path.join(root,'config/metrics-schema.json'),JSON.stringify({version:'2',calibers:{'sales.qty.total':{unit:'件'}}}));
 assert.notEqual(b.contextId,(await load(root)).contextId);
});
test('last increasing revision is preserved without treating it as verified',async t=>{
 const root=await project(t);await rows(root,[row(),row({value:416,revision:2})]);
 const c=await load(root);assert.equal(c.observations.length,1);assert.equal(c.observations[0].value,416);
 assert.equal(c.observations[0].revision,2);assert.equal(c.observations[0].provenance.line,2);
});
test('same revision different content and regressing revisions are conflicts',async t=>{
 const root=await project(t);await rows(root,[row({revision:2}),row({value:416,revision:2}),row({revision:1})]);
 const c=await load(root);assert.ok(c.gaps.includes('SOURCE_REVISION_CONFLICT'));
 assert.ok(c.observations[0].issues.includes('SOURCE_REVISION_CONFLICT'));assert.deepEqual(c.facts,[]);
});
test('unknown caliber and future capture remain unusable with explicit reasons',async t=>{
 const root=await project(t);await rows(root,[row({caliber:'unregistered',capturedAt:'2099-01-01T00:00:00Z'})]);
 const c=await load(root);assert.ok(c.observations[0].issues.includes('UNKNOWN_CALIBER'));
 assert.ok(c.observations[0].issues.includes('CAPTURE_FROM_FUTURE'));
});
test('bad JSONL fails closed without revealing raw text',async t=>{
 const root=await project(t);await writeFile(file(root),'private-secret-not-json\n');
 await assert.rejects(load(root),e=>e.code==='INVALID_SOURCE'&&!e.message.includes('private-secret'));
});
test('oversized source file is rejected',async t=>{
 const root=await project(t);await writeFile(file(root),' '.repeat(1024*1024+1));
 await assert.rejects(load(root),{code:'SOURCE_LIMIT'});
});
test('source symlink outside project is rejected',async t=>{
 const root=await project(t);await rows(root,[row()]);
 const other=await mkdtemp(path.join(os.tmpdir(),'ceo-outside-'));t.after(()=>rm(other,{recursive:true,force:true}));
 await rm(path.join(root,'data/metrics/facts/aliexpress'),{recursive:true});
 await symlink(other,path.join(root,'data/metrics/facts/aliexpress'),'junction');
 await assert.rejects(load(root),{code:'UNSAFE_SOURCE'});
});
test('invalid target version or silently confirmed metric is rejected',async t=>{
 const root=await project(t), p=path.join(root,'config/ceo-store-400370.json');
 const c=JSON.parse(await readFile(p));c.goal.version=0;await writeFile(p,JSON.stringify(c));
 await assert.rejects(load(root),{code:'INVALID_CONFIG'});
});
