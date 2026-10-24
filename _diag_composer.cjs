// 诊断：ChatGPT composer 长文本写入耗时（只读诊断 + 可自清理）
const { chromium } = require("playwright-core");

const CHROME_DEBUG_PORT = 9223;
const SIZES = [2000, 8000, 15000];

(async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`, { timeout: 60000 });
  const ctx = browser.contexts()[0];
  const pages = [];
  for (const c of browser.contexts()) for (const p of c.pages()) pages.push(p);
  const page = pages.find((p) => p.url().includes("chatgpt.com")) || pages[0];
  console.log("page.url =", page.url());
  console.log("pages =", pages.map((p) => p.url()).slice(0, 8));

  const info = await page.evaluate(() => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    const send = document.querySelector('#composer-submit-button[data-testid="send-button"], button[data-testid="send-button"]');
    return {
      foundEditor: !!ed,
      tag: ed?.tagName,
      editable: ed?.getAttribute?.("contenteditable"),
      id: ed?.id,
      testid: ed?.getAttribute?.("data-testid"),
      foundSend: !!send,
      sendDisabled: send?.disabled,
      draftLen: (ed?.innerText || "").length,
      stopVisible: !!document.querySelector('button[data-testid="stop-button"]'),
    };
  });
  console.log("composer info =", JSON.stringify(info, null, 2));

  const clear = () => page.evaluate(() => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    if (!ed) return false;
    ed.focus();
    ed.innerHTML = "";
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    return true;
  });

  const measure = (text) => page.evaluate((value) => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    if (!ed) return { error: "no editor" };
    ed.focus();
    const t0 = performance.now();
    document.execCommand("insertText", false, value);
    const t1 = performance.now();
    const len = (ed.innerText || ed.textContent || "").length;
    return { insertMs: Math.round(t1 - t0), editorLen: len };
  }, text);

  const measureChunked = (text, chunk) => page.evaluate(async ({ value, size }) => {
    const ed = document.querySelector('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]');
    if (!ed) return { error: "no editor" };
    ed.focus();
    const t0 = performance.now();
    for (let i = 0; i < value.length; i += size) {
      document.execCommand("insertText", false, value.slice(i, i + size));
      await new Promise((r) => setTimeout(r, 0));
    }
    const t1 = performance.now();
    const len = (ed.innerText || ed.textContent || "").length;
    return { insertMs: Math.round(t1 - t0), editorLen: len };
  }, { value: text, size: chunk });

  for (const size of SIZES) {
    const text = "X".repeat(size);
    await clear();
    const one = await measure(text).catch((e) => ({ error: e.message.split("\n")[0] }));
    await clear();
    const chunked = await measureChunked(text, 1500).catch((e) => ({ error: e.message.split("\n")[0] }));
    await clear();
    console.log(`size=${size} 单次 execCommand =`, JSON.stringify(one), " 分块1500 =", JSON.stringify(chunked));
  }

  await clear();
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
