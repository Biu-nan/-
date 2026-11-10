import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../../public/ceo-daily-review.js').catch(()=>({}));
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this._text='';this.classList={add:()=>{}};}
 set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerHTML(v){throw new Error('UNSAFE_HTML');}append(...n){this.children.push(...n);}replaceChildren(...n){this._text='';this.children=n;}setAttribute(k,v){this.attributes[k]=v;}
}
const nodes=n=>[n,...n.children.flatMap(nodes)];
function setup(){const doc={createElement:tag=>new Element(tag,doc)},root=new Element('section',doc);const data={actor:{role:'owner'},contextId:'context-test',date:'2026-10-28',reviews:[],tasks:[{taskId:'store-400370-a',version:2,status:'PROPOSED'}],brief:{status:'AVAILABLE',sourceId:'b'.repeat(64),plan:{today:'2026-10-28',isExpired:false},days:[{date:'2026-10-28',actions:[{sourceTaskRef:'store-400370-a'}]},{date:'2026-10-29',actions:[]}]}};return{root,data};}
function render(root,data,options={}){assert.equal(typeof module.renderCeoDailyReview,'function');if(!root.testStorage){const values=new Map();root.testStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}module.renderCeoDailyReview(root,data,{storage:root.testStorage,...options});}
test('only owner can save for an available nonfuture day; no daily completion claim',()=>{
 const {root,data}=setup();render(root,data);assert.equal(nodes(root).filter(n=>n.tagName==='form').length,1);assert.match(root.textContent,/不代表当日动作已完成/);
 for(const change of [{actor:{role:'agent'}},{date:'2026-10-29'},{brief:{status:'UNAVAILABLE'}}]){render(root,{...data,...change});assert.equal(nodes(root).filter(n=>n.tagName==='form').length,0);}
 const expired=structuredClone(data);expired.brief.plan.isExpired=true;render(root,expired);assert.equal(nodes(root).filter(n=>n.tagName==='form').length,0);
});
test('uncertain save retains exact operation and note, retry reuses it, refresh can confirm from history',async()=>{
 const {root,data}=setup(),calls=[];let fail=true;
 const options={onSave:async p=>{calls.push(structuredClone(p));if(fail)throw new Error('网络暂不可用');return{review:{...p,reviewId:'r',taskSnapshots:[],handoff:{candidates:[],scheduled:false}}};}};
 render(root,data,options);const area=nodes(root).find(n=>n.tagName==='textarea');area.value='今日缺证 <script>';await nodes(root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});
 assert.equal(calls.length,1);assert.match(root.textContent,/结果尚未确认/);
 render(root,data,options);const retry=nodes(root).find(n=>n.tagName==='form');assert.ok(nodes(root).find(n=>n.tagName==='textarea').disabled);fail=false;await retry.onsubmit({preventDefault(){}});
 assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].expectedTaskVersions['store-400370-a'],2);assert.match(root.textContent,/已存档/);
});
test('archived notes and handoff are rendered as text and do not create or approve tasks',()=>{
 const {root,data}=setup(),seen=[];data.reviews=[{reviewId:'r',date:data.date,createdAt:'2026-10-28T08:00:00Z',note:'<img onerror=alert(1)>',taskSnapshots:[{taskId:'store-400370-a',title:'补证',status:'PENDING_VERIFICATION',version:5,receipt:{summary:'<script>',evidenceCount:1}}],handoff:{nextDate:'2026-10-29',candidates:[{taskId:'store-400370-a',reason:'RECONCILE_UNKNOWN'}]}}];
 render(root,data,{onTask:id=>seen.push(id)});assert.match(root.textContent,/<img onerror=alert\(1\)>/);assert.match(root.textContent,/核对未知结果/);assert.match(root.textContent,/未排程/);
 nodes(root).find(n=>n.tagName==='button'&&n.textContent==='查看原任务').onclick();assert.deepEqual(seen,['store-400370-a']);
});
test('explicit session clear drops an unconfirmed note and operation from the next session',async()=>{
 const {root,data}=setup();render(root,data,{onSave:async()=>{throw new Error('未确认');}});nodes(root).find(n=>n.tagName==='textarea').value='私有说明';await nodes(root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});
 assert.equal(typeof module.clearCeoDailyReview,'function');module.clearCeoDailyReview(root);render(root,data);
 assert.equal(nodes(root).find(n=>n.tagName==='textarea').value,'');
});
test('lost POST response is confirmed from shared history without a second POST',async()=>{
 const {root,data}=setup();let payload,calls=0;render(root,data,{onSave:async p=>{payload=p;calls++;throw new Error('response lost');}});
 nodes(root).find(n=>n.tagName==='textarea').value='今日尚有待核项';await nodes(root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});
 data.reviews=[{operationId:payload.operationId,reviewId:'r',date:data.date,createdAt:'2026-10-28T08:00:00Z',note:payload.note,taskSnapshots:[],handoff:{nextDate:null,candidates:[]}}];render(root,data);
 assert.match(root.textContent,/已从共享记录核对/);assert.equal(nodes(root).find(n=>n.tagName==='textarea').value,'');assert.equal(calls,1);
});
test('task progress separates stable business IDs from demos',()=>{
 assert.equal(typeof module.businessTaskCounts,'function');
 assert.deepEqual(module.businessTaskCounts([{taskId:'store-400370-a',status:'PROPOSED'},{taskId:'demo-1',status:'DONE'},{taskId:'demo-2',status:'DONE'}]),{businessTotal:1,businessDone:0,otherTotal:2,otherDone:2});
});
test('unconfirmed operation survives changed source and a fresh page root without minting another ID',async()=>{
 const {root,data}=setup(),saved=new Map(),storage={getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},calls=[];
 const options={storage,onSave:async p=>{calls.push(structuredClone(p));throw new Error('lost response');}};
 render(root,data,options);nodes(root).find(n=>n.tagName==='textarea').value='原复盘说明';await nodes(root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});
 const changed=structuredClone(data);changed.contextId='context-new';changed.brief.sourceId='c'.repeat(64);render(root,changed,options);
 assert.match(root.textContent,/待确认|尚未确认/);await nodes(root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});assert.deepEqual(calls[0],calls[1]);
 const next=setup();render(next.root,changed,options);assert.match(next.root.textContent,/待确认|尚未确认/);await nodes(next.root).find(n=>n.tagName==='form').onsubmit({preventDefault(){}});assert.deepEqual(calls[0],calls[2]);
 module.clearCeoDailyReview(next.root);assert.equal(saved.size,0);
});
