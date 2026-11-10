#!/usr/bin/env node
/**
 * C2b 探测：销售管理页能否按日期范围查询（按日历史）。
 *
 * 只读：不写 data/、不改平台数据。dump 页面结构 + 页面自己发请求的完整参数，
 * 用来判断「自主抓逐日数据」走哪条路：
 *   A. 页面有日期选择器 → CDP 点选日期，旁听页面自己发的 mtop 响应
 *   B. window.lib.mtop 可用 → 在页面上下文带日期参数调用（签名由页面库生成）
 *   C. 都不行 → 只能逐日累积
 *
 * 用法：node scripts/probe-ae-daily.mjs [envId] [--keep-open]
 */
import { WenmaiApi } from "../nawu-fetch/lib/wenmai-api.cjs";
import { chromium } from "playwright-core";

const argv = process.argv.slice(2);
const STORE_ID = Number(argv.find((a) => /^\d+$/.test(a)) || 400370);
const KEEP_OPEN = argv.includes("--keep-open");
const CHANNEL = process.env.AE_CHANNEL_ID || "2358891";
const log = (...a) => console.log("[probe]", ...a);
const SALES = (ch) => `https://csp.aliexpress.com/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice?channelId=${ch}`;

const api = new WenmaiApi("http://127.0.0.1:3980", 600);
log("openEnv", STORE_ID, "...");
const opened = await api.openEnv(STORE_ID, "default");
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
if (!page) {
  log("未拿到 csp 页面:", ctx.pages().map((p) => p.url().slice(0, 70)));
  if (!KEEP_OPEN) await api.closeEnv(STORE_ID).catch(() => {});
  process.exit(4);
}
log("initial url =", page.url().slice(0, 110));

// ① 先注册监听（必须在导航前，否则漏掉首屏请求）
const seen = new Set();
const reqs = [];
page.on("response", (res) => {
  const m = res.url().match(/\/h5\/([^/]+)\/[\d.]+\//);
  if (m) seen.add(m[1]);
});
page.on("request", (req) => {
  const u = req.url();
  const m = u.match(/\/h5\/([^/]+)\/[\d.]+\//);
  if (!m) return;
  // 只关心可能带日期维度的接口，避免被首屏十几条公告类请求挤掉。
  if (!/sales\.trend|sales\.query|sales\.summary/i.test(m[1])) return;
  if (reqs.length >= 10) return;
  let data = null, raw = "";
  try {
    const q = new URL(u).searchParams;
    raw = q.get("data") || "";
    if (raw) data = JSON.parse(raw);
  } catch { /* ignore */ }
  reqs.push({ api: m[1], data, raw: raw.slice(0, 400) });
});

// ② 导航到销售页（当前标签可能停在 SHOP_NO_PERMISSION 错误页）
if (!/sub-sales-aeChoice/i.test(page.url())) {
  log("navigate →", SALES(CHANNEL));
  await page.goto(SALES(CHANNEL), { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch((e) => log("goto 失败:", e.message.slice(0, 80)));
  await page.waitForTimeout(8000);
}
log("after nav url =", page.url().slice(0, 110));

// ③ 页面里的日期语义元素
const dateish = await page.evaluate(() => {
  const out = [];
  const re = /(今天|昨日|近\s*\d+\s*[天日]|\d+\s*[天日]|自定义|日期|按日|筛选)/;
  for (const n of document.querySelectorAll("button,[role=button],a,span,div,li")) {
    const t = (n.textContent || "").trim();
    if (!t || t.length > 24 || !re.test(t) || n.offsetParent === null) continue;
    out.push({ tag: n.tagName, text: t, cls: (n.className || "").toString().slice(0, 50) });
    if (out.length >= 30) break;
  }
  return out;
});

const pickers = await page.evaluate(() => ({
  inputDate: document.querySelectorAll('input[type="date"]').length,
  nextPicker: document.querySelectorAll(".next-date-picker, .next-range-picker, [class*=datePicker], [class*=DatePicker], [class*=date-picker]").length,
}));

const runtime = await page.evaluate(() => {
  let libMtop = "n/a";
  try { libMtop = typeof window.lib?.mtop; } catch { libMtop = "throw"; }
  return { lib: typeof window.lib, libMtop, hasTk: document.cookie.includes("_m_h5_tk"), hasFetch: typeof window.fetch };
});

console.log("\n===== ① 日期语义元素 =====");
for (const d of dateish) console.log(`  <${d.tag}> "${d.text}"  ${d.cls}`);
if (!dateish.length) console.log("  （无）");

console.log("\n===== ② 日期组件 =====", JSON.stringify(pickers));
console.log("===== ③ 运行时能力 =====", JSON.stringify(runtime));
console.log("\n===== ④ h5 接口名 =====", [...seen].join(", ") || "（无）");

console.log("\n===== ⑤ 页面请求的业务参数（按日期重放的关键）=====");
for (const r of reqs) {
  if (/trend|sales\.query|sales\.summary|channel\.sales/i.test(r.api)) {
    console.log(`  ★ ${r.api}`);
    console.log(`     data=${JSON.stringify(r.data)}`);
  } else {
    console.log(`    ${r.api}  data=${r.raw ? r.raw.slice(0, 80) : "(空)"}`);
  }
}

const verdict = pickers.inputDate || pickers.nextPicker ? "A(有日期组件)"
  : runtime.libMtop === "function" || runtime.libMtop === "object" ? "B(可带参调 mtop)"
  : "C(只能逐日累积)";
console.log("\n===== 判定 =====", verdict);

if (!KEEP_OPEN) { await api.closeEnv(STORE_ID).catch(() => {}); log("已关闭环境", STORE_ID); }
else log("保留环境（--keep-open）");
