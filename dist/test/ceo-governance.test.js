import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/ceo-governance.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
export function credentials(){return{legacy:{id:'legacy',role:'agent',profile:'legacy',storeId:'400370',token:'l'.repeat(48)},shadow:{id:'shadow',role:'agent',profile:'shadow',storeId:'400370',token:'s'.repeat(48)},human:{id:'human',role:'owner',profile:'human',storeId:'400370',token:'h'.repeat(48)}};}
function setup(options={}){assert.equal(typeof api.createCeoGovernance,'function','governance feature missing');return api.createCeoGovernance({credentials:credentials(),...options});}
test('unissued principals and body role names cannot grant authority',()=>{
 const gov=setup();assert.throws(()=>gov.authorize({principal:{id:'human',role:'owner',profile:'human',storeId:'400370'},operation:'read',storeId:'400370'}),{code:'UNAUTHORIZED'});
});
for(const profile of ['legacy','shadow'])for(const operation of ['task.import','task.command','workflow.execute','human.review','policy.write','unknown']){
 test(`${profile} is rejected before ${operation}`,()=>{const gov=setup();assert.throws(()=>gov.authorize({principal:gov.authenticateToken(credentials()[profile].token),operation,storeId:'400370'}),{code:'FORBIDDEN'});});
}
test('legacy and shadow read their store; only shadow analyzes; human feedback is a separate capability',()=>{
 const gov=setup();for(const profile of ['legacy','shadow','human'])assert.equal(gov.authorize({principal:gov.authenticateToken(credentials()[profile].token),operation:'read',storeId:'400370'}).allowed,true);
 assert.throws(()=>gov.authorize({principal:gov.authenticateToken(credentials().legacy.token),operation:'analyze',storeId:'400370'}),{code:'FORBIDDEN'});
 assert.equal(gov.authorize({principal:gov.authenticateToken(credentials().shadow.token),operation:'analyze',storeId:'400370'}).allowed,true);
 assert.equal(gov.authorize({principal:gov.authenticateToken(credentials().human.token),operation:'human.review',storeId:'400370'}).allowed,true);
});
test('cross-store, expired, revoked and malformed tokens always fail closed',()=>{
 let now=Date.parse('2026-11-05T00:00:00Z');const c=credentials();c.legacy.expiresAt='2026-11-05T00:01:00Z';const gov=setup({credentials:c,now:()=>now});
 const p=gov.authenticateToken(c.legacy.token);assert.throws(()=>gov.authorize({principal:p,operation:'read',storeId:'400371'}),{code:'FORBIDDEN'});
 now+=61000;assert.throws(()=>gov.authorize({principal:p,operation:'read',storeId:'400370'}),{code:'UNAUTHORIZED'});
 gov.revoke('human');assert.throws(()=>gov.authenticateToken(c.human.token),{code:'UNAUTHORIZED'});
 for(const token of ['', 'h'.repeat(47),'你'.repeat(48)])assert.throws(()=>gov.authenticateToken(token),{code:'UNAUTHORIZED'});
});
test('policy and credentials are copied: caller cannot expand grants after construction',()=>{
 const c=credentials(),gov=setup({credentials:c});c.legacy.profile='human';c.legacy.storeId='400371';
 const principal=gov.authenticateToken('l'.repeat(48));assert.ok(Object.isFrozen(principal));assert.throws(()=>gov.authorize({principal,operation:'human.review',storeId:'400370'}),{code:'FORBIDDEN'});
});
test('unmapped credential defaults to legacy read-only; ambiguous credentials are rejected',()=>{
 const c=credentials();delete c.legacy.profile;const gov=setup({credentials:c});assert.equal(gov.authenticateToken(c.legacy.token).profile,'legacy');
 c.shadow.token=c.legacy.token;assert.throws(()=>setup({credentials:c}),{code:'INVALID_CREDENTIALS'});
});
test('duplicate request and same ID with changed content are rejected, not executed twice',()=>{
 const gov=setup(),principal=gov.authenticateToken(credentials().human.token),request={principal,operation:'human.review',storeId:'400370',operationId:'review-1',payload:{note:'one'}};
 gov.reserveOperation(request);assert.throws(()=>gov.reserveOperation(request),{code:'REPLAY_REJECTED'});
 assert.throws(()=>gov.reserveOperation({...request,payload:{note:'two'}}),{code:'OPERATION_CONFLICT'});
});
test('unsafe GET routes and unknown API paths are never classified as read-only',()=>{
 setup();for(const route of ['/api/status','/api/agent/active-task','/api/events','/api/today-dashboard','/api/dianxiaomi/batch-status','/api/unknown'])assert.equal(api.classifyCeoRequest('GET',route),'unsafe');
 assert.equal(api.classifyCeoRequest('GET','/api/system/state'),'read');
});
