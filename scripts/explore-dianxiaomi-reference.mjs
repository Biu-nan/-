// 店小秘「引用现有产品」流程探索（只读 + 引用，不保存）
// 连接 Chrome CDP(9223)，进入创建产品页，执行：
//   引用产品(下拉) → 引用现有产品 → 切「产品ID」标签 → 搜 1005005575013300 → 引用
// 然后枚举引用后表单各字段的【当前值】，输出 JSON，供 DianxiaomiAdapter 回填选择器。
// 重要：本脚本只引用、不保存；引用会填充创建页表单（未保存的草稿态，可丢弃）。

import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CHROME_DEBUG_PORT,
  DIANXIAOMI_URL,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID
} from "../dist/src/config.js";

const OUT_FILE = path.join(process.cwd(), "dianxiaomi-reference-explore.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEMPLATE_ID = process.argv[2] || DIANXIAOMI_TEMPLATE_PRODUCT_ID;

// 忽略对话框竞态导致的未处理拒绝（如 beforeunload 已被自动处理）
process.on("unhandledRejection", (reason) => {
  if (reason && /No dialog is showing|handleJavaScriptDialog/.test(String((reason && reason.message) || reason))) return;
  console.error("UnhandledRejection:", reason);
});

const actions = [];
const log = (s) => { actions.push({ t: new Date().toISOString(), msg: s }); console.log("[*]", s); };

async function findDianxiaomiPage(browser) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (!p.isClosed() && p.url().includes("dianxiaomi.com")) return p;
    }
  }
  return undefined;
}

// 点击包含指定文字的元素（可见优先）
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
  // 自动接受任何 JS 对话框（beforeunload/confirm）；立即接受避免竞态
  browser.on("dialog", (d) => { d.accept().catch(() => {}); });

  let page = await findDianxiaomiPage(browser);
  if (!page) { log("未找到店小秘标签，新开一页"); page = await browser.contexts()[0].newPage(); }
  log("复用店小秘标签: " + page.url());

  // 始终重新导航到创建产品页，确保页面干净（清除上一次可能残留的引用弹窗/模态）
  log("导航到创建产品页: " + DIANXIAOMI_URL);
  await page.goto(DIANXIAOMI_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);
  log("当前 URL: " + page.url());

  // 步骤 1：点「引用产品」下拉
  log("步骤1：点击「引用产品」");
  try { await clickByText(page, "引用产品", 10000); } catch (e) { log("步骤1失败: " + e.message); throw e; }
  await sleep(1200);

  // 步骤 2：选「引用现有产品」
  log("步骤2：点击「引用现有产品」");
  try { await clickByText(page, "引用现有产品", 10000); } catch (e) { log("步骤2失败: " + e.message); throw e; }
  await sleep(1500);

  // 步骤 3：切到「产品ID」标签（弹窗内，优先点 .ant-tabs-tab）
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

  // 步骤 4：填搜索框（产品ID）—— 先诊断所有可见 input，再选可编辑的那个
  log("步骤4：填写产品ID = " + TEMPLATE_ID);
  const debugInputs = [];
  const visibleInputs = await page.locator("input:visible").elementHandles();
  let target = null;
  for (const h of visibleInputs) {
    const ph = (await h.getAttribute("placeholder")) || "";
    const nm = (await h.getAttribute("name")) || "";
    const idv = (await h.getAttribute("id")) || "";
    const editable = await h.isEditable().catch(() => false);
    debugInputs.push({ ph, nm, idv, editable });
    if (!target && editable && /id|编号|商品|搜索|查询/i.test(ph + " " + nm + " " + idv)) target = h;
  }
  if (!target) target = visibleInputs.find((h) => true); // 第一个可见 input
  if (!target) throw new Error("找不到可见输入框");
  log("  候选输入框数=" + visibleInputs.length + " 选中=" + JSON.stringify(debugInputs[visibleInputs.indexOf(target)] || {}));
  try {
    await target.fill(TEMPLATE_ID);
  } catch {
    await target.click({ timeout: 5000 });
    await page.keyboard.type(TEMPLATE_ID, { delay: 30 });
  }
  await sleep(800);

  // 步骤 5：点「搜索」
  log("步骤5：点击「搜索」");
  try { await clickByText(page, "搜索", 10000); } catch (e) { log("步骤5失败: " + e.message); throw e; }
  // 等待搜索结果表格出现
  await page.waitForSelector(".ant-table, table, [class*='table']", { timeout: 10000 }).catch(() => {});
  await sleep(2500);

  // 步骤 6：点结果行的「引用」
  // 用 DOM 直接 click 绕过遮挡（店小秘有 sticky 区块/返回面包屑会拦截坐标点击）
  log("步骤6：通过 DOM 点击结果行「引用」按钮");
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, a"));
    const norm = (b) => (b.innerText || b.textContent || "").trim();
    // 优先：文本精确为「引用」且位于表格行/列表行内
    const inRow = btns.find((b) => norm(b) === "引用" && b.closest("tr, [class*='row'], [class*='table'], [class*='list']"));
    const exact = btns.find((b) => norm(b) === "引用");
    const target = inRow || exact || btns.find((b) => norm(b).includes("引用"));
    if (!target) return { ok: false, reason: "no 引用 button" };
    const info = { ok: true, text: norm(target), inRow: !!inRow };
    target.click();
    return info;
  });
  if (!clicked.ok) throw new Error("找不到结果行「引用」按钮: " + clicked.reason);
  log("  已点击: text=" + JSON.stringify(clicked.text) + " inRow=" + clicked.inRow);
  // 等待表单被模板填充
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(5000);
  log("引用后 URL: " + page.url());

  // 枚举引用后各字段当前值
  log("枚举引用后字段当前值 ...");
  const snapshot = await page.evaluate(() => {
    const txt = (n) => (n && n.innerText ? n.innerText : "").toString();
    const out = [];
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    for (const el of inputs) {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || tag).toLowerCase();
      if (["hidden", "file", "submit", "button", "reset"].includes(type)) continue;
      let value = el.value || "";
      if (type === "search" || el.getAttribute("role") === "combobox") {
        // 组合框当前显示文本从父 .ant-select 取
        const sel = el.closest(".ant-select") || el.parentElement;
        value = sel ? txt(sel).replace(/\*/g, " ").trim() : "";
      }
      if (tag === "textarea") value = el.value || txt(el).slice(0, 80);
      const formItem = el.closest(".ant-form-item");
      let label = "";
      if (formItem) {
        const lr = formItem.querySelector(".ant-form-item-label, [class*='form-item-label']");
        if (lr) label = txt(lr).replace(/\*/g, " ").trim();
      }
      out.push({
        id: el.id || "",
        name: el.name || "",
        type,
        label: label.slice(0, 40),
        value: String(value).slice(0, 120)
      });
    }
    return { url: location.href, total: out.length, fields: out };
  });

  const result = {
    templateId: TEMPLATE_ID,
    url: page.url(),
    actions,
    debugInputs,
    snapshot
  };
  await writeFile(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  log("已写出 " + OUT_FILE);
  log("引用后字段数: " + snapshot.total);
  console.log("  前 12 个字段值:");
  for (const f of snapshot.fields.slice(0, 12)) {
    console.log(`    [${f.label || "?"}] (${f.type}) = ${JSON.stringify(f.value)}`);
  }
  await browser.close();
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
