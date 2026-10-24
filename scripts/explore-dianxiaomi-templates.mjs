// 店小秘固定模板下拉「可选项」扒取（只读引用，不保存）
// 复用已验证的引用流程进入 quoteEdit，然后对每个 C 类固定字段的 Ant Select：
//   展开 → 读取全部 .ant-select-item-option-content → 收起
// 输出 dianxiaomi-template-options.json，供用户勾选/确认 DIANXIAOMI_FIXED。

import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CHROME_DEBUG_PORT,
  DIANXIAOMI_URL,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID
} from "../dist/src/config.js";

const OUT_FILE = path.join(process.cwd(), "dianxiaomi-template-options.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPLATE_ID = process.argv[2] || DIANXIAOMI_TEMPLATE_PRODUCT_ID;

process.on("unhandledRejection", (reason) => {
  if (reason && /No dialog is showing|handleJavaScriptDialog/.test(String((reason && reason.message) || reason))) return;
  console.error("UnhandledRejection:", reason);
});

const actions = [];
const log = (s) => { actions.push({ t: new Date().toISOString(), msg: s }); console.log("[*]", s); };

const TARGETS = [
  ["storeName", "店铺名称"],
  ["stockType", "备货类型"],
  ["freightTemplate", "运费模板"],
  ["promiseTemplate", "服务模板"],
  ["attributeTemplate", "产品属性模板"],
  ["variantTemplate", "变种模板"],
  ["productTemplate", "产品模板"],
  ["sizeTemplate", "尺码表"],
  ["regionPriceTemplate", "区域调价"]
];

async function findDianxiaomiPage(browser) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (!p.isClosed() && p.url().includes("dianxiaomi.com")) return p;
    }
  }
  return undefined;
}

async function clickByText(page, text, timeout = 15000) {
  const candidates = page.locator(`text=${JSON.stringify(text)}`);
  const count = await candidates.count();
  if (count === 0) throw new Error(`找不到包含「${text}」的元素`);
  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 5000 });
      return i;
    }
  }
  await candidates.first().click({ timeout: 5000 });
  return 0;
}

