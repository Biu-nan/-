// 只读：单独跑一次 collectProductTypeMap，验证多变种修复
'use strict';
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const c6r = require('../lib/dxm-c6r.cjs');

const log = { info: (m) => console.log('[INFO] ' + m), warn: (m) => console.log('[WARN] ' + m) };

(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = await b.contexts()[0].newPage();
  const tm = await c6r.collectProductTypeMap(page, 'https://www.dianxiaomi.com/web/dxmCommodityProduct/index', log);
  const out = {
    counts: tm.counts, declared: tm.declared, collected: tm.collected, complete: tm.complete,
    lists: Object.fromEntries(Object.entries(tm.lists).map(([k, v]) => [k, v.length])),
    samples: Object.fromEntries(Object.entries(tm.lists).map(([k, v]) => [k, v.slice(0, 4)])),
  };
  const f = 'F:/yikuaborder-deploy/纳物采购最新数据/_raw/type_map_verify.json';
  fs.writeFileSync(f, JSON.stringify(out, null, 1), 'utf8');
  console.log('WROTE ' + f);
  console.log(JSON.stringify(out, null, 1).slice(0, 1500));
  await page.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.message); process.exit(1); });
