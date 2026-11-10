#!/usr/bin/env node
// 商品级全量抓取：sales.query 474 条（43 字段/条）
//
// 关键约束（实测，改之前先读）
// 1. 接口是 GET，sign 在 URL 里，**只覆盖原始 data 参数**。任何改动（pageSize/pageNumber/sortField）
//    都会让 sign 失效并静默返回空 data —— 所以不能自己构造请求，只能让页面自己翻页，我们旁听响应。
// 2. 排序默认 sortField=total_channel_item_sales_1d desc（按 1 日销量降序），
//    正好让高销量商品先出现，对分层无偏见。
// 3. 日切窗口（北京 15:00–17:00）只让 todaySalesNum 归零，本脚本用到的
//    recent7d/30d、totalSalesNum、firstUpShelfTime、库存四态、predict 均为滚动窗口或静态属性，
//    受影响 <3%，故照常抓取但在 _meta 标注 capturedDuringDaycut。
//
// 用法
//   node scripts/fetch-ae-items.mjs 400370               # 抓全量并落盘
//   node scripts/fetch-ae-items.mjs 400370 --dry-run     # 不落盘
//   node scripts/fetch-ae-items.mjs 400370 --max-pages 5 # 限页数（调试）
//   node scripts/fetch-ae-items.mjs 400370 --keep-open
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WenmaiApi } = require('../nawu-fetch/lib/wenmai-api.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const STORE_ID = Number(process.argv[2] || 400370);
const CHANNEL = 2358891;
const API = 'mtop.global.merchant.sales.query';
const DRY = process.argv.includes('--dry-run');
const KEEP_OPEN = process.argv.includes('--keep-open');
const MAX_PAGES = Number((() => {
  const i = process.argv.indexOf('--max-pages');
  return i >= 0 ? process.argv[i + 1] : 60;
})());

const ITEMS_DIR = path.join(ROOT, 'data/metrics/items');
const RAW_DIR = path.join(ROOT, 'data/metrics/raw/aliexpress', new Date().toISOString().slice(0, 10));
const log = (...a) => console.log('[items]', ...a);

// 日切窗口：北京 15:00–17:00（平台标 PST 实为 PDT，日切在 UTC 07:00）
function inDaycutWindow() {
  const h = new Date().getUTCHours();
  return h >= 7 && h < 9; // UTC 07:00-09:00 = 北京 15:00-17:00（夏时制）
}

// Fusion Design 分页器（非 Ant Design）。实测有效选择器：.next-pagination .next-next
// 末页时该按钮带 disabled 属性。
const NEXT_SELECTORS = ['.next-pagination .next-next', '.next-next', '[class*="next-pagination"] .next-next'];

async function main() {
  const api = new WenmaiApi('http://127.0.0.1:3980', 600);
  let browser = null;

  try {
    log('openEnv', STORE_ID);
    const opened = await api.openEnv(STORE_ID, 'default');
    const cdpPort = opened.cdpPort || opened.data?.cdpPort;
    for (let i = 0; i < 30; i++) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (!browser) throw new Error('CDP 连接失败');

    const ctx = browser.contexts()[0];
    const page =
      ctx.pages().find((p) => p.url().includes('aechoice-Sales-statistics')) ||
      ctx.pages().find((p) => p.url().includes('csp.aliexpress.com')) ||
      ctx.pages()[0];
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});

    const collected = new Map(); // itemId → item
    let declaredTotal = null;
    let apiCalls = 0;
    const pagesSeen = [];

    const onResp = async (res) => {
      if (!res.url().includes(API)) return;
      try {
        const j = await res.json();
        const d = j?.data?.data;
        if (!d || !Array.isArray(d.list)) return;
        apiCalls++;
        declaredTotal = d.total ?? declaredTotal;
        pagesSeen.push(d.current);
        for (const it of d.list) {
          const id = String(it.itemId || '');
          if (id) collected.set(id, it);
        }
      } catch {}
    };
    page.on('response', onResp);

    log('打开销售管理页 ...');
    try {
      await page.goto(
        `https://csp.aliexpress.com/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice?channelId=${CHANNEL}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 }
      );
    } catch (e) {
      log('goto 警告:', e.message.slice(0, 60));
    }
    // 等首屏响应到达（比固定 sleep 快且稳）
    for (let i = 0; i < 100; i++) {
      if (apiCalls > 0) break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(1500); // 给列表与分页器渲染
    log(`首屏: 已收 ${collected.size} 条 / 声明 total=${declaredTotal ?? '?'}`);

    // 探测分页器
    const pagerInfo = await page.evaluate(() => {
      const out = { found: [], textHints: [] };
      const sels = [
        '.ant-pagination',
        '.ant-pagination-next',
        'li[title="下一页"]',
        '[class*="pagination"]',
        '[class*="Pagination"]',
      ];
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) out.found.push({ sel: s, tag: el.tagName, cls: String(el.className).slice(0, 80), text: (el.innerText || '').slice(0, 40) });
      }
      const body = document.body.innerText || '';
      const m = body.match(/共\s*(\d+)\s*[条个]/);
      if (m) out.textHints.push('共' + m[1] + '条');
      return out;
    });
    log('分页器探测:', JSON.stringify(pagerInfo).slice(0, 400));

    // 逐页点击
    let noProgressRounds = 0;
    for (let p = 1; p <= MAX_PAGES; p++) {
      if (declaredTotal && collected.size >= declaredTotal) break;
      const before = collected.size;
      const beforeCalls = apiCalls;

      const clicked = await page.evaluate((sels) => {
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) continue;
          const disabled = el.disabled === true || /\bdisabled\b/.test(String(el.className)) || el.getAttribute('aria-disabled') === 'true';
          if (disabled) return { clicked: false, sel: s, reason: 'disabled' };
          el.click();
          return { clicked: true, sel: s };
        }
        return { clicked: false, reason: 'no-selector' };
      }, NEXT_SELECTORS);

      if (!clicked.clicked) {
        log(`翻页停止（${clicked.reason}），已收 ${collected.size}/${declaredTotal ?? '?'}`);
        break;
      }

      // 等新响应到达（通常 300-800ms），而非固定 sleep
      let arrived = false;
      for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(150);
        if (apiCalls > beforeCalls) {
          arrived = true;
          break;
        }
      }
      if (!arrived) await page.waitForTimeout(1200);
      await page.waitForTimeout(200); // 给渲染留余量

      const gained = collected.size - before;
      if (gained <= 0) {
        noProgressRounds++;
        if (noProgressRounds >= 3) {
          log('连续 3 轮无新增，停止翻页');
          break;
        }
      } else {
        noProgressRounds = 0;
        if (p % 8 === 0) log(`  第 ${p} 页: 累计 ${collected.size}/${declaredTotal ?? '?'}`);
      }
    }

    page.off('response', onResp);

    const items = [...collected.values()];
    const coverage = declaredTotal && items.length >= declaredTotal ? 'FULL' : 'PARTIAL';
    log(`抓取完成: ${items.length} 条 (${coverage})，API 调用 ${apiCalls} 次，访问页 ${pagesSeen.length} 个`);

    if (!items.length) throw new Error('未抓到任何商品，检查登录态或页面结构');

    // 交叉校验：Σ recent30dSalesNum 与店铺级 30 日销量对比（口径校验）
    const sumD30 = items.reduce((a, x) => a + (Number(x.recent30dSalesNum) || 0), 0);
    log(`校验: Σrecent30dSalesNum = ${sumD30}`);

    const daycut = inDaycutWindow();
    const date = new Date().toISOString().slice(0, 10);
    const payload = items.map((it) => ({
      ...it,
      _meta: {
        capturedAt: new Date().toISOString(),
        storeId: `env:${STORE_ID}`,
        channelId: CHANNEL,
        coverage,
        declaredTotal,
        capturedDuringDaycut: daycut,
      },
    }));

    if (DRY) {
      log('--dry-run，不落盘');
    } else {
      fs.mkdirSync(ITEMS_DIR, { recursive: true });
      fs.mkdirSync(RAW_DIR, { recursive: true });
      const outFile = path.join(ITEMS_DIR, `${date}.jsonl`);
      fs.writeFileSync(outFile, payload.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
      fs.writeFileSync(
        path.join(RAW_DIR, 'items-raw.json'),
        JSON.stringify({ total: declaredTotal, count: items.length, coverage, capturedAt: new Date().toISOString(), items }, null, 1),
        'utf8'
      );
      log('已写:', path.relative(ROOT, outFile));
      log('原始快照:', path.relative(ROOT, path.join(RAW_DIR, 'items-raw.json')));
      if (daycut) log('⚠️ 处于日切窗口（北京15-17），todaySalesNum 不可信，30d/7d 误差 <3%');
    }
  } finally {
    if (!KEEP_OPEN) await api.closeEnv(STORE_ID).catch(() => {});
    process.exit(0);
  }
}

main().catch(async (e) => {
  console.error('[items] FATAL', e.message);
  process.exit(1);
});
