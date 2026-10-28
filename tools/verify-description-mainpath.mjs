// 商品描述（3.2 AEO 五点）提取三方对比 —— 只读量化，不改任何生产代码。
//
// 背景：与标题同构的「重复实现」问题。两份独立实现都用于填 description.pc，
// 但都不是从解析层取：
//   A = automation-service.js: extractAeoSection   （AI 主路径，写 aiFacts.description）
//   B = dianxiaomi-facts.js:   extractDetailLocal  （fallback，写 description.pc）
//   C = listing-contract.js:   describeBoundary + descriptionLines（解析层）
//
// 已知的三处语义差异（先列为可证伪假设，再用 450 份产物实测）：
//   1. A 的起点正则要求「3.2」编号必需，B 写成可选 → 英文批量包（无编号）A 应失败
//   2. A 的措辞表缺 "AEO Structured Bullet Points"，B 有 → 英文包 A 应失败
//   3. A 的终点不含「商品详情页 / Product Detail Page」，B 含
//      → 当 3.x 编号缺失时，A 会把 3.3 正文一起吞进来（串段）
//   4. B 有最小长度 30 的校验，A 没有 → A 可能返回极短内容
//
// 用法（项目根执行）：node tools/verify-description-mainpath.mjs [根目录]

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describeBoundary, descriptionLines } from '../dist/src/listing-contract.js';

// A：automation-service.js extractAeoSection 原样复刻
function aeoExtract(listingText) {
  if (!listingText) return '';
  const startMatch = listingText.match(
    /3\.2\s*[\s\S]*?(?:AEO\s*结构化五点描述|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i
  );
  if (!startMatch) return '';
  const remainder = listingText.slice(startMatch.index + startMatch[0].length);
  const endMatch = remainder.match(/\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+)/i);
  const endIndex = endMatch ? endMatch.index : remainder.length;
  return remainder.slice(0, endIndex).trim();
}

// B：dianxiaomi-facts.js extractDetailLocal 原样复刻
function detailExtract(listingText) {
  if (!listingText) return '';
  const startMatch = listingText.match(
    /(?:3\.2\s*[\s\S]*?)?(?:AEO\s*结构化五点描述|AEO Structured Bullet Points|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i
  );
  if (!startMatch) return '';
  const remainder = listingText.slice(startMatch.index + startMatch[0].length);
  const endMatch = remainder.match(
    /\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+|商品详情页内容|商品详情页|Product Detail Page)/i
  );
  const endIndex = endMatch ? endMatch.index : remainder.length;
  const section = remainder.slice(0, endIndex).trim();
  return section.length >= 30 ? section : '';
}

// C：解析层
function contractExtract(listingText) {
  const b = describeBoundary(listingText || '');
  if (!b.matched) return '';
  return descriptionLines(b.content).join('\n');
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

let aEmpty = 0, bEmpty = 0, cEmpty = 0;
let rescuedByB = 0;
let rescuedByC = 0;
let bothEmpty = 0;
let diverge = 0;
let aTooShort = 0;
let aBleed = 0;
const divergeSamples = [];
const bleedSamples = [];

for (const file of files) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  const a = aeoExtract(text);
  const b = detailExtract(text);
  const c = contractExtract(text);

  if (!a) aEmpty += 1;
  if (!b) bEmpty += 1;
  if (!c) cEmpty += 1;

  if (!a && b) rescuedByB += 1;
  if (!a && c) rescuedByC += 1;
  if (!a && !b) bothEmpty += 1;
  if (a && b && a !== b) {
    diverge += 1;
    if (divergeSamples.length < 3) divergeSamples.push({ file, a, b });
  }
  if (a && a.length < 30) aTooShort += 1;
  if (a && /商品详情页内容|Product Detail Page/i.test(a)) {
    aBleed += 1;
    if (bleedSamples.length < 3) bleedSamples.push({ file, len: a.length });
  }
}

const rel = (p) => p.replace(ROOT, '<root>');
console.log(`产物总数:              ${files.length}`);
console.log(`A 主路径提不到:        ${aEmpty}`);
console.log(`B fallback 提不到:     ${bEmpty}`);
console.log(`C 解析层提不到:        ${cEmpty}`);
console.log('');
console.log(`A空->B有（B 可救回）:  ${rescuedByB}`);
console.log(`A空->C有（C 可救回）:  ${rescuedByC}`);
console.log(`A、B 都空:             ${bothEmpty}`);
console.log('');
console.log(`A、B 都有但内容不同:   ${diverge}   <-- 双真相分歧度`);
console.log(`A 有但 <30 字:         ${aTooShort}   <-- A 缺最小长度校验`);
console.log(`A 含 3.3/详情页标记:   ${aBleed}   <-- 串段实证（假设 3）`);

if (divergeSamples.length) {
  console.log('\n分歧样例（前 3）:');
  for (const s of divergeSamples) {
    console.log(`  ${rel(s.file).slice(-70)}`);
    console.log(`    A(${s.a.length}): ${s.a.slice(0, 70).replace(/\n/g, ' | ')}`);
    console.log(`    B(${s.b.length}): ${s.b.slice(0, 70).replace(/\n/g, ' | ')}`);
  }
}
if (bleedSamples.length) {
  console.log('\n串段样例（前 3，A 把 3.3 正文也吞了）:');
  for (const s of bleedSamples) console.log(`  ${rel(s.file).slice(-70)}  A=${s.len} 字`);
}

// 源码级复核：上面是手抄复刻，可能失真。从真实源码抽函数跑一遍逐份比对。
const srcA = await readFile(new URL('../dist/src/automation-service.js', import.meta.url), 'utf8');
const srcB = await readFile(new URL('../dist/src/dianxiaomi-facts.js', import.meta.url), 'utf8');
const fnA = srcA.match(/function extractAeoSection\(listingText\)\s*\{[\s\S]*?\n\}/);
const fnB = srcB.match(/function extractDetailLocal\(listingText\)\s*\{[\s\S]*?\n\}/);
if (!fnA || !fnB) {
  console.log('\n[FAIL] 源码级复核失败：抽不到函数（函数名或签名已变？）');
  process.exit(1);
}
const realA = new Function(`${fnA[0]}\nreturn extractAeoSection;`)();
const realB = new Function(`${fnB[0]}\nreturn extractDetailLocal;`)();

let mismatch = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (realA(text) !== aeoExtract(text) || realB(text) !== detailExtract(text)) {
    mismatch += 1;
    if (mismatch <= 3) console.log(`  差异: ${rel(file).slice(-70)}`);
  }
}
console.log(`\n源码级复核: ${files.length} 份中 ${mismatch} 份与复刻版不一致  <-- 必须为 0`);
const ok = mismatch === 0;
console.log(`\n最终判定: ${ok ? 'PASS（复刻忠实，上面的数字可采信）' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
