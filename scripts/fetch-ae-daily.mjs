#!/usr/bin/env node
/**
 * C2b · 按日期区间抓「店铺渠道销售趋势」（sales.trend）
 *
 * 为什么这样做：MTop 在 H5 页里由 window.lib.mtop 统一签名（读 _m_h5_tk cookie），
 * 我们自己算签名既脆弱又违规。所以在页面上下文里调用它，把日期范围当普通参数传。
 *
 * 用法：
 *   node scripts/fetch-ae-daily.mjs --from 2026-11-01 --to 2026-11-10 [--env 400370] [--dump]
 *   --dump  只打印返回结构，不落库
 */
import { WenmaiApi } from "../nawu-fetch/lib/wenmai-api.cjs";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const ENV = Number(val("env", 400370));
const FROM = val("from", "2026-11-01");
const TO = val("to", "2026-11-10");
const DUMP = argv.includes("--dump");
const CHANNEL = process.env.AE_CHANNEL_ID || "2358891";
const API = "mtop.global.merchant.shop.channel.sales.trend";
const log = (...a) => console.log("[daily]", ...a);

// 北京时间当天 00:00:00.000 ~ 23:59:59.999 → 毫秒戳
const CST = 8 * 3600 * 1000;
const toMs = (d, endOfDay) => {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) - CST;
};
const startMs = toMs(FROM, false);
const endMs = toMs(TO, true);
log(`范围 ${FROM} 00:00 ~ ${TO} 23:59:59.999 (+08)`, `→ ${startMs} … ${endMs}`);

const api = new WenmaiApi("http://127.0.0.1:3980", 600);
log("openEnv", ENV, "...");
const opened = await api.openEnv(ENV, "default");
let browser = null;
for (let i = 0; i < 30; i++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${opened.cdpPort}`); break; }
  catch { await new Promise((r) => setTimeout(r, 2000)); }
}
if (!browser) throw new Error("CDP 未就绪");

const ctx = browser.contexts()[0];
const READY = /csp\.aliexpress\.com|dchain-web\.aliexpress\.com/i;
let page = null;
for (let i = 0; i < 30; i++) {
  page = ctx.pages().find((p) => READY.test(p.url())) || null;
  if (page) break;
  await new Promise((r) => setTimeout(r, 1000));
}
if (!page) throw new Error("未拿到 csp 页面");

// 必须落在销售页，才能保证 lib.mtop 初始化完成
if (!/sub-sales-aeChoice/i.test(page.url())) {
  await page.goto(`https://csp.aliexpress.com/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice?channelId=${CHANNEL}`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(7000);
}
log("page.url =", page.url().slice(0, 100));

// 在页面上下文里点日期选择器之前，先确认 lib.mtop 就绪
const ready = await page.evaluate(() => {
  let t = "n/a";
  try { t = typeof window.lib?.mtop?.request; } catch { t = "throw"; }
  return { libMtop: t, hasTk: document.cookie.includes("_m_h5_tk") };
});
log("runtime =", JSON.stringify(ready));
if (ready.libMtop !== "function") throw new Error("window.lib.mtop.request 不可用，无法带参调用");

// 调 sales.trend，传入自定义日期区间。
// 必须补齐页面自己请求时带的参数：appKey / type=originaljson / valueType=original /
// H5Request / x-i18n-regionID。缺这些会返回 LOGIN_PAGE_ERROR「用户未登录」——
// 不是因为没登录，而是 MTop 按另一套 appKey 域去解析会话了。
const trendData = { startTimeStand: startMs, endTimeStand: endMs, language: "zh_CN", channelId: CHANNEL };
const out = await page.evaluate(async ({ apiName, data }) => {
  try {
    const mtop = window.lib.mtop;
    const r = await mtop.request({
      api: apiName,
      v: "1.0",
      type: "GET",
      dataType: "json",
      valueType: "original",
      H5Request: true,
      appKey: "30267743",
      timeout: 30000,
      "x-i18n-regionID": "AE",
      data,
    });
    return { ok: true, json: r };
  } catch (e) {
    // mtop 用非 Error 对象 reject（带 ret 数组），String(e) 只会得到 [object Object]。
    let detail = "";
    try { detail = JSON.stringify(e, Object.getOwnPropertyNames(e || {})).slice(0, 800); } catch { detail = String(e); }
    return { ok: false, err: detail };
  }
}, { apiName: API, data: trendData });

if (!out.ok) {
  log("调用失败:", out.err);
  await api.closeEnv(ENV).catch(() => {});
  process.exit(2);
}

const ret = out.json;
const summarize = (o, depth = 0) => {
  if (o === null) return "null";
  if (Array.isArray(o)) return `Array(${o.length})` + (o.length && typeof o[0] === "object" ? ` first=${summarize(o[0], depth + 1)}` : "");
  if (typeof o === "object") return `{${Object.keys(o).slice(0, 10).join(",")}}`;
  return `${typeof o}:${String(o).slice(0, 40)}`;
};
log("返回顶层:", summarize(ret));
const body = ret?.data ?? ret;
log("data:", summarize(body));
if (body && typeof body === "object") {
  for (const [k, v] of Object.entries(body).slice(0, 8)) {
    log(`  ${k} = ${summarize(v)}`);
    if (Array.isArray(v) && v.length) log(`     sample = ${JSON.stringify(v[0]).slice(0, 300)}`);
  }
}

if (DUMP) {
  const p = "data/metrics/raw/aliexpress/_probe-trend.json";
  const fs = await import("node:fs/promises");
  await fs.mkdir("data/metrics/raw/aliexpress", { recursive: true });
  await fs.writeFile(p, JSON.stringify(ret, null, 2), "utf8");
  log("已 dump 到", p);
}

await api.closeEnv(ENV).catch(() => {});
log("已关闭环境", ENV);
