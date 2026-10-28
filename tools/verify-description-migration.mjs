// 描述提取迁移对比：现状 A vs 新方案（B 优先 || 解析层兜底）
//
// 改前先拿数，再动手。回答三个可证伪的问题：
//   1. A 空、新方案有的有多少？（救回）
//   2. A 有、新方案空的有没有？（回归，必须为 0）
//   3. A 有、新方案也有但内容不同的有多少？（变化，需逐类说明为什么变、是不是修好了）
//
//   A   = automation-service.js extractAeoSection（现状，AI 主路径）
//   NEW = dianxiaomi-facts.js extractDetailLocal || 解析层 describeBoundary
//
// 用法（项目根执行）：node tools/verify-description-migration.mjs [根目录]
// 只读，不写任何业务文件。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describeBoundary, descriptionLines } from '../dist/src/listing-contract.js';

// A：现状（automation-service.js extractAeoSection）
function currentExtract(listingText) {
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

// B：dianxiaomi-facts.js extractDetailLocal
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

// NEW：B 优先，B 空退 C
function newExtract(listingText) {
  return detailExtract(listingText) || contractExtract(listingText);
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

let rescued = 0;      // A 空 → NEW 有
let regression = 0;   // A 有 → NEW 空
let changed = 0;      // 都有但不同
let same = 0;
let bothEmpty = 0;
// 变化分类：是否属于「A 串段被修好」
let changedBleedFix = 0;
let changedOther = 0;
const changeSamples = [];
const regressionSamples = [];

for (const file of files) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  const a = currentExtract(text);
  const n = newExtract(text);

  if (!a && n) rescued += 1;
  else if (a && !n) {
    regression += 1;
    if (regressionSamples.length < 5) regressionSamples.push(file);
  } else if (!a && !n) bothEmpty += 1;
  else if (a === n) same += 1;
  else {
    changed += 1;
    // A 含 3.3 标记 = 串段，新方案把它截掉了 → 属于修好
    const aBleed = /商品详情页内容|Product Detail Page/i.test(a);
    if (aBleed) changedBleedFix += 1; else changedOther += 1;
    if (changeSamples.length < 3) changeSamples.push({ file, a, n, aBleed });
  }
}

const rel = (p) => p.replace(ROOT, '<root>');
console.log(`产物总数:            ${files.length}`);
console.log('');
console.log(`救回 (A空→NEW有):    ${rescued}`);
console.log(`回归 (A有→NEW空):    ${regression}   <-- 必须为 0`);
console.log(`内容变化:            ${changed}`);
console.log(`  其中 修好串段:     ${changedBleedFix}`);
console.log(`  其中 其它变化:     ${changedOther}   <-- 需人工看`);
console.log(`完全一致:            ${same}`);
console.log(`两边都空:            ${bothEmpty}`);

if (regressionSamples.length) {
  console.log('\n❌ 回归明细（前 5）:');
  for (const f of regressionSamples) console.log(`  ${rel(f).slice(-72)}`);
}

if (changeSamples.length) {
  console.log('\n变化样例（前 3）:');
  for (const s of changeSamples) {
    console.log(`  ${rel(s.file).slice(-70)}  ${s.aBleed ? '[串段→已修]' : '[其它]'}`);
    console.log(`    A(${s.a.length}): ${s.a.slice(0, 60).replace(/\n/g, ' | ')}`);
    console.log(`    NEW(${s.n.length}): ${s.n.slice(0, 60).replace(/\n/g, ' | ')}`);
  }
}

const verdict = regression === 0;
console.log(`\n判定: ${verdict ? 'PASS —— 零回归，可动手' : 'FAIL —— 有回归，先查清'}`);

// ── 改后源码级复核 ────────────────────────────────────────────
// 上面的 NEW 是手抄复刻。改完生产代码后，从真实源码抽出 extractAeoSection
// （以及它所依赖的 extractDetailLocal）跑一遍，逐份比对是否等于 NEW。
// 全部一致，才能说「脚本预测 == 生产代码实际行为」。
const srcA = await readFile(new URL('../dist/src/automation-service.js', import.meta.url), 'utf8');
const srcB = await readFile(new URL('../dist/src/dianxiaomi-facts.js', import.meta.url), 'utf8');
const fnA = srcA.match(/function extractAeoSection\(listingText\)\s*\{[\s\S]*?\n\}/);
const fnB = srcB.match(/export function extractDetailLocal\(listingText\)\s*\{[\s\S]*?\n\}/);
if (!fnA || !fnB) {
  console.log('\n[FAIL] 源码级复核失败：抽不到函数（函数名或签名已变？）');
  process.exit(1);
}
const realB = new Function(`${fnB[0].replace(/^export\s+/, '')}\nreturn extractDetailLocal;`)();
const realA = new Function(
  'extractDetailLocal', 'describeBoundary', 'descriptionLines',
  `${fnA[0]}\nreturn extractAeoSection;`
)(realB, describeBoundary, descriptionLines);

let mismatch = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8').catch(() => '');
  if (realA(text) !== newExtract(text)) {
    mismatch += 1;
    if (mismatch <= 3) console.log(`  差异: ${rel(file).slice(-72)}`);
  }
}
console.log(`\n改后源码级复核: ${files.length} 份中 ${mismatch} 份与复刻版不一致  <-- 必须为 0`);
const finalOk = verdict && mismatch === 0;
console.log(`\n最终判定: ${finalOk ? 'PASS —— 生产代码行为与脚本预测一致' : 'FAIL'}`);
process.exit(finalOk ? 0 : 1);
