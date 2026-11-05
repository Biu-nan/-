import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {paymentInput} from '../../../dist/test/fixtures/ceo-payment-fixture.js';
import {createCeoGovernance} from '../../../dist/src/ceo-governance.js';
import {createCeoShadowTrace} from '../../../dist/src/ceo-shadow-trace.js';
import {createCeoReportArchive} from '../../../dist/src/ceo-report-archive.js';
import {readCeoTaskSnapshot} from '../../../dist/src/ceo-task-read-model.js';
import {readCeoWorkflowState} from '../../../dist/src/ceo-workflow-catalog.js';
import {paidOrderDictionaryBytes,paidOrderSourcePolicy} from '../../../dist/src/ceo-payment-domain.js';
import {createCeoReadinessVersionResolver} from '../../../dist/src/ceo-readiness-versions.js';
import {createCeoPaymentLoop,startCeoPaymentReadinessService,CEO_PAYMENT_QUESTION} from '../../../dist/src/ceo-payment-loop.js';
import {sha} from '../../../dist/src/ceo-vnext-common.js';

const output=new URL('./demo-output/',import.meta.url);await mkdir(output,{recursive:true});
const root=await mkdtemp(path.join(os.tmpdir(),'b0-reviewable-demo-'));await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
const credentials={shadow:{id:'fixture-shadow',profile:'shadow',storeId:'400370',token:'s'.repeat(48)},human:{id:'fixture-human',profile:'human',storeId:'400370',token:'h'.repeat(48)}};
const governance=createCeoGovernance({credentials}),shadow=governance.authenticateToken(credentials.shadow.token),human=governance.authenticateToken(credentials.human.token);
const input=paymentInput(),now=()=>input.now,resolveVersions=createCeoReadinessVersionResolver({dictionaryBytes:paidOrderDictionaryBytes,sourcePolicy:paidOrderSourcePolicy});
const trace=createCeoShadowTrace({fixtureRoot:root,filePath:path.join(root,'events.jsonl'),governance,now});
const archive=createCeoReportArchive({fixtureRoot:root,directory:path.join(root,'archive'),governance,resolveVersions,traceReader:x=>trace.read(x),now});
const dbPath=path.join(root,'synthetic-tasks.sqlite'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE ceo_tasks(task_id TEXT,version INTEGER,payload_json TEXT);CREATE TABLE ceo_task_events(event_id INTEGER,task_id TEXT,command TEXT,actor_id TEXT,created_at TEXT,payload_json TEXT)');db.close();const before=sha(await readFile(dbPath));
const loop=createCeoPaymentLoop({fixtureRoot:root,governance,archive,trace,resolveVersions,loadPaymentInput:async()=>input,readTaskSnapshot:()=>readCeoTaskSnapshot({dbPath,fixtureRoot:root,offlineSnapshot:true,storeId:'400370',now:now()}),readWorkflowSnapshot:async()=>readCeoWorkflowState({storeId:'400370',snapshot:{version:1,storeId:'400370',capturedAt:now().toISOString(),states:[]},now:now()}),now});
const service=await startCeoPaymentReadinessService({fixtureRoot:root,governance,archive,loop,analysisPrincipal:shadow});
const save=(name,value)=>writeFile(new URL(name,output),JSON.stringify(value,null,2)+'\n','utf8');
try{
 const post=async(route,body,token)=>{const r=await fetch(service.baseUrl+route,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(r.status!==200)throw Error(result.error);return result;};
 const original=await post('/api/ceo/payment-readiness',{requestId:'demo-question',question:CEO_PAYMENT_QUESTION},credentials.shadow.token);await save('initial-result.json',original);await save('initial-full-archive.json',await archive.read({principal:human,reportId:original.reportId}));
 input.snapshot.revision=2;input.snapshot.rows[0].itemCount=3;input.approval.snapshotHash=sha(JSON.stringify(input.snapshot));
 const correction=await post('/api/ceo/payment-corrections',{requestId:'demo-correction',correctsReportId:original.reportId,note:'合成演练：来源核准件数由2更正为3；保留原记录。',question:CEO_PAYMENT_QUESTION},credentials.human.token);await save('corrected-result.json',correction);await save('corrected-full-archive.json',await archive.read({principal:human,reportId:correction.reportId}));
 await save('trace.json',await trace.read({principal:human,storeId:'400370'}));await save('integrity.json',{scope:'SYNTHETIC_ONLY',fixtureRoot:root,beforeDbSha256:before,afterDbSha256:sha(await readFile(dbPath)),productionBusinessWrites:0,productionLogWrites:0,workflowExecutions:0,question:CEO_PAYMENT_QUESTION,reportIds:[original.reportId,correction.reportId]});
 console.log(JSON.stringify({scope:'SYNTHETIC_ONLY',status:'COMPLETE',reportCount:2,traceCount:(await trace.read({principal:human,storeId:'400370'})).length,dbUnchanged:before===sha(await readFile(dbPath))}));
}finally{await service.stop();}
