// 标题提取 A/B 对比：旧手写逻辑 vs 新 listing-contract 实现。
//
// 目的不是「新版看起来更好」，而是回答三个可证伪的问题：
//   1. 旧版提不到标题的产物，新版能提到多少？（救回）
//   2. 旧版能提到、新版提不到的，有几个？（回归，必须为 0 或可解释）
//   3. 标题长度分布怎么变？（旧允许 10–220，新优先 126–128）
//
// 用法（项目根执行）：node tools/verify-title-extraction.mjs [根目录]
// 只读，不写任何业务文件。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractTitle } from '../dist/src/listing-contract.js';

// 旧实现原样复刻（dianxiaomi-facts.js 2026-10-27 之前的样子）
function legacyExtract(listingText) {
  if (!listingText) return '';
  const lines = listingText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (!/Clean Title/i.test(lines[i])) continue;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const line = lines[j].trim();
      if (!line) continue;
      if (/^(Final Title|Clean Title|字符核算|校验|Title)/i.test(line)) continue;
      if (line.length >= 10 && line.length <= 220) return line;
    }
  }
  return '';
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
let legacyEmpty = 0, neuEmpty = 0;
const rescued = [];      // 旧空 → 新有
const regressed = [];    // 旧有 → 新空
const changed = [];      // 两边都有但内容不同
const same = [];

for (const file of files) {
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { continue; }
  const before = legacyExtract(text);
  const after = extractTitle(text);
  if (!before) legacyEmpty += 1;
  if (!after) neuEmpty += 1;

  if (!before && after) rescued.push({ file, after });
  else if (before && !after) regressed.push({ file, before });
  else if (before && after && before !== after) changed.push({ file, before, after });
  else if (before && after) same.push(file);
}

const rel = (p) => p.replace(ROOT, '<root>');
const bucket = (n) => (n < 100 ? '<100' : n < 126 ? '100-125' : n <= 128 ? '126-128✅' : n <= 220 ? '129-220' : '>220');

console.log(`产物总数: ${files.length}`);
console.log(`旧版提不到标题: ${legacyEmpty}`);
console.log(`新版提不到标题: ${neuEmpty}`);
console.log(`救回(旧空→新有): ${rescued.length}`);
console.log(`回归(旧有→新空): ${regressed.length}  <-- 必须为 0`);
console.log(`内容变化: ${changed.length}   完全一致: ${same.length}`);

if (rescued.length) {
  console.log('\n救回明细（前 8）:');
  for (const r of rescued.slice(0, 8)) {
    console.log(`  ${rel(r.file).slice(-70)}`);
    console.log(`    → ${r.after.slice(0, 90)} (${r.after.length} 字)`);
  }
}

if (regressed.length) {
  console.log('\n回归明细（全部）:');
  for (const r of regressed) {
    console.log(`  ${rel(r.file).slice(-70)}`);
    console.log(`    旧: ${r.before.slice(0, 80)}`);
  }
}

if (changed.length) {
  const dist = new Map();
  for (const c of changed) {
    const k = `${bucket(c.before.length)} → ${bucket(c.after.length)}`;
    dist.set(k, (dist.get(k) || 0) + 1);
  }
  console.log('\n长度变化分布:');
  [...dist.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n.toString().padStart(4)}  ${k}`));
  console.log('\n内容变化样例（前 3）:');
  for (const c of changed.slice(0, 3)) {
    console.log(`  ${rel(c.file).slice(-60)}`);
    console.log(`    旧(${c.before.length}): ${c.before.slice(0, 80)}`);
    console.log(`    新(${c.after.length}): ${c.after.slice(0, 80)}`);
  }
}

const verdict = regressed.length === 0 && rescued.length > 0;
console.log(`\n判定: ${verdict ? 'PASS —— 有救回、无回归' : 'REVIEW —— 需人工看回归或救回为 0'}`);
process.exit(verdict ? 0 : 1);
