// 诊断脚本：走真实「产品 → 创建产品」菜单，定位「速卖通/半托管」栏的创建入口。
// 只读探索，不点引用、不保存。输出 dianxiaomi-hub-explore.json。
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { CHROME_DEBUG_PORT, DIANXIAOMI_URL } from "../dist/src/config.js";

const OUT_FILE = path.join(process.cwd(), "dianxiaomi-hub-explore.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function clickByText(page, text, timeout = 12000) {
  const cands = page.locator(`text=${JSON.stringify(text)}`);
  const count = await cands.count();
  if (count === 0) throw new Error(`找不到包含「${text}」的元素`);
  for (let i = 0; i < count; i += 1) {
    const el = cands.nth(i);
    if (await el.isVisible().catch(() => false)) { await el.click({ timeout: 5000 }); return i; }
  }
  await cands.first().click({ timeout: 5000 });
  return 0;
}

async function main() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
  browser.on("dialog", (d) => { d.accept().catch(() => {}); });
  let page = await findDianxiaomiPage(browser);
  if (!page) { log("未找到店小秘标签"); process.exit(1); }
  log("复用标签: " + page.url());

  // 回到首页（菜单在首页左侧/顶部最稳）
  await page.goto("https://www.dianxiaomi.com/web/home", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(1500);

  // 点「产品」菜单
  log("点「产品」");
  try { await clickByText(page, "产品", 12000); } catch (e) { log("点产品失败: " + e.message); }
  await sleep(1200);

  // 点「创建产品」
  log("点「创建产品」");
  try { await clickByText(page, "创建产品", 12000); } catch (e) { log("点创建产品失败: " + e.message); }
  await sleep(2000);
  log("进入后 URL: " + page.url());

  // 诊断：当前页面所有「创建产品」按钮 + 它们所属的栏目卡片 + 链接
  const hub = await page.evaluate(() => {
    const txt = (n) => (n && n.innerText ? n.innerText : "").toString();
    const out = { url: location.href, title: document.title, columns: [], createButtons: [], links: [] };

    // 1) 找所有「创建产品」/「新建产品」相关按钮或链接
    const btns = Array.from(document.querySelectorAll("button, a"));
    for (const b of btns) {
      const t = (b.innerText || b.textContent || "").trim();
      if (/创建产品|新建产品|发布产品/.test(t)) {
        // 向上找所属栏目卡片标题
        let col = "";
        let anc = b;
        while (anc && anc !== document.body) {
          const hit = anc.querySelector(":scope > .ant-card-head-title, :scope > [class*='head-title'], :scope > h1, :scope > h2, :scope > h3, :scope > h4, [class*='title']");
          if (hit && txt(hit).trim()) { col = txt(hit).trim().replace(/\s+/g, " ").slice(0, 40); break; }
          anc = anc.parentElement;
        }
        // 2) 也看最近的兄弟/父容器里是否有「半托管」「aliexpress」「pop」字样
        const ctxText = txt(b.closest("[class*='card'], [class*='col'], [class*='item'], li, [class*='channel']") || b.parentElement).replace(/\s+/g, " ");
        out.createButtons.push({
          text: t,
          column: col,
          ctxHint: ctxText.slice(0, 80),
          href: b.getAttribute("href") || "",
          onclick: (b.getAttribute("onclick") || "").slice(0, 60)
        });
      }
    }

    // 2) 找包含「半托管」「aliexpress」「速卖通」字样的栏目/卡片
    const allText = Array.from(document.querySelectorAll("div, span, h1, h2, h3, h4, li, a, button"));
    const seen = new Set();
    for (const n of allText) {
      const t = txt(n).replace(/\s+/g, " ").trim();
      if (!t || seen.has(t)) continue;
      if (/半托管|aliexpress|速卖通|托管/.test(t) && t.length < 40) {
        seen.add(t);
        out.columns.push({ text: t, tag: n.tagName.toLowerCase() });
      }
    }

    // 3) 抓取所有含 smt/product/create 的链接
    for (const a of document.querySelectorAll("a[href]")) {
      const h = a.getAttribute("href") || "";
      if (/smt|product|create|add/i.test(h)) out.links.push({ href: h, text: (a.innerText || "").trim().slice(0, 30) });
    }
    return out;
  });

  const result = { actions, hub };
  await writeFile(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  log("已写出 " + OUT_FILE);
  console.log(JSON.stringify(hub, null, 2));
  await browser.close();
}
main().catch((err) => { console.error("[FATAL]", err); process.exit(1); });
