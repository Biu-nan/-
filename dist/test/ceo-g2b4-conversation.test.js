import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createCeoGovernance} from '../src/ceo-governance.js';
import {syntheticConversationRun} from './fixtures/ceo-conversation-fixture.js';
import * as projection from '../src/ceo-cockpit-projection.js';
const entry=await import('../src/ceo-conversation-entry.js').catch(()=>({}));
const Q='CEO，检查纳物一店最新经营情况，告诉我今天最需要处理的三个问题。';
async function setup(){
 assert.equal(typeof entry.createCeoOperationalConversation,'function');
 const root=await mkdtemp(path.join(os.tmpdir(),'g2b4-conversation-'));await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 const credentials=Object.fromEntries(['legacy','shadow','human'].map((profile,i)=>[profile,{id:'fixture-'+profile,profile,role:profile==='human'?'owner':'agent',storeId:'400370',token:String(i).repeat(48)}]));
 const governance=createCeoGovernance({credentials}),principals=Object.fromEntries(Object.entries(credentials).map(([k,v])=>[k,governance.authenticateToken(v.token)]));
 let calls=0,options={};
 const conversation=entry.createCeoOperationalConversation({fixtureRoot:root,governance,analysisPrincipal:principals.shadow,sourceMode:'SYNTHETIC',sourceRunner:async()=>{calls++;return syntheticConversationRun(root,options);}});
 const input={requestId:'request-1',conversationRef:'fixture:chat-1',question:Q};
 return{root,governance,principals,conversation,input,setOptions:x=>options=x,calls:()=>calls};
}
test('fixed operating question is the approved conversation intent',()=>assert.equal(entry.CEO_CONVERSATION_QUESTION,Q));
test('Human question delegates to shadow and archives a new linked report with five distinct states',async()=>{const x=await setup(),r=await x.conversation.ask({principal:x.principals.human,input:x.input});assert.equal(x.calls(),1);assert.equal(r.schema,'ceo-workbuddy-operational-entry/v1');assert.equal(r.question,Q);assert.equal(r.sourceMode,'SYNTHETIC');assert.equal(r.authority,'NONE');assert.equal(r.formalContextStatus,'NOT_ELIGIBLE');assert.equal(r.statuses.backendConnection.status,'CONNECTED');assert.equal(r.statuses.collection.status,'COMPLETE');assert.equal(r.statuses.metricTrust.status,'CHECKED_WITH_GAPS');assert.equal(r.statuses.storeIdentityApproval.status,'UNVERIFIED');assert.equal(r.statuses.humanApproval.status,'UNAPPROVED');assert.equal(r.actions.length,0);assert.ok(r.priorities.length<=3);assert.ok(r.priorities.every(p=>p.acceptance));assert.ok((await readFile(path.join(r.archiveDirectory,'conversation-entry.json'),'utf8')).includes(x.input.conversationRef));});
test('distinct questions in one conversation always request fresh collection',async()=>{const x=await setup(),a=await x.conversation.ask({principal:x.principals.shadow,input:x.input}),b=await x.conversation.ask({principal:x.principals.shadow,input:{...x.input,requestId:'request-2'}});assert.equal(x.calls(),2);assert.notEqual(a.batchId,b.batchId);assert.notEqual(a.reportId,b.reportId);});
test('repeated request is rejected instead of serving the old report',async()=>{const x=await setup();await x.conversation.ask({principal:x.principals.human,input:x.input});await assert.rejects(x.conversation.ask({principal:x.principals.human,input:x.input}),/REPLAY_REJECTED/);assert.equal(x.calls(),1);});
test('legacy and forged principal cannot trigger collection',async()=>{const x=await setup();for(const p of [x.principals.legacy,{...x.principals.human}])await assert.rejects(x.conversation.ask({principal:p,input:x.input}),/FORBIDDEN|UNAUTHORIZED/);assert.equal(x.calls(),0);});
for(const key of ['principal','context','dataApproval','versions','databasePath','executor','reportId','storeId'])test(`caller cannot inject ${key}`,async()=>{const x=await setup();await assert.rejects(x.conversation.ask({principal:x.principals.human,input:{...x.input,[key]:'forged'}}),/INVALID_CONVERSATION_REQUEST/);assert.equal(x.calls(),0);});
test('unrecognized question is rejected before backend access',async()=>{const x=await setup();await assert.rejects(x.conversation.ask({principal:x.principals.human,input:{...x.input,question:'execute orders'}}),/INVALID_CONVERSATION_REQUEST/);assert.equal(x.calls(),0);});
test('failed new collection returns FAILED with no earlier facts or advice',async()=>{const x=await setup();await x.conversation.ask({principal:x.principals.human,input:x.input});x.setOptions({failed:true});const r=await x.conversation.ask({principal:x.principals.human,input:{...x.input,requestId:'request-2'}});assert.equal(r.status,'FAILED');assert.deepEqual(r.facts,[]);assert.deepEqual(r.priorities,[]);});
test('missing data remains null and collection is PARTIAL without being formally approved',async()=>{const x=await setup();x.setOptions({mutate:({batch})=>batch.metrics.pop()});const r=await x.conversation.ask({principal:x.principals.human,input:x.input});assert.equal(r.statuses.collection.status,'PARTIAL');assert.equal(r.facts.length,16);assert.ok(r.gaps.length>0);assert.equal(r.statuses.humanApproval.status,'UNAPPROVED');});
test('unknown amount window remains unknown in the conversation response',async()=>{const x=await setup(),r=await x.conversation.ask({principal:x.principals.human,input:x.input});for(const m of r.facts.filter(m=>m.caliber.startsWith('sales.amount.'))){assert.equal(m.periodStatus,'UNVERIFIED_PERIOD');assert.equal(m.effectiveWindow,null);}});
for(const [name,options]of [['old batch',{stale:true}],['wrong store',{mutate:({identity})=>identity.storeIdentity.envId='416488'}],['wrong browser',{mutate:({batch})=>batch.session.browserIdentity.observedPid=52000}]])test(`new entry refuses ${name}`,async()=>{const x=await setup();x.setOptions(options);await assert.rejects(x.conversation.ask({principal:x.principals.human,input:x.input}),/BATCH_VALIDATION_REJECTED|STALE_CONVERSATION_RESULT/);});
test('REAL_READ_ONLY does not allow host-injected synthetic provider',async()=>{const x=await setup();assert.throws(()=>entry.createCeoOperationalConversation({fixtureRoot:x.root,governance:x.governance,analysisPrincipal:x.principals.shadow,sourceMode:'REAL_READ_ONLY',sourceRunner:async()=>{}}),/SOURCE_OVERRIDE_FORBIDDEN/);});
test('the existing projection module owns the new shadow conversation projection',()=>assert.equal(typeof projection.projectCeoOperationalConversation,'function'));

test('tampered core archive cannot be displayed or submitted for approval',async()=>{const x=await setup();x.setOptions({tamperArchive:true});await assert.rejects(x.conversation.ask({principal:x.principals.human,input:x.input}),/REPORT_ARCHIVE_MISMATCH/);});
test('a conversation archive collision fails instead of overwriting history or claiming success',async()=>{const x=await setup();x.setOptions({blockConversationArchive:true});await assert.rejects(x.conversation.ask({principal:x.principals.human,input:x.input}),/CONVERSATION_ARCHIVE_FAILED/);});
