import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const moduleUrl = pathToFileURL(path.resolve("dist/src/state-store.js")).href;
async function fixture(t, raw, backup) {
  const base = path.resolve(tmpdir());
  const dir = await mkdtemp(path.join(base, "state-safe-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), base);
    assert.ok(path.basename(dir).startsWith("state-safe-"));
    await rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, "run-state.json");
  if (raw !== undefined) await writeFile(file, raw);
  if (backup !== undefined) await writeFile(`${file}.backup`, backup);
  return { dir, file };
}
function run(f, script) {
  // 每个子进程在加载config前就隔离USER_DATA_DIR，RED阶段也不碰真实状态。
  const bootstrap = `import { StateStore } from ${JSON.stringify(moduleUrl)};
    import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
    import path from 'node:path';
    const file=path.join(process.env.USER_DATA_DIR,'run-state.json');
    const store=new StateStore();
    ${script}`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", bootstrap], {
    env: { ...process.env, USER_DATA_DIR: f.dir }, encoding: "utf8", timeout: 15000,
  }).trim());
}
const good = JSON.stringify({ stage: "IDENTIFIED", running: false, objectiveInfo: "商品A" });

test("损坏主状态无快照时保留原文并显式报错", async t => {
  const f = await fixture(t, "{broken-state");
  const outcome = run(f, `let code;try{await store.load()}catch(e){code=e.code}console.log(JSON.stringify({code}));`);
  assert.equal(outcome.code, "E_JSON_INVALID");
  assert.equal(await readFile(f.file, "utf8"), "{broken-state");
});
for (const invalid of ["null", "[]", '{"product":"wrong file"}']) {
  test(`结构非法状态${invalid}不能被重置覆盖`, async t => {
    const f = await fixture(t, invalid);
    const outcome = run(f, `let code;try{await store.load()}catch(e){code=e.code}console.log(JSON.stringify({code}));`);
    assert.equal(outcome.code, "E_JSON_INVALID");
    assert.equal(await readFile(f.file, "utf8"), invalid);
  });
}
test("读取运行中的有效状态仍恢复为可继续的暂停状态", async t => {
  const f = await fixture(t, JSON.stringify({ stage: "GENERATING_IMAGES", running: true, generatedImageNumbers: [1, 2] }));
  const actual = run(f, `console.log(JSON.stringify(await store.load()));`);
  assert.equal(actual.stage, "PAUSED");
  assert.equal(actual.interruptedStage, "GENERATING_IMAGES");
  assert.equal(actual.running, false);
  assert.deepEqual(actual.generatedImageNumbers, [1, 2]);
});
test("有效快照可恢复损坏主文件并保留损坏副本", async t => {
  const f = await fixture(t, "{broken-state", good);
  const actual = run(f, `console.log(JSON.stringify(await store.load()));`);
  assert.equal(actual.stage, "IDENTIFIED");
  assert.equal(actual.objectiveInfo, "商品A");
  const preserved = (await readdir(f.dir)).filter(name => name.includes(".corrupt-"));
  assert.equal(preserved.length, 1);
  assert.equal(await readFile(path.join(f.dir, preserved[0]), "utf8"), "{broken-state");
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).objectiveInfo, "商品A");
});
test("主文件与快照都坏时均保留而不伪造初始状态", async t => {
  const f = await fixture(t, "{bad-main", "{bad-backup");
  const outcome = run(f, `let code;try{await store.load()}catch(e){code=e.code}console.log(JSON.stringify({code}));`);
  assert.equal(outcome.code, "E_JSON_INVALID");
  assert.equal(await readFile(f.file, "utf8"), "{bad-main");
  assert.equal(await readFile(`${f.file}.backup`, "utf8"), "{bad-backup");
});
test("主文件缺失但有有效快照时恢复原任务", async t => {
  const f = await fixture(t, undefined, good);
  const actual = run(f, `console.log(JSON.stringify(await store.load()));`);
  assert.equal(actual.stage, "IDENTIFIED");
  assert.equal(actual.objectiveInfo, "商品A");
});
test("连续更新保留最后有效版本用于恢复", async t => {
  const f = await fixture(t, good);
  const actual = run(f, `await store.load();await store.update({stage:'PLANNED'});await writeFile(file,'{bad');console.log(JSON.stringify(await new StateStore().load()));`);
  assert.equal(actual.stage, "IDENTIFIED");
  assert.equal(actual.objectiveInfo, "商品A");
});
test("并发状态更新不会丢字段或留下无法解析的JSON", async t => {
  const f = await fixture(t, good);
  const actual = run(f, `await store.load();await Promise.all(Array.from({length:20},(_,i)=>store.update({['done_'+i]:i})));console.log(JSON.stringify({memory:store.get(),disk:JSON.parse(await readFile(file,'utf8'))}));`);
  for (let i = 0; i < 20; i++) {
    assert.equal(actual.memory[`done_${i}`], i);
    assert.equal(actual.disk[`done_${i}`], i);
  }
});
test("写入失败不能让内存提前显示新阶段", async t => {
  const f = await fixture(t, good);
  const actual = run(f, `await store.load();await rename(file,file+'.held');await mkdir(file);await writeFile(path.join(file,'sentinel'),'keep');let rejected=false;try{await store.update({stage:'COMPLETED'})}catch{rejected=true}console.log(JSON.stringify({rejected,state:store.get()}));`);
  assert.equal(actual.rejected, true);
  assert.equal(actual.state.stage, "IDENTIFIED");
  assert.equal(await readFile(path.join(f.file, "sentinel"), "utf8"), "keep");
});
test("不可序列化的更新不污染内存和磁盘", async t => {
  const f = await fixture(t, good);
  const actual = run(f, `await store.load();let rejected=false;try{await store.update({bad:1n})}catch{rejected=true}console.log(JSON.stringify({rejected,hasBad:Object.hasOwn(store.get(),'bad'),disk:JSON.parse(await readFile(file,'utf8'))}));`);
  assert.equal(actual.rejected, true);
  assert.equal(actual.hasBad, false);
  assert.equal(actual.disk.stage, "IDENTIFIED");
});
test("首次启动没有主文件和快照时正常初始化", async t => {
  const f = await fixture(t);
  const actual = run(f, `console.log(JSON.stringify(await store.load()));`);
  assert.equal(actual.stage, "IDLE");
  assert.equal(actual.running, false);
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).stage, "IDLE");
});

