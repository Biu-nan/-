// 金标对比：Node 版 listing-contract 与 Python 版 src/listing_contract.py 是否逐字段等价。
//
// 用法（必须从项目根跑，PROJECT_ROOT=process.cwd() 是既有约定）：
//   node tools/verify-listing-contract.mjs <04文件> <Python产出的金标JSON>
//
// 判据：title / title_length / description_boundary / description_lines / problems 必须完全一致；
// warnings 里的「描述图」一条允许不同（Node 侧尚未移植 assets_contract，恒为 0）。

import { readFile } from 'node:fs/promises';
import { buildContract } from '../dist/src/listing-contract.js';

const [listingPath, goldenPath] = process.argv.slice(2);
if (!listingPath || !goldenPath) {
  console.error('用法: node tools/verify-listing-contract.mjs <04_LISTING_CONTENT.md> <golden.json>');
  process.exit(2);
}

const text = await readFile(listingPath, 'utf8');
const golden = JSON.parse(await readFile(goldenPath, 'utf8'));
const { fields: mine } = buildContract(text);

const rows = [];
function cmp(name, a, b) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  rows.push({ name, eq, mine: a, golden: b });
  return eq;
}

cmp('title', mine.title, golden.title);
cmp('title_length', mine.title_length, golden.title_length);
cmp('description_boundary', mine.description_boundary, golden.description_boundary);
cmp('description_lines', mine.description_lines, golden.description_lines);
cmp('problems', mine.problems, golden.problems);

// warnings：过滤掉描述图那条（已知差异）
const filterWarn = (list) => (list || []).filter((w) => !String(w).includes('描述图'));
cmp('warnings(除描述图)', filterWarn(mine.warnings), filterWarn(golden.warnings));

let failed = 0;
for (const r of rows) {
  console.log(`${r.eq ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.eq) {
    failed += 1;
    console.log(`   Node  : ${JSON.stringify(r.mine).slice(0, 300)}`);
    console.log(`   Python: ${JSON.stringify(r.golden).slice(0, 300)}`);
  }
}

console.log('');
console.log(`结果: ${rows.length - failed}/${rows.length} 字段一致`);
if (failed === 0) {
  console.log('样品验证通过 —— Node 版与 Python 版在该产物上逐字段等价。');
  console.log(`title 长度 ${mine.title_length}，描述 ${mine.description_lines.length} 行，边界=${mine.description_boundary}`);
}
process.exit(failed === 0 ? 0 : 1);
