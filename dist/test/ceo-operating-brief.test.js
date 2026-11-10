import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {briefFixture} from './fixtures/ceo-operating-brief-fixture.js';
const module=await import('../src/ceo-operating-brief.js').catch(()=>({}));
async function load(x,extra={}){assert.equal(typeof module.loadCeoOperatingBrief,'function','经营简报读取器尚未实现');return module.loadCeoOperatingBrief({projectRoot:x.root,context:x.context,tasks:x.tasks,now:x.now,...extra});}

test('brief projects historical/null values and joins live tasks without returning raw paths or secret fields',async t=>{
 const x=await briefFixture(t),r=await load(x);
 assert.equal(r.status,'AVAILABLE');assert.equal(r.baseline.paidUnitsTotal,28);assert.equal(r.baseline.netProfitCNY,null);
 assert.equal(r.baseline.formalTargetGap,null);assert.equal(r.baseline.sourceTimeZone,'PST');
 assert.equal(r.days[0].actions[0].liveTask.status,'PENDING_VERIFICATION');
 assert.equal(r.days[0].actions[0].liveTask.version,5);assert.equal(r.plan.isExpired,false);
 assert.equal(JSON.stringify(r).includes('NEVER_RETURN'),false);assert.equal(JSON.stringify(r).includes(x.root),false);
});
test('missing manifest is isolated as not configured',async t=>{
 const x=await briefFixture(t);await rm(path.join(x.root,'data/ceo-operating/brief-manifest.json'));
 assert.equal((await load(x)).status,'NOT_CONFIGURED');
});
test('changed source content is rejected until its explicit hash is updated',async t=>{
 const x=await briefFixture(t);await writeFile(path.join(x.root,x.manifest.sources.baseline.path),'{}');
 const r=await load(x);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.reason,'SOURCE_HASH_MISMATCH');
});
test('source path traversal and absolute paths are rejected without disclosing the path',async t=>{
 const x=await briefFixture(t);
 for(const unsafe of ['../outside.json','C:/private/credential.json','data/../config/secret.json']){
  x.manifest.sources.baseline.path=unsafe;await x.writeManifest();const r=await load(x);
  assert.equal(r.status,'UNAVAILABLE');assert.equal(r.reason,'UNSAFE_SOURCE');assert.equal(JSON.stringify(r).includes(unsafe),false);
 }
});
test('other store, changed goal or changed context fails closed',async t=>{
 const x=await briefFixture(t);
 for(const changes of [{storeId:'another-store'},{goalVersion:3},{contextId:'changed-context'}]){
  const original={...x.manifest};Object.assign(x.manifest,changes);await x.writeManifest();
  assert.equal((await load(x)).reason,'BRIEF_CONTEXT_CHANGED');Object.assign(x.manifest,original);
 }
});
test('over-capacity days, missing emergency reserve and nonconsecutive schedule fail closed',async t=>{
 const x=await briefFixture(t),original=structuredClone(x.plan.schedule);
 for(const change of [()=>{x.plan.schedule[0].routineOperationsReserveMinutes=250;},()=>{x.plan.schedule[0].emergencyReserveMinutes=0;},()=>{x.plan.schedule[1].date='2026-10-31';}]){
  x.plan.schedule=structuredClone(original);change();await x.save();assert.equal((await load(x)).reason,'INVALID_BRIEF_SOURCE');
 }
});
test('expired plans remain explicitly historical and current task versions are not frozen in the source',async t=>{
 const x=await briefFixture(t);x.tasks[0].status='DONE';x.tasks[0].version=6;
 const r=await load(x,{now:new Date('2026-11-05T00:00:00Z')});
 assert.equal(r.plan.isExpired,true);assert.equal(r.days[3].actions[0].liveTask.status,'DONE');assert.equal(r.days[3].actions[0].liveTask.version,6);
});
test('source cannot turn missing profit into zero or a forecast into an executable plan',async t=>{
 const x=await briefFixture(t);x.baseline.monthlyOperatingNetProfitCNY=0;await x.save();
 assert.equal((await load(x)).reason,'INVALID_BRIEF_SOURCE');
 x.baseline.monthlyOperatingNetProfitCNY=null;x.plan.notImportedOrScheduled=false;await x.save();assert.equal((await load(x)).reason,'INVALID_BRIEF_SOURCE');
});
test('oversized source JSON is bounded before parsing',async t=>{
 const x=await briefFixture(t);await writeFile(path.join(x.root,x.manifest.sources.plan.path),' '.repeat(300000));
 assert.equal((await load(x)).reason,'SOURCE_LIMIT');
});

test('directory junctions cannot leave the canonical project data boundary',async t=>{
 const x=await briefFixture(t),other=await briefFixture(t);
 const privateDir=path.join(x.root,'private');await mkdir(privateDir);
 await writeFile(path.join(privateDir,'baseline.json'),JSON.stringify(x.baseline));
 for(const [name,target] of [['private-link',privateDir],['foreign-link',path.join(other.root,'data/ceo-operating')]]){
  await symlink(target,path.join(x.root,'data',name),process.platform==='win32'?'junction':'dir');
  x.manifest.sources.baseline.path=`data/${name}/baseline.json`;await x.writeManifest();
  const r=await load(x);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.reason,'UNSAFE_SOURCE');
 }
});

test('file growth after stat reads at most limit plus one bytes and always closes the same handle',async()=>{
 assert.equal(typeof module.readBoundedBriefFile,'function','缺少真正有界的句柄读取');
 let requested=0,closed=false;
 const handle={stat:async()=>({isFile:()=>true,size:2}),read:async(buffer,offset,length)=>{requested+=length;buffer.fill(120,offset,offset+length);return{bytesRead:length};},close:async()=>{closed=true;}};
 await assert.rejects(module.readBoundedBriefFile('synthetic',16,async()=>handle),{code:'SOURCE_LIMIT'});
 assert.equal(requested,17);assert.equal(closed,true);
});

test('Shanghai day boundary and missing live task are explicit',async t=>{
 const x=await briefFixture(t);
 const r=await load(x,{now:new Date('2026-11-03T16:00:00Z'),tasks:[]});
 assert.equal(r.plan.today,'2026-11-04');assert.equal(r.plan.isExpired,true);assert.equal(r.days[0].actions[0].liveTask,null);
});
