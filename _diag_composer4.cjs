// 诊断 4：小样本对照 — 行数 vs 字符数、paste(+selection) vs execCommand vs CDP insertText
const { chromium } = require("playwright-core");
const SEL = '#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][data-lexical-editor="true"]';

(async () => {
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

  const oneLine = "X".repeat(2000);
  const manyLines = Array.from({ length: 60 }, () => "X".repeat(32)).join("\n"); // ~2000 chars, 60 lines

  const execCmd = (value) => page.evaluate(({ v, sel }) => {
    const ed = document.querySelector(sel);
    ed.focus();
    const t0 = performance.now();
    document.execCommand("insertText", false, v);
    return { ms: Math.round(performance.now() - t0), len: (ed.innerText || "").length };
  }, { v: value, sel: SEL });

  const pasteEvt = (value) => page.evaluate(({ v, sel }) => {
    const ed = document.querySelector(sel);
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const selObj = window.getSelection();
    selObj.removeAllRanges();
    selObj.addRange(range);
    const dt = new DataTransfer();
    dt.setData("text/plain", v);
    const t0 = performance.now();
    ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    return { ms: Math.round(performance.now() - t0), len: (ed.innerText || "").length };
  }, { v: value, sel: SEL });

  const cdpInsert = async (value) => {
    const t0 = Date.now();
    await page.evaluate((sel) => { document.querySelector(sel).focus(); }, SEL);
    await page.keyboard.insertText(value);
    const len = await page.evaluate((sel) => (document.querySelector(sel)?.innerText || "").length, SEL);
    return { ms: Date.now() - t0, len };
  };

  for (const [name, text] of [["单行2000字符", oneLine], ["60行共2000字符", manyLines]]) {
    await clear();
    console.log(`--- ${name} ---`);
    const r1 = await execCmd(text).catch((e) => ({ err: e.message.split("\n")[0] }));
    await clear();
    console.log("  execCommand      :", JSON.stringify(r1));
    const r2 = await pasteEvt(text).catch((e) => ({ err: e.message.split("\n")[0] }));
    await clear();
    console.log("  paste+selection  :", JSON.stringify(r2));
  }

  await clear();
  const r3 = await cdpInsert(manyLines).catch((e) => ({ err: e.message.split("\n")[0] }));
  console.log("  CDP insertText(60行2000字符):", JSON.stringify(r3));
  await clear();

  await browser.close().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
