// 诊断 3：对比 paste 事件 / 分块 execCommand 在真实模板上的写入耗时
const { chromium } = require("playwright-core");
const fs = require("fs");

const SEL = '#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]';

(async () => {
  const tpl = fs.readFileSync("prompts/05_LUXURY_INSERT_PROMPT.md", "utf8");
  const prompt = `${tpl}\n\n[本批指纹：DIAG-3]`;
  console.log("prompt length =", prompt.length, "lines =", prompt.split("\n").length);

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", { timeout: 60000 });
  const pages = [];
  for (const c of browser.contexts()) for (const p of c.pages()) pages.push(p);
  const page = pages.find((p) => p.url().includes("chatgpt.com"));

  const clear = () => page.evaluate((sel) => {
    const ed = document.querySelector(sel);
    if (!ed) return false;
    ed.focus();
    ed.innerHTML = "";
    ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
    return true;
  }, SEL);

  const run = (mode, chunk) => page.evaluate(async ({ value, sel, mode, size }) => {
    const ed = document.querySelector(sel);
    if (!ed) return { error: "no editor" };
    ed.focus();
    const t0 = performance.now();
    if (mode === "paste") {
      const dt = new DataTransfer();
      dt.setData("text/plain", value);
      dt.setData("text/html", "");
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
      ed.dispatchEvent(ev);
    } else {
      for (let i = 0; i < value.length; i += size) {
        document.execCommand("insertText", false, value.slice(i, i + size));
        if (i + size < value.length) await new Promise((r) => setTimeout(r, 0));
      }
    }
    const t1 = performance.now();
    const text = ed.innerText || ed.textContent || "";
    return {
      ms: Math.round(t1 - t0),
      editorLen: text.length,
      markerHit: text.includes(value.slice(0, 16)),
      tailHit: text.includes("[本批指纹：DIAG-3]"),
    };
  }, { value: prompt, sel: SEL, mode, size: chunk });

  for (const [mode, chunk] of [["paste", 0], ["chunk", 1500], ["chunk", 500]]) {
    await clear();
    const label = mode === "paste" ? "paste 事件" : `分块 execCommand(${chunk})`;
    const t = Date.now();
    const r = await run(mode, chunk).catch((e) => ({ error: e.message.split("\n")[0] }));
    console.log(`${label}:`, JSON.stringify(r), " 总往返(ms) =", Date.now() - t);
  }

  await clear();
  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
