// 诊断 5：验证 navigator.clipboard.writeText + Ctrl+V 能否快速写入真实模板
const { chromium } = require("playwright-core");
const fs = require("fs");
const SEL = '#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]';

(async () => {
  const tpl = fs.readFileSync("prompts/05_LUXURY_INSERT_PROMPT.md", "utf8");
  const prompt = `${tpl}\n\n[本批指纹：DIAG-5]`;
  console.log("prompt length =", prompt.length, "lines =", prompt.split("\n").length);

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 60000 });
  const pages = [];
  for (const c of browser.contexts()) for (const p of c.pages()) pages.push(p);
  const page = pages.find((p) => p.url().includes("chatgpt.com"));
  const context = page.context();

  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://chatgpt.com" });
    console.log("grantPermissions OK");
  } catch (e) {
    console.log("grantPermissions 失败:", e.message.split("\n")[0]);
  }

  const wrote = await page.evaluate(async (t) => {
    try {
      await navigator.clipboard.writeText(t);
      return "ok";
    } catch (e) {
      return "fail: " + e.message;
    }
  }, prompt);
  console.log("clipboard.writeText =", wrote);

  const t0 = Date.now();
  await page.evaluate((sel) => { document.querySelector(sel).focus(); }, SEL);
  await page.keyboard.press("Control+V");
  console.log("Ctrl+V 往返(ms) =", Date.now() - t0);

  // 等待写入完成（最多 60s）
  const deadline = Date.now() + 60000;
  let len = 0;
  while (Date.now() < deadline) {
    len = await page.evaluate((sel) => (document.querySelector(sel)?.innerText || "").length, SEL);
    if (len >= prompt.length * 0.9) break;
    await page.waitForTimeout(1000);
  }
  const tail = await page.evaluate((sel) => {
    const ed = document.querySelector(sel);
    const t = ed?.innerText || "";
    return { len: t.length, tailHit: t.includes("[本批指纹：DIAG-5]") };
  }, SEL);
  console.log("写入结果 =", JSON.stringify(tail), " 总耗时(ms) =", Date.now() - t0);

  await page.evaluate((sel) => {
    const ed = document.querySelector(sel);
    if (!ed) return;
    ed.focus();
    ed.innerHTML = "";
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  }, SEL);

  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
