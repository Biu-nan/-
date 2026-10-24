const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  if (!collectPage) { console.log("NO COLLECT PAGE"); await browser.close(); process.exit(1); }
  console.log("URL:", collectPage.url());

  // 关掉残留 modal/drawer
  await collectPage.evaluate(() => {
    document.querySelectorAll(".ant-modal-wrap, .ant-drawer").forEach(el => {
      const c = el.querySelector(".ant-modal-close, .ant-drawer-close, [class*=close]");
      if (c) c.click();
      else el.style.display = "none";
    });
  });
  await collectPage.waitForTimeout(500);

  // 查 first 20 行的标题/类目 + 是否有炸鸡
  const r = await collectPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".vxe-body--row")).slice(0, 30);
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll(".vxe-cell"));
      return {
        title: (cells[3]?.innerText || "").slice(0, 80),
        category: (cells[4]?.innerText || "").slice(0, 40),
        opCell: (cells[cells.length - 1]?.innerText || "").slice(0, 60)
      };
    });
  });
  console.log("=== first 30 rows ===");
  for (const r1 of r) console.log(` - ${r1.title.slice(0, 60).padEnd(60)} | ${r1.category.slice(0, 30).padEnd(30)} | op: ${r1.opCell}`);

  // 看是否有炸鸡相关
  const hasChicken = r.some(x => /炸鸡|Fried Chicken|keychain/i.test(x.title));
  console.log("hasChicken:", hasChicken);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
