const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));

  // 验证当前是草稿还是待发布: 看 "操作" 列所有 button
  const r0 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    const lastCell = Array.from(row.querySelectorAll(".vxe-cell")).slice(-1)[0];
    // 也用 class col--last
    const lastCol = row.querySelector(".col--last");
    const buttons = lastCol ? Array.from(lastCol.querySelectorAll("button")) : [];
    return {
      lastCellText: lastCell ? lastCell.innerText : null,
      lastColText: lastCol ? lastCol.innerText : null,
      buttonCount: buttons.length,
      buttons: buttons.map(b => ({ text: (b.innerText || "").trim(), cls: (b.className || "").toString().slice(0, 80) }))
    };
  });
  console.log("=== R0: 操作列按钮 ===");
  console.log(JSON.stringify(r0, null, 2));

  // 真实点"更多"+ 截图 dropdown
  const moreLoc = collectPage.locator(".vxe-body--row").first().locator("button.ant-dropdown-trigger").last();
  await moreLoc.click({ timeout: 5000 });
  await collectPage.waitForTimeout(800);
  await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_probe_dropdown.png", fullPage: false });
  console.log("dropdown screenshot: F:/yikuaborder-deploy/_probe_dropdown.png");

  // 关掉 dropdown
  await collectPage.keyboard.press("Escape");
  await collectPage.waitForTimeout(500);

  // 点"更多"再点"添加备注"，观察弹窗（可能是 ant-popover/drawer）
  await moreLoc.click({ timeout: 5000 });
  await collectPage.waitForTimeout(800);
  const addMemoLoc = collectPage.locator(".ant-dropdown-menu-item:visible").filter({ hasText: "添加备注" }).first();
  await addMemoLoc.click({ timeout: 5000 });
  await collectPage.waitForTimeout(1500);
  await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_probe_modal.png", fullPage: false });
  console.log("modal screenshot: F:/yikuaborder-deploy/_probe_modal.png");

  // 弹窗详细 dump
  const r1 = await collectPage.evaluate(() => {
    // 找所有可能的弹窗/对话框/抽屉
    const selectors = [
      ".ant-modal",
      ".ant-modal-wrap",
      ".ant-drawer",
      ".ant-drawer-content",
      ".ant-popover",
      ".ant-popover-inner",
      ".ant-popconfirm",
      "[class*='modal']:not(script)",
      "[class*='dialog']:not(script)",
      "[class*='drawer']:not(script)",
      "[class*='popover']:not(script)"
    ];
    const out = [];
    for (const sel of selectors) {
      const els = Array.from(document.querySelectorAll(sel));
      for (const el of els) {
        if (el.offsetParent === null) continue;
        const t = (el.innerText || "").trim().slice(0, 300);
        if (t.length < 5) continue;
        out.push({
          sel,
          cls: (el.className || "").toString().slice(0, 100),
          tag: el.tagName,
          text: t
        });
      }
    }
    // textareas and inputs
    const inputs = Array.from(document.querySelectorAll("textarea, input[type='text']:not([readonly])")).map(t => ({
      tag: t.tagName, type: t.type, ph: t.placeholder, cls: (t.className || "").toString().slice(0, 80), visible: t.offsetParent !== null
    }));
    return { popups: out, inputs };
  });
  console.log("=== R1: 弹窗 + 输入框 ===");
  console.log(JSON.stringify(r1, null, 2));

  // 看截图
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
