// 采集箱批量上架 全链路自测：openCollectBox -> search -> openDraft -> fillCategory -> fillFromFacts -> save
// 直接驱动最新 adapter 代码（不经由运行中的 server），并用独立日志看清每一步的页面状态 / 弹窗 / JS 对话框。
import { DianxiaomiAdapter } from "../dist/src/dianxiaomi-adapter.js";
import { normalizeDianxiaomiFacts } from "../dist/src/dianxiaomi-facts.js";
import fs from "node:fs";
import path from "node:path";

const KEY = process.argv[2] || "xiangBao";
const TITLE = process.argv[3] || "幸运草手机链挂绳串珠风铃ccd相机挂饰钥匙扣百搭包包挂件小礼品";
const FACTS_DIR = process.argv[4] || path.resolve("已完成产品/四叶草发光按压钥匙扣");

const log = [];
const L = (...a) => { const s = a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" "); console.log(s); log.push(`[${new Date().toISOString()}] ${s}`); };
const dumpFile = path.resolve("scripts/collect_loop_test.log.json");

async function dumpPage(page, label) {
  try {
    const info = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      bodyPreview: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").slice(0, 400),
      buttons: Array.from(document.querySelectorAll("button, a")).map(b => (b.innerText || "").trim()).filter(Boolean).slice(0, 40),
      modalText: (() => { const m = document.querySelector(".ant-modal"); return m ? (m.innerText || "").replace(/\s+/g, " ").slice(0, 300) : null; })(),
      hasEditCategoryBtn: !!Array.from(document.querySelectorAll("button")).find(b => /^编辑分类$/.test((b.innerText || "").trim())),
      hasSkipBtn: !!Array.from(document.querySelectorAll("button")).find(b => /跳过，?去编辑产品/.test(b.innerText || "")),
      hasSaveNext: !!Array.from(document.querySelectorAll("button")).find(b => /保存，下一步|保存下一步/.test(b.innerText || "")),
    }));
    L(`-- ${label}: url=${info.url} | title=${info.title}`);
    L(`   modal=${info.modalText ? JSON.stringify(info.modalText) : "none"} | editCatBtn=${info.hasEditCategoryBtn} skip=${info.hasSkipBtn} saveNext=${info.hasSaveNext}`);
    L(`   buttons=${JSON.stringify(info.buttons)}`);
    L(`   body=${JSON.stringify(info.bodyPreview)}`);
    return info;
  } catch (e) {
    L(`-- ${label}: dumpPage FAILED: ${e.message}`);
    return null;
  }
}

async function main() {
  L(`=== collect_loop_test START key=${KEY} title=${TITLE} facts=${FACTS_DIR} ===`);
  const adapter = new DianxiaomiAdapter(KEY);
  L(`profile: key=${adapter.profile.key} category=${adapter.profile.category} variantThemeMap=${JSON.stringify(adapter.profile.variantThemeMap)}`);

  // 加载 facts
  const factsRaw = JSON.parse(fs.readFileSync(path.join(FACTS_DIR, "product-facts.json"), "utf8"));
  const facts = normalizeDianxiaomiFacts(factsRaw);
  L(`facts.title.en=${JSON.stringify(facts.title && facts.title.en)}`);
  L(`facts.title.zh=${JSON.stringify(facts.title && facts.title.zh)}`);

  // 连接 + 捕获 JS 对话框（仅记录，adapter 的 browser 级 handler 会自动 accept；此处不再 accept 以免二次 accept 崩溃）
  process.on("unhandledRejection", () => { /* swallow CDP dialog race */ });
  await adapter.connect();
  adapter.browser.on("dialog", async (d) => {
    L(`[DIALOG] type=${d.type()} message=${JSON.stringify(d.message())}`);
  });
  L(`connected initial page: ${adapter.page.url()}`);

  const result = { steps: {}, success: false, error: null };

  // 1. 打开采集箱
  const open = await adapter.openCollectBox();
  result.steps.openCollectBox = { url: adapter.page.url(), ok: open.ok };
  await dumpPage(adapter.page, "after openCollectBox");

  // 2. 搜索
  await adapter.searchCollectBox(TITLE);
  result.steps.searchCollectBox = { url: adapter.page.url() };
  await dumpPage(adapter.page, "after searchCollectBox");

  // 3. 点编辑
  const draft = await adapter.openCollectDraftByTitle(TITLE);
  result.steps.openCollectDraftByTitle = { ok: draft.ok, score: draft.score, url: adapter.page.url() };
  await dumpPage(adapter.page, "after openCollectDraftByTitle");

  // 4. 映射页
  const cat = await adapter.fillCollectDraftCategory(facts);
  result.steps.fillCollectDraftCategory = { ok: cat.ok, skipped: cat.skipped || false, reason: cat.reason || "", url: cat.url, mapped: cat.mapped || [] };
  L(`fillCollectDraftCategory -> url=${cat.url} reason=${cat.reason} mapped=${JSON.stringify(cat.mapped)}`);
  await dumpPage(adapter.page, "after fillCollectDraftCategory");

  if (cat.reason === "not-category-page") {
    result.error = "not-category-page";
    throw new Error("分类映射页未出现（not-category-page），中止后续步骤");
  }

  // 5. 填 facts（collectMode 跳过图片上传，保留采集箱源图）
  const applied = await adapter.fillFromFacts(facts, { collectMode: true });
  result.steps.fillFromFacts = applied;
  L(`fillFromFacts applied ${applied.length} fields:`);
  for (const a of applied) L(`   - ${a.field}: ok=${a.ok} skipped=${a.skipped || false} reason=${a.reason || ""} value=${(a.value || "").slice(0, 60)}`);
  await dumpPage(adapter.page, "after fillFromFacts");

  // 6. 保存（不发布）
  const saved = await adapter.save();
  result.steps.save = saved;
  L(`save -> ${JSON.stringify(saved)}`);
  await dumpPage(adapter.page, "after save");

  const criticalFailures = applied.filter(a => (a.field === "description.pc" || a.field === "description.mobile") && a.ok === false);
  const readbackIssues = (saved && Array.isArray(saved.hardIssues) && saved.hardIssues.length) ? saved.hardIssues : [];
  const criticalFailed = criticalFailures.length > 0 || readbackIssues.length > 0;
  result.success = !!(saved && saved.saved && !criticalFailed);
  result.criticalFailed = criticalFailed;
  result.criticalFailures = criticalFailures;
  result.readbackIssues = readbackIssues;

  L(`=== RESULT success=${result.success} criticalFailed=${criticalFailed} ===`);
  L(`=== collect_loop_test DONE ===`);

  fs.writeFileSync(dumpFile, JSON.stringify(result, null, 2), "utf8");
  L(`result written to ${dumpFile}`);
  try { await adapter.close(); } catch (_) {}
  process.exit(result.success ? 0 : 1);
}

main().catch(e => {
  const msg = e instanceof Error ? e.message : String(e);
  L(`FATAL: ${msg}`);
  fs.writeFileSync(dumpFile, JSON.stringify({ success: false, error: msg, log }, null, 2), "utf8");
  L(`result written to ${dumpFile}`);
  process.exit(1);
});
