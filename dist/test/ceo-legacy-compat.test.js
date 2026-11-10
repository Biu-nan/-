import test from 'node:test';
import assert from 'node:assert/strict';
import {readCeoBrief} from '../src/ceo-read-brief.js';
const api=await import('../src/ceo-legacy-view.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
test('legacy presentation limits priorities without discarding Context Snapshot or full source units',async()=>{
 assert.equal(typeof api.buildLegacyCeoView,'function','legacy view feature missing');
 const state={schema:'system-state/v1',readOnly:true,generatedAt:'2026-11-05T00:00:00Z',summary:{healthy:true},sources:[{id:'fixture',ok:true}],units:Array.from({length:5},(_,i)=>({unitId:'u'+i,state:i===0?'DONE':'READY'})),gates:[],caveats:[]};
 const brief=await readCeoBrief({fetchImpl:async()=>new Response(JSON.stringify(state))});
 const snapshot={contextId:'synthetic-context',sourceManifest:[{sha256:'a'.repeat(64)}]},before=structuredClone(snapshot);
 const view=api.buildLegacyCeoView({brief,contextSnapshot:snapshot,priorities:[1,2,3,4,5].map(i=>({title:'p'+i}))});
 assert.equal(view.priorities.length,3);assert.equal(view.brief.units.length,5);assert.deepEqual(view.contextSnapshot,before);assert.deepEqual(snapshot,before);
 assert.equal(view.brief.units[0].businessStatus,'PENDING_VERIFICATION');assert.equal(view.businessWriteAllowed,false);
});
