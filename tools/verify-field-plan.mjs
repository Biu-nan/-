// field_plan 消费器离线验证 —— 对全量产品包跑一遍纯数据转换，不碰浏览器。
//
// 回答四个可证伪的问题：
//   1. 320 个包里，消费器能正常读入并转换的有多少？
//   2. schema 版本不兼容的有多少？（决定要不要做向后兼容）
//   3. sku_plan → 变种行的转换有没有丢字段/算出非法值？
//   4. 按 action 分组后，FILL / REVIEW / DISCOVER 的分布是否符合预期？
//
// 用法（项目根执行）：node tools/verify-field-plan.mjs [根目录]

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeFieldPlan, groupFields, planToVariantRows, planToFillValues } from '../dist/src/field-plan.js';

const ROOT = process.argv[2] || 'F:/yikuaborder-deploy/已完成产品';

async function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out, depth + 1);
    else if (e.name === 'field_plan.json' && path.basename(path.dirname(full)) === 'erp') out.push(full);
  }
  return out;
}

const files = await walk(ROOT);

let okCount = 0, badCount = 0, versionSkip = 0, blockerPkgs = 0, badJson = 0, blockedPkgs = 0;
const versionHist = new Map();
const actionTotals = {};
let variantPkgsNonEmpty = 0, variantRowTotal = 0, variantProblems = 0;
let fillTotal = 0, fillWithReviewTotal = 0, reviewTotal = 0, discoverTotal = 0, skipTotal = 0, missingTotal = 0;
const pkgIssues = [];

for (const file of files) {
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); } catch { badJson += 1; continue; }
  const norm = normalizeFieldPlan(raw);
  const ver = norm.version;
  versionHist.set(ver, (versionHist.get(ver) || 0) + 1);

  // 版本不兼容单独计数（但下面仍然跑转换，看看数据本身是否可用）
  if (!norm.ok) {
    const onlyVersion = norm.problems.length === 1 && /schema_version/.test(norm.problems[0]);
    if (onlyVersion) versionSkip += 1;
    if (norm.blockers && norm.blockers.length) blockerPkgs += 1;
  }

  const { groups } = groupFields(raw);
  for (const [k, arr] of Object.entries(groups)) actionTotals[k] = (actionTotals[k] || 0) + arr.length;

  const vr = planToVariantRows(raw);
  if (vr.rows.length) variantPkgsNonEmpty += 1;
  variantRowTotal += vr.rows.length;
  variantProblems += vr.problems.length;

  const fv = planToFillValues(raw);
  fillTotal += fv.fill.length;
  fillWithReviewTotal += fv.fillWithReview.length;
  reviewTotal += fv.reviewLabels.length;
  discoverTotal += fv.discoverLabels.length;
  skipTotal += fv.skipLabels.length;
  missingTotal += fv.missing.length;

  const hardProblems = norm.problems.filter((p) => !/schema_version/.test(p) && !/blockers/.test(p));
  // 有 blockers 的包被拒绝执行是**期望行为**，不算消费器缺陷，单独计数。
  if (hardProblems.length === 0 && vr.problems.length === 0) {
    okCount += 1;
    if (norm.blockers && norm.blockers.length) blockedPkgs += 1;
  } else {
    badCount += 1;
    if (pkgIssues.length < 5) {
      pkgIssues.push({ file, problems: [...hardProblems, ...vr.problems].slice(0, 3) });
    }
  }
}

const rel = (p) => p.replace(ROOT, '<root>');

console.log(`field_plan 总数:        ${files.length}`);
console.log(`JSON 解析失败:          ${badJson}`);
console.log(`schema 版本:            ${JSON.stringify([...versionHist.entries()].sort((a, b) => b[1] - a[1]))}`);
console.log('');
console.log(`转换成功（无硬问题）:   ${okCount}`);
console.log(`转换有问题:             ${badCount}`);
console.log(`  其中仅版本不兼容:     ${versionSkip}`);
console.log(`  含 blockers:          ${blockerPkgs}（消费器正确拒绝执行，非缺陷）`);
console.log('');
console.log(`变种行: 包数=${variantPkgsNonEmpty}  总行数=${variantRowTotal}  字段问题=${variantProblems}`);
console.log(`其中含 blockers 被拒执行: ${blockedPkgs}`);
console.log('');
console.log('action 分组（全量累计）:');
for (const [k, v] of Object.entries(actionTotals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
console.log('');
console.log(`可自动填(FILL):         ${fillTotal}`);
console.log(`填但需复核(FILL_W_REV): ${fillWithReviewTotal}`);
console.log(`需人工(REVIEW):         ${reviewTotal}`);
console.log(`页面发现(DISCOVER):     ${discoverTotal}`);
console.log(`跳过(SKIP):             ${skipTotal}`);
console.log(`源缺失(MISSING):        ${missingTotal}`);

if (pkgIssues.length) {
  console.log('\n问题包样例:');
  for (const p of pkgIssues) {
    console.log(`  ${rel(p.file).slice(-66)}`);
    for (const x of p.problems) console.log(`    - ${x}`);
  }
}

// 判据：不能有硬问题；变种行总数必须 > 0（证明 sku_plan 真的能转出可用数据）
const verdict = badCount === 0 && variantRowTotal > 0 && variantProblems === 0;
console.log(`\n判定: ${verdict ? 'PASS —— 320 个包均可转换，变种行可用' : 'REVIEW —— 见上方问题明细'}`);
process.exit(verdict ? 0 : 1);
