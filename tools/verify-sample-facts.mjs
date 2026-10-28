// 样品级 facts 验证：用真实产品包跑真实的 buildProductFactsFallback，
// 检查落进 facts 的 title.en / description.pc 是否正确。
//
// 这是端到端验证的「零风险前半段」——不碰浏览器、不写店小秘，只验证
// 链路产出的**数据**。后半段（写草稿）依赖 CDP 9223 + 店小秘登录，另行判断。
//
// 样品选择依据（来自 verify-description-mainpath.mjs 的实测）：
//   样品 1：无「3.2」编号 + 无 Basic Information → 旧主路径提不到描述
//   样品 2：旧主路径串段（把 3.3 正文一起吞掉，长度是正确值的 2.5 倍）
//
// 用法（项目根执行）：node tools/verify-sample-facts.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildProductFactsFallback } from '../dist/src/dianxiaomi-facts.js';

const ROOT = 'F:/yikuaborder-deploy/已完成产品/A已填充到店小秘产品文件夹中';

const SAMPLES = [
  {
    dir: '2026原创马年吉祥物创意小马包挂件高级感车挂钥匙扣配饰新年礼物_1005604363310_images',
    why: '无 3.2 编号 + 无 Basic Information（旧主路径提不到描述）',
  },
  {
    dir: 'MIU系个性潮流百搭亮钻小熊包包挂件爱心蝴蝶结钥匙扣挂件配饰_915180152603_images',
    why: '旧主路径串段（吞掉 3.3 正文）',
  },
];

let fail = 0;

for (const s of SAMPLES) {
  const baseDir = path.join(ROOT, s.dir);
  let listingContentText = '';
  try {
    listingContentText = await readFile(path.join(baseDir, '04_LISTING_CONTENT.md'), 'utf8');
  } catch (e) {
    console.log(`\n[SKIP] ${s.dir}\n  读不到 04_LISTING_CONTENT.md: ${e.message}`);
    fail += 1;
    continue;
  }

  const facts = await buildProductFactsFallback({ listingContentText, baseDir });
  const title = (facts && facts.title && facts.title.en) || '';
  const pc = (facts && facts.description && facts.description.pc) || '';

  // 判据：标题非空、描述非空、描述不含 3.3 标记（不串段）
  const titleOk = title.length > 0;
  const descOk = pc.length > 0;
  const noBleed = !/商品详情页内容|Product Detail Page/i.test(pc);
  const ok = titleOk && descOk && noBleed;
  if (!ok) fail += 1;

  console.log(`\n${ok ? '[PASS]' : '[FAIL]'} ${s.dir.slice(0, 46)}`);
  console.log(`  样品说明: ${s.why}`);
  console.log(`  title.en   ${title.length} 字  ${titleOk ? '' : '<-- 空！'}`);
  console.log(`     ${title.slice(0, 96)}`);
  console.log(`  desc.pc    ${pc.length} 字  ${descOk ? '' : '<-- 空！'} ${noBleed ? '' : '<-- 串段！'}`);
  console.log(`     ${pc.slice(0, 96).replace(/\n/g, ' | ')}`);
  console.log(`  meta.source = ${facts && facts.meta && facts.meta.source}`);
}

console.log(`\n判定: ${fail === 0 ? 'PASS —— 两个样品的标题与描述都正确落进 facts' : `FAIL —— ${fail} 个样品有问题`}`);
process.exit(fail === 0 ? 0 : 1);
