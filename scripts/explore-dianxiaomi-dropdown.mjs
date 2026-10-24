// 诊断：引用到 quoteEdit 后，针对 rc_select_0（店铺名称）展开，dump 下拉浮层真实状态
import { chromium } from "playwright-core";
import { CHROME_DEBUG_PORT, DIANXIAOMI_URL, DIANXIAOMI_TEMPLATE_PRODUCT_ID } from "../dist/src/config.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPLATE_ID = process.argv[2] || DIANXIAOMI_TEMPLATE_PRODUCT_ID;
process.on("unhandledRejection", (r) => { if (r && /No dialog is showing/.test(String(r))) return; console.error(r); });
async function findPage(b) { for (const c of b.contexts()) for (const p of c.pages()) if (!p.isClosed() && p.url().includes("dianxiaomi.com")) return p; }
async function clickByText(page, text, t = 15000) {
  const c = page.locator(`text=${JSON.stringify(text)}`); const n = await c.count(); if (!n) throw new Error(`找不到「${text}」`);
  for (let i = 0; i < n; i++) if (await c.nth(i).isVisible().catch(() => false)) { await c.nth(i).click({ timeout: 5000 }); return; }
  await c.first().click({ timeout: 5000 });
}
async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
  browser.on("dialog", (d) => d.accept().catch(() => {}));
  let page = await findPage(browser); if (!page) page = await browser.contexts()[0].newPage();
  await page.goto(DIANXIAOMI_URL, { waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle").catch(() => {}); await sleep(1500);
  await clickByText(page, "引用产品", 10000); await sleep(1200);
  await clickByText(page, "引用现有产品", 10000); await sleep(1500);
  try { const t = page.locator(".ant-tabs-tab", { hasText: "产品ID" }).first(); if (await t.count()) await t.click({ timeout: 5000 }); } catch { try { await clickByText(page, "产品ID", 10000); } catch {} }
  await sleep(1500);
  const vis = await page.locator("input:visible").elementHandles(); let target = null;
  for (const h of vis) { const ph = (await h.getAttribute("placeholder")) || "", nm = (await h.getAttribute("name")) || "", idv = (await h.getAttribute("id")) || ""; if (!target && (await h.isEditable().catch(() => false)) && /id|编号|商品|搜索|查询/i.test(ph + " " + nm + " " + idv)) target = h; }
  if (!target) target = vis[0];
  try { await target.fill(TEMPLATE_ID); } catch { await target.click({ timeout: 5000 }); await page.keyboard.type(TEMPLATE_ID, { delay: 30 }); }
  await sleep(800);
  await clickByText(page, "搜索", 10000); await page.waitForSelector(".ant-table, table", { timeout: 10000 }).catch(() => {}); await sleep(2500);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll("button, a")).find((x) => { const t = (x.innerText || "").trim(); return t === "引用" && !/产品/.test(t) && x.closest("tr, [class*='row'], [class*='table'], [class*='list']"); }); if (b) b.click(); });
  await page.waitForLoadState("networkidle").catch(() => {}); await sleep(5000);

  const selId = "rc_select_0";
  await page.evaluate((id) => { const el = document.querySelector("#" + id); if (el) el.scrollIntoView({ block: "center" }); }, selId);
  await sleep(300);
  const before = await page.evaluate(() => Array.from(document.querySelectorAll(".ant-select-dropdown")).map((d) => ({ cls: d.className.toString().slice(0, 60), opts: d.querySelectorAll(".ant-select-item-option-content").length })));
  await page.evaluate((id) => { const sel = document.querySelector("#" + id); const trig = sel && (sel.querySelector(".ant-select-selector") || sel.querySelector(".ant-select-selection-search") || sel); if (trig) trig.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })); }, selId);
  await sleep(1200);
  const after = await page.evaluate((id) => {
    const selCls = document.querySelector("#" + id).className.toString();
    const d = document.querySelector(".ant-select-dropdown:not(.ant-select-dropdown-hidden)");
    const allD = Array.from(document.querySelectorAll(".ant-select-dropdown")).map((x) => ({ hidden: x.className.toString().includes("hidden"), opts: x.querySelectorAll(".ant-select-item-option-content, .ant-cascader-menu-item, li, [role='option']").length, txt: x.innerText.slice(0, 200) }));
    return { selOpen: /ant-select-open/.test(selCls), dropdownExists: !!d, dropdownCls: d ? d.className.toString().slice(0, 80) : null, dropdownText: d ? d.innerText.slice(0, 400) : null, allD };
  }, selId);
  console.log("BEFORE dropdowns:", JSON.stringify(before, null, 2));
  console.log("AFTER:", JSON.stringify(after, null, 2));
  await browser.close();
}
main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
