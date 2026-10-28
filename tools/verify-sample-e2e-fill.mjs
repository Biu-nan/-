// 端到端样品验证：真实 facts → 真实店小秘页面 → 只填表不保存
//
// 为什么 commit: false —— listing-engine.js:194 写明「false = 只填 + 回读，便于灰度」。
// 所以这一步对店小秘**零副作用**：填完不点保存，不产生草稿、更不发布。
// 验证的是「我们的标题 / 描述能不能真的填进页面并被回读确认」。
//
// 依赖（已就绪）：
//   - CDP 9223 在监听，且 profile F:\yikuaborder-deploy\.chrome-profile 已登录店小秘
//   - 一跨服务 3000 空闲（本脚本自建 adapter，不复用服务内的 page）
//
// 用法（项目根执行）：node tools/verify-sample-e2e-fill.mjs [包目录]

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DianxiaomiAdapter } from '../dist/src/dianxiaomi-adapter.js';
import { runListingEngine } from '../dist/src/listing-engine.js';
import { buildProductFactsFallback } from '../dist/src/dianxiaomi-facts.js';
import { getDianxiaomiProfile } from '../dist/src/config.js';

const DIR = process.argv[2]
  || 'F:/yikuaborder-deploy/已完成产品/A已填充到店小秘产品文件夹中/MIU系个性潮流百搭亮钻小熊包包挂件爱心蝴蝶结钥匙扣挂件配饰_915180152603_images';

console.log(`包目录: ${DIR}`);

// 1) 04 文案 → facts（走 fallback，正好验证刚改的标题与描述提取）
const listingContentText = await readFile(path.join(DIR, '04_LISTING_CONTENT.md'), 'utf8');
// factText 用于提取材质/品牌（extractField）。不传的话 facts.material 为空，
// 引擎会在「6-材质」直接抛错 —— 那是样本输入不全，不是要验的字段有问题。
const factText = await readFile(path.join(DIR, '01_PRODUCT_FACTS.md'), 'utf8').catch(() => '');
const facts = await buildProductFactsFallback({ factText, listingContentText, baseDir: DIR });

// fallback 的 collectImagesFromDir 只找 output/Image_*.png 与 产品图/，
// 这个包的主图在根目录，手动补上（否则引擎会在图片步骤因无图而报错，掩盖真正要验的字段）。
const files = await readdir(DIR).catch(() => []);
const mainImages = files
  .filter((f) => /^主图_\d+\.(jpe?g|png)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (mainImages.length) {
  facts.images = Object.assign({}, facts.images, { main: mainImages });
}

// 样品 01_PRODUCT_FACTS.md 里材质写的是「待人工确认」——店小秘下拉不接受该值，
// 会把引擎卡在「6-材质」而掩盖后面真正要验的标题/描述。
// 这里给一个箱包挂件常见的合法材质，仅为让流程走通；不影响要验的字段。
if (!facts.material || /待人工确认/.test(String(facts.material))) {
  facts.material = '合金(Alloy)';
  console.log('  (材质原值为「待人工确认」，本次以 合金(Alloy) 送测)');
}

console.log('');
console.log('=== 送进引擎的 facts ===');
console.log(`title.en   ${(facts.title.en || '').length} 字`);
console.log(`  ${(facts.title.en || '').slice(0, 100)}`);
console.log(`desc.pc    ${(facts.description.pc || '').length} 字`);
console.log(`  ${(facts.description.pc || '').slice(0, 100).replace(/\n/g, ' | ')}`);
console.log(`images.main ${mainImages.length} 张`);

// 2) 连接真实浏览器
const adapter = new DianxiaomiAdapter('xiangBao');
adapter.setImageBaseDir(DIR);

console.log('\n=== 连接 CDP 9223 ===');
const connected = await adapter.connect();
if (!connected) {
  console.log('[FAIL] 连接失败：CDP 9223 不可用');
  process.exit(1);
}
console.log('连接成功');

// 3) 打开新建页（新标签，不影响已有页面）
await adapter.openCreatePage({ freshTab: true });
console.log('新建页已打开');

// 4) 只填不存
const profile = JSON.parse(JSON.stringify(getDianxiaomiProfile('xiangBao')));
console.log('\n=== 开始填表（commit=false，不保存）===');
const started = Date.now();

let res;
try {
  res = await runListingEngine({
    adapter,
    facts,
    profile,
    row: { packageName: path.basename(DIR) },
    commit: false,
  });
} catch (e) {
  console.log(`\n[ERROR] 引擎抛错: ${e.message}`);
  if (e.steps) {
    console.log('\n已完成步骤:');
    for (const s of e.steps) {
      console.log(`  ${s.status === 'SUCCESS' ? 'OK ' : s.status}  ${s.name}${s.reason ? ' — ' + s.reason : ''}`);
    }
  }
  process.exit(1);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n=== 结果（用时 ${secs}s）===`);
for (const s of res.steps || []) {
  const mark = s.status === 'SUCCESS' ? 'OK  ' : s.status === 'ATTENTION' ? 'ATT ' : 'ERR ';
  const v = s.value == null ? '' : `  = ${String(JSON.stringify(s.value)).slice(0, 70)}`;
  console.log(`  ${mark} ${s.name}${s.reason ? ' — ' + s.reason : ''}${v}`);
}
if ((res.attention || []).length) {
  console.log('\nattention:');
  for (const a of res.attention) console.log(`  - ${a}`);
}

// 关键：标题与描述这两步必须 SUCCESS，且回读值等于我们送进去的值
const titleStep = (res.steps || []).find((s) => /标题/.test(s.name));
const descStep = (res.steps || []).find((s) => /描述/.test(s.name));
const titleOk = titleStep && titleStep.status === 'SUCCESS';
const descOk = descStep && descStep.status === 'SUCCESS';
console.log(`\n标题步骤: ${titleStep ? titleStep.status : '未找到'}`);
console.log(`描述步骤: ${descStep ? descStep.status : '未找到'}`);
console.log(`\ncommitted = ${res.committed}  <-- 必须为 false（未保存）`);
console.log(`\n判定: ${titleOk && descOk && res.committed === false ? 'PASS —— 标题与描述填入成功，且未保存' : 'REVIEW'}`);
