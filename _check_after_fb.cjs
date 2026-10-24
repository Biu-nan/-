const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  // 强清残留
  for (let i = 0; i < 3; i++) {
    await collectPage.evaluate(() => {
      document.querySelectorAll(".ant-modal-wrap, .ant-drawer").forEach(el => {
        const c = el.querySelector(".ant-modal-close, .ant-drawer-close");
        if (c) c.click(); else el.style.display = "none";
      });
    });
    await collectPage.keyboard.press("Escape").catch(() => {});
    await collectPage.waitForTimeout(300);
  }
  await collectPage.reload({ waitUntil: "domcontentloaded" });
  await collectPage.waitForTimeout(3000);

  // 模拟 searchCollectBox fallback
  const SEARCH = "Fried Chicken Keychain Realistic Food Bag Charm For Backpack Purse Keys Food Lovers Birthday Party And Everyday Gift,Accessory";
  const box = collectPage.locator("input[name='tableSearchInput']").first();
  await box.click({ timeout: 5000 });
  await box.fill("", { timeout: 5000 });
  await box.fill(SEARCH, { timeout: 5000 });
  await collectPage.waitForTimeout(500);
  await collectPage.keyboard.press("Enter");
  await collectPage.locator("button:has-text('搜索'):visible").first().click({ timeout: 3000 }).catch(() => {});
  await collectPage.waitForFunction(() => !document.querySelector(".vxe-table--loading"), null, { timeout: 10000 }).catch(() => {});
  await collectPage.waitForTimeout(2000);

  let total = await collectPage.locator(".vxe-body--row").count();
  console.log("first search rows:", total);

  if (!total) {
    // fallback
    await box.fill("", { timeout: 5000 });
    await box.fill("Fried Chicken", { timeout: 5000 });
    await collectPage.waitForTimeout(500);
    await collectPage.keyboard.press("Enter");
    await collectPage.locator("button:has-text('搜索'):visible").first().click({ timeout: 3000 }).catch(() => {});
    await collectPage.waitForFunction(() => !document.querySelector(".vxe-table--loading"), null, { timeout: 10000 }).catch(() => {});
    await collectPage.waitForTimeout(2000);
    total = await collectPage.locator(".vxe-body--row").count();
    console.log("after fallback rows:", total);
  }

  // dump first row 详情
  const r = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    const trs = Array.from(document.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    return {
      vxeRowCount: document.querySelectorAll(".vxe-body--row").length,
      trWithTdCount: trs.length,
      firstTrClass: trs[0]?.className || "(none)",
      firstTrText: (trs[0]?.innerText || "").slice(0, 300).replace(/\n+/g, " | "),
      vxeFirstRowText: (row?.innerText || "").slice(0, 300).replace(/\n+/g, " | "),
      // 看 tr 是否就是 vxe-body--row
      vxeRowIsTr: row?.tagName || "(none)"
    };
  });
  console.log("dump:", JSON.stringify(r, null, 2));

  await browser.close();
})();
