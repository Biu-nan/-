const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  console.log("URL:", collectPage.url());

  // 等表格加载
  await collectPage.waitForSelector(".vxe-body--row", { timeout: 10000 });
  await collectPage.waitForTimeout(1500);

  // dump 头 20 行
  const r = await collectPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".vxe-body--row"));
    return {
      total: rows.length,
      sample: rows.slice(0, 20).map((row) => {
        const cells = Array.from(row.querySelectorAll(".vxe-cell, td"));
        // 标题/产品ID 是 col_7/col_8
        const titleCell = cells.find(c => /keychain|钥匙|包|Charm/i.test(c.innerText || ""));
        return {
          text: (row.innerText || "").slice(0, 200).replace(/\n+/g, " | ")
        };
      })
    };
  });
  console.log("total rows:", r.total);
  for (const s of r.sample) console.log("  >", s.text);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
