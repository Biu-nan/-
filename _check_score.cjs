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

  // 模拟 openCollectDraftByTitle 的 score 评估
  const r = await collectPage.evaluate((t) => {
    const norm = (s) => (s || "").replace(/\s+/g, "").trim().toLowerCase();
    const keywords = (s) => norm(s).split(/[^\u4e00-\u9fa5a-z0-9]+/).filter(Boolean);
    const tk = keywords(t);
    const rows = Array.from(document.querySelectorAll("tr")).filter((r) => r.querySelector("td"));
    const results = [];
    for (const r of rows) {
      const cells = Array.from(r.querySelectorAll("td"));
      const titleCells = cells.filter((td) => (td.innerText || "").length > 8);
      const candidates = titleCells.length ? titleCells : cells;
      let rowScore = 0;
      let rowTitle = "";
      for (const td of candidates) {
        const ct = norm(td.innerText);
        const ck = keywords(td.innerText);
        let score = 0;
        if (ct && (ct === norm(t) || ct.includes(norm(t)) || norm(t).includes(ct))) {
          score = Math.max(score, ct === norm(t) ? 4 : (ct.includes(norm(t)) ? 3 : 2));
        }
        const inter = ck.filter((w) => tk.includes(w)).length;
        if (tk.length && inter) {
          const ratio = inter / Math.max(tk.length, ck.length);
          score = Math.max(score, ratio * 2);
        }
        if (score > rowScore) { rowScore = score; rowTitle = (td.innerText || "").trim().slice(0, 60); }
      }
      if (rowScore >= 0.3) results.push({ rowScore: rowScore.toFixed(2), title: rowTitle, cls: r.className });
    }
    return {
      totalTr: rows.length,
      matched: results.length,
      top5: results.slice(0, 5)
    };
  }, "Fried Chicken Keychain Realistic Food Bag Charm For Backpack Purse Keys Food Lovers Birthday Party And Everyday Gift,Accessory");
  console.log(JSON.stringify(r, null, 2));

  await browser.close();
})();
