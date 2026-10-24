const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  console.log("COLLECT:", collectPage.url());

  // 找 vxe 行
  const r1 = await collectPage.evaluate(() => {
    const rows = document.querySelectorAll(".vxe-body--row, .vxe-body--column, [class*='vxe-body'] tr, [class*='vxe-table--body'] tr");
    const altRows = document.querySelectorAll("[class*='vxe']");
    return {
      vxeBodyRow: document.querySelectorAll(".vxe-body--row").length,
      vxeBodyColumn: document.querySelectorAll(".vxe-body--column").length,
      vxeTable: document.querySelectorAll(".vxe-table").length,
      // 找任意有"更多"文本的元素
      moreEls: Array.from(document.querySelectorAll("*")).filter(e => {
        const t = (e.innerText || "").trim();
        return t === "更多" || t === "更多 ▼" || t.startsWith("更多");
      }).slice(0, 5).map(e => ({ tag: e.tagName, cls: (e.className || "").toString().slice(0, 80) }))
    };
  });
  console.log("=== STEP A: Vxe 元素探测 ===");
  console.log(JSON.stringify(r1, null, 2));

  // dump 第一行内容
  const r2 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row, tr[class*='vxe-body']");
    if (!row) return { ok: false, reason: "no vxe body row" };
    return {
      ok: true,
      tag: row.tagName, cls: row.className,
      cells: Array.from(row.querySelectorAll("td, .vxe-cell")).map(c => ({
        cls: (c.className || "").toString().slice(0, 60),
        text: (c.innerText || "").trim().slice(0, 100)
      })),
      // 行内所有 a / button
      actions: Array.from(row.querySelectorAll("a, button, .vxe-cell a")).map(b => ({
        tag: b.tagName, cls: (b.className || "").toString().slice(0, 60), text: (b.innerText || "").trim().slice(0, 30)
      }))
    };
  });
  console.log("=== STEP B: Vxe 第一行 ===");
  console.log(JSON.stringify(r2, null, 2));

  // 找"更多"按钮 (用 vxe 上下文)
  const r3 = await collectPage.evaluate(async () => {
    const row = document.querySelector(".vxe-body--row, tr[class*='vxe-body']");
    if (!row) return { ok: false, reason: "no row" };
    // 找含"更多"的元素
    const all = Array.from(row.querySelectorAll("*"));
    const more = all.find(e => (e.innerText || "").trim() === "更多");
    if (!more) return { ok: false, reason: "no 更多 text el" };
    more.click();
    await new Promise(r => setTimeout(r, 800));
    // 找所有可见 dropdown
    const dd = document.querySelectorAll(".ant-dropdown:not(.ant-dropdown-hidden), .vxe-dropdown:not([style*='display: none']), .vxe-table--dropdown, [class*='dropdown']");
    const visible = Array.from(dd).filter(d => d.offsetParent !== null);
    // 找菜单项
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, .vxe-dropdown-item, [class*='dropdown-item'], li[class*='item']"));
    return {
      ok: true,
      moreTag: { tag: more.tagName, cls: (more.className || "").toString().slice(0, 80) },
      visibleDdCount: visible.length,
      ddTags: visible.map(d => d.className.toString().slice(0, 60)),
      items: items.filter(i => i.offsetParent !== null).map(i => (i.innerText || "").trim())
    };
  });
  console.log("=== STEP C: 点更多后的菜单项 ===");
  console.log(JSON.stringify(r3, null, 2));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
