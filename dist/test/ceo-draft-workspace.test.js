import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
const url=new URL('../src/ceo-draft-workspace.js',import.meta.url);
const config=JSON.parse(await readFile(new URL('../../config/ceo-store-400370.json',import.meta.url)));
const example=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
async function setup(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'ceo-workspace-'));const resources=[];t.after(async()=>{for(const r of resources.reverse())r.close();await rm(dir,{recursive:true,force:true});});
 const {ceoContextId}=await import('../src/ceo-operating-context.js');
 const context={schema:'ceo-operating-context/v1',loadedAt:'2026-10-26T09:00:00Z',goal:structuredClone(example.goal),facts:[],observations:[],sourceManifest:[],dictionaryHash:'test',gaps:['NO_LOCAL_FACTS'],resourceProposal:config.resourceProposal};
 context.contextId=ceoContextId(context);
 const {CeoDraftWorkspace}=await import(url), dbPath=path.join(dir,'draft.sqlite');
 const service=new CeoDraftWorkspace({dbPath});resources.push(service);
 const input={context,decision:structuredClone(example.decision),candidates:structuredClone(example.candidates),expectedContextId:context.contextId,now:new Date('2026-10-26T09:00:00Z')};
 return {service,input,dbPath,CeoDraftWorkspace,ceoContextId,resources};
}
test('draft survives close and reopen and cannot imply execution',async t=>{
 const x=await setup(t), receipt=x.service.saveDraft(x.input);assert.equal(receipt.created,true);
 assert.equal(receipt.status,'DRAFT');assert.equal(receipt.commitment,'UNCOMMITTED');assert.equal(receipt.plan.tasks.length,0);
 assert.equal(receipt.plan.deferred.length,3);x.service.close();
 const reopened=new x.CeoDraftWorkspace({dbPath:x.dbPath});x.resources.push(reopened);
 assert.deepEqual(reopened.getPlan(receipt.planId),receipt.plan);
});
test('identical retries reuse one plan and decision',async t=>{
 const x=await setup(t),a=x.service.saveDraft(x.input),b=x.service.saveDraft(x.input);
 assert.equal(a.planId,b.planId);assert.equal(b.created,false);
 const db=new DatabaseSync(x.dbPath);x.resources.push(db);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ceo_plan_versions').get().n,1);
 assert.equal(db.prepare('SELECT count(*) AS n FROM ceo_decision_versions').get().n,1);
});
test('clock-only observation diagnostics do not create a decision context conflict on retry',async t=>{
 const x=await setup(t);
 x.input.context.observations=[{capturedAt:'2026-10-26T09:00:01Z',issues:['PERIOD_AND_COVERAGE_UNVERIFIED','CAPTURE_FROM_FUTURE']}];
 x.input.context.contextId=x.ceoContextId(x.input.context);x.input.expectedContextId=x.input.context.contextId;
 const first=x.service.saveDraft(x.input);
 x.input.context.loadedAt='2026-10-26T09:00:02Z';x.input.context.observations[0].issues.pop();
 x.input.context.contextId=x.ceoContextId(x.input.context);x.input.now=new Date('2026-10-26T09:00:02Z');
 const second=x.service.saveDraft(x.input);assert.equal(second.planId,first.planId);assert.equal(second.created,false);
});
test('stale expected context and forged usable facts are rejected',async t=>{
 const x=await setup(t);assert.throws(()=>x.service.saveDraft({...x.input,expectedContextId:'old'}),{code:'CONTEXT_CHANGED'});
 x.input.context.facts=[{value:999}];assert.throws(()=>x.service.saveDraft(x.input),{code:'INVALID_CONTEXT'});
});
test('same goal version cannot silently change target or capacity',async t=>{
 const x=await setup(t);x.service.saveDraft(x.input);x.input.context.goal.capacityMinutes=120;
 x.input.context.contextId=x.ceoContextId(x.input.context);x.input.expectedContextId=x.input.context.contextId;
 assert.throws(()=>x.service.saveDraft(x.input),{code:'GOAL_VERSION_CONFLICT'});
});
test('same decision identity cannot overwrite different content',async t=>{
 const x=await setup(t);x.service.saveDraft(x.input);x.input.decision.assumptions.push('Changed judgment');
 assert.throws(()=>x.service.saveDraft(x.input),{code:'DECISION_VERSION_CONFLICT'});
});
test('new fact snapshot requires a fresh decision identity',async t=>{
 const x=await setup(t);x.service.saveDraft(x.input);x.input.context.dictionaryHash='changed';
 x.input.context.contextId=x.ceoContextId(x.input.context);x.input.expectedContextId=x.input.context.contextId;
 assert.throws(()=>x.service.saveDraft(x.input),{code:'DECISION_CONTEXT_CONFLICT'});
});
test('last statement failure rolls back goal context decision and plan atomically',async t=>{
 const x=await setup(t);x.service.ready();const db=new DatabaseSync(x.dbPath);x.resources.push(db);
 db.exec("CREATE TRIGGER fail_plan BEFORE INSERT ON ceo_plan_versions BEGIN SELECT RAISE(ABORT,'private-sensitive-reason'); END;");
 assert.throws(()=>x.service.saveDraft(x.input),e=>e.code==='STORAGE_FAILED'&&!e.message.includes('private-sensitive'));
 for(const table of ['ceo_goal_versions','ceo_context_snapshots','ceo_decision_versions','ceo_plan_versions'])assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n,0);
});
test('old charm tables survive readiness and save unchanged',async t=>{
 const x=await setup(t),db=new DatabaseSync(x.dbPath);x.resources.push(db);
 db.exec("CREATE TABLE charm_products(id TEXT PRIMARY KEY,name TEXT); INSERT INTO charm_products VALUES('old','kept');");
 x.service.saveDraft(x.input);assert.equal(db.prepare('SELECT name FROM charm_products').get().name,'kept');
});
test('invalid or expired decision cannot be archived as an executable plan',async t=>{
 const x=await setup(t);x.input.decision.reviewAt='2000-01-01T00:00:00Z';
 assert.throws(()=>x.service.saveDraft(x.input),{code:'INVALID_DECISION'});
});
test('two workspace instances save duplicate draft exactly once',async t=>{
 const x=await setup(t),other=new x.CeoDraftWorkspace({dbPath:x.dbPath});x.resources.push(other);
 const a=x.service.saveDraft(x.input),b=other.saveDraft(x.input);assert.equal(a.created,true);assert.equal(b.created,false);
});
test('explicit absolute database path is required',async()=>{
 const {CeoDraftWorkspace}=await import(url);assert.throws(()=>new CeoDraftWorkspace({dbPath:'relative.sqlite'}),{code:'INVALID_DB_PATH'});
});
