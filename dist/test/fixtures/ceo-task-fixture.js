import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ceoContextId} from '../../src/ceo-operating-context.js';

export const agent={id:'agent-local',role:'agent',storeId:'400370'};
export const owner={id:'owner-local',role:'owner',storeId:'400370'};
export const now=new Date('2026-10-27T06:00:00Z');
const config=JSON.parse(await readFile(new URL('../../../config/ceo-store-400370.json',import.meta.url)));
const example=JSON.parse(await readFile(new URL('../../../docs/superpowers/examples/ceo-first-loop-draft-input.json',import.meta.url)));
export const evidence=[{reference:'local-audit:demo-result',sha256:'a'.repeat(64),summary:'演练验收记录'}];
export async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'ceo-tasks-')),resources=[];
 await writeFile(path.join(dir,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 t.after(async()=>{for(const r of resources.reverse())r.close();await rm(dir,{recursive:true,force:true});});
 const {CeoTaskWorkspace}=await import('../../src/ceo-task-workspace.js');
 const workspace=new CeoTaskWorkspace({dbPath:path.join(dir,'tasks.sqlite')});resources.push(workspace);
 const context={schema:'ceo-operating-context/v1',loadedAt:now.toISOString(),goal:structuredClone(config.goal),facts:[],observations:[],sourceManifest:[],dictionaryHash:'test',gaps:['COSTS_UNRECONCILED'],resourceProposal:config.resourceProposal};
 context.goal.capacityMinutes=300;context.goal.bufferMinutes=60;context.contextId=ceoContextId(context);
 const decision={...structuredClone(example.decision),goalVersion:context.goal.version,reviewAt:'2026-10-28T06:00:00Z'};
 const candidates=structuredClone(example.candidates);
 const plan=workspace.saveDraft({context,decision,candidates,expectedContextId:context.contextId,now}).plan;
 const input={planId:plan.planId,context,actor:agent,operationId:'import-1',now};
 const imported=()=>workspace.importPlan(input);
 let n=0;
 const command=(task,cmd,args={},extra={})=>workspace.command({taskId:task.taskId,expectedVersion:task.version,command:cmd,args,context,actor:['approve','verify','resolve-unknown'].includes(cmd)?owner:agent,operationId:`op-${++n}`,now,...extra});
 const approved=()=>command(imported().tasks[0],'approve',{expiresAt:'2026-10-27T07:00:00Z'}).task;
 const running=()=>command(approved(),'start').task;
 return{dir,workspace,context,plan,input,imported,command,approved,running,resources,CeoTaskWorkspace,evidence};
}
