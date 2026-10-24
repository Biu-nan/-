const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  await collectPage.reload({ waitUntil: "domcontentloaded" });
  await collectPage.waitForTimeout(3000);

  // fallback 搜 "Fried Chicken"
  const box = collectPage.locator("input[name='tableSearchInput']").first();
  await box.fill("", { timeout: 5000 });
  await box.fill("Fried Chicken", { timeout: 5000 });
  await collectPage.waitForTimeout(500);
  await collectPage.keyboard.press("Enter");
  await collectPage.locator("button:has-text('搜索'):visible").first().click({ timeout: 3000 }).catch(() => {});
  await collectPage.waitForFunction(() => !document.querySelector(".vxe-table--loading"), null, { timeout: 10000 }).catch(() => {});
  await collectPage.waitForTimeout(2000);

  // dump 第一个 vxe-body--row 的所有 td
  const r = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    if (!row) return { error: "no row" };
    const tds = Array.from(row.querySelectorAll("td"));
    return tds.map((td, i) => ({
      i, cls: td.className.slice(0, 50),
      text: (td.innerText || "").slice(0, 80).replace(/\n+/g, " | "),
      textLen: (td.innerText || "").length
    }));
  });
  console.log("=== first vxe row tds ===");
  for (const t of r) console.log(`  td[${t.i}] cls=${t.cls} len=${t.textLen}: ${t.text}`);

  await browser.close();
})();
