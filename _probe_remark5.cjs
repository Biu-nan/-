const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  // 先滚到顶
  await collectPage.evaluate(() => window.scrollTo(0, 0));
  await collectPage.waitForTimeout(500);

  // 1) 找"更多"按钮（操作列最后一个）+ 列表里有"添加备注"
  const r1 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    if (!row) return { ok: false };
    // 找操作列（最后一个 col--last cell）的"更多"按钮
    const lastCell = row.querySelector(".vxe-body--column.col--last, .vxe-cell:last-child, [class*='col_13']");
    const moreBtn = lastCell ? lastCell.querySelector("button.ant-dropdown-trigger") : null;
    return {
      ok: !!moreBtn,
      lastCellCls: lastCell ? lastCell.className : null,
      lastCellText: lastCell ? lastCell.innerText.slice(0, 100) : null,
      moreInLastCell: !!moreBtn
    };
  });
  console.log("=== STEP 1: 找操作列的更多按钮 ===");
  console.log(JSON.stringify(r1, null, 2));

  // 2) 用 Playwright locator 真正点"更多"按钮，等 dropdown 出现
  console.log("=== STEP 2: 真实点击更多，等待 dropdown ===");
  // 用 page.click selector
  const moreLoc = collectPage.locator(".vxe-body--row").first().locator("button.ant-dropdown-trigger").last();
  console.log("count of moreLoc:", await moreLoc.count());
  try {
    await moreLoc.click({ timeout: 5000 });
    await collectPage.waitForTimeout(1000);
  } catch (e) { console.log("click err:", e.message); }

  // dump 可见 dropdown menu
  const r2 = await collectPage.evaluate(() => {
    const allDd = Array.from(document.querySelectorAll(".ant-dropdown"));
    const visible = allDd.filter(d => d.offsetParent !== null);
    const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, .ant-dropdown-menu-submenu-title, .ant-dropdown-menu li"));
    const visibleItems = items.filter(i => i.offsetParent !== null);
    return {
      visibleDd: visible.map(d => d.className.toString().slice(0, 60)),
      itemCount: items.length,
      visibleItems: visibleItems.map(i => (i.innerText || "").trim())
    };
  });
  console.log(JSON.stringify(r2, null, 2));

  // 3) 点"添加备注"菜单项
  console.log("=== STEP 3: 真实点击添加备注，等待 modal ===");
  try {
    const addMemoLoc = collectPage.locator(".ant-dropdown-menu-item:visible").filter({ hasText: "添加备注" }).first();
    console.log("addMemo count:", await addMemoLoc.count());
    await addMemoLoc.click({ timeout: 5000 });
    await collectPage.waitForTimeout(1500);
  } catch (e) { console.log("click err:", e.message); }

  // dump 弹窗
  const r3 = await collectPage.evaluate(() => {
    const wraps = Array.from(document.querySelectorAll(".ant-modal-wrap"));
    const visible = wraps.find(w => w.offsetParent !== null);
    if (!visible) {
      return { ok: false, reason: "no visible modal-wrap", wraps: wraps.length };
    }
    const title = visible.querySelector(".ant-modal-title")?.innerText || null;
    const inputs = Array.from(visible.querySelectorAll("textarea, input[type='text'], input:not([type])")).map(t => ({
      tag: t.tagName, type: t.type || null, ph: t.placeholder, cls: (t.className || "").toString().slice(0, 80)
    }));
    const btns = Array.from(visible.querySelectorAll("button")).map(b => ({
      text: (b.innerText || "").trim().slice(0, 30),
      cls: (b.className || "").toString().slice(0, 80),
      type: b.type || null
    }));
    // 颜色色块
    const colorEls = Array.from(visible.querySelectorAll("[class*='color'], .ant-tag, [class*='Color']")).slice(0, 12).map(c => ({
      tag: c.tagName, cls: (c.className || "").toString().slice(0, 80), style: c.getAttribute("style") || null
    }));
    return { ok: true, title, inputs, btns, colorEls };
  });
  console.log(JSON.stringify(r3, null, 2));

  // 4) 关掉弹窗
  await collectPage.evaluate(() => {
    const m = document.querySelector(".ant-modal-wrap:not([style*='display: none'])");
    if (!m) return;
    const close = m.querySelector(".ant-modal-close") || Array.from(m.querySelectorAll("button")).find(b => /关闭|取消/.test(b.innerText || ""));
    if (close) close.click();
  });
  await collectPage.waitForTimeout(800);

  // 5) 验证"操作"列的"移入待发布"按钮可以直接点
  console.log("=== STEP 5: 操作列'移入待发布'按钮可见性 ===");
  const r5 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    const lastCell = row.querySelector(".vxe-body--column.col--last");
    const buttons = Array.from(lastCell.querySelectorAll("button"));
    return {
      buttons: buttons.map(b => ({
        text: (b.innerText || "").trim().slice(0, 30),
        cls: (b.className || "").toString().slice(0, 80)
      }))
    };
  });
  console.log(JSON.stringify(r5, null, 2));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
