import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderCeoDailyReview,clearCeoDailyReview,businessTaskCounts} from '../../public/ceo-daily-review.js';
import {renderCeoReplanning,appendCeoReviewLink} from '../../public/ceo-replanning.js';

const module=await import('../../public/ceo-operating-brief.js').catch(()=>({}));
class Element{
 constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.dataset={};this.attributes={};this.style={};this._text='';this.className='';this.classList={add:()=>{}};}
 set textContent(v){this._text=String(v);this.children=[];}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set innerHTML(v){throw new Error('UNSAFE_HTML_WRITE');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this._text='';this.children=[...nodes];}
 setAttribute(k,v){this.attributes[k]=v;}
}
function root(){const doc={createElement:tag=>new Element(tag,doc)};return new Element('section',doc);}
function nodes(n){return[n,...n.children.flatMap(nodes)];}
function brief(){return{schema:'ceo-operating-brief/v1',status:'AVAILABLE',plan:{fromDate:'2026-10-28',toDate:'2026-11-03',today:'2026-10-28',timeZone:'Asia/Shanghai',isExpired:false},
 baseline:{period:['2026-10-19','2026-10-25'],sourceTimeZone:'PST',paidUnitsTotal:28,dailyAverage:4,products:2,skus:3,netProfitCNY:null,formalTargetGap:null},
 tiers:[{name:'主推候选',products:1,historicalPaidUnits:20,dailyTargetProposal:140},{name:'辅助候选',products:1,historicalPaidUnits:8,dailyTargetProposal:60}],
 candidates:[{productId:'10001',name:'<img src=x onerror=alert(1)>',historicalPaidUnits:20,dailyTargetProposal:140}],
 days:Array.from({length:7},(_,i)=>({date:new Date(Date.UTC(2026,9,28+i)).toISOString().slice(0,10),theme:`核对${i+1}`,coreMinutes:30,routineMinutes:120,emergencyMinutes:60,
  actions:[{title:`第${i+1}日动作`,estimatedMinutes:30,sourceTaskRef:'store-400370-test',steps:['读取资料'],acceptance:'核对证据',ifBlocked:'保留缺项',liveTask:{status:'DONE',version:6,attempt:1}}]}))};}
function render(r,b,options){assert.equal(typeof module.renderCeoOperatingBrief,'function','经营简报界面尚未实现');module.renderCeoOperatingBrief(r,b,options);}

test('UI labels history and proposal while retaining null as pending',()=>{
 const r=root();render(r,brief());
 assert.match(r.textContent,/历史观察/);assert.match(r.textContent,/目标分摊草案/);assert.match(r.textContent,/净利润.*待核/);
 assert.doesNotMatch(r.textContent,/净利润[：\s]*[¥￥]?0/);assert.match(r.textContent,/PST/);assert.match(r.textContent,/未排入执行队列/);
});
test('seven date buttons switch action details without executing anything',()=>{
 const r=root(),seen=[];render(r,brief(),{onDay:date=>seen.push(date)});assert.match(r.textContent,/第1日动作/);
 const dates=nodes(r).filter(n=>n.tagName==='button'&&/^2026-|^2026-/.test(n.textContent));assert.equal(dates.length,7);
 dates[1].onclick();assert.match(r.textContent,/第2日动作/);assert.doesNotMatch(r.textContent,/第1日动作/);
 assert.deepEqual(seen,['2026-10-28','2026-10-29']);
 assert.match(r.textContent,/原任务当前状态/);assert.match(r.textContent,/不代表该日动作已完成/);
});
test('task button only invokes navigation and remote text is never interpreted as HTML',()=>{
 const r=root(),seen=[];render(r,brief(),{onTask:id=>seen.push(id)});
 assert.match(r.textContent,/<img src=x onerror=alert\(1\)>/);
 nodes(r).find(n=>n.tagName==='button'&&n.textContent==='查看原任务').onclick();assert.deepEqual(seen,['store-400370-test']);
});
test('unavailable and expired sources are explicit and do not display stale values as current',()=>{
 const r=root();render(r,{status:'UNAVAILABLE',reason:'SOURCE_HASH_MISMATCH'});assert.match(r.textContent,/暂不可用/);assert.match(r.textContent,/任务/);
 const b=brief();b.plan.isExpired=true;render(r,b);assert.match(r.textContent,/已过期/);
});

