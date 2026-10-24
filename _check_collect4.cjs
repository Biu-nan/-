const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  await collectPage.waitForSelector(".vxe-body--row", { timeout: 10000 });
  await collectPage.waitForTimeout(1000);

  // dump 头 3 行 + 头所有列的 innerText
  const r = await collectPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".vxe-body--row")).slice(0, 3);
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(".vxe-cell, .vxe-body--column"));
      return cells.map((c, i) => ({
        i, cls: (c.className || "").toString().slice(0, 40),
        text: (c.innerText || "").trim().slice(0, 60)
      })).filter(c => c.text.length > 0);
    });
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
