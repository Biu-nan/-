const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  await collectPage.waitForSelector(".vxe-body--row", { timeout: 10000 });
  await collectPage.waitForTimeout(1500);

  const r = await collectPage.evaluate(() => {
    const SEARCH = "fried chicken keychain realistic food bag charm";
    const norm = (s) => (s || "").replace(/\s+/g, "").trim().toLowerCase();
    const tn = norm(SEARCH);
    // 跟 openCollectDraftByTitle 一样: document.querySelectorAll("tr")
    const trs = Array.from(document.querySelectorAll("tr")).filter((r) => r.querySelector("td"));
    const trWithTds = trs.length;
    const matches = trs.filter((r) => r.innerText && norm(r.innerText).includes(tn));
    return {
      trWithTds,
      matchCount: matches.length,
      firstTrInner: trs[0]?.innerText.slice(0, 200) || "(none)",
      vxeRows: document.querySelectorAll(".vxe-body--row").length
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})();
