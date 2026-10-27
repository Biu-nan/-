// 店小秘上品引擎 —— 照搬 ecom-translator 的上品路径（tools/dianxiaomi_draft_executor.mjs）。
//
// 为什么要重搭而不是继续修旧流程：
//   旧流程把顺序散在 server.js:runBatchListing + adapter:fillFromFacts 两处，
//   没有步进契约、没有行数校验、没有保存前回读 —— 于是出现「appliedSummary 23 步全 ok、
//   保存却报『产品信息中有错误』」这种最难查的形态：每一步都自证成功，失败却在页面级。
//   ecom 的做法是：**一条显式 step 序列 + 每步可判定的后果 + 保存前统一回读**，
//   失败立刻定位到某一步，而不是等到保存那一行日志。
//
// 本文件的边界：
//   - 只负责「顺序 + 门禁 + 回读」，不重复实现叶子能力（传图/描述/下拉…仍调 adapter）。
//   - required=true 的步骤失败即中断（Fail-Closed）；required=false 的只记 attention。
//   - 每个 step 的返回都会进 steps[]，形成可审计的产物。
//
// 与 ecom 的唯一有意差异（必须有，否则跑不通本店）：
//   ecom 的模板会带出产品分类；本店唯一模板「箱包配件-包饰-星造」的引用模块只有
//   「产品属性」，**不带分类**（2026-10-26 实测），所以第 4 步显式补一道「分类落定门」。
//   分类没落定 → 属性区/变种区根本不渲染 → 后续每个字段都只是它的下游症状。

import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { customSkuName, duplicateNames } from "./sku-naming.js";
import { fillInputVerified, noteUnverified } from "./dianxiaomi-verify.js";


// ── 图片预处理（对齐 ecom 的 resizeMainImagesSquare / pickMarketingImages）────────
// 为什么要找"带 PIL 的 python"：Node 侧没有图像库，而主图必须**上传前**统一成
// 1:1 ≥800×800（实测原图 790×846 / 790×967 / 790×1385 全部不达标），
// 营销图更是必须**按目标画布生成**（1:1 1000 白底 + 3:4 750×1000 场景）。
// 只用解释器、脚本在本仓库 scripts/prep-images.py，不跨项目引用 ecom 的代码。
const PY_CANDIDATES = [
  process.env.PYTHON_FOR_IMAGES,
  "D:////ecom-translator////.venv////Scripts////python.exe",
  "python",
  "python3"
].filter(Boolean);

function findPythonWithPil() {
  for (const exe of PY_CANDIDATES) {
    try {
      execFileSync(exe, ["-c", "import PIL"], { stdio: "ignore", timeout: 8000 });
      return exe;
    } catch { /* 试下一个 */ }
  }
  return "";
}

function runPrep(args) {
  const exe = findPythonWithPil();
  if (!exe) return { ok: false, error: "找不到带 Pillow 的 Python（可设 PYTHON_FOR_IMAGES 指定解释器）" };
  try {
    const raw = execFileSync(exe, [path.join(process.cwd(), "scripts", "prep-images.py"), ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120000
    });
    const line = String(raw).trim().split("\n").pop();
    return JSON.parse(line);
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 300) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 兜底根目录：与 adapter 的 PRODUCT_IMAGES_DIR 同源（当前产品/产品图）
const BASE_PRODUCT_DIR = process.env.PRODUCT_IMAGES_DIR || path.join(process.cwd(), "当前产品", "产品图");

/** 等页面加载遮罩 .d-page-loading 消失（ecom waitForPageLoader）。它覆盖全页会拦掉所有点击。 */
export async function waitForPageLoader(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const blocking = await page.evaluate(() => Array.from(document.querySelectorAll(".d-page-loading")).some((n) => {
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      const s = getComputedStyle(n);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    })).catch(() => false);
    if (!blocking) return true;
    await sleep(300);
  }
  return false;
}

/** 压掉残留遮罩（ecom clearStaleOverlays）：只压遮罩本身，不碰真对话框的按钮。 */
export async function clearStaleOverlays(page) {
  await page.addStyleTag({
    content: ".ant-modal-mask,.ant-drawer-mask,.d-page-loading{display:none!important;pointer-events:none!important}"
  }).catch(() => {});
  await page.evaluate(() => {
    document.body.style.overflow = "";
    document.body.classList.remove("ant-scrolling-effect");
  }).catch(() => {});
  await sleep(150);
}

