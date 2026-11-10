import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const module=await import('../../public/ceo-evidence-check.js').catch(()=>({}));
class Element{constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(v){throw Error('UNSAFE_HTML');}append(...n){this.children.push(...n);}replaceChildren(...n){this._text='';this.children=n;}}
const nodes=n=>[n,...n.children.flatMap(nodes)],task={taskId:'store-400370-test',version:5,receipt:{evidence:[{reference:'data/<script>.json',summary:'<img onerror=x>'}]}};
function setup(options={}){const doc={createElement:t=>new Element(t,doc)},root=new Element('section',doc);assert.equal(typeof module.mountCeoEvidenceCheck,'function');return{root,controller:module.mountCeoEvidenceCheck(root,task,options)};}
test('evidence check is explicit and read-only, renders references literally and never accepts a task',async()=>{
 let calls=0;const {root,controller}=setup({onCheck:async()=>{calls++;return{taskId:task.taskId,taskVersion:5,status:'MATCH',checkId:'a'.repeat(64),files:[{reference:'<script>.json',status:'MATCH',bytes:5}]};}});
 assert.equal(calls,0);assert.equal(controller.getCheckId(),null);await nodes(root).find(n=>n.tagName==='button').onclick();assert.equal(calls,1);assert.equal(controller.getCheckId(),'a'.repeat(64));assert.match(root.textContent,/<script>\.json/);assert.match(root.textContent,/仍需.*验收/);
});
test('failed or wrong-task checks cannot yield a usable token and errors are readable',async()=>{
 for(const result of [{status:'FAILED',files:[{reference:'proof',status:'MISSING'}]},{status:'MATCH',taskId:'other',taskVersion:5,checkId:'a'.repeat(64),files:[]}]){const {root,controller}=setup({onCheck:async()=>result});await nodes(root).find(n=>n.tagName==='button').onclick();assert.equal(controller.getCheckId(),null);assert.match(root.textContent,/缺失|未通过/);}
});
test('human verdict is explicit; positive real acceptance carries check ID; rejection needs none',()=>{
 assert.equal(typeof module.ceoVerificationArgs,'function');assert.throws(()=>module.ceoVerificationArgs(task,{verdict:'',note:'x'}),/选择/);assert.throws(()=>module.ceoVerificationArgs(task,{verdict:'yes',note:'x'}),/原件/);
 assert.deepEqual(module.ceoVerificationArgs(task,{verdict:'no',note:'缺资料'}),{accepted:false,note:'缺资料'});assert.deepEqual(module.ceoVerificationArgs(task,{verdict:'yes',note:'逐项核对',checkId:'a'.repeat(64)}),{accepted:true,note:'逐项核对',evidenceCheckId:'a'.repeat(64)});
});
test('task form integrates empty verdict and original-check controller, static module served locally',async()=>{
 const source=await readFile(new URL('../../public/ceo-tasks.js',import.meta.url),'utf8'),http=await readFile(new URL('../src/ceo-task-http.js',import.meta.url),'utf8');
 assert.match(source,/mountCeoEvidenceCheck/);assert.match(source,/ceoVerificationArgs/);assert.match(source,/\['','请选择核验结论'\]/);assert.match(http,/'\/ceo-evidence-check.js':'ceo-evidence-check.js'/);
});
