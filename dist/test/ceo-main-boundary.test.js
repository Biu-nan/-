import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const api=await import('../src/ceo-main-boundary.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
async function setup(t){
 assert.equal(typeof api.installCeoMainBoundary,'function','main route boundary missing');
 const root=await mkdtemp(path.join(os.tmpdir(),'main-boundary-')),effects=[],app=express();app.use(express.json());
 await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 await writeFile(path.join(root,'synthetic-principals.json'),JSON.stringify({legacy:{id:'fixture-legacy',profile:'legacy',storeId:'400370',token:'l'.repeat(48)},shadow:{id:'fixture-shadow',profile:'shadow',storeId:'400370',token:'s'.repeat(48)},human:{id:'fixture-human',profile:'human',role:'owner',storeId:'400370',token:'h'.repeat(48)}}));
 api.installCeoMainBoundary(app,{fixtureRoot:root});
 const source=await readFile(new URL('../src/server.js',import.meta.url),'utf8');
 const routes=[...source.matchAll(/app\.(post|put|delete|patch|get)\("([^\"]+)"/g)].map(m=>[m[1],m[2]]).filter(([,r])=>r.startsWith('/api/'));
 for(const [method,route]of routes)app[method](route,(req,res)=>{effects.push(route);res.json({humanOriginalHandler:true});});
 const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 return{effects,routes,request:(method,route,token='l'.repeat(48),body={operationId:'test-'+Math.random(),storeId:'400370'})=>fetch('http://127.0.0.1:'+server.address().port+route,{method:method.toUpperCase(),headers:{authorization:'Bearer '+token,...(method==='get'?{}:{'content-type':'application/json'})},body:method==='get'?undefined:JSON.stringify(body)})};
}
test('all discovered main API mutation routes reject legacy and shadow before original handlers',async t=>{
 const x=await setup(t),mutations=x.routes.filter(([m])=>m!=='get');assert.ok(mutations.length>100,'must exercise actual main route inventory');
 for(const token of ['l'.repeat(48),'s'.repeat(48)])for(const [method,pattern]of mutations){const route=pattern.replace(/:[A-Za-z_][A-Za-z_0-9]*/g,'fixture-id');assert.equal((await x.request(method,route,token,{role:'owner',commit:true,storeId:'400370',operationId:'forged'})).status,403,method+' '+route);}
 assert.deepEqual(x.effects,[]);
});
test('human original handler works only in explicitly marked synthetic environment; replay is rejected',async t=>{
 const x=await setup(t),body={operationId:'human-action',storeId:'400370'};
 assert.equal((await x.request('post','/api/agent/claim','h'.repeat(48),body)).status,200);
 assert.equal((await x.request('post','/api/agent/claim','h'.repeat(48),body)).status,409);
 assert.deepEqual(x.effects,['/api/agent/claim']);
});
test('disguised GET writes and cross-store Human actions cannot bypass the main gateway',async t=>{
 const x=await setup(t);
 for(const route of ['/api/status','/api/events','/api/agent/active-task','/api/today-dashboard'])assert.equal((await x.request('get',route)).status,403);
 assert.equal((await x.request('post','/api/agent/claim','h'.repeat(48),{operationId:'cross',storeId:'400371'})).status,403);assert.deepEqual(x.effects,[]);
});
test('case-insensitive Express API matching cannot bypass governance with missing or Agent credentials',async t=>{
 const x=await setup(t);
 for(const route of ['/API/agent/claim','/Api/agent/claim','/aPi/agent/claim']){
  assert.equal((await x.request('post',route,'l'.repeat(48),{role:'owner',operationId:'case',storeId:'400370'})).status,403);
  assert.equal((await x.request('post',route,'')).status,401);
 }assert.deepEqual(x.effects,[]);
});
test('synthetic Human cannot enter real execution bridges or mutate a store selected by URL parameters',async t=>{
 const x=await setup(t);
 for(const route of ['/api/draft/execute','/api/listing/run','/api/collect/from-url','/api/operations/stores/400371']){
  const method=route.includes('/stores/')?'delete':'post';
  assert.equal((await x.request(method,route,'h'.repeat(48),{operationId:'unsafe-'+route.length,commit:true,storeId:'400370'})).status,403,route);
 }assert.deepEqual(x.effects,[]);
});
