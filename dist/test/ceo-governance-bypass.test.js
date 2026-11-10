import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import express from 'express';
const api=await import('../src/ceo-governance.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const creds={legacy:{id:'legacy',profile:'legacy',role:'agent',storeId:'400370',token:'l'.repeat(48)},shadow:{id:'shadow',profile:'shadow',role:'agent',storeId:'400370',token:'s'.repeat(48)},human:{id:'human',profile:'human',role:'owner',storeId:'400370',token:'h'.repeat(48)}};
async function setup(t){
 assert.equal(typeof api.createCeoGateway,'function','gateway feature missing');const gov=api.createCeoGovernance({credentials:creds}),app=express(),effects=[];
 app.use(express.json());app.use(api.createCeoGateway({governance:gov}));
 for(const [method,route]of [['post','/api/draft/execute'],['post','/api/agent/claim'],['delete','/api/product/1'],['get','/api/status'],['get','/api/events']])app[method](route,(_req,res)=>{effects.push(route);res.json({ok:true});});
 app.get('/api/system/state',(_req,res)=>res.json({readOnly:true}));app.post('/api/ceo-shadow/feedback',(req,res)=>{effects.push(req.body.note);res.json({saved:true});});
 const server=http.createServer(app);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base='http://127.0.0.1:'+server.address().port;
 return{effects,request:(route,{profile='legacy',method='POST',body={},headers={}}={})=>fetch(base+route,{method,headers:{authorization:'Bearer '+creds[profile].token,...(method==='GET'?{}:{'content-type':'application/json'}),...headers},body:method==='GET'?undefined:JSON.stringify(body)})};
}
test('every direct business mutation and disguised read rejects both Agent profiles with zero effects',async t=>{
 const x=await setup(t);for(const profile of ['legacy','shadow'])for(const [method,route]of [['POST','/api/draft/execute'],['POST','/api/agent/claim'],['DELETE','/api/product/1'],['GET','/api/status'],['GET','/api/events'],['POST','/api/new-bypass']]){
  const r=await x.request(route,{profile,method,body:{role:'owner',agent:'human',commit:true,operationId:'attack'}});assert.equal(r.status,403,route);
 }assert.deepEqual(x.effects,[]);
});
test('request identity headers and missing credentials cannot authorize owner feedback',async t=>{
 const x=await setup(t);for(const headers of [{authorization:''},{authorization:'Bearer unknown'},{'x-role':'owner','x-agent':'human'}])assert.ok([401,403].includes((await x.request('/api/ceo-shadow/feedback',{headers,body:{role:'owner',operationId:'forged',note:'bad'}})).status));assert.deepEqual(x.effects,[]);
});
test('human can submit feedback once; cross-store and replay fail before handler',async t=>{
 const x=await setup(t),route='/api/ceo-shadow/feedback',body={operationId:'human-one',storeId:'400370',note:'human correction'};
 assert.equal((await x.request(route,{profile:'human',body})).status,200);
 assert.equal((await x.request(route,{profile:'human',body})).status,409);
 assert.equal((await x.request(route,{profile:'human',body:{...body,operationId:'cross',storeId:'400371'}})).status,403);
 assert.deepEqual(x.effects,['human correction']);
});
test('pure state remains available to legacy identity without write capability',async t=>{
 const x=await setup(t),r=await x.request('/api/system/state',{method:'GET'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{readOnly:true});assert.deepEqual(x.effects,[]);
});
