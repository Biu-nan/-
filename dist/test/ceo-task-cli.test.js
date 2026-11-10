import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadCeoOperatingContext} from '../src/ceo-operating-context.js';
import {CeoTaskWorkspace} from '../src/ceo-task-workspace.js';

const cli=fileURLToPath(new URL('../../scripts/ceo-task-loop.mjs',import.meta.url));
let fixtureRoot;
function run(args){return new Promise(resolve=>{const child=spawn(process.execPath,[cli,...args],{env:{...process.env,...(fixtureRoot?{CEO_G1_FIXTURE_ROOT:fixtureRoot}:{})},windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',e=>resolve({code:1,out,err:e.code}));child.on('close',code=>resolve({code,out,err}));});}
async function boot(args){
 const child=spawn(process.execPath,[cli,...args],{env:{...process.env,CEO_G1_FIXTURE_ROOT:fixtureRoot},windowsHide:true,stdio:['ignore','pipe','pipe']});
 const ready=await new Promise((resolve,reject)=>{let s='',error='';const timer=setTimeout(()=>reject(new Error('BOOT_TIMEOUT')),8000);child.stdout.on('data',b=>{s+=b;const line=s.split('\n')[0];try{const r=JSON.parse(line);clearTimeout(timer);resolve(r);}catch{}});child.stderr.on('data',b=>error+=b);child.on('exit',()=>{clearTimeout(timer);reject(new Error('BOOT_FAILED '+error));});});
 return{child,ready,stop:()=>new Promise(resolve=>{child.once('close',resolve);child.kill();})};
}
test('CLI and page API complete one isolated manual task and read it after restart',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'ceo-loop-cli-'));let server;
 fixtureRoot=root;await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 t.after(async()=>{if(server)await server.stop();await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(root,'config'));await mkdir(path.join(root,'data/metrics/facts/aliexpress'),{recursive:true});
 const config=JSON.parse(await readFile(new URL('../../config/ceo-store-400370.json',import.meta.url)));
 await writeFile(path.join(root,'config/ceo-store-400370.json'),JSON.stringify(config));await writeFile(path.join(root,'config/metrics-schema.json'),' {"calibers":{}}');
 const context=await loadCeoOperatingContext({projectRoot:root});
 const ex=JSON.parse(await readFile(new URL('../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
 ex.decision.decisionId='isolated-manual-loop';ex.decision.goalVersion=config.goal.version;ex.decision.reviewAt=new Date(Date.now()+86400000).toISOString();
 ex.candidates=ex.candidates.slice(0,1);ex.candidates[0].taskId='DEMO-ONLY-shared-loop';
 const db=path.join(root,'loop.sqlite');
 const credentialsDir=path.join(root,'access'),init=await run(['init-credentials','--out',credentialsDir]);assert.equal(init.code,0,init.err);
 const serverFile=path.join(credentialsDir,'server-credentials.json'),agentFile=path.join(credentialsDir,'agent-token.json'),ownerFile=path.join(credentialsDir,'owner-token.json');
 const owner=(JSON.parse(await readFile(ownerFile))).token;
 assert.ok(!init.out.includes(owner));assert.equal((await run(['init-credentials','--out',credentialsDir])).code,1);
 const args=['serve','--root',root,'--db',db,'--credentials',serverFile,'--port','0'];server=await boot(args);const base=server.ready.baseUrl;
 const input=path.join(root,'request.json');const call=async(command,payload,token=agentFile)=>{if(payload)await writeFile(input,JSON.stringify(payload));const r=await run([command,'--base-url',base,'--token-file',token,...(payload?['--input',input]:[])]);assert.equal(r.code,0,r.err);assert.ok(!r.out.includes(owner));return JSON.parse(r.out);};
 assert.deepEqual(await call('reviews'),{reviews:[]});
 assert.equal((await call('replanning')).status,'SOURCE_UNAVAILABLE');
 await writeFile(input,JSON.stringify({requestId:'missing-review-replan',conversationRef:'test:cli',expectedContextId:context.contextId,decision:ex.decision,candidates:[],reviewBinding:{}}));
 const noReview=await run(['replan','--base-url',base,'--token-file',agentFile,'--input',input]);assert.equal(noReview.code,1);assert.equal(noReview.out,'');assert.match(noReview.err,/REVIEW_SOURCE_UNAVAILABLE/);
 const draftInput={requestId:'cli-first-plan',conversationRef:'test:cli-chat',expectedContextId:context.contextId,decision:ex.decision,candidates:ex.candidates};
 const saved=await call('draft',draftInput);assert.equal(saved.entry.actorId,'agent-local');assert.equal(saved.externalExecution,false);
 assert.equal((await call('draft',draftInput)).replayed,true);
 const readReceipt=await run(['receipt','--base-url',base,'--token-file',agentFile,'--request-id',draftInput.requestId]);assert.equal(readReceipt.code,0,readReceipt.err);assert.equal(JSON.parse(readReceipt.out).planId,saved.planId);
 await writeFile(input,JSON.stringify({...draftInput,requestId:'cli-bad-decision',decision:{}}));
 const badDraft=await run(['draft','--base-url',base,'--token-file',agentFile,'--input',input]);assert.equal(badDraft.code,1);assert.equal(badDraft.out,'');assert.match(badDraft.err,/INVALID_DECISION/);
 const imported=await call('import',{planId:saved.planId,operationId:'cli-import'});let task=imported.tasks[0];
 const login=await fetch(base+'/api/ceo/session',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({token:owner})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');
 async function human(command,args){const r=await fetch(base+`/api/ceo/tasks/${task.taskId}/commands`,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({command,args,expectedVersion:task.version,operationId:`human-${command}`})});assert.equal(r.status,200,await r.clone().text());task=(await r.json()).task;}
 await human('approve',{expiresAt:new Date(Date.now()+3600000).toISOString()});
 task=(await call('command',{taskId:task.taskId,expectedVersion:task.version,command:'start',args:{},operationId:'cli-start'})).task;
 task=(await call('command',{taskId:task.taskId,expectedVersion:task.version,command:'report',args:{outcome:'REPORTED',summary:'隔离演练；未操作真实店铺',evidence:[{reference:'demo:fixture',sha256:'b'.repeat(64),summary:'人工演练核对'}]},operationId:'cli-report'})).task;
 assert.equal(task.status,'PENDING_VERIFICATION');
 const checked=await run(['evidence','--base-url',base,'--token-file',agentFile,'--task-id',task.taskId]);assert.equal(checked.code,0,checked.err);assert.equal(JSON.parse(checked.out).files[0].status,'UNSUPPORTED_REFERENCE');assert.equal(JSON.parse(checked.out).businessAcceptance,'HUMAN_REQUIRED');
 await human('verify',{accepted:true,note:'仅核准隔离演练记录，不证明经营效果'});
 assert.equal((await call('read')).tasks[0].status,'DONE');
 const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(await page.text(),/CEO 任务工作台/);
 await server.stop();server=await boot(args);
 const again=await run(['read','--base-url',server.ready.baseUrl,'--token-file',agentFile]);assert.equal(again.code,0,again.err);
 const result=JSON.parse(again.out);assert.equal(result.tasks[0].status,'DONE');assert.equal(result.tasks[0].attempt,1);assert.equal(result.tasks[0].effectStatus,'PENDING_OBSERVATION');
});
test('CLI rejects external URLs duplicate flags and identity injection before network',async()=>{
 for(const args of [['read','--base-url','https://example.com','--token-file','none'],['serve','--root','x','--root','y'],['command','--actor','owner']]){
  const r=await run(args);assert.equal(r.code,1);assert.equal(r.out,'');assert.match(r.err,/INVALID_ARGUMENTS|INVALID_BASE_URL/);
 }
});
