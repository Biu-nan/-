import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadCeoOperatingContext} from 'file:///F:/yikuaborder-deploy/.worktrees/ceo-g0-g1-20261105/dist/src/ceo-operating-context.js';

// No production facts/configuration are loaded. The two dictionary snapshots are read-only evidence.
const oldBytes=await readFile(new URL('./metrics-head.stdout.txt',import.meta.url));
const newBytes=await readFile(new URL('./metrics-current.json',import.meta.url));
const oldSchema=JSON.parse(oldBytes),newSchema=JSON.parse(newBytes);
const now=new Date('2026-11-05T00:00:00Z');
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'closure-dictionary-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'config'));
 for(const source of ['aliexpress','ixspy'])await mkdir(path.join(root,'data/metrics/facts',source),{recursive:true});
 const config={schema:'ceo-store-config/v1',goal:{schema:'ceo-goal/v1',goalId:'fixture-closure',version:1,storeRef:{platform:'aliexpress-choice',environmentId:'400370'},period:{fromDate:'2026-11-01',toDate:'2026-11-30',timeZone:'Asia/Shanghai'},targets:[{targetId:'daily-paid-items',value:1,caliber:null,unit:'件',window:'DAY',metricStatus:'PENDING'},{targetId:'monthly-operating-profit-ex-quality-penalty',value:1,caliber:null,unit:'CNY',window:'MONTH',metricStatus:'PENDING'}],capacityMinutes:300,bufferMinutes:60,deadline:null},resourceProposal:{status:'PROPOSED_SCENARIO',operators:1,capacityMinutes:300,bufferMinutes:60}};
 await writeFile(path.join(root,'config/ceo-store-400370.json'),JSON.stringify(config));
 return root;
}
test('dictionary extension preserves all 23 existing definitions and all calculation sections',()=>{
 assert.equal(Object.keys(oldSchema.calibers).length,23);
 assert.equal(Object.keys(newSchema.calibers).length,33);
 for(const [key,value]of Object.entries(oldSchema.calibers))assert.deepEqual(newSchema.calibers[key],value,key);
 for(const key of ['windows','timezone','freshness','metrics','forbidden'])assert.deepEqual(newSchema[key],oldSchema[key],key);
});
test('dictionary byte update changes context identity without admitting or changing synthetic business observations',async t=>{
 const root=await fixture(t),dict=path.join(root,'config/metrics-schema.json');
 const fact={source:'aliexpress',storeId:'env:400370',caliber:'sales.qty.total',subject:'fixture',window:'7d',statDate:'2026-11-04',value:3,unit:'件',capturedAt:'2026-11-04T00:00:00Z'};
 await writeFile(path.join(root,'data/metrics/facts/aliexpress/2026-11-04.jsonl'),JSON.stringify(fact)+'\n');
 await writeFile(dict,oldBytes);const before=await loadCeoOperatingContext({projectRoot:root,now});
 await writeFile(dict,newBytes);const filesBefore=await readdir(root,{recursive:true});const after=await loadCeoOperatingContext({projectRoot:root,now});
 assert.notEqual(before.dictionaryHash,after.dictionaryHash);assert.notEqual(before.contextId,after.contextId);
 assert.deepEqual(before.observations,after.observations);assert.equal(after.observations.length,1);
 assert.deepEqual(before.facts,[]);assert.deepEqual(after.facts,[]);
 assert.deepEqual(await readdir(root,{recursive:true}),filesBefore);
});
test('registered market caliber does not make IXSPY synthetic records enter the current CEO fact reader',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'config/metrics-schema.json'),newBytes);
 await writeFile(path.join(root,'data/metrics/facts/ixspy/2026-11-04.jsonl'),JSON.stringify({source:'ixspy',storeId:'env:400370',caliber:'market.rank.sales7d@product_rank',subject:'fixture',window:'7d',statDate:'2026-11-04',value:999,unit:'件',capturedAt:'2026-11-04T00:00:00Z'})+'\n');
 const result=await loadCeoOperatingContext({projectRoot:root,now});
 assert.deepEqual(result.observations,[]);assert.deepEqual(result.facts,[]);assert.deepEqual(result.sourceManifest,[]);
});
