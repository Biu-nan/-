import { chromium } from "playwright-core";
import fs from "node:fs";

const PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9223);
const OUT = "scripts/probe-collectbox.result.json";
const log = (...a) => console.log(...a);

let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  log("[probe] connected to CDP");

  // 找已有的店小秘标签页
  let page = null;
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (!p.isClosed() && p.url().includes("dianxiaomi.com")) { page = p; break; }
    }
    if (page) break;
  }
  if (!page) {
    log("[probe] 没有已打开的店小秘标签，新建一个导航到采集箱");
    page = await browser.contexts()[0].newPage();
    await page.goto("https://www.dianxiaomi.com/web/smtChoice/draft", { waitUntil: "domcontentloaded" }).catch(e => log("[probe] goto err", e.message));
    await page.waitForTimeout(4000);
  } else {
    log("[probe] 复用已有店小秘标签:", page.url());
    // 若不在采集箱，则导航过去
    if (!page.url().includes("smtChoice/draft") && !page.url().includes("smtChoice")) {
      await page.goto("https://www.dianxiaomi.com/web/smtChoice/draft", { waitUntil: "domcontentloaded" }).catch(()=>{});
      await page.waitForTimeout(4000);
    }
  }

  const dump = await page.evaluate(() => {
    const out = { url: location.href, title: document.title };
    // 搜索框：找 input，优先 placeholder 含 搜索/标题/关键词
    const inputs = Array.from(document.querySelectorAll("input")).map(i => ({
      type: i.type, placeholder: i.getAttribute("placeholder") || "", id: i.id, name: i.name,
      cls: (i.className||"").slice(0,40)
    }));
    out.inputs = inputs.slice(0, 30);
    // 表格
    const tables = Array.from(document.querySelectorAll("table"));
    out.tableCount = tables.length;
    out.firstTableHeaders = tables[0] ? Array.from(tables[0].querySelectorAll("th, thead td")).map(th => (th.innerText||"").trim()).slice(0,20) : [];
    // 找含有"编辑"按钮的行
    const allButtons = Array.from(document.querySelectorAll("button, a"));
    out.buttonsWithEditText = allButtons.filter(b => /编辑/.test(b.innerText||"")).slice(0,5).map(b => ({ tag:b.tagName, text:(b.innerText||"").trim().slice(0,30), cls:(b.className||"").slice(0,40) }));
    out.allButtonTextsSample = Array.from(new Set(allButtons.map(b=>(b.innerText||"").trim()))).filter(Boolean).slice(0,40);
    // 行数（ant-table row）
    out.antTableRows = document.querySelectorAll(".ant-table-row, tr[data-row-key], tbody tr").length;
    // 是否存在搜索框相关容器
    out.hasSearchArea = !!document.querySelector(".ant-input-search, .ant-input-affix-wrapper, [class*=search]");
    return out;
  });

  fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
  log("[probe] DONE, wrote", OUT);
  log(JSON.stringify(dump, null, 2).slice(0, 4000));
} catch (e) {
  log("[probe] ERROR", e.message);
  fs.writeFileSync(OUT, JSON.stringify({ error: e.message }, null, 2));
} finally {
  if (browser) await browser.close().catch(()=>{});
}
