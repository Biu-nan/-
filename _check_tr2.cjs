const { chromium } = require("playwright-core");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));

  // 强清残留 + reload
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
  await collectPage.waitForTimeout(4000);
  await collectPage.evaluate(() => window.scrollTo(0, 0));
  await collectPage.waitForTimeout(500);

  const r = await collectPage.evaluate(() => {
    const trWithTds = Array.from(document.querySelectorAll("tr")).filter(r => r.querySelector("td"));
    return {
      trWithTds: trWithTds.length,
      firstTrClass: trWithTds[0]?.className || "(none)",
      firstTrText: (trWithTds[0]?.innerText || "").slice(0, 200).replace(/\n+/g, " | "),
      vxeRows: document.querySelectorAll(".vxe-body--row").length
    };
  });
  console.log("tr with tds:", JSON.stringify(r, null, 2));
  await browser.close();
})();
