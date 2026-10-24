// 诊断：引用到 quoteEdit 后，枚举页面上【所有】Ant Select 的
//   id / formItem 文本(前90) / input 当前值或占位符 / 关键 class
// 不展开、不读选项。输出 dianxiaomi-all-selects.json 供人工识别模板字段 id。

import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CHROME_DEBUG_PORT, DIANXIAOMI_URL, DIANXIAOMI_TEMPLATE_PRODUCT_ID } from "../dist/src/config.js";

const OUT_FILE = path.join(process.cwd(), "dianxiaomi-all-selects.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPLATE_ID = process.argv[2] || DIANXIAOMI_TEMPLATE_PRODUCT_ID;

process.on("unhandledRejection", (r) => {
  if (r && /No dialog is showing|handleJavaScriptDialog/.test(String((r && r.message) || r))) return;
  console.error("UnhandledRejection:", r);
});

async function findDianxiaomiPage(browser) {
  for (const ctx of browser.contexts()) for (const p of ctx.pages())
    if (!p.isClosed() && p.url().includes("dianxiaomi.com")) return p;
  return undefined;
}
async function clickByText(page, text, timeout = 15000) {
  const c = page.locator(`text=${JSON.stringify(text)}`);
  const n = await c.count();
  if (!n) throw new Error(`找不到「${text}」`);
  for (let i = 0; i < n; i++) if (await c.nth(i).isVisible().catch(() => false)) { await c.nth(i).click({ timeout: 5000 }); return; }
  await c.first().click({ timeout: 5000 });
}
async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
  browser.on("dialog", (d) => d.accept().catch(() => {}));
  let page = await findDianxiaomiPage(browser);
  if (!page) page = await browser.contexts()[0].newPage();
  await page.goto(DIANXIAOMI_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  await clickByText(page, "引用产品", 10000); await sleep(1200);
  await clickByText(page, "引用现有产品", 10000); await sleep(1500);
  try { const t = page.locator(".ant-tabs-tab", { hasText: "产品ID" }).first(); if (await t.count()) await t.click({ timeout: 5000 }); }
  catch { try { await clickByText(page, "产品ID", 10000); } catch {} }
  await sleep(1500);
  const vis = await page.locator("input:visible").elementHandles();
  let target = null;
  for (const h of vis) {
    const ph = (await h.getAttribute("placeholder")) || "", nm = (await h.getAttribute("name")) || "", idv = (await h.getAttribute("id")) || "";
    if (!target && (await h.isEditable().catch(() => false)) && /id|编号|商品|搜索|查询/i.test(ph + " " + nm + " " + idv)) target = h;
  }
  if (!target) target = vis[0];
  try { await target.fill(TEMPLATE_ID); } catch { await target.click({ timeout: 5000 }); await page.keyboard.type(TEMPLATE_ID, { delay: 30 }); }
  await sleep(800);
  await clickByText(page, "搜索", 10000);
  await page.waitForSelector(".ant-table, table", { timeout: 10000 }).catch(() => {});
  await sleep(2500);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button, a")).find((x) => { const t = (x.innerText || "").trim(); return t === "引用" && !/产品/.test(t) && x.closest("tr, [class*='row'], [class*='table'], [class*='list']"); });
    if (b) b.click();
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(5000);

  // 滚动到底，触发懒加载，再回顶部
  for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(700); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(600);

  const all = await page.evaluate(() => {
    const clean = (s) => (s || "").replace(/\*/g, " ").replace(/[-－—–]+/g, " ").replace(/\s+/g, " ").trim();
    const out = [];
    const items = Array.from(document.querySelectorAll(".ant-form-item"));
    for (const item of items) {
      const sel = item.querySelector(".ant-select");
      const input = sel ? sel.querySelector("input") : null;
      const id = sel ? (sel.id || (input ? input.id : "")) : "";
      const formText = clean((item.innerText || "").replace(/\*/g, " "));
      const firstLine = formText.split(/[\n|｜]/)[0].slice(0, 60);
      const kw = ["运费", "服务", "模板", "区域调价", "产品分组", "属性模板", "变种模板", "产品模板", "尺码"];
      const hit = kw.some((k) => formText.includes(k));
      out.push({ id, firstLine, hasSelect: !!sel, hit });
    }
    return { url: location.href, total: out.length, items: out };
  });
  await writeFile(OUT_FILE, JSON.stringify(all, null, 2), "utf8");
  console.log("FormItem 总数:", all.total);
  console.log("=== 命中模板/运费/服务/区域调价 关键词的字段 ===");
  for (const s of all.items) {
    if (s.hit) console.log(`  ${String(s.id || "?").padEnd(18)} | ${s.firstLine}`);
  }
  console.log("=== 全部 form-item 标签 ===");
  for (const s of all.items) console.log(`  ${String(s.id || "?").padEnd(18)} | ${s.firstLine}`);
  await browser.close();
}
main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
