const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  if (!collectPage) { console.log("NO COLLECT PAGE"); await browser.close(); process.exit(1); }
  console.log("COLLECT:", collectPage.url());

  // 先关掉残留 dropdown（点 body）
  await collectPage.evaluate(() => {
    const m = document.querySelector(".ant-dropdown-hidden");
    if (!m) return;
    // 强制 close 通过 click outside
    document.body.click();
  });
  await collectPage.waitForTimeout(500);

  // dump 表格结构
  const tblStruct = await collectPage.evaluate(() => {
    const tables = document.querySelectorAll("table");
    const tbl = Array.from(tables).find(t => /标题产品ID|标题/.test(t.innerText || ""));
    if (!tbl) return { found: false };
    return {
      found: true,
      tbodyTr: tbl.querySelectorAll("tbody tr").length,
      rowCls: Array.from(tbl.querySelectorAll("tr")).slice(0, 3).map(r => r.className || "(no-class)"),
      antTableRow: document.querySelectorAll(".ant-table-row").length,
      // 找操作列的链接
      actionLinks: Array.from(document.querySelectorAll("a")).filter(a => {
        const t = (a.innerText || "").trim();
        return /移入待发布|保存并移入待发布|缩略|更新|删除|添加备注/.test(t);
      }).map(a => ({ text: (a.innerText || "").trim(), cls: (a.className || "").toString().slice(0, 60) }))
    };
  });
  console.log("=== STEP A: 表格结构 ===");
  console.log(JSON.stringify(tblStruct, null, 2));

  // 找 ant-table-row 的"更多"和"操作"列结构
  const r1 = await collectPage.evaluate(() => {
    const rows = document.querySelectorAll(".ant-table-row");
    if (!rows.length) return { ok: false, reason: "no ant-table-row" };
    const sample = rows[0];
    return {
      ok: true,
      rowCount: rows.length,
      // 行内所有按钮/链接
      actions: Array.from(sample.querySelectorAll("button, a, span, .ant-dropdown-trigger, [class*='dropdown']")).map((b, i) => ({
        i, tag: b.tagName, cls: (b.className || "").toString().slice(0, 80), text: (b.innerText || "").trim().slice(0, 30)
      })),
      // 行内所有 cell 文本
      cells: Array.from(sample.querySelectorAll("td, .ant-table-cell")).map(c => (c.innerText || "").trim().slice(0, 50))
    };
  });
  console.log("=== STEP B: 第一行所有按钮+链接 ===");
  console.log(JSON.stringify(r1, null, 2));

  // 用真实选择器点击"更多"，dump 完整菜单
  const r2 = await collectPage.evaluate(async () => {
    const rows = document.querySelectorAll(".ant-table-row");
    const sample = rows[0];
    if (!sample) return { ok: false };
    // 找"更多"按钮（不在链接里，是带 .ant-dropdown-trigger 的元素）
    const moreBtn = Array.from(sample.querySelectorAll(".ant-dropdown-trigger, [class*='more'], a, button, span"))
      .find(b => /更多/.test((b.innerText || "").trim()));
    if (!moreBtn) return { ok: false, reason: "no more btn" };
    moreBtn.click();
    await new Promise(r => setTimeout(r, 800));
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item"));
    return { ok: true, items: items.map(i => (i.innerText || "").trim()) };
  });
  console.log("=== STEP C: 点'更多'(.ant-table-row) 完整菜单 ===");
  console.log(JSON.stringify(r2, null, 2));

  // 找"操作"列里的"移入待发布"链接 - 验证是否在操作列
  const r3 = await collectPage.evaluate(() => {
    const rows = document.querySelectorAll(".ant-table-row");
    if (!rows[0]) return { ok: false };
    // 找所有列中含 "操作" 文本的 td
    const opCell = Array.from(rows[0].querySelectorAll("td, .ant-table-cell")).find(c => /^操作$/.test((c.innerText || "").trim()));
    if (!opCell) return { ok: false, reason: "no 操作 col" };
    return {
      ok: true,
      opColText: opCell.innerText,
      opColLinks: Array.from(opCell.querySelectorAll("a, button, span")).map(b => ({
        tag: b.tagName, text: (b.innerText || "").trim().slice(0, 30)
      }))
    };
  });
  console.log("=== STEP D: 操作列内容 ===");
  console.log(JSON.stringify(r3, null, 2));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
