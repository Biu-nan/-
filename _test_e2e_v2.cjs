// 端到端实测 v2：复刻 searchCollectBox 真实搜索逻辑（fill+Enter+点击搜索+等loading消失）
// 然后走 markCollectRowAsPending 流程，验证 selector + 行为
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 15000 });
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const collectPage = pages.find((p) => /smtChoice\/(draft|collect)/.test(p.url()));
  if (!collectPage) { console.log("NO COLLECT PAGE"); await browser.close(); process.exit(1); }
  console.log("COLLECT:", collectPage.url());
  const SEARCH_TITLE = "仿真PVC食礼物品玩创意炸鸡翅腿薯条模型学生批发钥匙圈扣挂件饰";

  function log(s) { console.log(`[test] ${s}`); }
  function pause(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ====== 1) 复刻 searchCollectBox ======
  log(`搜 searchTitle = ${SEARCH_TITLE}`);
  const sel = 'input[name="tableSearchInput"]';
  const box = collectPage.locator(sel).first();
  await box.click({ timeout: 5000 });
  await box.fill("", { timeout: 5000 });
  await box.fill(SEARCH_TITLE, { timeout: 5000 });
  await pause(500);
  await collectPage.keyboard.press("Enter").catch(() => {});
  // 点击 "搜索" 按钮（如有）
  const searchBtns = collectPage.locator("button:has-text('搜索'):visible");
  if (await searchBtns.count() > 0) {
    await searchBtns.first().click({ timeout: 3000 }).catch(() => {});
    log("点击搜索按钮");
  }
  // 等 vxe-table--loading 消失 + 表格 reload
  try {
    await collectPage.waitForFunction(
      () => {
        const loading = document.querySelector(".vxe-table--loading");
        if (loading) return false;
        const rows = document.querySelectorAll(".vxe-body--row");
        return rows.length >= 0; // 0 也算（搜索无结果）
      },
      null, { timeout: 15000 }
    );
  } catch (e) { log(`wait loading timeout: ${e.message}`); }
  await pause(1500);

  // 验证搜索结果
  const r1 = await collectPage.evaluate(() => ({
    rowCount: document.querySelectorAll(".vxe-body--row").length,
    firstRowText: (document.querySelector(".vxe-body--row")?.innerText || "").slice(0, 300).replace(/\n+/g, " | ")
  }));
  log(`搜索后行数=${r1.rowCount}, 首行内容: ${r1.firstRowText}`);
  if (!r1.rowCount) {
    log("搜索无结果，可能炸鸡已被移走。换英文标题实测。");
    await browser.close();
    process.exit(0);
  }

  // ====== 2) 等 dropdown 真正出现 ======
  log("点第一行的'更多'");
  const moreBtn = collectPage.locator(".vxe-body--row").first().locator("button.ant-dropdown-trigger").last();
  await moreBtn.click({ timeout: 5000, force: true });
  // 等 dropdown 元素可见
  try {
    await collectPage.waitForSelector(".ant-dropdown-menu-item:visible", { timeout: 5000 });
  } catch (ex) { log(`wait dropdown timeout: ${ex.message}`); }
  await pause(500);

  const ddItems = collectPage.locator(".ant-dropdown-menu-item:visible");
  const ddText = await ddItems.allInnerTexts();
  log(`dropdown 菜单项: ${JSON.stringify(ddText)}`);

  if (!ddText.some(t => t.includes("添加备注"))) {
    log("dropdown 无'添加备注'，中止");
    await browser.close();
    process.exit(1);
  }

  // ====== 3) 备注 ======
  log("点'添加备注'");
  await ddItems.filter({ hasText: "添加备注" }).first().click({ timeout: 5000, force: true });
  // 等 modal 出现
  try {
    await collectPage.waitForSelector("textarea[placeholder*='请填写您要备注的内容']:visible", { timeout: 8000 });
  } catch (ex) { log(`wait modal timeout: ${ex.message}`); }
  await pause(800);

  const ta = collectPage.locator("textarea[placeholder*='请填写您要备注的内容']:visible").first();
  console.log("  textarea count:", await ta.count());
  await ta.fill("待上架", { timeout: 5000 });
  log("已填 textarea = '待上架'");
  await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_test_modal_filled.png" });

  // 提交
  const submit = collectPage.locator(".ant-modal:visible button").filter({ hasText: /^提交$/ }).first();
  console.log("  submit count:", await submit.count());
  await submit.click({ timeout: 5000, force: true });
  log("点击提交");

  // 等 modal 关闭
  try {
    await collectPage.waitForFunction(
      () => !document.querySelector(".ant-modal-wrap:not([style*='display: none'])"),
      null, { timeout: 8000 }
    );
    log("备注 modal 已关闭");
  } catch (ex) { log(`modal 关闭超时: ${ex.message}`); }
  await pause(1500);

  // ====== 4) 移入待发布 ======
  log("点操作列'移入待发布'");
  const moveBtn = collectPage.locator(".vxe-body--row").first().locator("button").filter({ hasText: /^移入待发布$/ }).first();
  const moveCount = await moveBtn.count();
  console.log("  移入待发布 count:", moveCount);
  if (moveCount > 0) {
    await moveBtn.click({ timeout: 5000, force: true });
    await pause(1500);
    // 二次确认
    const confirm = collectPage.locator(".ant-modal-confirm-btns button, .ant-modal:visible button").filter({ hasText: /^确定$|^确认$/ }).first();
    if (await confirm.count() > 0) {
      log("二次确认→确定");
      await confirm.click({ timeout: 5000, force: true });
      await pause(1500);
    } else {
      log("无二次确认弹窗");
    }
    await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_test_after_move.png" });
  } else {
    log("操作列无'移入待发布'按钮");
  }

  // ====== 5) 最终状态 ======
  await pause(2000);
  const r2 = await collectPage.evaluate(() => {
    const row = document.querySelector(".vxe-body--row");
    const opCell = row?.querySelector(".col--last");
    return {
      rowCount: document.querySelectorAll(".vxe-body--row").length,
      opCellText: opCell?.innerText || "(none)",
      fullRowText: (row?.innerText || "").slice(0, 400).replace(/\n+/g, " | ")
    };
  });
  log(`最终行数=${r2.rowCount}`);
  log(`操作列: ${r2.opCellText}`);
  log(`整行: ${r2.fullRowText}`);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
