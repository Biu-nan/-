const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));

  // 找"操作"列的链接
  const r1 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    if (!row) return { ok: false };
    // 找含"操作"列的 cell
    const allCells = Array.from(row.querySelectorAll(".vxe-cell, td.vxe-body--column"));
    const opCell = allCells.find(c => /^(操作|更多)$/.test((c.innerText || "").trim()) || /操作/.test((c.className || "").toString()));
    // 也直接找含"操作"列头
    const headers = Array.from(document.querySelectorAll(".vxe-header--column, .vxe-table--header th, .vxe-cell--label"));
    const opHeader = headers.find(h => (h.innerText || "").trim() === "操作");
    // 操作列的所有 cell
    const opIdx = opHeader ? Array.from(headers).indexOf(opHeader) : -1;
    return {
      headers: headers.map(h => (h.innerText || "").trim()).slice(0, 30),
      opHeaderIdx: opIdx,
      opHeaderText: opHeader ? opHeader.innerText : null,
      // 取最后一列 (通常是操作列) 的链接
      lastColLinks: Array.from(row.querySelectorAll(".vxe-cell:last-child a, .vxe-cell:last-child button, .vxe-cell:nth-last-child(1) a, .vxe-cell:nth-last-child(1) button, .vxe-cell:nth-last-child(2) a")).map(b => ({
        tag: b.tagName, text: (b.innerText || "").trim().slice(0, 30)
      })),
      // 找含 "操作" 或 "更多" 或 "移入" 的 cell
      opCells: allCells.filter(c => /移入|缩略|更新|删除|更多|操作/.test(c.innerText || "")).map(c => ({
        cls: (c.className || "").toString().slice(0, 60),
        text: (c.innerText || "").trim().slice(0, 200)
      }))
    };
  });
  console.log("=== STEP 1: 操作列位置 + 链接 ===");
  console.log(JSON.stringify(r1, null, 2));

  // 点"更多"，看完整菜单
  const r2 = await collectPage.evaluate(async () => {
    const row = document.querySelector(".vxe-body--row");
    const moreBtn = row.querySelector("button.ant-dropdown-trigger");
    if (!moreBtn) return { ok: false, reason: "no more btn" };
    moreBtn.click();
    await new Promise(r => setTimeout(r, 1000));
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, .ant-dropdown-menu-submenu-title"));
    const visibleItems = items.filter(i => i.offsetParent !== null);
    return {
      ok: true,
      itemCount: items.length,
      visibleCount: visibleItems.length,
      items: visibleItems.map(i => (i.innerText || "").trim())
    };
  });
  console.log("=== STEP 2: 点更多后完整菜单 ===");
  console.log(JSON.stringify(r2, null, 2));

  // 关掉 dropdown
  await collectPage.keyboard.press("Escape");
  await collectPage.waitForTimeout(500);

  // 点"添加备注"，dump 弹窗
  const r3 = await collectPage.evaluate(async () => {
    // 重新点"更多"
    const row = document.querySelector(".vxe-body--row");
    const moreBtn = row.querySelector("button.ant-dropdown-trigger");
    moreBtn.click();
    await new Promise(r => setTimeout(r, 800));
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item")).filter(i => i.offsetParent !== null);
    const addMemo = items.find(i => /添加备注/.test(i.innerText || ""));
    if (!addMemo) return { ok: false, items: items.map(i => i.innerText) };
    addMemo.click();
    await new Promise(r => setTimeout(r, 1500));
    // 找可见 modal
    const wraps = Array.from(document.querySelectorAll(".ant-modal-wrap"));
    const visible = wraps.find(w => w.offsetParent !== null);
    if (!visible) return { ok: false, reason: "no modal" };
    const title = visible.querySelector(".ant-modal-title")?.innerText || null;
    const textareas = Array.from(visible.querySelectorAll("textarea, input[type='text']")).map(t => ({
      tag: t.tagName, ph: t.placeholder, cls: (t.className || "").toString().slice(0, 80)
    }));
    const btns = Array.from(visible.querySelectorAll("button")).map(b => ({
      text: (b.innerText || "").trim().slice(0, 30),
      cls: (b.className || "").toString().slice(0, 80)
    }));
    // 颜色按钮
    const colors = Array.from(visible.querySelectorAll("[class*='color'], .ant-tag")).slice(0, 12).map(c => ({
      tag: c.tagName, cls: (c.className || "").toString().slice(0, 80)
    }));
    return { ok: true, title, textareas, btns, colors };
  });
  console.log("=== STEP 3: 点击添加备注后弹窗 ===");
  console.log(JSON.stringify(r3, null, 2));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
