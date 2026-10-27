// 主路径标题提取三方对比：锚定版（现状） vs 解析层 vs 分层（拟改造）
//
// 背景：P1 只把 fallback 路径（dianxiaomi-facts.js）换成了解析层，
// AI 主路径 automation-service.js:61 的 extractCleanTitle 仍是手写旧正则，
// 而它才是跑批时真正强制覆盖 aiFacts.title.en 的那一个。
//
// 三方定义：
//   A 锚定版 = automation-service.js:61 现状（锁 3.1 小节后第一行，>=10 字就收）
//   B 解析层 = listing-contract.js extractTitle（全文扫描 + 126-128 打分 + 锚点回退）
//   C 分层    = A 优先，A 空才退 B  <-- 拟采用的形态
//
// 关键性质：C 以 A 为优先，故「A 有值时 C === A」，回归恒为 0（构造保证）。
// 真正要量化的只有一件事：A 锚定失败（返回空）时，B 能救回多少。
//
// 用法（项目根执行）：node tools/verify-title-mainpath.mjs [根目录]
// 只读，不写任何业务文件。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractTitle } from '../dist/src/listing-contract.js';

// A：automation-service.js:61 原样复刻
function anchoredExtract(listingText) {
  if (!listingText) return '';
  const match = listingText.match(/3\.1\s*[\s\S]*?算法标题\s*Clean Title[\s\S]*?\n\s*\n?\s*([^\n]+?)\s*\n/i);
  if (match && match[1]) {
    const title = match[1].trim();
    if (title.length >= 10) return title;
  }
  const fallback = listingText.match(/Clean Title[\s\S]*?\n\s*\n?\s*([^\n]+?)\s*\n/i);
  if (fallback && fallback[1]) {
    const title = fallback[1].trim();
    if (title.length >= 10) return title;
  }
  return '';
}

// C：分层
function layeredExtract(listingText) {
  const anchored = anchoredExtract(listingText);
  if (anchored) return anchored;
  return extractTitle(listingText);
}

const ROOT = process.argv[2] || 'F:/yikuaborder-deploy/已完成产品';

async function findListings(dir, out = [], depth = 0) {
  if (depth > 5) return out;
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await findListings(full, out, depth + 1);
    else if (e.name === '04_LISTING_CONTENT.md') out.push(full);
  }
  return out;
}

const files = await findListings(ROOT);

let aEmpty = 0;            // 锚定失败
let bEmpty = 0;
let cEmpty = 0;
const rescued = [];         // A 空 → C 有（分层真正带来的增量）
const regression = [];      // C 相对 A 的回归，构造上应为 0
const stillEmpty = [];      // A 空且 C 也空（解析层也没辙，需人工）
const inRange = { a: 0, c: 0 };

for (const file of files) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  const a = anchoredExtract(text);
  const b = extractTitle(text);
  const c = layeredExtract(text);

  if (!a) aEmpty += 1;
  if (!b) bEmpty += 1;
  if (!c) cEmpty += 1;
  if (a && a.length >= 126 && a.length <= 128) inRange.a += 1;
  if (c && c.length >= 126 && c.length <= 128) inRange.c += 1;

  if (!a && c) rescued.push({ file, c });
  else if (!a && !c) stillEmpty.push(file);
  if (a && !c) regression.push({ file, a });
  // 一致性自检：A 有值时 C 必须等于 A
  if (a && c !== a) regression.push({ file, a, c, note: 'C!==A 违反优先约定' });
}

const rel = (p) => p.replace(ROOT, '<root>');

console.log(`产物总数:            ${files.length}`);
console.log(`A 锚定版提不到:      ${aEmpty}   <-- 主路径当前真实缺口`);
console.log(`B 解析层提不到:      ${bEmpty}`);
console.log(`C 分层提不到:        ${cEmpty}`);
console.log('');
console.log(`分层救回 (A空→C有):  ${rescued.length}   <-- 本次改造的净收益`);
console.log(`仍然提不到 (A空C空): ${stillEmpty.length}`);
console.log(`回归 (A有→C空/变):   ${regression.length}   <-- 构造上必须为 0`);
console.log('');
console.log(`标题落在 126-128:    A=${inRange.a}  C=${inRange.c}`);

if (rescued.length) {
  console.log('\n救回明细（前 6）:');
  for (const r of rescued.slice(0, 6)) {
    console.log(`  ${rel(r.file).slice(-72)}`);
    console.log(`    → ${r.c.slice(0, 92)} (${r.c.length} 字)`);
  }
}

if (regression.length) {
  console.log('\n❌ 回归明细（必须为空）:');
  for (const r of regression) console.log(`  ${rel(r.file).slice(-72)}`);
}

if (stillEmpty.length) {
  console.log(`\n仍提不到样例（前 5，共 ${stillEmpty.length}）:`);
  for (const f of stillEmpty.slice(0, 5)) console.log(`  ${rel(f).slice(-72)}`);
}

const verdict = regression.length === 0;
console.log(`\n判定: ${verdict ? 'PASS —— 零回归' : 'FAIL —— 出现回归'}`);
console.log(`净收益: 救回 ${rescued.length} / 缺口 ${aEmpty}`);

// ── 源码级复核 ────────────────────────────────────────────────
// 上面的 anchoredExtract 是手抄的复刻版。手抄可能失真，所以再从
// automation-service.js 的真实源码里抽出这两个函数跑一遍，逐份比对。
// 全部一致，才能说「脚本结论 == 生产代码结论」。
const SRC = new URL('../dist/src/automation-service.js', import.meta.url);
const src = await readFile(SRC, 'utf8');
const anchoredFn = src.match(/function anchoredCleanTitle\(listingText\)\s*\{[\s\S]*?\n\}/);
const cleanFn = src.match(/function extractCleanTitle\(listingText\)\s*\{[\s\S]*?\n\}/);
if (!anchoredFn || !cleanFn) {
  console.log('\n❌ 源码级复核失败：抽不到函数（函数名或签名已变？）');
  process.exit(1);
}
const realCleanTitle = new Function(
  'extractTitleFromListing',
  `${anchoredFn[0]}\n${cleanFn[0]}\nreturn extractCleanTitle;`
)(extractTitle);

let mismatch = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (realCleanTitle(text) !== layeredExtract(text)) {
    mismatch += 1;
    if (mismatch <= 3) console.log(`  差异: ${rel(file).slice(-70)}`);
  }
}
console.log(`\n源码级复核: ${files.length} 份中 ${mismatch} 份与复刻版不一致  <-- 必须为 0`);
const finalOk = verdict && mismatch === 0;
console.log(`\n最终判定: ${finalOk ? 'PASS' : 'FAIL'}`);
process.exit(finalOk ? 0 : 1);
