import test from 'node:test';
import assert from 'node:assert/strict';
const api=await import('../src/ceo-live-source-contract.js');
const binding=()=>({envId:'400370',opened:{pid:51001,cdpPort:21001},connected:{pid:51001,cdpPort:21001,product:'Chrome/test-1',observedProduct:'Chrome/test-1'}});
const check=x=>{assert.equal(typeof api.assertLiveBrowserIdentity,'function');return api.assertLiveBrowserIdentity(x);};
test('fresh openEnv binding matches the connected browser PID and product',()=>{const r=check(binding());assert.equal(r.status,'MATCHED');assert.equal(r.observedPid,51001);assert.equal(r.envId,'400370');});
test('a changed dynamic port and browser PID are accepted when the current binding agrees',()=>{const x=binding();x.opened={pid:51019,cdpPort:21019};x.connected={...x.connected,pid:51019,cdpPort:21019};assert.equal(check(x).cdpPort,21019);});
for(const [name,change] of [
 ['another browser with same version',x=>x.connected.pid=52000],
 ['another browser port',x=>x.connected.cdpPort=22000],
 ['another store environment',x=>x.envId='416488'],
 ['missing process proof',x=>delete x.connected.pid],
 ['expired or invalid endpoint',x=>x.opened.cdpPort=0],
 ['browser replaced after HTTP version probe',x=>x.connected.product='Chrome/replaced'],
 ['non-loopback endpoint text',x=>x.connected.cdpPort='evil.example:21001']
])test(`fail closed: ${name}`,()=>{const x=binding();change(x);assert.throws(()=>check(x),/CDP_BROWSER_IDENTITY_MISMATCH/);});