/** 自检：遮罩是否真的压住了（ecom assertOverlaySuppressed）。不通过就不要往下走。 */
export async function assertOverlaySuppressed(page) {
  return await page.evaluate(() => {
    const bad = [];
    for (const sel of [".d-page-loading", ".ant-modal-mask", ".ant-drawer-mask"]) {
      for (const n of Array.from(document.querySelectorAll(sel))) {
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const s = getComputedStyle(n);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") continue;
        if (s.pointerEvents === "none") continue;
        bad.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return bad.length ? { ok: false, reason: `仍有遮罩拦截：${bad.join("、")}` } : { ok: true };
  }).catch(() => ({ ok: true, reason: "自检执行失败（不阻断）" }));
}

/** 页面上是否还挂着「提醒：请先选择店铺」这类硬前置提示（店小秘用顶部橙条提示）。 */
export async function readPreconditionBanner(page) {
  return await page.evaluate(() => {
    const t = document.body ? document.body.innerText : "";
    const m = /提醒[:：]\s*([^\n]{1,30})/.exec(t || "");
    return m ? m[1].trim() : "";
  }).catch(() => "");
}

/**
 * 草稿校验（ecom verifyDraft，draft_executor.mjs:623）：
 * 开一个新页去「待发布」列表（`/web/smtChoice/offline`）按标题搜索，搜到就说明草稿真的落库了。
 * 为什么必须有这一步：`save()` 的自述结果不可靠 —— 实测 19 步全绿、页面字段错误清零、
 * 但 save() 仍返回 ok:false（它内部有基于读回的启发式判定）。**后果优先于自述**：
 * 列表里搜得到 = 真保存了；搜不到才是真的没保存。
 */
export async function verifyDraft(adapter, title) {
  const result = { found: false, draftId: "", editUrl: "", summary: "", reason: "", key: "" };
  const full = String(title || "").replace(/\s+/g, " ").trim();
  if (!full) { result.reason = "标题为空，无法校验草稿"; return result; }
  const keys = [full];
  const compact = full.replace(/[\s_\-—()（）【】\[\]]+/g, "").slice(0, 28);
  if (compact && compact !== full) keys.push(compact);
  const ctx = adapter.browser && adapter.browser.contexts()[0];
  if (!ctx) { result.reason = "无可用浏览器上下文"; return result; }
  const page = await ctx.newPage();
  // 页面 JS 对话框一律 dismiss：没有监听器时 Playwright 内部处理失败会抛未捕获 rejection 打死进程
  page.on("dialog", (d) => { d.dismiss().catch(() => {}); });
  try {
    await page.goto("https://www.dianxiaomi.com/web/smtChoice/offline", { waitUntil: "domcontentloaded", timeout: 60000 });
    const input = page.locator('input[name="tableSearchInput"]:visible').first();
    try { await input.waitFor({ state: "visible", timeout: 15000 }); }
    catch { result.reason = "待发布页面的搜索框未出现（页面可能未加载完），无法判定草稿是否已保存"; return result; }
    for (const key of keys) {
      await input.fill("").catch(() => {});
      await input.fill(key).catch(() => {});
      await page.locator("button").filter({ hasText: "搜索" }).first().click({ timeout: 8000 }).catch(() => {});
      for (let i = 0; i < 10; i += 1) {
        await sleep(800);
        // 同名草稿可能有多条（重复跑过）→ 把**所有**命中行的 rowid 都收出来，
        // 供调用方区分「本次新建」与「早就存在的旧草稿」。
        const allRows = page.locator("tr").filter({ hasText: key });
        const total = await allRows.count().catch(() => 0);
        const ids = [];
        for (let k = 0; k < total; k += 1) {
          const id = await allRows.nth(k).getAttribute("rowid").catch(() => "");
          if (id) ids.push(id);
        }
        result.allIds = ids;
        const row = allRows.first();
        if (await row.count().catch(() => 0)) {
          result.found = true;
          result.key = key;
          result.draftId = (await row.getAttribute("rowid").catch(() => "")) || "";
          const a = row.locator("a").filter({ hasText: "编辑" });
          result.editUrl = (await a.count().catch(() => 0)) ? ((await a.first().getAttribute("href").catch(() => "")) || "") : "";
          result.summary = ((await row.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 140);
          return result;
        }
      }
    }
    result.reason = `待发布列表搜不到标题「${full}」：草稿很可能没有真的保存`;
    return result;
  } catch (e) {
    result.reason = "草稿校验异常：" + ((e && e.message) || e);
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * 跑一遍 ecom 上品路径。
 * @param {object} args
 * @param {object} args.adapter   DianxiaomiAdapter 实例（叶子能力）
 * @param {object} args.facts     product-facts.json
 * @param {object} args.profile   类目 profile
 * @param {object} args.row       表格行（store / productTemplate / logisticsAttribute / material / variantParams…）
 * @param {boolean} args.commit   是否真的保存草稿（false=只填+回读，便于灰度）
 */
export async function runListingEngine({ adapter, facts, profile, row = {}, commit = false }) {
  const steps = [];
  const attention = [];
  const startedAt = new Date().toISOString();

  const step = async (name, fn, required = true) => {
    const at = new Date().toISOString();
    try {
      const value = await fn();
      steps.push({ name, status: "SUCCESS", value: sanitize(value), at });
      return value;
    } catch (error) {
      const reason = (error && error.message) || String(error);
      steps.push({ name, status: required ? "ERROR" : "ATTENTION", reason, at });
      if (required) {
        const err = new Error(`[${name}] ${reason}`);
        err.steps = steps;
        err.attention = attention;
        throw err;
      }
      attention.push(`${name}：${reason}`);
      return null;
    }
  };

  const page = () => adapter.page;
  const v = (facts && facts.variants) || {};
  const matrix = v.matrix || [];
  const rowCount = matrix.length;

  // ── 0. 前置门：页面就绪 + 遮罩 + 登录态 ──────────────────────────────
  await step("0-前置门", async () => {
    await waitForPageLoader(page());
    await clearStaleOverlays(page());
    let check = await assertOverlaySuppressed(page());
    if (!check.ok) {
      await waitForPageLoader(page(), 8000);
      await clearStaleOverlays(page());
      check = await assertOverlaySuppressed(page());
    }
    if (!check.ok) throw new Error(`遮罩压制自检未通过：${check.reason}`);
    const body = await page().evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
    if (/登录|验证码|真人验证/i.test(body)) throw new Error("店小秘需要人工登录或验证");
    return { ok: true };
  });

  // ── 1. 店铺（模板列表依赖它，必须第二早）─────────────────────────────
  await step("1-店铺", async () => {
    const wanted = String(row.store || (profile.fixed && profile.fixed.storeName) || "").trim();
    if (!wanted) throw new Error("行与 profile 都没有店铺名；未选店铺时「引用产品模板」静默无反应");
    const r = await adapter.selectStoreByName(wanted);
    if (!r || r.ok === false) throw new Error(`店铺选择失败：${(r && r.reason) || "unknown"}`);
    return { value: r.value || wanted };
  });

  // ── 2. 引用产品模板（会整体重置表单，必须早于所有其它写入）─────────────
  await step("2-引用模板", async () => {
    const tpl = String(row.productTemplate || (profile.defaultProductTemplate) || "").trim();
    if (!tpl) throw new Error("未配置产品模板（profile.defaultProductTemplate 为空）");
    const r = await adapter.applyProductTemplate(tpl);
    if (!r || r.ok === false) throw new Error(`引用模板失败：${(r && r.reason) || "unknown"}`);
    if (r.warning) attention.push(`引用模板：${r.warning}`);
    return { template: tpl, moduleNames: r.moduleNames || "", matchedRowText: r.matchedRowText || "" };
  });

  // ── 3. 分类落定门（本店模板不带分类，必须我方显式选）───────────────────
  await step("3-分类", async () => {
    const r = await adapter.ensureCategoryFilled(profile.category);
    if (!r || r.ok === false) throw new Error(r ? `${r.reason}：${r.detail || ""}` : "分类未落定");
    return { value: r.value || "", skipped: !!r.skipped };
  });

  // ── 4. 备货类型（模板之后，因为模板会重置它）───────────────────────────
  await step("4-备货类型", async () => {
    const wanted = String(row.stockType || (profile.fixed && profile.fixed.stockType) || "国内履约").trim();
    const r = await adapter.fillStockingType(wanted);
    if (!r || r.ok === false) throw new Error(`备货类型设置失败：${(r && r.reason) || "unknown"}`);
    return { value: r.value || wanted };
  });

  // ── 5. 产品标题（ecom 用 input.ant-input.ant-input-sm:visible 第一条）────
  await step("5-产品标题", async () => {
    const title = (facts && facts.title && (facts.title.en || facts.title.zh)) || "";
    if (!title) throw new Error("facts 没有标题");
    const r = await adapter.fillInputByLabel("产品标题", title);
    if (!r || r.ok === false) throw new Error(`标题填写失败：${(r && r.reason) || "unknown"}`);
    return { value: title };
  });

  // ── 5.5 来源URL（ecom 的「来源URL」步骤，非必填）──────────────────────
  // 用户 2026-10-27 截图指出：来源URL 是空的（仅在小秘内部显示，不同步到贸易通平台）。
  // 它确实非必填，但**空着不等于没事** —— 后续复盘要按链接回溯源商品，
  // 所以没有来源就如实记 attention，而不是静默留空。
  await step("5.5-来源URL", async () => {
    const url = String(row.sourceUrl || (facts && facts.sourceUrl) || (facts && facts.url) || "").trim();
    if (!url) {
      attention.push("来源URL：facts/表格都没有商详链接（_URL.txt），页面该字段留空；后续按链接溯源会断，建议补数据");
      return { skipped: true };
    }
    const input = page().locator('input[placeholder*="来源"], input[placeholder*="链接"]').first();
    if (!(await input.count())) {
      attention.push(`来源URL：页面没找到输入框（期望写入 ${url}）`);
      return { skipped: true };
    }
    const ver = await fillInputVerified(input, url, { label: "来源URL", escalateUnreadable: false, selectAll: process.platform === "darwin" ? "Meta+A" : "Control+A" });
    noteUnverified(attention, "来源URL", ver);
    return { value: url, state: ver.state };
  }, false);

  // ── 6. 材质（先自检属性区是否渲染：不存在=分类没落定，直接指向上一步）───
  await step("6-材质", async () => {
    const wanted = String(row.material || (facts && facts.material) || "").trim();
    if (!wanted) throw new Error("facts 未提供材质，请在页面人工选择");
    const rendered = await page().evaluate(() => !!document.querySelector("[id^=rc_select_]")).catch(() => false);
    if (!rendered) throw new Error("属性区未渲染（无任何 rc_select）：材质是分类带出后才出现的必填属性，请先看第 3 步分类是否真的落定");
    const r = await adapter.trySetMaterial(wanted);
    if (!r || r.ok === false) throw new Error(`材质设置失败：${(r && r.reason) || "unknown"}（期望「${wanted}」）`);
    return { value: r.value || wanted };
  });

  // ── 7. 其余必填属性（类型/品牌/产地/高关注化学品）─────────────────────
  // 店小秘对这几项按必填校验（页面报「请选择产品属性」「至少选择一项」），
  // facts 缺值时按 ecom 的做法选页面**确实存在**的合法枚举并留痕，不静默跳过、也不编造。
  await step("7-必填属性", async () => {
    // 用 profile.requiredAttrs 里的**完整定义**（含 rc_select id），而不是硬编码标签：
    // 联动字段（中国省份 = rc_select_17）按 label 定位不稳，必须走 id 优先路径。
    const attrs = [];
    for (const a of (profile.requiredAttrs || [])) {
      if (a && a.label) attrs.push({ label: a.label, id: a.id });
    }
    for (const extra of ["高关注化学品"]) {
      if (!attrs.some((x) => x.label.includes(extra))) attrs.push({ label: extra });
    }
    const done = [];
    for (const attr of attrs) {
      const cur = await adapter.readAntSelectByLabel(attr.label).catch(() => "");
      if (cur) { done.push(`${attr.label}=${cur}(已有)`); continue; }
      const r = await adapter.fillMandatoryAttribute(attr).catch((e) => ({ ok: false, reason: e.message }));
      if (r && r.ok) {
        done.push(`${attr.label}=${r.value}`);
        if (Array.isArray(r.attention)) attention.push(...r.attention);
      } else {
        attention.push(`${attr.label}：${(r && r.reason) || "兜底失败"}（必填，可能拦住保存）`);
      }
    }
    return { done };
  }, false);

  // ── 8. 产品图片（主图）────────────────────────────────────────────────
  // 2026-10-27 修：原来直接把手里的**裸文件名**丢给 uploadProductImages，
  // 而它内部 `fs.existsSync(fp)` → 全部 SKIP missing file → 一张没传却被当成
  // "已尝试"（只落一条 attention），主图区始终是空槽占位图。
  // 现在显式按 imageBaseDir 拼绝对路径并**先验存在性**：找不到就直接抛，
  // 与 ecom 一致（`产品目录没有任何可用主图，无法上架`）。
  await step("8-主图", async () => {
    const names = (facts && facts.images && facts.images.main) || [];
    if (!names.length) throw new Error("facts 没有主图");
    const baseDir = adapter.imageBaseDir || "";
    // imageBaseDir 在不同调用点含义不同：独立运行器里是 `产品包/产品图`，
    // 服务端批量链路里是**产品包目录本身**（图片实际在 `产品图/` 子目录）。
    // 所以按顺序试几个候选根目录，取第一个真实存在的 —— 不要再让"路径没对上"
    // 伪装成"文件缺失"（上一轮就是这样 3/3 全 SKIP missing file）。
    const roots = [baseDir, path.join(baseDir, "产品图"), path.join(baseDir, "output"), BASE_PRODUCT_DIR].filter(Boolean);
    const resolveOne = (n) => {
      if (path.isAbsolute(n)) return fs.existsSync(n) ? n : "";
      for (const r of roots) {
        const p = path.join(r, n);
        if (fs.existsSync(p)) return p;
      }
      return "";
    };
    const files = names.map(resolveOne);
    const missing = names.filter((n, i) => !files[i]);
    if (missing.length) {
      throw new Error(`主图文件找不到（${missing.length}/${names.length}）：${missing.slice(0, 3).join("、")}；试过的目录=${JSON.stringify(roots.slice(0, 3))}`);
    }
    // 上传前统一缩放 + 白底补边到 1000×1000（原图不动，只传合规副本）。
    // ecom 同一做法（resizeMainImagesSquare, MAIN_IMAGE_SQUARE=1000）；
    // 缩放失败就退回原图并记 attention —— 不因为"图不够规范"把产品整个挡下。
    let uploadFiles = files;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yikuaborder-main-"));
    const prep = runPrep(["resize-main", "--size", "1000", "--out", tmpDir, ...files]);
    if (prep && prep.ok && Array.isArray(prep.items) && prep.items.length === files.length) {
      uploadFiles = prep.items.map((it) => path.join(tmpDir, it.out));
      attention.push(`主图已统一缩放为 1000×1000（等比 + 纯白补边）后上传，原图未改动`);
      if (Array.isArray(prep.problems) && prep.problems.length) attention.push(`主图缩放告警：${prep.problems.join("；")}`);
    } else {
      attention.push(`主图缩放失败（${(prep && prep.error) || "未知"}），已回退上传原始尺寸；尺寸可能不符合店小秘建议`);
    }

    const r = await adapter.uploadProductImages(uploadFiles);
    // 判据改造（2026-10-27）：adapter 的 real-thumbs 用 `src.length > 60` 排除占位图，
    // 但刚上传的预览可能是**短 blob: 地址**，于是 3 张只认到 2 张（实测反复出现）。
    // 改为「**非占位图**计数」：排除 kong-*/addImg-*/placeholder/empty/default/svg 即可，
    // 并且**只等不重传** —— 重传会先清空已传的图，越补越少。
    const countReal = () => page().evaluate(() => {
      const m = document.querySelector(".productMainImgModule");
      if (!m) return 0;
      const isPlaceholder = (s) => !s || /kong-|addImg-|placeholder|empty|default|svg\+xml/i.test(s);
      return Array.from(m.querySelectorAll("img")).map((x) => x.getAttribute("src") || "").filter((s) => !isPlaceholder(s)).length;
    }).catch(() => 0);
    let real = await countReal();
    for (let i = 0; i < 12 && real < files.length; i += 1) {
      await sleep(1000);
      real = await countReal();
    }
    if (real < files.length) {
      throw new Error(`主图只认到 ${real}/${files.length} 张非占位图（adapter 自述：${(r && r.reason) || "ok"}）`);
    }
    if (Array.isArray(r.srcs) && r.srcs.length) adapter.lastMainSrcs = r.srcs;
    return { uploaded: real, files: uploadFiles.map((f) => path.basename(f)) };
  });

  // ── 8.5 营销图（两个槽位：1:1 白底 / 3:4 场景）────────────────────────
  // ecom 的做法是**生成**这两张图（pick_marketing_images.py）：按「边框环白度」挑白底图、
  // 挑场景图，再各自补到目标画布（1:1 1000×1000 / 3:4 750×1000）。
  // 为什么不能直接拿主图塞：实测原逻辑把 1:1 图塞进 3:4 槽，与页面规范**直接冲突**
  // （ecom 的 OPTIMIZATION_LOG 记过这次事故）。
  await step("8.5-营销图", async () => {
    const productDir = path.dirname(adapter.imageBaseDir || ".");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yikuaborder-mkt-"));
    const prep = runPrep(["marketing", "--product", productDir, "--out", tmpDir]);
    if (!prep || !prep.ok) throw new Error(`营销图生成失败：${(prep && prep.error) || "未知"}`);
    if (Array.isArray(prep.notes)) prep.notes.forEach((n) => attention.push(`营销图：${n}`));
    for (const key of ["white", "scene"]) {
      const item = prep[key];
      if (item && Array.isArray(item.problems) && item.problems.length) {
        attention.push(`营销图 ${key} 自查告警：${item.problems.join("；")}`);
      }
    }
    const r = await adapter.uploadMarketingImages([prep.white.path, prep.scene.path]);
    if (!r || r.ok === false) throw new Error(`营销图上传失败：${(r && r.reason) || "unknown"}`);
    return {
      white: { source: prep.white.source, size: `${prep.white.width}x${prep.white.height}`, whiteness: prep.white.whiteness },
      scene: { source: prep.scene.source, size: `${prep.scene.width}x${prep.scene.height}`, whiteness: prep.scene.whiteness }
    };
  }, false);

  // ── 9. PC端描述与描述图 ───────────────────────────────────────────────
  await step("9-PC端描述", async () => {
    const text = (facts && facts.description && facts.description.pc) || "";
    if (!text) throw new Error("facts 没有 PC 端描述");
    const r = await adapter.fillCkeditorByLabel("PC端描述", text);
    if (!r || r.ok === false) throw new Error(`PC端描述填写失败：${(r && r.reason) || "unknown"}`);
    return { chars: String(text).length };
  }, false);

  // ── 10. 变种勾选（可见数必须 >= 行数，否则说明变种区没渲染）───────────
  await step("10-变种参数", async () => {
    if (!rowCount) throw new Error("facts 没有 variants.matrix，无法建变种");
    const r = await adapter.fillSalesAttributes(facts, { variantOverride: true });
    if (!r || r.ok === false) throw new Error(`变种勾选失败：${(r && r.reason) || "unknown"}`);
    if (Array.isArray(r.attention)) attention.push(...r.attention);
    return { checked: r.checked || [], rows: rowCount };
  });

  // ── 10.5 变种自定义名称（ecom 步骤「SKU自定义名称与网络图片」）─────────
  // 实测漏项（用户截图 2026-10-27）：变种参数表里「自定义名称」三行全空。
  // 店小秘/平台侧这是 SKU 的可读名，空着虽然能存，但后台与买家端都会显示成一串编码。
  await step("10.5-变种自定义名称", async () => {
    const tableIdx = await page().evaluate(() => {
      const tables = Array.from(document.querySelectorAll("table"));
      return tables.findIndex((tb) => {
        const hs = Array.from(tb.querySelectorAll("thead th, thead td")).map((h) => (h.innerText || "").trim());
        return hs.some((h) => /自定义名称/.test(h));
      });
    });
    if (tableIdx < 0) { attention.push("变种参数表没有「自定义名称」列，跳过命名"); return { skipped: true }; }
    const inputs = page().locator("table").nth(tableIdx).locator("tbody tr input:visible");
    const cnt = await inputs.count();
    if (cnt !== rowCount) throw new Error(`自定义名称输入框 ${cnt} 个 ≠ 变种行数 ${rowCount}`);
    const names = matrix.map((m, i) => {
      const src = m.style || m.color || m.name || "";
      const r = customSkuName(src, i + 1);
      if (r && r.requiresReview) attention.push(`第 ${i + 1} 行自定义名称「${r.value}」需人工复核（来源「${src}」）`);
      return (r && r.value) || String(src || `Variant ${i + 1}`);
    });
    const dup = duplicateNames(names.map((n) => ({ customName: n })));
    if (dup && dup.length) attention.push(`变种自定义名称重名：${JSON.stringify(dup).slice(0, 120)}`);
    for (let i = 0; i < cnt; i += 1) {
      const ver = await fillInputVerified(inputs.nth(i), names[i], { label: `第 ${i + 1} 行自定义名称`, escalateUnreadable: false, selectAll: process.platform === "darwin" ? "Meta+A" : "Control+A" });
      noteUnverified(attention, `第 ${i + 1} 行自定义名称`, ver);
    }
    return { names };
  }, false);

  // ── 10.6 图片完整性自检（把"哪些图缺了"显性化，不静默）──────────────────
  // 用户 2026-10-27 截图指出的三类空位：营销图（1:1白底/3:4场景）两个槽全空、
  // SKU 图全是「暂无图片」、变种参数表图片列全空。
  // 这三个的数据源都在 facts 里（marketing / colorImages），facts 没有就是真的没有 ——
  // 必须记 attention 让上游补数据，而不是等上架后靠买家端发现。
  await step("10.6-图片完整性", async () => {
    const imgs = (facts && facts.images) || {};
    const v2 = (facts && facts.variants) || {};
    const gaps = [];
    if (!Array.isArray(imgs.marketing) || !imgs.marketing.length) gaps.push("营销图：facts.images.marketing 为空（页面 1:1白底图 / 3:4场景图 两个槽会空着）");
    if (!v2.colorImages || !Object.keys(v2.colorImages).length) gaps.push("每色图：facts.variants.colorImages 为空（SKU图 与 变种参数图片列 会显示暂无图片）");
    if (gaps.length) gaps.forEach((g) => attention.push(g));
    // 主图尺寸：页面建议 1:1 ≥800×800 或 3:4 ≥750×1000。
    // 实测本产品主图为 790×846 / 790×967 / 790×1389 —— 宽度 790 < 800，且比例既非 1:1 也非 3:4。
    const sizeNote = await page().evaluate(() => {
      const m = document.querySelector(".productMainImgModule");
      if (!m) return [];
      return Array.from(m.querySelectorAll("img"))
        .map((i) => ({ w: i.naturalWidth || 0, h: i.naturalHeight || 0 }))
        .filter((x) => x.w && x.h)
        .map((x) => `${x.w}x${x.h}`);
    }).catch(() => []);
    const badSize = sizeNote.filter((t) => {
      const [w, h] = t.split("x").map(Number);
      const square = Math.abs(w - h) / Math.max(w, h) < 0.05 && w >= 800;
      const threeFour = Math.abs(w / h - 3 / 4) < 0.06 && w >= 750 && h >= 1000;
      return !(square || threeFour);
    });
    if (badSize.length) attention.push(`主图尺寸不合建议（1:1≥800×800 或 3:4≥750×1000）：${badSize.join("、")}；建议出图环节按建议比例产出`);
    return { gaps: gaps.length, mainSizes: sizeNote, badSize };
  }, false);

  // ── 11. 供货价与 SKU编码（钱与编码，行数必须 == rows，逐行回读）───────
  await step("11-供货价与SKU", async () => {
    const r = await adapter.fillSkus(facts);
    if (!r || r.ok === false) throw new Error(`SKU 填写失败：${(r && r.reason) || "unknown"}`);
    if (Array.isArray(r.attention)) attention.push(...r.attention);
    return { rows: r.rows, failedRows: r.failedRows || 0 };
  });

  // ── 12. 包装重量和尺寸（4 个 name，行数必须 == rows）──────────────────
  await step("12-包装重量尺寸", async () => {
    const r = await adapter.fillPackageWeightAndSize(facts);
    if (!r || r.ok === false) throw new Error(`包装重量/尺寸填写失败：${(r && r.reason) || "unknown"}`);
    if (Array.isArray(r.attention)) attention.push(...r.attention);
    return { weightKg: r.weightKg, dims: r.dims, rows: r.rows };
  });

  // ── 13. 物流属性（逐行铅笔 → 对话框 → 普货 → 确定）────────────────────
  await step("13-物流属性", async () => {
    const wanted = String(row.logisticsAttribute || (profile.logistics) || "普货").trim();
    const r = await adapter.fillLogisticsAttribute(wanted);
    if (!r || r.ok === false) throw new Error(`物流属性设置失败：${(r && r.reason) || "unknown"}`);
    return { value: wanted };
  }, false);

  // ── 14. 库存（铅笔 → 修改仓库 → 填值 → 确定 → 应用到全部）─────────────
  await step("14-库存", async () => {
    const stock = String(v.defaultStock || (matrix[0] && matrix[0].stock) || "50");
    const r = await adapter.updateInventory(rowCount || 1, stock);
    if (!r || r.ok === false) throw new Error(`库存设置失败：${(r && r.reason) || "unknown"}`);
    return { stock, warehouse: r.warehouse || "" };
  }, false);

  // ── 15. 无线端描述 ────────────────────────────────────────────────────
  await step("15-无线端描述", async () => {
    const r = await adapter.clickNewEditorThenGenerateFromPc();
    if (!r || r.ok === false) throw new Error(`无线端描述未确认：${(r && r.reason) || "unknown"}`);
    return { closed: r.closed, generated: r.generated };
  }, false);

  // ── 16. 合规信息（按店铺读，不写死）──────────────────────────────────
  await step("16-合规信息", async () => {
    const results = await adapter.fillComplianceInfo(facts);
    const bad = (results || []).filter((x) => x && x.ok === false);
    for (const x of results || []) {
      if (x && x.ok === false && x.reason) attention.push(`${x.field}：${x.reason}`);
    }
    if (bad.length) throw new Error(`合规项未确认：${bad.map((x) => `${x.field}(${x.reason || "无原因"})`).join("；")}`);
    return { items: (results || []).length };
  }, false);

  // ── 17. 海关监管属性（仅材质=Fabric，倒数第二步）──────────────────────
  await step("17-海关属性", async () => {
    const cfg = profile.customs || (facts && facts.customs);
    if (!cfg) throw new Error("profile 未配置 customs");
    const r = await adapter.fillCustomsInfo(cfg);
    if (r && r.skipped) return { skipped: true, reason: r.reason };
    if (!r || r.ok === false) throw new Error(`海关属性填写失败：${(r && r.reason) || "unknown"}`);
    return { fields: (r.fields || []).length };
  }, false);

  // ── 18. 保存前字段回读（ecom 的收口：标题 / SKU编码数组 / 重量数组）────
  const preSave = await step("18-保存前回读", async () => {
    const title = (facts && facts.title && (facts.title.en || facts.title.zh)) || "";
    const pageTitle = await page().evaluate(() => {
      const i = document.querySelector("input.ant-input.ant-input-sm");
      return i ? String(i.value || "") : "";
    }).catch(() => "");
    const codes = await page().evaluate(() => Array.from(document.querySelectorAll('input[name="variationSku"]'))
      .map((i) => String(i.value || ""))).catch(() => []);
    const weights = await page().evaluate(() => Array.from(document.querySelectorAll('input[name="variationWeight"]'))
      .map((i) => String(i.value || ""))).catch(() => []);
    const wantCodes = matrix.map((m) => String(m.sku || ""));
    const problems = [];
    if (title && pageTitle !== title) problems.push(`标题回读不一致：期望「${title}」，页面「${pageTitle || "(空)"}」`);
    if (wantCodes.length && JSON.stringify(codes) !== JSON.stringify(wantCodes)) {
      problems.push(`SKU编码回读不一致：期望 ${JSON.stringify(wantCodes)}，页面 ${JSON.stringify(codes)}`);
    }
    if (weights.some((w) => !String(w).trim())) problems.push(`重量有空行：${JSON.stringify(weights)}`);
    return { title: pageTitle, codes, weights, problems };
  });
  if (preSave && preSave.problems && preSave.problems.length) {
    // 回读不一致是**硬失败**：这些是钱与编码口径，带着错值保存比保存失败更糟。
    const err = new Error(`保存前回读不一致：${preSave.problems.join("；")}`);
    err.steps = steps;
    err.attention = attention;
    throw err;
  }

  // ── 19-20. 保存草稿 + 草稿校验（闭环判据）────────────────────────────
  // 关键工程原则：**后果优先于自述**。
  // 实测踩过：19 步全绿、页面字段错误清零，但 adapter.save() 仍返回 ok:false
  // （它内部有基于读回的启发式判定，会误判）。所以不以 save() 的返回值定成败，
  // 而以「待发布列表能不能搜到这个标题」为最终判据 —— 搜得到=真的落库了。
  let saved = null;
  if (commit) {
    saved = await step("19-保存草稿", async () => {
      // 先快照「同名草稿已有哪几条」：重复跑同一产品时，列表里本来就有旧草稿，
      // 若不区分就会把旧草稿当成本次成果（假成功，且会掩盖保存其实失败了）。
      const titleForCheck = (facts && facts.title && (facts.title.en || facts.title.zh)) || "";
      const before = await verifyDraft(adapter, titleForCheck).catch(() => ({ allIds: [] }));
      const beforeIds = new Set((before && before.allIds) || []);
      let saveRaw = null;
      let saveError = "";
      try {
        saveRaw = await adapter.save();
      } catch (e) {
        // 不立刻抛：save() 可能只是自述失败，草稿其实已经落库。先记现场，再用列表判。
        saveError = (e && e.message) || String(e);
      }
      await sleep(1500);

      const pageErrors = await page().evaluate(() => Array.from(document.querySelectorAll(".ant-form-item-explain-error"))
        .map((e) => (e.innerText || "").replace(/\s+/g, " ").trim()).filter(Boolean)).catch(() => []);

      const title = titleForCheck;
      const draft = await verifyDraft(adapter, title);
      const newIds = ((draft && draft.allIds) || []).filter((id) => !beforeIds.has(id));
      draft.isNew = newIds.length > 0;
      draft.newIds = newIds;
      if (draft.found && !draft.isNew) {
        // 这是**硬失败**而不是 attention：批量跑一次的定义就是"产出一条新草稿"。
        // 只记 attention 会让上层判成功（实测就这样出现过 success:1，而实际上一条新草稿都没有）。
        throw new Error(`本次保存没有产生新草稿：列表命中的 ${JSON.stringify((draft.allIds || []).slice(0, 3))} 全部是保存前就存在的`
          + `（可能是重复标题被拦、或保存按钮点了没生效）；save() 自述=${JSON.stringify(saveRaw || saveError).slice(0, 120)}`);
      }

      if (!draft.found) {
        throw new Error(`草稿未落库：${draft.reason || "待发布列表搜不到"}`
          + `；save() 自述=${JSON.stringify(saveRaw || saveError).slice(0, 160)}`
          + `；页面字段错误=${JSON.stringify(pageErrors.slice(0, 8))}`);
      }
      // 落库了：把自述与列表结果的差异如实记下来，而不是掩盖
      if (saveError || (saveRaw && saveRaw.ok === false)) {
        attention.push(`save() 自述失败（${saveError || "ok:false"}），但待发布列表已能搜到草稿；以列表为准判成功 —— save() 的读回启发式需单独修`);
      }
      if (pageErrors.length) {
        attention.push(`保存后页面仍有字段红字：${JSON.stringify(pageErrors.slice(0, 6))}（草稿已落库，请人工复核）`);
      }
      return {
        verifiedInList: true,
        isNew: true,
        draftId: draft.draftId,
        editUrl: draft.editUrl,
        summary: draft.summary,
        saveSelfReport: saveRaw ? { ok: saveRaw.ok } : { error: saveError }
      };
    });
  }

  return {
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    committed: !!commit,
    saved,
    steps,
    attention
  };
}

function sanitize(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "object") {
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  }
  return value;
}
