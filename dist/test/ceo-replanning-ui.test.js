import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../../public/ceo-replanning.js').catch(()=>({}));
class Element{constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this._text='';}set textContent(v){this._text=String(v);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}set innerHTML(v){throw new Error('UNSAFE_HTML');}append(...n){this.children.push(...n);}replaceChildren(...n){this._text='';this.children=n;}}
const nodes=n=>[n,...n.children.flatMap(nodes)];
function root(){const doc={createElement:tag=>new Element(tag,doc)};return new Element('section',doc);}
function render(r,p,options){assert.equal(typeof module.renderCeoReplanning,'function');module.renderCeoReplanning(r,p,options);}
test('no review and stale sources explicitly block submission without simulating a CEO answer',()=>{
 const r=root();render(r,{status:'NEEDS_REVIEW',canSubmit:false,tasks:[]});assert.match(r.textContent,/首份真实复盘/);assert.equal(nodes(r).filter(n=>n.tagName==='form').length,0);
 render(r,{status:'REVIEW_STALE',canSubmit:false,tasks:[]});assert.match(r.textContent,/变化|重新/);assert.doesNotMatch(r.textContent,/已生成|已执行/);
});
test('ready packet shows immutable review, changed current work and safe original task navigation',()=>{
 const r=root(),seen=[];render(r,{status:'AVAILABLE',canSubmit:true,review:{reviewId:'r',date:'2026-10-27',note:'<script>假设不是事实'},changedSinceReview:['store-400370-a'],tasks:[{taskId:'store-400370-a',title:'<img onerror=1>',status:'PENDING_VERIFICATION',version:5,allowedChoices:['WAIT']}]},{onTask:id=>seen.push(id)});
 assert.match(r.textContent,/<script>/);assert.match(r.textContent,/等待|待核验/);assert.match(r.textContent,/1/);assert.match(r.textContent,/未导入|未排程/);
 nodes(r).find(n=>n.tagName==='button').onclick();assert.deepEqual(seen,['store-400370-a']);
});
test('stored plan linkage renders per-task reasoning while old plans get no fabricated link',()=>{
 const r=root();assert.equal(typeof module.appendCeoReviewLink,'function');module.appendCeoReviewLink(r,null);assert.equal(r.textContent,'');
 module.appendCeoReviewLink(r,{reviewId:'r',reviewDate:'2026-10-27',rationale:'<script>继续补证',dispositions:[{taskId:'store-400370-a',choice:'DEFER',reason:'费用缺证'}]});assert.match(r.textContent,/承接复盘/);assert.match(r.textContent,/<script>/);assert.match(r.textContent,/费用缺证/);assert.match(r.textContent,/存档时.*未导入/);assert.match(r.textContent,/未排程/);
});
