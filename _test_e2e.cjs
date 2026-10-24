// 端到端实测：复现 markCollectRowAsPending 流程，验证 selector + 行为
// 跑：搜索炸鸡 → 找行 → 备注"待上架" → 移入待发布
// 不破坏：每步前后 dump，方便排查

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

  // 1) 在采集箱搜炸鸡
  log(`搜 searchTitle = ${SEARCH_TITLE}`);
  await collectPage.evaluate(() => {
    const inp = document.querySelector("input[name='tableSearchInput']");
    if (inp) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(inp, "");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await collectPage.locator("input[name='tableSearchInput']").fill(SEARCH_TITLE);
  await pause(500);
  // 触发搜索按钮（如果有）
  const searchBtn = collectPage.locator("button:has-text('搜索')").first();
  if (await searchBtn.count() > 0) {
    await searchBtn.click({ timeout: 3000 }).catch(() => {});
    log("点击搜索按钮");
  }
  await pause(2000);

  // 看搜索结果
  const r1 = await collectPage.evaluate(() => ({
    rowCount: document.querySelectorAll(".vxe-body--row").length,
    firstRowText: (document.querySelector(".vxe-body--row")?.innerText || "").slice(0, 200).replace(/\n+/g, " | ")
  }));
  log(`搜索后行数=${r1.rowCount}, 首行内容前 200: ${r1.firstRowText}`);
  if (!r1.rowCount) {
    log("无搜索结果，跳过实测");
    await browser.close();
    process.exit(0);
  }

  // 2) 点"更多"
  log("点第一行的'更多'");
  const moreBtn = collectPage.locator(".vxe-body--row").first().locator("button.ant-dropdown-trigger").last();
  console.log("  more count:", await moreBtn.count());
  await moreBtn.click({ timeout: 5000, force: true });
  await pause(1000);

  // 3) 等 dropdown 出现
  const ddItems = collectPage.locator(".ant-dropdown-menu-item:visible");
  const ddText = await ddItems.allInnerTexts();
  log(`dropdown 菜单项: ${JSON.stringify(ddText)}`);

  // 4) 点"添加备注"
  if (ddText.some(t => t.includes("添加备注"))) {
    log("点'添加备注'");
    await ddItems.filter({ hasText: "添加备注" }).first().click({ timeout: 5000, force: true });
    await pause(2000);

    // 5) 填备注
    const ta = collectPage.locator("textarea[placeholder*='请填写您要备注的内容']:visible").first();
    console.log("  textarea count:", await ta.count());
    await ta.fill("待上架", { timeout: 5000 });
    log("已填 textarea = '待上架'");

    // 截图：备注弹窗已填
    await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_test_modal_filled.png" });
    log("截图: _test_modal_filled.png");

    // 6) 点提交
    const submit = collectPage.locator(".ant-modal:visible button").filter({ hasText: /^提交$/ }).first();
    console.log("  submit count:", await submit.count());
    await submit.click({ timeout: 5000, force: true });
    log("点击提交");

    // 7) 等 modal 关闭
    try {
      await collectPage.waitForFunction(
        () => !document.querySelector(".ant-modal-wrap:not([style*='display: none'])"),
        null, { timeout: 8000 }
      );
      log("备注 modal 已关闭");
    } catch (ex) { log(`modal 关闭超时: ${ex.message}`); }
  } else {
    log("dropdown 无'添加备注'，跳过备注步骤");
  }

  await pause(1500);

  // 8) 点"移入待发布"
  log("点操作列'移入待发布'");
  const moveBtn = collectPage.locator(".vxe-body--row").first().locator("button").filter({ hasText: /^移入待发布$/ }).first();
  const moveCount = await moveBtn.count();
  console.log("  移入待发布 count:", moveCount);
  if (moveCount > 0) {
    await moveBtn.click({ timeout: 5000, force: true });
    await pause(1500);
    // 二次确认
    const confirm = collectPage.locator(".ant-modal-confirm-btns button, .ant-modal:visible button").filter({ hasText: /^确定$|^确认$/ }).first();
    const confCount = await confirm.count();
    if (confCount > 0) {
      log("二次确认→确定");
      await confirm.click({ timeout: 5000, force: true });
      await pause(1500);
    } else {
      log("无二次确认弹窗");
    }
    // 截图：移入后
    await collectPage.screenshot({ path: "F:/yikuaborder-deploy/_test_after_move.png" });
    log("截图: _test_after_move.png");
  } else {
    log("操作列无'移入待发布'按钮");
  }

  // 9) 最终状态
  await pause(2000);
  const r2 = await collectPage.evaluate(() => ({
    rowCount: document.querySelectorAll(".vxe-body--row").length,
    firstRowText: (document.querySelector(".vxe-body--row")?.innerText || "").slice(0, 400).replace(/\n+/g, " | "),
    opCellText: (document.querySelector(".vxe-body--row .col--last")?.innerText || "(no row)")
  }));
  log(`最终行数=${r2.rowCount}`);
  log(`首行内容: ${r2.firstRowText}`);
  log(`操作列: ${r2.opCellText}`);

  await browser.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", e); process.exit(1); });