test("选品并发启动在持久化期间仍只取得一个会话", async t => {
  const f = await fixture(t);
  const selectionModule = pathToFileURL(path.resolve("dist/src/product-selection-service.js")).href;
  const actual = run(f, `
    const {SelectionService}=await import(${JSON.stringify(selectionModule)});
    let calls=0;
    store.persist=async()=>{};
    const ai={checkReady:async()=>({ready:true}),createBlankChat:async()=>{calls++;throw new Error('test stop before any external action')}};
    const service=new SelectionService(store,{chatgpt:ai});
    const settled=await Promise.allSettled([service.runSelection({}),service.runSelection({})]);
    console.log(JSON.stringify({calls,rejected:settled.filter(x=>x.status==='rejected').length}));
  `);
  assert.equal(actual.calls, 1);
  assert.equal(actual.rejected, 1);
});

test("启动落盘失败后释放启动锁并保留原阶段", async t => {
  const f = await fixture(t);
  const actual = run(f, `
    store.persist=async()=>{throw new Error('test write failure')};
    const pending=store.update({running:true,stage:'STARTING'});
    const during=store.get();await pending.catch(()=>{});
    console.log(JSON.stringify({during,after:store.get()}));
  `);
  assert.equal(actual.during.running, true, "启动中的互斥必须先预留");
  assert.equal(actual.during.stage, "IDLE", "阶段尚未落盘，不得提前提交");
  assert.equal(actual.after.running, false);
  assert.equal(actual.after.stage, "IDLE");
});
