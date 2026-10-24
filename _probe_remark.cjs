// 用 playwright-core attach 9223 找采集箱 tab，dump 真实 DOM
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  console.log("=== tabs ===");
  for (const p of pages) {
    console.log(" -", p.url(), "=>", (await p.title()).slice(0, 60));
  }
  // 找采集箱列表页
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  if (!collectPage) { console.log("NO COLLECT PAGE"); await browser.close(); process.exit(1); }
  console.log("FOUND COLLECT:", collectPage.url());

  // 1) 表格 + 更多按钮
  const r1 = await collectPage.evaluate(() => {
    const tables = document.querySelectorAll("table");
    const tbl = Array.from(tables).find(t => /标题产品ID|标题/.test(t.innerText || ""));
    if (!tbl) return { found: false, reason: "no-table" };
    const rows = tbl.querySelectorAll("tbody tr");
    const sample = rows[0];
    if (!sample) return { found: false, reason: "no-rows" };
    const btns = Array.from(sample.querySelectorAll("button, a, span, .ant-dropdown-trigger"));
    const triggers = btns.filter(b => /更多/.test(b.innerText || ""));
    return {
      found: true, rowCount: rows.length,
      firstRowText: (sample.innerText || "").slice(0, 300).replace(/\n+/g, " | "),
      moreCount: triggers.length,
      moreTags: triggers.map(t => ({ tag: t.tagName, cls: (t.className || "").toString().slice(0, 80), text: (t.innerText || "").slice(0, 30) }))
    };
  });
  console.log("=== STEP 1: 表格+更多按钮 ===");
  console.log(JSON.stringify(r1, null, 2));

  // 2) 当前页面所有 dropdown item
  const r2 = await collectPage.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"));
    return { count: items.length, labels: items.map(i => (i.innerText || "").trim()) };
  });
  console.log("=== STEP 2: 现有 dropdown 菜单项 ===");
  console.log(JSON.stringify(r2, null, 2));

  // 3) 点第一行"更多"
  const r3 = await collectPage.evaluate(async () => {
    const tables = document.querySelectorAll("table");
    const tbl = Array.from(tables).find(t => /标题产品ID|标题/.test(t.innerText || ""));
    const rows = tbl ? tbl.querySelectorAll("tbody tr") : [];
    if (!rows[0]) return { ok: false, reason: "no row" };
    const btns = Array.from(rows[0].querySelectorAll("button, a, span, .ant-dropdown-trigger"));
    const more = btns.find(b => /更多/.test(b.innerText || ""));
    if (!more) return { ok: false, reason: "no more btn" };
    more.click();
    await new Promise(r => setTimeout(r, 800));
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"));
    return {
      ok: true,
      itemCount: items.length,
      itemTexts: items.map(i => (i.innerText || "").trim())
    };
  });
  console.log("=== STEP 3: 点击更多后下拉菜单 ===");
  console.log(JSON.stringify(r3, null, 2));

  // 4) 点"添加备注"，dump 弹窗
  const r4 = await collectPage.evaluate(async () => {
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"));
    const addMemo = items.find(i => /添加备注/.test(i.innerText || ""));
    if (!addMemo) return { ok: false, reason: "no addMemo item", labels: items.map(i => i.innerText) };
    addMemo.click();
    await new Promise(r => setTimeout(r, 1500));
    // 找可见 modal
    const modals = Array.from(document.querySelectorAll(".ant-modal-wrap"));
    const visibleModal = modals.find(m => m.offsetParent !== null && (m.querySelector(".ant-modal-content") || m.querySelector(".ant-modal")));
    // 找 popover
    const pops = Array.from(document.querySelectorAll(".ant-popover")).filter(p => p.offsetParent !== null);
    if (visibleModal) {
      const m = visibleModal;
      const title = m.querySelector(".ant-modal-title")?.innerText || null;
      const inputs = Array.from(m.querySelectorAll("textarea, input[type='text']")).map(t => ({ tag: t.tagName, ph: t.placeholder, cls: (t.className || "").toString() }));
      const btns = Array.from(m.querySelectorAll("button")).map(b => (b.innerText || "").trim());
      const colors = Array.from(m.querySelectorAll("[class*='color'], .ant-tag")).slice(0, 12).map(c => (c.className || "").toString().slice(0, 60));
      return { ok: true, type: "modal", title, inputs, btns, colors };
    }
    if (pops.length) {
      return { ok: true, type: "popover", count: pops.length, popoverTexts: pops.map(p => p.innerText.slice(0, 300)) };
    }
    return { ok: false, reason: "no modal/popover after click" };
  });
  console.log("=== STEP 4: 点击添加备注后弹窗 ===");
  console.log(JSON.stringify(r4, null, 2));

  // 5) 关弹窗（如有）
  await collectPage.evaluate(() => {
    const m = document.querySelector(".ant-modal-wrap");
    if (!m) return "no-modal";
    const close = m.querySelector(".ant-modal-close") || Array.from(m.querySelectorAll("button")).find(b => /关闭|取消/.test(b.innerText || ""));
    if (close) close.click();
    return "closed";
  });
  await collectPage.waitForTimeout(800);

  // 6) 再点"更多"，这次找"保存并移入待发布"
  const r5 = await collectPage.evaluate(async () => {
    const tables = document.querySelectorAll("table");
    const tbl = Array.from(tables).find(t => /标题产品ID|标题/.test(t.innerText || ""));
    const rows = tbl ? tbl.querySelectorAll("tbody tr") : [];
    if (!rows[0]) return { ok: false, reason: "no row" };
    const btns = Array.from(rows[0].querySelectorAll("button, a, span, .ant-dropdown-trigger"));
    const more = btns.find(b => /更多/.test(b.innerText || ""));
    if (!more) return { ok: false, reason: "no more btn" };
    more.click();
    await new Promise(r => setTimeout(r, 800));
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"));
    return { ok: true, items: items.map(i => (i.innerText || "").trim()) };
  });
  console.log("=== STEP 5: 再点更多,完整菜单项 ===");
  console.log(JSON.stringify(r5, null, 2));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
