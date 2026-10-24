// 诊断 2：插入真实 18KB 模板后，send 按钮多久 enabled（不点击发送，最后清空）
const { chromium } = require("playwright-core");
const fs = require("fs");

(async () => {
  const tpl = fs.readFileSync("prompts/05_LUXURY_INSERT_PROMPT.md", "utf8");
  const prompt = `${tpl}\n\n现在是第 1 次输出：请只输出 Image 01、02、03 三个完整区块。\n\n[本批指纹：DIAG-1]`;
  console.log("prompt length =", prompt.length);

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 60000 });
  const pages = [];
  for (const c of browser.contexts()) for (const p of c.pages()) pages.push(p);
  const page = pages.find((p) => p.url().includes("chatgpt.com"));
  console.log("url =", page.url());

  const t0 = Date.now();
  const result = await page.evaluate((value) => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    if (!ed) return { error: "no editor" };
    ed.focus();
    const a = performance.now();
    document.execCommand("insertText", false, value);
    const b = performance.now();
    return new Promise((resolve) => {
      const marker = value.slice(0, 16);
      let attempts = 0;
      const t = performance.now();
      const check = () => {
        const text = ed.innerText || ed.textContent || "";
        const send = document.querySelector('#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"]');
        const ready = text.includes(marker) && send instanceof HTMLButtonElement && !send.disabled;
        if (ready || attempts >= 240) {
          resolve({
            insertMs: Math.round(b - a),
            readyMs: Math.round(performance.now() - t),
            ready,
            editorLen: text.length,
            attempts,
            sendDisabled: send ? send.disabled : "no-send",
            markerHit: text.includes(marker),
          });
          return;
        }
        attempts += 1;
        window.setTimeout(check, 50);
      };
      window.setTimeout(check, 0);
    });
  }, prompt);
  console.log("evaluate 总耗时(ms) =", Date.now() - t0);
  console.log("result =", JSON.stringify(result));

  // 探测：插入后主线程是否仍繁忙（连续 5 次轻量 evaluate 的往返时间）
  const rtt = [];
  for (let i = 0; i < 5; i += 1) {
    const s = Date.now();
    await page.evaluate(() => 1 + 1);
    rtt.push(Date.now() - s);
  }
  console.log("插入后 evaluate RTT(ms) =", JSON.stringify(rtt));

  await page.evaluate(() => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    if (!ed) return;
    ed.focus();
    ed.innerHTML = "";
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
  });
  const left = await page.evaluate(() => {
    const ed = document.querySelector('#prompt-textarea');
    return (ed?.innerText || "").length;
  });
  console.log("清空后残留长度 =", left);
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
