const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  console.log("URL:", collectPage.url());

  // 强关所有 modal
  for (let i = 0; i < 3; i++) {
    await collectPage.evaluate(() => {
      document.querySelectorAll(".ant-modal-wrap, .ant-drawer").forEach(el => {
        const c = el.querySelector(".ant-modal-close, .ant-drawer-close");
        if (c) c.click();
        else el.style.display = "none";
      });
    });
    await collectPage.keyboard.press("Escape").catch(() => {});
    await collectPage.waitForTimeout(500);
  }
  // reload
  await collectPage.reload({ waitUntil: "domcontentloaded" });
  await collectPage.waitForTimeout(3000);

  // 滚动到顶
  await collectPage.evaluate(() => window.scrollTo(0, 0));
  await collectPage.waitForTimeout(500);

  // dump 所有 vxe-body--row
  const r = await collectPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".vxe-body--row"));
    return {
      total: rows.length,
      first10: rows.slice(0, 10).map((row) => {
        const cells = Array.from(row.querySelectorAll(".vxe-cell"));
        const titleCell = cells[3] || cells[2] || cells[1];
        return (titleCell?.innerText || "").slice(0, 80);
      })
    };
  });
  console.log("total:", r.total);
  for (const t of r.first10) console.log(" -", t);

  // 看头部链接（看是否在 草稿 / 待发布 等哪个分类）
  const nav = await collectPage.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, .ant-menu-item, [class*='tab']")).map(a => (a.innerText || "").trim()).filter(Boolean);
    return links.slice(0, 30);
  });
  console.log("nav links:", nav);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