async function main() {
  console.log("[1] 连接 CDP ...");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
  browser.on("dialog", (d) => { d.accept().catch(() => {}); });

  let page = await findDianxiaomiPage(browser);
  if (!page) { log("未找到店小秘标签，新开一页"); page = await browser.contexts()[0].newPage(); }
  log("复用店小秘标签: " + page.url());

  log("导航到创建产品页: " + DIANXIAOMI_URL);
  await page.goto(DIANXIAOMI_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  log("当前 URL: " + page.url());

  log("步骤1：点击「引用产品」");
  try { await clickByText(page, "引用产品", 10000); } catch (e) { log("步骤1失败: " + e.message); throw e; }
  await sleep(1200);

  log("步骤2：点击「引用现有产品」");
  try { await clickByText(page, "引用现有产品", 10000); } catch (e) { log("步骤2失败: " + e.message); throw e; }
  await sleep(1500);

  log("步骤3：点击「产品ID」标签");
  let tabClicked = false;
  try {
    const tab = page.locator(".ant-tabs-tab", { hasText: "产品ID" }).first();
    if (await tab.count()) { await tab.click({ timeout: 5000 }); tabClicked = true; log("  用 .ant-tabs-tab 点击"); }
  } catch (e) { log("  tab 点击异常: " + e.message); }
  if (!tabClicked) {
    try { await clickByText(page, "产品ID", 10000); tabClicked = true; } catch (e) { log("步骤3失败(尝试继续): " + e.message); }
  }
  await sleep(1500);

  log("步骤4：填写产品ID = " + TEMPLATE_ID);
  const visibleInputs = await page.locator("input:visible").elementHandles();
  let target = null;
  for (const h of visibleInputs) {
    const ph = (await h.getAttribute("placeholder")) || "";
    const nm = (await h.getAttribute("name")) || "";
    const idv = (await h.getAttribute("id")) || "";
    const editable = await h.isEditable().catch(() => false);
    if (!target && editable && /id|编号|商品|搜索|查询/i.test(ph + " " + nm + " " + idv)) target = h;
  }
  if (!target) target = visibleInputs[0];
  if (!target) throw new Error("找不到可见输入框");
  try { await target.fill(TEMPLATE_ID); }
  catch { await target.click({ timeout: 5000 }); await page.keyboard.type(TEMPLATE_ID, { delay: 30 }); }
  await sleep(800);

  log("步骤5：点击「搜索」");
  try { await clickByText(page, "搜索", 10000); } catch (e) { log("步骤5失败: " + e.message); throw e; }
  await page.waitForSelector(".ant-table, table, [class*='table']", { timeout: 10000 }).catch(() => {});
  await sleep(2500);

  log("步骤6：点击结果行「引用」");
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, a"));
    const norm = (b) => (b.innerText || b.textContent || "").trim();
    const inRow = btns.find((b) => norm(b) === "引用" && b.closest("tr, [class*='row'], [class*='table'], [class*='list']"));
    const exact = btns.find((b) => norm(b) === "引用");
    const t = inRow || exact || btns.find((b) => norm(b).includes("引用"));
    if (!t) return { ok: false, reason: "no 引用 button" };
    t.click();
    return { ok: true, text: norm(t), inRow: !!inRow };
  });
  if (!clicked.ok) throw new Error("找不到结果行「引用」按钮: " + clicked.reason);
  log("  已点击引用 inRow=" + clicked.inRow);
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(5000);
  log("引用后 URL: " + page.url());

  // ① 收集所有 .ant-select 的 {id, label, current}，并匹配 TARGETS
  log("枚举固定字段 Select ...");
  const found = await page.evaluate((targets) => {
    const clean = (s) => (s || "").replace(/\*/g, " ").replace(/[-－—–]+/g, " ").replace(/\s+/g, " ").trim();
    const labelOf = (fi) => {
      if (!fi) return "";
      const lr = fi.querySelector(".ant-form-item-label");
      if (lr) { const t = clean(lr.innerText); if (t && !/^请选择|^请输入/.test(t)) return t; }
      const full = clean((fi.innerText || "").replace(/\*/g, " "));
      const sel = fi.querySelector(".ant-select");
      const cur = sel ? clean(sel.innerText) : "";
      let prefix = full;
      if (cur && full.includes(cur)) prefix = full.slice(0, full.indexOf(cur));
      prefix = prefix.replace(/请选择.*/, " ").replace(/[-－—\s]+/g, " ").trim();
      return prefix.slice(0, 40);
    };
    const out = [];
    const items = Array.from(document.querySelectorAll(".ant-form-item"));
    for (const item of items) {
      const sel = item.querySelector(".ant-select");
      if (!sel) continue;
      const input = sel.querySelector("input");
      const id = sel.id || (input ? input.id : "");
      const cur = input ? (input.value || input.getAttribute("placeholder") || "") : (sel.getAttribute("title") || "");
      const label = labelOf(item);
      const hit = targets.find(([, l]) => label === l || label.includes(l));
      if (hit) out.push({ key: hit[0], label, id, current: String(cur).slice(0, 60) });
    }
    return out;
  }, TARGETS);

  log("匹配到固定 Select " + found.length + " 个: " + found.map((f) => f.key + "(" + (f.id || "?") + ")").join(", "));

  // ② 逐个展开读取可选项
  const options = {};
  for (const f of found) {
    if (!f.id) { options[f.key] = { label: f.label, current: f.current, error: "no-id" }; continue; }
    try {
      // 先关闭任何已开下拉，避免残留合并
      await page.mouse.click(5, 5).catch(() => {});
      await sleep(400);
      // 真实鼠标点击 Selector 中心展开（触发 Ant Select 的 mousedown 展开逻辑）
      const box = await page.evaluate((id) => {
        const input = document.querySelector("#" + id);
        const sel = (input && input.closest(".ant-select")) || document.querySelector("#" + id);
        if (sel) sel.scrollIntoView({ block: "center" });
        const trig = sel && (sel.querySelector(".ant-select-selector") || sel.querySelector(".ant-select-selection-search") || sel);
        const r = (trig || sel).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, f.id);
      await page.mouse.click(box.x, box.y);
      await page.waitForFunction(() => {
        const ds = Array.from(document.querySelectorAll(".ant-select-dropdown")).filter((d) => !d.className.includes("hidden"));
        return ds.length >= 1 && ds[ds.length - 1].querySelectorAll(".ant-select-item-option-content, .ant-cascader-menu-item").length > 0;
      }, { timeout: 7000 }).catch(() => {});
      await sleep(800);
      // 只读最后一个可见下拉，避免多下拉残留合并
      const opts = await page.evaluate(() => {
        const ds = Array.from(document.querySelectorAll(".ant-select-dropdown")).filter((d) => !d.className.includes("hidden"));
        const d = ds[ds.length - 1];
        if (!d) return [];
        return Array.from(d.querySelectorAll(".ant-select-item-option-content, .ant-cascader-menu-item")).map((x) => x.innerText.trim()).filter(Boolean);
      });
      await page.mouse.click(5, 5).catch(() => {});
      await sleep(400);
      options[f.key] = { label: f.label, current: f.current, count: opts.length, options: opts };
      log(`  ${f.key}「${f.label}」当前="${f.current}" 可选项 ${opts.length} 个`);
    } catch (e) {
      options[f.key] = { label: f.label, current: f.current, error: e.message };
      log(`  ${f.key} 读取失败: ${e.message}`);
      await page.mouse.click(5, 5).catch(() => {});
      await sleep(300);
    }
  }

  // 未匹配到的 target 标记缺失
  const matchedKeys = new Set(found.map((f) => f.key));
  const missing = TARGETS.filter(([k]) => !matchedKeys.has(k)).map(([k, l]) => ({ key: k, label: l }));

  const result = { url: page.url(), templateId: TEMPLATE_ID, found, missing, options };
  await writeFile(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  log("已写出 " + OUT_FILE);
  log("缺失未匹配的字段: " + (missing.length ? missing.map((m) => m.key).join(", ") : "无"));
  await browser.close();
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
