const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  console.log("URL:", collectPage.url());

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
  // reload
  await collectPage.reload({ waitUntil: "domcontentloaded" });
  await collectPage.waitForTimeout(3000);
  await collectPage.evaluate(() => window.scrollTo(0, 0));
  await collectPage.waitForTimeout(500);

  // 验证第一行
  const r0 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    return {
      title: row?.querySelector(".col_8")?.innerText.slice(0, 100) || "(no title)",
      totalRows: document.querySelectorAll(".vxe-body--row").length
    };
  });
  console.log("BEFORE SEARCH: total=", r0.totalRows, "first title:", r0.title);

  // 模拟 searchCollectBox 真实步骤
  const SEARCH = "Fried Chicken Keychain Realistic Food Bag Charm For Backpack Purse Keys Food Lovers Birthday Party And Everyday Gift,Accessory";
  console.log("SEARCHING:", SEARCH.slice(0, 60), "...");
  const box = collectPage.locator("input[name='tableSearchInput']").first();
  await box.click({ timeout: 5000 });
  await box.fill("", { timeout: 5000 });
  await box.fill(SEARCH, { timeout: 5000 });
  await collectPage.waitForTimeout(500);
  await collectPage.keyboard.press("Enter");
  // 点 "搜索" 按钮（如有）
  const sb = collectPage.locator("button:has-text('搜索'):visible");
  if (await sb.count() > 0) {
    await sb.first().click({ timeout: 3000 }).catch(() => {});
    console.log("clicked 搜索");
  }
  // 等 loading
  await collectPage.waitForFunction(
    () => !document.querySelector(".vxe-table--loading"),
    null, { timeout: 10000 }
  ).catch((e) => console.log("loading wait:", e.message.slice(0, 80)));
  await collectPage.waitForTimeout(2000);

  // 验证搜索结果
  const r1 = await collectPage.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".vxe-body--row"));
    return {
      total: rows.length,
      firstTitle: rows[0]?.querySelector(".col_8")?.innerText.slice(0, 100) || "(no title)",
      allTitles: rows.slice(0, 5).map(r => r.querySelector(".col_8")?.innerText.slice(0, 60) || "")
    };
  });
  console.log("AFTER SEARCH: total=", r1.total, "first title:", r1.firstTitle);
  for (const t of r1.allTitles) console.log("  -", t);

  // 看搜索框还留着没
  const inputVal = await collectPage.locator("input[name='tableSearchInput']").inputValue();
  console.log("input value after:", inputVal.slice(0, 80));

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