test('full workspace mount hides authenticated data when only the brief request gets a session-expiry 401',async()=>{
 const source=(await readFile(new URL('../../public/ceo-tasks.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function mountCeoTaskWorkspace','function mountCeoTaskWorkspace');
 const r=root(),fields=new Map();
 r.querySelector=selector=>{const match=selector.match(/data-ceo="([^"]+)"/);if(!match)return null;if(!fields.has(match[1]))fields.set(match[1],new Element('div',r.ownerDocument));return fields.get(match[1]);};
 r.querySelectorAll=()=>[];
 for(const id of ['workspace','login','identity','login-form','refresh','logout','token'])r.querySelector(`[data-ceo="${id}"]`);
 const calls=[];
 const fakeFetch=async url=>{const route=url.split('/').at(-1);calls.push(route);const payload={me:{actor:{id:'owner-local',role:'owner'}},context:{goal:{capacityMinutes:300,bufferMinutes:60},gaps:[]},tasks:{tasks:[]},plans:{plans:[]},'operating-brief':{error:'UNAUTHORIZED'}}[route];return{ok:route!=='operating-brief',json:async()=>payload};};
 r.ownerDocument.querySelector=()=>null;
 const mount=new Function('createCeoTaskLayout','renderCeoOperatingBrief','renderCeoDailyReview','clearCeoDailyReview','businessTaskCounts','renderCeoReplanning','appendCeoReviewLink','fetch','document','AbortSignal',source+'\nreturn mountCeoTaskWorkspace;')(()=>{},()=>{},renderCeoDailyReview,clearCeoDailyReview,businessTaskCounts,renderCeoReplanning,appendCeoReviewLink,fakeFetch,r.ownerDocument,AbortSignal);
 mount(r);await new Promise(resolve=>setImmediate(resolve));
 assert.ok(calls.includes('operating-brief'));assert.equal(fields.get('workspace').hidden,true);assert.equal(fields.get('login').hidden,false);
 assert.doesNotMatch(fields.get('identity').textContent,/经营者/);
});
test('refresh network failure hides private review and form while retaining recovery separately',async()=>{
 const source=(await readFile(new URL('../../public/ceo-tasks.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function mountCeoTaskWorkspace','function mountCeoTaskWorkspace');
 const r=root(),fields=new Map();r.querySelector=selector=>{const match=selector.match(/data-ceo="([^"]+)"/);if(!match)return null;if(!fields.has(match[1]))fields.set(match[1],new Element('div',r.ownerDocument));return fields.get(match[1]);};r.querySelectorAll=()=>[];r.ownerDocument.querySelector=()=>null;
 let offline=false;
 const fakeFetch=async url=>{if(offline)throw new TypeError('network failed');const route=url.split('/').at(-1);return{ok:true,json:async()=>({me:{actor:{id:'owner-local',role:'owner'}},context:{contextId:'context-test',goal:{capacityMinutes:300,bufferMinutes:60},gaps:[]},tasks:{tasks:[]},plans:{plans:[]},'operating-brief':brief(),'daily-reviews':{reviews:[]}}[route])};};
 const mount=new Function('createCeoTaskLayout','renderCeoOperatingBrief','renderCeoDailyReview','clearCeoDailyReview','businessTaskCounts','renderCeoReplanning','appendCeoReviewLink','fetch','document','AbortSignal',source+'\nreturn mountCeoTaskWorkspace;')(()=>{},(_r,_b,options)=>options.onDay('2026-10-28'),review=>{review.textContent='私有历史与草稿';},clearCeoDailyReview,businessTaskCounts,renderCeoReplanning,appendCeoReviewLink,fakeFetch,r.ownerDocument,AbortSignal);
 mount(r);await new Promise(resolve=>setImmediate(resolve));assert.equal(fields.get('workspace').hidden,false);assert.match(fields.get('daily-review').textContent,/私有/);
 offline=true;fields.get('refresh').onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(fields.get('workspace').hidden,true);assert.equal(fields.get('daily-review').textContent,'');
});
