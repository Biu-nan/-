import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createCeoTaskServer} from '../src/ceo-task-http.js';
const credentials={owner:{id:'owner',storeId:'400370',token:'o'.repeat(48)},agent:{id:'legacy',storeId:'400370',token:'a'.repeat(48)}};
test('legacy task service defaults to read-only and never invokes database initialization for blocked reads',async t=>{
 let effects=0;const workspace={listTasks:()=>{effects++;return[];},importPlan:()=>{effects++;return{tasks:[]};}},context={contextId:'fixture',goal:{storeRef:{environmentId:'400370'}},gaps:[]};
 const server=createCeoTaskServer({workspace,loadContext:async()=>context,credentials});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer '+credentials.agent.token,'content-type':'application/json'};
 assert.equal((await fetch(base+'/api/ceo/import',{method:'POST',headers,body:JSON.stringify({planId:'forged',operationId:'attack'})})).status,403);
 assert.equal((await fetch(base+'/api/ceo/tasks',{headers})).status,503);assert.equal(effects,0);
 assert.equal((await fetch(base+'/api/ceo/context',{headers})).status,200);
});
