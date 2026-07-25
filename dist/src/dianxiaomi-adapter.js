// 店小秘 ERP 自动化上品适配器（v1.1 乳贴，速卖通半托管 Choice 模式）
// 复用现有 Chrome CDP(9223)，不另起浏览器。
// 闭环：引用现有产品(1005005575013300) → 填固定字段(本店配置) → 保存(不发布，等人工确认)。
//
// 关键坑（来自 DOM 探索，务必遵守）：
//  1) 「引用产品」按钮点击后会先弹 JS confirm Dialog，接受后才出 Ant Dropdown；
//  2) Dropdown 内选项是 .ant-dropdown-menu-item > .ant-dropdown-menu-title-content；
//  3) Ant Select 靠 mousedown 展开，element.click() 无效；
//  4) `.ant-select` div 与内部 input 同 id(rc_select_X)，须 input.closest('.ant-select') 定位真容器；
//  5) 多下拉残留会合并选项，展开前先 mouse.click(5,5) 关闭上一个，读取时只取最后一个可见 dropdown。
//  6) 「选择产品」弹窗的「标题/产品ID」Tab 是自定义 .d-tag-group-item 组件，**不是** .ant-tabs-tab！
//     必须用 .d-tag-group-item:has-text("产品ID") 选择器，且需验证 active 类切换成功。

import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright-core";
import {
  CHROME_DEBUG_PORT,
  DIANXIAOMI_URL,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID,
  DIANXIAOMI_FIXED,
  DIANXIAOMI_CATEGORY,
  DIANXIAOMI_REQUIRED_ATTRS,
  DIANXIAOMI_BESTEFFORT_ATTRS,
  DIANXIAOMI_DEFAULT_MATERIAL,
  DIANXIAOMI_CATEGORY_PROFILES,
  DIANXIAOMI_DEFAULT_PROFILE_KEY,
  getDianxiaomiProfile,
  PRODUCT_IMAGES_DIR
} from "./config.js";

// 图片文件名可能只存了 basename，且 product-facts 输出到「产品图/」或「output/」子目录，
// 后缀也可能与 facts 中声明不同（如 .jpg 实际为 .png）。这里按 baseDir 逐级兜底。
function resolveImagePath(baseDir, filename) {
  if (!baseDir || !filename) return null;
  const candidates = [];
  const base = path.join(baseDir, filename);
  candidates.push(base);
  candidates.push(path.join(baseDir, "产品图", filename));
  candidates.push(path.join(baseDir, "output", filename));
  // 后缀互换兜底
  const ext = path.extname(filename).toLowerCase();
  const nameNoExt = path.basename(filename, ext);
  if (ext === ".jpg" || ext === ".jpeg") {
    candidates.push(path.join(baseDir, `${nameNoExt}.png`));
    candidates.push(path.join(baseDir, "产品图", `${nameNoExt}.png`));
    candidates.push(path.join(baseDir, "output", `${nameNoExt}.png`));
  } else if (ext === ".png") {
    candidates.push(path.join(baseDir, `${nameNoExt}.jpg`));
    candidates.push(path.join(baseDir, "产品图", `${nameNoExt}.jpg`));
    candidates.push(path.join(baseDir, "output", `${nameNoExt}.jpg`));
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickVisibleByText(page, text, timeout = 10000) {
  /* 点击第一个可见的包含指定文字的元素；优先用 Dropdown 精确选择器 */
  // 先尝试 Ant Dropdown 菜单项（最常用场景）
  const dropdownItem = page.locator(`.ant-dropdown-menu-item:has-text("${text}")`).first();
  if (await dropdownItem.count()) {
    try {
      await dropdownItem.waitFor({ state: "visible", timeout });
      await dropdownItem.click({ timeout: 5000 });
      return { source: "dropdown-item", text };
    } catch { /* fallback */ }
  }
  // 回退：通用文本定位
  const candidates = page.locator(`text=${JSON.stringify(text)}`);
  const count = await candidates.count();
  if (count === 0) throw new Error(`找不到包含「${text}」的元素`);
  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 5000 });
      return { source: "generic", index: i, text };
    }
  }
  await candidates.first().click({ timeout: 5000 });
  return { source: "generic-first", text };
}

export class DianxiaomiAdapter {
  constructor(profile) {
    this.browser = null;
    this.page = null;
    // 图片基准目录（批量上架时切到产品包目录，单品流程恒为 PRODUCT_IMAGES_DIR）
    this.imageBaseDir = PRODUCT_IMAGES_DIR;
    // profile 解析：可为 key 字符串 / profile 对象 / 空（默认 ruTie，向后兼容）
    this.profile = getDianxiaomiProfile(profile || DIANXIAOMI_DEFAULT_PROFILE_KEY);
  }

  setProfile(profile) {
    this.profile = getDianxiaomiProfile(profile || DIANXIAOMI_DEFAULT_PROFILE_KEY);
    return this.profile;
  }

  // 批量上架：把图片基准目录切到某个产品包目录（包内相对文件名即可定位）
  setImageBaseDir(dir) {
    this.imageBaseDir = dir && dir.trim() ? dir : PRODUCT_IMAGES_DIR;
    return this.imageBaseDir;
  }

  // 复原默认图片目录（单品流程 / 批量结束调用）
  resetImageBaseDir() {
    this.imageBaseDir = PRODUCT_IMAGES_DIR;
    return this.imageBaseDir;
  }

  // 标题优先使用英文（速卖通常见且字符长），中文需 >= 15 字符才单独使用；否则回退到英文或中文。
  resolveTitle(facts) {
    const zh = (facts && facts.title && facts.title.zh) || "";
    const en = (facts && facts.title && facts.title.en) || "";
    if (en && en.trim().length >= 15) return en.trim();
    if (zh && zh.trim().length >= 15) return zh.trim();
    if (en) return en.trim();
    return zh.trim();
  }

  async connect() {
    // 策略：每次都重新连接 CDP，避免缓存过期引用导致 "Target has been closed"
    // CDP connectOverCDP 耗时仅 ~50ms，对用户点击操作可忽略不计
    try {
      // 先尝试优雅关闭旧连接（忽略错误，可能已死）
      if (this.browser) { await this.browser.close().catch(() => {}); }
    } catch { /* ignore */ }
    this.browser = null;
    this.page = null;

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);

    // 自动接受任何 JS 对话框（confirm/alert/beforeunload）。
    // 重要：只注册在 browser 级别一次！page 级别也注册会导致同一对话框被 accept 两次，
    // 第二次抛 "No dialog is showing"。browser 级 handler 覆盖其下所有 context/page。
    const _handle = async (d) => {
      try { await d.accept(); } catch { /* 对话框已消失或被内置处理，忽略 */ }
    };
    this.browser.on("dialog", _handle);

    // 查找已有的店小秘标签页（复用，避免重复开新标签）
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        if (!this.page && !p.isClosed() && p.url().includes("dianxiaomi.com")) {
          this.page = p;
        }
      }
    }

    // 没有找到则新建页面
    if (!this.page || this.page.isClosed()) {
      this.page = await this.browser.contexts()[0].newPage();
    }
    return this.page;
  }

  async openCreatePage() {
    await this.connect();
    await this.page.goto(this.profile.url || DIANXIAOMI_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
  }

  // 引用现有产品（不保存）。引用后表单被模板源产品预填。
  async referenceProduct(templateId = this.profile.templateProductId) {
    await this.connect();
    await this.openCreatePage();

    // 步骤1：点「引用产品」按钮（会弹 JS confirm，由 connect() 中的 handler 自动接受）
    // 先关闭任何残留下拉（多下拉残留会合并/隐藏，导致旧 dropdown 的 <li> 被 .first() 误选 →「element is not visible」）
    await this.page.keyboard.press("Escape").catch(() => {});
    await this.page.mouse.click(5, 5).catch(() => {});
    await sleep(400);
    const refBtn = this.page.locator("button:has-text('引用产品')").first();
    await refBtn.waitFor({ state: "visible", timeout: 10000 });
    await refBtn.click({ timeout: 5000 });

    // 步骤2：等 Dialog 被自动接受 + Ant Dropdown 出现（含「引用现有产品」）
    // 关键修复：作用域限定到「当前可见」的 .ant-dropdown（:visible 排除带 ant-dropdown-hidden 的残留下拉），
    // 并取 .last() 确保是本次刚打开的菜单，避免选中旧隐藏 <li> 触发「element is not visible」。
    await sleep(1500); // 等 confirm dialog 被自动接受 + 菜单渲染
    const dropdownItem = this.page
      .locator(".ant-dropdown:visible")
      .last()
      .locator('.ant-dropdown-menu-item:has-text("引用现有产品")');
    try {
      await dropdownItem.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      // 如果 waitFor 超时，尝试再等一下（某些网络慢的情况）
      await sleep(3000);
      if (!await dropdownItem.isVisible().catch(() => false)) {
        throw new Error("点击「引用产品」后未出现「引用现有产品」下拉选项");
      }
    }
    await sleep(500);

    // 步骤3：点下拉中的「引用现有产品」
    await dropdownItem.click({ timeout: 5000 });
    await sleep(2000);

    // 步骤4：切「产品ID」标签（店小秘用 .d-tag-group-item 自定义 Tab，非 ant-tabs-tab）
    const idTab = this.page.locator(".d-tag-group-item", { hasText: "产品ID" }).first();
    if (await idTab.count()) {
      await idTab.waitFor({ state: "visible", timeout: 5000 });
      await idTab.click({ timeout: 5000 });
      // 验证切换成功（active 类应转移到产品ID）
      await sleep(800);
      const isActive = await idTab.evaluate(el => el.classList.contains("active"));
      if (!isActive) {
        // 可能需要再点一次（某些 UI 库首次点击只 focus）
        await idTab.click({ timeout: 3000 });
        await sleep(800);
      }
    } else {
      // 回退：尝试任何包含「产品ID」文字的可点击元素
      console.warn("[dianxiaomi] 未找到 .d-tag-group-item[产品ID]，尝试回退选择器");
      await clickVisibleByText(this.page, "产品ID", 5000);
      await sleep(1000);
    }
    await sleep(1000);

    // 填搜索框（限定在弹窗/引用面板范围内，避免误选 rc_select 或后台表单字段）
    // 策略：在 .d-tag-group-wrapper 所在容器内找 type=text 的普通输入框，
    // 排除 Ant Select 搜索框(rc_select_*/ant-select-selection-search-input)和已知表单字段。
    const searchSel = await this.page.evaluate((tid) => {
      const wrapper = document.querySelector(".d-tag-group-wrapper");
      if (!wrapper) return null;
      // 向上找最近的可疑弹窗容器；找不到就退回全文档
      const modalEl = wrapper.closest("[class*=modal], [class*=Modal], [role=dialog]") || document;
      const inputs = Array.from(modalEl.querySelectorAll("input")).filter((e) => {
        if (e.offsetParent === null) return false;
        if (e.type !== "text") return false;
        if (/rc_select|ant-select-selection-search-input/.test(e.className)) return false;
        const nm = e.getAttribute("name") || "";
        if (/sourceUrl|price|variation|sku|barcode|weight|length|width|height/.test(nm)) return false;
        return true;
      });
      if (!inputs.length) return null;
      // 优先 placeholder 含 产品ID/编号/商品ID
      const byPh = inputs.find((e) => /产品id|编号|商品id|productid/i.test(e.getAttribute("placeholder") || ""));
      const target = byPh || inputs[0];
      const id = target.id;
      if (id) return "#" + id;
      const ph = target.getAttribute("placeholder");
      if (ph) return "input[placeholder=\"" + ph + "\"]";
      // 兜底：返回它在容器内相对 XPath 序号不可靠，直接返回空（外层用兜底选择器）
      return ".__dxm_search_fallback__";
    }, templateId);

    let searchBox;
    if (searchSel && searchSel !== ".__dxm_search_fallback__") {
      searchBox = this.page.locator(searchSel).first();
    } else {
      // 兜底：弹窗内第一个可见普通 text input
      searchBox = this.page.locator(".d-tag-group-wrapper")
        .locator("xpath=ancestor::*[contains(@class,'modal') or @role='dialog'][1]")
        .locator("input[type='text']")
        .filter({ hasNot: this.page.locator("[class*='ant-select-selection-search-input']") })
        .first();
    }
    if (!searchBox || await searchBox.count() === 0) {
      throw new Error("找不到产品ID搜索框");
    }
    // 填值 + 验证回填成功
    await searchBox.click({ timeout: 5000 }).catch(() => {});
    try {
      await searchBox.fill(templateId, { timeout: 5000 });
    } catch {
      await searchBox.click({ timeout: 5000 });
      await this.page.keyboard.type(templateId, { delay: 30 });
    }
    await sleep(500);
    const filledVal = await searchBox.inputValue().catch(() => "");
    if (filledVal.trim() !== String(templateId)) {
      // 降级：清空后逐字符键入（应对受控组件）
      await searchBox.fill("");
      await searchBox.click({ timeout: 5000 });
      await this.page.keyboard.type(templateId, { delay: 30 });
      await sleep(500);
    }
    console.log("[dianxiaomi] 搜索框已填入:", templateId, "(回填校验:", (await searchBox.inputValue().catch(() => "")).trim() === String(templateId), ")");
    await sleep(500);

    await clickVisibleByText(this.page, "搜索", 10000);
    await this.page.waitForSelector(".ant-table, table", { timeout: 10000 }).catch(() => {});
    await sleep(2500);

    // 点结果行「引用」（DOM click 绕过 sticky 面包屑遮挡；排除「引用产品」下拉）
    const clicked = await this.page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, a"));
      const norm = (b) => (b.innerText || b.textContent || "").trim();
      const inRow = btns.find((b) => norm(b) === "引用" && !/产品/.test(norm(b)) && b.closest("tr, [class*='row'], [class*='table'], [class*='list']"));
      const exact = btns.find((b) => norm(b) === "引用" && !/产品/.test(norm(b)));
      const t = inRow || exact || btns.find((b) => norm(b).includes("引用") && !/产品/.test(norm(b)));
      if (!t) return { ok: false };
      t.click();
      return { ok: true, inRow: !!inRow };
    });
    if (!clicked.ok) throw new Error("找不到结果行「引用」按钮");
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(5000);
    return { ok: true, inRow: clicked.inRow, url: this.page.url() };
  }

  // 展开 Ant Select 并选择指定文本值的选项
  async selectAntSelectById(id, value) {
    if (!value) return { skipped: true, reason: "empty-value" };
    await this.connect();
    // 先关闭可能存在的下拉
    await this.page.mouse.click(5, 5).catch(() => {});
    await sleep(400);
    // 真实鼠标点击 Selector 中心展开
    const box = await this.page.evaluate((selId) => {
      const input = document.querySelector("#" + selId);
      const sel = (input && input.closest(".ant-select")) || document.querySelector("#" + selId);
      if (sel) sel.scrollIntoView({ block: "center" });
      const trig = sel && (sel.querySelector(".ant-select-selector") || sel.querySelector(".ant-select-selection-search") || sel);
      const r = (trig || sel).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
    await this.page.mouse.click(box.x, box.y);
    await sleep(600);
    // 搜索型下拉先输入值过滤
    const searchInput = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) input");
    if (await searchInput.count()) {
      try { await searchInput.first().fill(value); } catch {}
      // 远程搜索下拉：输入后选项异步加载，等选项出现再匹配（最多 ~3s），避免竞态误判「未找到」
      try {
        await this.page
          .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
          .first()
          .waitFor({ state: "visible", timeout: 3000 });
      } catch { /* 非远程搜索或已本地过滤，忽略 */ }
      await sleep(300);
    }
    // 点匹配选项（精确优先，否则包含）
    const optLocator = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content");
    const exact = optLocator.filter({ hasText: new RegExp(`^${value}$`) });
    const contains = optLocator.filter({ hasText: value });
    if (await exact.count()) {
      await exact.first().click({ timeout: 5000 });
    } else if (await contains.count()) {
      await contains.first().click({ timeout: 5000 });
    } else {
      await this.page.mouse.click(5, 5).catch(() => {});
      throw new Error(`Ant Select #${id} 未找到选项: ${value}`);
    }
    await sleep(400);
    return { ok: true, id, value };
  }

  // 填固定字段（本店配置，来自 profile.fixed）
  async fillFixedFields() {
    const fixed = this.profile.fixed || DIANXIAOMI_FIXED;
    const results = [];
    if (fixed.storeName) results.push(await this.selectAntSelectById("rc_select_0", fixed.storeName));
    if (fixed.stockType) results.push(await this.selectAntSelectById("rc_select_1", fixed.stockType));
    // sizeTemplate 留空（乳贴/箱包一般均码或不需要）
    return results;
  }

  // 填写「合规信息」：欧盟责任人 / 土耳其责任人 / 品牌制造商。
  // 取值优先级：facts.compliance > profile.compliance；空值则跳过。
  // 选择完后点击「刷新资质信息」按钮（店小秘保存前校验要求）。
  async fillComplianceInfo(facts) {
    await this.connect();
    const compliance = { ...(this.profile.compliance || {}), ...(facts?.compliance || {}) };
    const results = [];
    const items = [
      { key: "euResponsible", label: "欧盟责任人" },
      { key: "trResponsible", label: "土耳其责任人" },
      { key: "manufacturer", label: "品牌制造商" },
    ];
    for (const { key, label } of items) {
      const value = compliance[key];
      if (!value) {
        results.push({ field: label, ok: false, reason: "no-config" });
        continue;
      }
      try {
        const r = await this.selectAntSelectByLabel(label, value);
        results.push({ field: label, ...r });
      } catch (e) {
        // 若下拉选择失败，尝试当普通输入框填写
        try {
          const r = await this.fillInputByLabel(label, value);
          results.push({ field: label, ...r });
        } catch (_e2) {
          results.push({ field: label, ok: false, reason: e.message });
        }
      }
    }
    // 刷新资质信息（保存前必须点击，否则校验失败）
    try {
      const refreshClicked = await this.page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button, a, span"))
          .find((el) => /刷新资质信息/.test((el.innerText || el.textContent || "")));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (refreshClicked) {
        await sleep(2500);
        results.push({ field: "刷新资质信息", ok: true });
      } else {
        results.push({ field: "刷新资质信息", ok: false, reason: "button-not-found" });
      }
    } catch (e) {
      results.push({ field: "刷新资质信息", ok: false, reason: e.message });
    }
    return results;
  }

  // 按 label 文本定位 Ant Select 并选择值（避开动态 rc_select_X id）。
  // 用于选完产品属性模板后出现的类目专属属性（材质/颜色风格/内衣配件类型/产地等）。
  async selectAntSelectByLabel(labelKeyword, value) {
    if (!value) return { ok: false, reason: "empty-value" };
    await this.connect();
    const handle = await this.page.evaluateHandle((kw) => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (lab && lab.innerText.includes(kw)) {
          const sel = item.querySelector(".ant-select");
          if (sel) return sel;
        }
      }
      return null;
    }, labelKeyword);
    const sel = handle.asElement();
    if (!sel) return { ok: false, reason: "select-not-found:" + labelKeyword };
    // 关闭可能残留的下拉
    await this.page.mouse.click(5, 5).catch(() => {});
    await sleep(300);
    const box = await sel.evaluate((s) => {
      const trig = s.querySelector(".ant-select-selector") || s;
      const r = trig.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await this.page.mouse.click(box.x, box.y);
    await sleep(500);
    const searchInput = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) input");
    if (await searchInput.count()) {
      try { await searchInput.first().fill(value); } catch { /* 非搜索型 */ }
      await sleep(500);
    }
    const opt = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content");
    const exact = opt.filter({ hasText: new RegExp(`^${value}`) });
    const contains = opt.filter({ hasText: value });
    if (await exact.count()) await exact.first().click({ timeout: 5000 });
    else if (await contains.count()) await contains.first().click({ timeout: 5000 });
    else { await this.page.mouse.click(5, 5).catch(() => {}); return { ok: false, reason: "option-not-found:" + value }; }
    await sleep(400);
    return { ok: true, label: labelKeyword, value };
  }

  // 按 label 文本定位并填充普通 input（标题等）
  // 店小秘标题 input 是受控 React 组件；实测 .fill() 可能把值写入 DOM 但不触发 onChange，
  // 导致提交时仍保留引用模板旧标题。这里使用 focus + 全选 + 键盘输入 + value 验证的方式确保覆盖。
  async fillInputByLabel(labelKeyword, value) {
    if (!value) return { ok: false, reason: "empty-value" };
    await this.connect();
    const handle = await this.page.evaluateHandle((kw) => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (lab && lab.innerText.includes(kw)) {
          const inp = item.querySelector("input");
          if (inp) return inp;
        }
      }
      return null;
    }, labelKeyword);
    const inp = handle.asElement();
    if (!inp) return { ok: false, reason: "input-not-found:" + labelKeyword };

    const setValue = async (val) => {
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.focus();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Delete");
      await this.page.keyboard.type(String(val), { delay: 10 });
      // 尝试触发 blur/onChange，让 React 更新 state
      await this.page.keyboard.press("Tab").catch(() => {});
      await sleep(300);
    };

    await setValue(value);
    let actual = await inp.evaluate((el) => el.value || el.getAttribute("value") || "").catch(() => "");
    if (String(actual).trim() !== String(value).trim()) {
      await sleep(500);
      await setValue(value);
      actual = await inp.evaluate((el) => el.value || el.getAttribute("value") || "").catch(() => "");
    }
    const ok = String(actual).trim() === String(value).trim();
    return { ok, field: labelKeyword, value: String(value).slice(0, 60), actual: String(actual).slice(0, 60) };
  }

  // 按 label 文本定位并填充 CKEditor textarea（描述等）
  async fillCkeditorByLabel(labelKeyword, value) {
    if (!value) return { ok: false, reason: "empty-value" };
    // 用户要求：详情页行与行之间不要有空行。把连续空行/空段落压缩为单个换行。
    value = String(value).replace(/\n\s*\n+/g, "\n").trim();
    await this.connect();
    const containerLocator = this.page.locator(".ant-form-item, [class*=form-item]").filter({ hasText: labelKeyword }).first();
    if (await containerLocator.count() === 0) return { ok: false, reason: "container-not-found:" + labelKeyword };

    // 关键：引用模板可能已带出旧描述（尤其是无线端）。先尝试点击所在容器内的“清空”按钮，
    // 例如无线端描述的「清空无线端描述」，避免新描述与旧描述叠加。
    const cleared = await containerLocator.evaluate((c) => {
      const clearBtn = Array.from(c.querySelectorAll("a, button, span, .ant-typography")).find((e) => /清空/.test(e.innerText || ""));
      if (clearBtn) { clearBtn.click(); return true; }
      return false;
    }).catch(() => false);
    if (cleared) await sleep(800);

    // 优先：CKEditor（iframe contenteditable）—— 真实编辑区在 iframe 内的 body，
    // 容器里的 <textarea> 只是 CKEditor 的隐藏提交框，直接粘贴进去正文仍为空。
    const iframeCount = await containerLocator.locator("iframe").count();
    if (iframeCount > 0) {
      const frame = await containerLocator.locator("iframe").first().contentFrame();
      if (frame) {
        const body = frame.locator("body");
        await body.click({ timeout: 5000 }).catch(() => {});
        await this.page.keyboard.press("Control+A");
        await this.page.keyboard.press("Delete");
        await this.page.keyboard.insertText(value);
        await sleep(800);
        const actual = await frame.locator("body").innerText().catch(() => "");
        const ok = String(actual).trim().length >= String(value).trim().length * 0.8;
        return { ok, field: labelKeyword, cleared, pasted: true, actualLen: actual.length, mode: "ckeditor" };
      }
    }

    // 降级：contenteditable div 或普通 textarea（如无线端描述）
    const editor = containerLocator.locator("textarea, [contenteditable='true'], [contenteditable='']").first();
    if (await editor.count() > 0) {
      await editor.click({ timeout: 5000 }).catch(() => {});
      await editor.focus().catch(() => {});
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Delete");
      await this.page.keyboard.insertText(value);
      await sleep(800);
      const actual = await editor.evaluate((el) => (el.value !== undefined ? el.value : el.innerText) || "").catch(() => "");
      const ok = String(actual).trim().length >= String(value).trim().length * 0.8;
      return { ok, field: labelKeyword, cleared, pasted: true, actualLen: actual.length, mode: "textarea" };
    }
    return { ok: false, reason: "editor-not-found:" + labelKeyword };
  }

  // 把已上传主图的 CDN URL 插到指定 CKEditor 描述（PC端/无线端）正文下方。
  // 实测（ckeditor35=PC端、ckeditor33=无线端）：CKEditor 的「选择图片」combo 面板是异步 iframe，
  // 点缩略图不生效；直接调 CKEDITOR 实例 insertHtml/setData 插 <img src=已上传CDN> 最稳，且无需重传文件。
  // 顺序：调用前必须先 fillCkeditorByLabel 填好文案（光标在末尾或 getData 已含文案）。
  async insertImagesIntoCkeditor(labelKeyword, imageSrcs) {
    if (!imageSrcs || !imageSrcs.length) return { ok: false, reason: "no-srcs" };
    await this.connect();
    const containerLocator = this.page.locator(".ant-form-item, [class*=form-item]").filter({ hasText: labelKeyword }).first();
    if (await containerLocator.count() === 0) return { ok: false, reason: "container-not-found:" + labelKeyword };
    // CKEditor 实例名 = 容器内 textarea 的 id
    const taId = await containerLocator.evaluate((c) => {
      const ta = c.querySelector("textarea");
      return ta ? ta.id : null;
    }).catch(() => null);
    if (!taId) return { ok: false, reason: "no-textarea:" + labelKeyword };

    const res = await this.page.evaluate(({ taId, srcs }) => {
      const inst = window.CKEDITOR && window.CKEDITOR.instances[taId];
      if (!inst) return { ok: false, reason: "no-instance", taId };
      try { inst.focus(); } catch { /* ignore */ }
      const cur = inst.getData() || "";
      const imgsHtml = srcs.map((s) => `<div style="text-align:center;margin:8px 0"><img src="${s}" style="width:100%;height:auto;max-width:750px;border:0" /></div>`).join("");
      inst.setData(cur + imgsHtml);
      const after = inst.getData() || "";
      return {
        ok: true,
        taId,
        before: cur.length,
        after: after.length,
        addedImg: (after.match(/<img/g) || []).length,
      };
    }, { taId, srcs: imageSrcs });
    return res;
  }

  // 无线端描述：改用「使用新版编辑器 → 根据PC端描述一键生成」，不再手填文案。
  // 关键坑（已实测）：
  //   1) 「使用新版编辑器」文本在全局有 2 个匹配，但**不在**无线端 form-item 子树内，
  //      必须用全局 exact:true 的 first() 真实鼠标点击才能切换并触发生成。
  //   2) 切到新版编辑器后，「根据PC端描述一键生成」按钮才出现，点它即可从 PC 端描述一键生成无线端。
  //   3) PC 端描述必须先于本方法完成（含插图），否则生成内容缺失。
  async clickNewEditorThenGenerateFromPc() {
    await this.connect();
    // 先尝试清空无线端旧描述（引用模板可能带出旧内容），避免新描述与旧描述叠加
    try {
      await this.page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(".ant-form-item")).filter((it) => /无线端描述/.test((it.innerText || "").slice(0, 30)));
        const item = items[0];
        if (item) {
          const clearBtn = Array.from(item.querySelectorAll("a, button, span, .ant-typography")).find((e) => /清空/.test(e.innerText || ""));
          if (clearBtn) { clearBtn.click(); return true; }
        }
        return false;
      });
      await sleep(800);
    } catch (_e) { /* 清空非致命 */ }

    // 读无线端是否已生成内容（ck33 实例 + 无线端 form-item 内 iframe body 任一有内容即算生成）
    const readMobile = () => this.page.evaluate(() => {
      const out = { ck33: null, ck35: null, mb: null, generated: false };
      const i33 = window.CKEDITOR && window.CKEDITOR.instances["ckeditor33"];
      if (i33) { const d = i33.getData() || ""; out.ck33 = { len: d.length, imgs: (d.match(/<img/g) || []).length }; if (d.length > 50) out.generated = true; }
      const i35 = window.CKEDITOR && window.CKEDITOR.instances["ckeditor35"];
      if (i35) { const d = i35.getData() || ""; out.ck35 = { len: d.length, imgs: (d.match(/<img/g) || []).length }; }
      const items = Array.from(document.querySelectorAll(".ant-form-item")).filter((it) => /无线端描述/.test((it.innerText || "").slice(0, 30)));
      const item = items[0];
      if (item) {
        const frame = item.querySelector("iframe");
        if (frame && frame.contentDocument && frame.contentDocument.body) {
          const bd = frame.contentDocument.body;
          const len = (bd.innerText || bd.textContent || "").length;
          out.mb = { len, imgs: bd.querySelectorAll("img").length, via: "item-iframe" };
          if (len > 50) out.generated = true;
        }
      }
      return out;
    });

    // 若已在新版编辑器（已存在「根据PC端描述一键生成」），直接点生成
    let genBtn = this.page.getByText("根据PC端描述一键生成", { exact: true }).first();
    if ((await genBtn.count()) > 0) {
      await genBtn.click({ timeout: 8000 }).catch(() => {});
      await sleep(5000);
      const v = await readMobile();
      return { ok: v.generated, ...v };
    }

    // 否则点「使用新版编辑器」切换：优先在无线端 form-item 容器内找，失败再全局 first
    let newEditorBtn = this.page.locator(".ant-form-item").filter({ hasText: "无线端描述" }).getByText("使用新版编辑器", { exact: true }).first();
    if (await newEditorBtn.count() === 0) {
      newEditorBtn = this.page.getByText("使用新版编辑器", { exact: true }).first();
    }
    if (await newEditorBtn.count() === 0) return { ok: false, reason: "no-new-editor-btn" };
    await newEditorBtn.click({ timeout: 8000 }).catch(() => {});
    await sleep(3500);

    // 切换后可能已自动生成（实测点「使用新版编辑器」即触发从 PC 生成无线端，按钮随后消失）；
    // 也可能出现「根据PC端描述一键生成」按钮需再点一次。
    const afterSwitch = await readMobile();
    if (afterSwitch.generated) return { ok: true, autoGenerated: true, ...afterSwitch };

    genBtn = this.page.getByText("根据PC端描述一键生成", { exact: true }).first();
    if (await genBtn.count() === 0) {
      return { ok: false, reason: "no-generate-btn-after-switch", ...afterSwitch };
    }
    await genBtn.click({ timeout: 8000 }).catch(() => {});
    await sleep(5000);
    const v = await readMobile();
    return { ok: v.generated, ...v };
  }

  // 通用：清空产品图片区。
  // 实测（本店小秘账号）主图区没有「清空图片」菜单：「编辑图片」按钮点开是图片来源选择
  // （本地图片/空间图片/网络图片/引用采集图片）。真正的清除方式是逐张点击每张缩略图上的
  // 删除图标（.icon_delete / [class*=delete]）。故主路径采用「循环点击删除图标直到缩略图为 0」，
  // 并兼容旧版可能存在的「编辑图片→清空图片」菜单（命中即返回）。
  async clearImageThumbnails(containerSelector) {
    await this.connect();
    const container = await this.page.evaluateHandle((sel) => document.querySelector(sel), containerSelector);
    const containerEl = container.asElement();
    if (!containerEl) return 0;

    // 优先尝试旧版「编辑图片 → 清空图片」菜单（本账号实测不存在，命中即清空并返回）
    const menuCleared = await this.page.evaluate((sel) => {
      const c = document.querySelector(sel);
      if (!c) return false;
      const editBtn = Array.from(c.querySelectorAll("button, a, span")).find((e) => /编辑图片/.test(e.innerText || ""));
      if (!editBtn) return false;
      editBtn.click();
      return true;
    }, containerSelector);
    if (menuCleared) {
      await sleep(700);
      const clearClicked = await this.page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, .ant-dropdown-menu-submenu-title, [class*='dropdown-menu-item']"));
        const clearItem = items.find((e) => /清空图片/.test(e.innerText || ""));
        if (clearItem) { clearItem.click(); return true; }
        return false;
      });
      if (clearClicked) { await sleep(1200); return -1; }
    }

    // 主路径：循环点击缩略图删除图标，直到主图区缩略图数量为 0。
    // 每轮只点第一个可见删除图标（删除后列表重排），避免一次性点击已重排失效的节点。
    let removed = 0;
    for (let pass = 0; pass < 15; pass += 1) {
      const before = await this.page.evaluate((sel) => {
        const c = document.querySelector(sel);
        return c ? c.querySelectorAll("img").length : 0;
      }, containerSelector);
      if (before === 0) break;
      const clicked = await this.page.evaluate((sel) => {
        const c = document.querySelector(sel);
        if (!c) return 0;
        const dels = Array.from(c.querySelectorAll(".icon_delete, [class*=icon_delete], .anticon-delete, [class*=delete]"))
          .filter((b) => { try { return b.getBoundingClientRect().width > 0; } catch { return false; } });
        if (!dels.length) return 0;
        try { dels[0].click(); } catch { /* ignore */ }
        return 1;
      }, containerSelector);
      if (clicked) removed += 1;
      await sleep(700); // 等 React 重排 + 可能的 confirm 自动接受
    }
    await sleep(800);
    return removed;
  }

  // 通用：按 label 文本找到 ant-form-item，点击其内部所有“删除”文字按钮（无线端描述/产品视频等）。
  async clearByLabelText(labelText, buttonText = "删除") {
    await this.connect();
    const count = await this.page.evaluate(({ labelText: lt, buttonText: bt }) => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      const container = items.find((it) => (it.innerText || "").includes(lt));
      if (!container) return 0;
      const buttons = Array.from(container.querySelectorAll("a, button, span, .ant-typography")).filter((e) => new RegExp(bt).test(e.innerText || ""));
      buttons.forEach((b) => { try { b.click(); } catch { /* 忽略 */ } });
      return buttons.length;
    }, { labelText, buttonText });
    if (count) await sleep(1000);
    return count;
  }

  // 关闭可能残留的弹窗（点 X / Esc），避免拦截点击
  async dismissModals() {
    await this.page.evaluate(() => {
      document.querySelectorAll(".ant-modal-close").forEach((c) => { try { c.click(); } catch { /* ignore */ } });
    }).catch(() => {});
    await this.page.keyboard.press("Escape").catch(() => {});
    await sleep(300);
  }

  // 定位「图片选择器」面板：必须是 fixed/absolute 的 modal 覆盖层（排除 body/html），
  // 含 本地图片/空间图片 文本与图片网格，且内有「确定」类按钮。
  async findImagePicker() {
    return await this.page.evaluate(() => {
      // 1) 优先：可见的 modal 包装（AntD .ant-modal-wrap / VC .vcDialog），且含 本地/空间 图片 文本
      const modals = Array.from(document.querySelectorAll(".ant-modal-wrap, .ant-modal, [class*=vcDialog], [class*=modal]"))
        .filter((m) => { try { return m.getBoundingClientRect().width > 100 && m.getBoundingClientRect().height > 100; } catch { return false; } });
      for (const m of modals) {
        const t = m.innerText || "";
        if (/本地图片|空间图片/.test(t)) {
          return { via: "modal", cls: (m.className || "").toString().slice(0, 60), w: Math.round(m.getBoundingClientRect().width), h: Math.round(m.getBoundingClientRect().height), imgs: m.querySelectorAll("img").length, hasLocalInput: !!m.querySelector("input[type=file]"), btns: [...new Set(Array.from(m.querySelectorAll("button,a,.ant-btn")).map((b) => (b.innerText || "").trim()).filter(Boolean).filter((tt) => tt.length < 24))].slice(0, 30) };
        }
      }
      // 2) 退而求其次：fixed/absolute 且 z-index>500，含 本地/空间 文本的最小元素
      const all = Array.from(document.querySelectorAll("*"));
      const cands = [];
      for (const el of all) {
        if (el.tagName === "BODY" || el.tagName === "HTML") continue;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 150) continue;
        const zi = parseInt(cs.zIndex || "0", 10) || 0;
        if (!(cs.position === "fixed" || cs.position === "absolute" || zi > 500)) continue;
        const t = el.innerText || "";
        if (!/本地图片|空间图片/.test(t)) continue;
        cands.push({ score: (zi > 500 ? 10 : 0) + (cs.position === "fixed" ? 5 : 0), area: r.width * r.height, cls: (el.className || "").toString().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), z: cs.zIndex, imgs: el.querySelectorAll("img").length, hasLocalInput: !!el.querySelector("input[type=file]"), btns: [...new Set(Array.from(el.querySelectorAll("button,a,.ant-btn")).map((b) => (b.innerText || "").trim()).filter(Boolean).filter((tt) => tt.length < 24))].slice(0, 30) });
      }
      cands.sort((a, b) => b.score - a.score || a.area - b.area);
      return cands[0] || null;
    });
  }

  // 上传产品主图（产品图片区）。
  // 实测机制：店小秘主图上传是「单文件 input + 图片选择器」流程——
  //   点「选择图片」打开图片选择器 → 在「本地图片」里用 #localFileUploadInp 上传单张 →
  //   在选择器网格里选中该图 → 点「确定」才加入主图区。input 为 single-file，故逐张上传。
  // 引用模板会带出旧主图，先清空再上传。
  async uploadProductImages(filePaths) {
    if (!Array.isArray(filePaths) || !filePaths.length) return { ok: false, reason: "no-files" };
    await this.connect();
    const LOG = path.join(PRODUCT_IMAGES_DIR, "..", "upload_debug.log");
    const ulog = (...a) => { try { fs.appendFileSync(LOG, a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"); } catch { /* ignore */ } };
    try { fs.writeFileSync(LOG, ""); } catch { /* ignore */ }
    ulog("START upload count=", filePaths.length, filePaths.map((p) => path.basename(p)));

    await this.dismissModals();
    const clearedMain = await this.clearImageThumbnails(".productMainImgModule");
    const clearedVideo = await this.clearByLabelText("产品视频", "删除");
    ulog("CLEARED main=", clearedMain, "video=", clearedVideo);

    const mainCount = () => this.page.evaluate(() => {
      const m = document.querySelector(".productMainImgModule");
      return m ? m.querySelectorAll("img").length : 0;
    });

    let okCount = 0;
    for (let i = 0; i < filePaths.length; i += 1) {
      const fp = filePaths[i];
      await this.dismissModals();
      const before = await mainCount();

      // 1) 打开图片选择器
      const trigger = this.page.locator(".productMainImgModule button:has-text('选择图片')").first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 8000 }).catch((e) => ulog(`[${i}] trigger err`, e.message.slice(0, 80)));
        await sleep(800);
        // 选择图片下拉菜单 → 选「本地图片」
        const localItem = this.page.locator(".ant-dropdown:visible .ant-dropdown-menu-item").filter({ hasText: "本地图片" }).last();
        if (await localItem.count()) {
          await localItem.click({ timeout: 5000 }).catch((e) => ulog(`[${i}] localItem err`, e.message.slice(0, 80)));
          ulog(`[${i}] clicked 本地图片 dropdown item`);
          await sleep(1500);
        } else {
          ulog(`[${i}] no 本地图片 dropdown item`);
        }
      }
      const picker = await this.findImagePicker();
      ulog(`[${i}] picker=`, picker ? { cls: picker.cls, w: picker.w, h: picker.h, imgs: picker.imgs, hasLocalInput: picker.hasLocalInput, btns: picker.btns } : null);

      // 2) 切到「本地图片」tab（如有）
      if (picker) {
        const localTab = this.page.locator(".d-tag-group-item:has-text('本地图片'), .ant-tabs-tab:has-text('本地图片')").first();
        if (await localTab.count()) { await localTab.click({ timeout: 5000 }).catch(() => {}); await sleep(1000); ulog(`[${i}] clicked 本地图片 tab`); }
      }

      // 3) 上传单张（选择器内的 input 优先，否则全局 #localFileUploadInp）
      const inputSel = picker && picker.hasLocalInput ? ".productMainImgModule ~ * input[type=file], .ant-modal input[type=file], input[type=file]" : "#localFileUploadInp";
      const input = this.page.locator(inputSel).first();
      await input.setInputFiles([fp], { timeout: 15000 }).catch((e) => ulog(`[${i}] setInputFiles err`, e.message.slice(0, 80)));
      await sleep(4000);
      const picker2 = await this.findImagePicker();
      ulog(`[${i}] after upload picker imgs=`, picker2 ? picker2.imgs : "n/a");

      // 4) 在选择器网格里选中刚传的图（点 image-box / 第一个 img 的容器 / checkbox）
      const selOk = await this.page.evaluate(() => {
        // 与 findImagePicker 一致：先找含 本地/空间 文本的 modal，否则 fixed/absolute 覆盖层
        const modals = Array.from(document.querySelectorAll(".ant-modal-wrap, .ant-modal, [class*=vcDialog], [class*=modal]")).filter((m) => { try { return m.getBoundingClientRect().width > 100 && m.getBoundingClientRect().height > 100; } catch { return false; } });
        let pk = modals.find((m) => /本地图片|空间图片/.test(m.innerText || "")) || null;
        if (!pk) {
          const all = Array.from(document.querySelectorAll("*"));
          let best = null, bestScore = 0;
          for (const el of all) {
            if (el.tagName === "BODY" || el.tagName === "HTML") continue;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.width < 200 || r.height < 150) continue;
            const zi = parseInt(cs.zIndex || "0", 10) || 0;
            if (!(cs.position === "fixed" || cs.position === "absolute" || zi > 500)) continue;
            if (!/本地图片|空间图片/.test(el.innerText || "")) continue;
            const sc = (zi > 500 ? 10 : 0) + (cs.position === "fixed" ? 5 : 0);
            if (sc > bestScore) { bestScore = sc; best = el; }
          }
          pk = best;
        }
        if (!pk) return false;
        const box = pk.querySelector(".image-box, [class*=image-item], [class*=img-item], li");
        if (box) { try { box.click(); return "box"; } catch { /* ignore */ } }
        const img = pk.querySelector("img");
        if (img) { try { (img.closest("[class*=item], [class*=card], li") || img.parentElement).click(); return "img"; } catch { /* ignore */ } }
        const cb = pk.querySelector("input[type=checkbox], .ant-checkbox");
        if (cb) { try { cb.click(); return "checkbox"; } catch { /* ignore */ } }
        return false;
      });
      ulog(`[${i}] select-in-picker=`, selOk);
      await sleep(1000);

      // 5) 点「确定」把选中图加入主图区
      const okBtn = this.page.locator("button:has-text('确定'), a:has-text('确定'), button:has-text('添加到'), button:has-text('插入'), button:has-text('完成')").first();
      if (await okBtn.count()) {
        await okBtn.click({ timeout: 5000 }).catch((e) => ulog(`[${i}] ok err`, e.message.slice(0, 60)));
        await sleep(2000);
        ulog(`[${i}] clicked 确定`);
      } else {
        ulog(`[${i}] NO 确定 button found`);
      }
      await this.dismissModals();
      const after = await mainCount();
      ulog(`[${i}] main before=${before} after=${after}`);
      if (after > before) okCount = after;
    }

    const finalv = await this.page.evaluate(() => {
      const m = document.querySelector(".productMainImgModule");
      if (!m) return { count: 0, real: 0, srcs: [] };
      const imgs = Array.from(m.querySelectorAll("img")).map((i) => i.getAttribute("src") || "").filter(Boolean);
      const isReal = (s) => s.length > 60 && !/placeholder|empty|default|svg\+xml/.test(s);
      return { count: imgs.length, real: imgs.filter(isReal).length, srcs: imgs };
    });
    ulog("FINAL", finalv);
    return { ok: finalv.real >= filePaths.length, uploadedCount: filePaths.length, thumbnails: finalv.count, realThumbnails: finalv.real, clearedMain, clearedVideo, srcs: finalv.srcs };
  }

  // 选类目（依赖先选店铺；选项才加载）
  async selectCategory(value = this.profile.category) {
    return this.selectAntSelectById("rc_select_2", value);
  }

  // 是否暴露图片（乳贴类目必填）→ 默认「否(No)」
  async setObscenePicture(value = "否(No)") {
    return this.selectAntSelectById("rc_select_15", value);
  }

  // 填充一个类目属性：先按 rc_select id 精确定位，失败再按 label 文本兜底。
  // 适用于「可搜索」下拉：selectAntSelectById 会先填搜索框再点选项。
  async applyAttribute(labelKeyword, id, value) {
    if (!value) return { ok: false, reason: "empty-value" };
    try {
      const r = await this.selectAntSelectById(id, value);
      if (r && r.ok) return { ok: true, via: "id", id, value };
    } catch { /* fall through to label */ }
    try {
      const r = await this.selectAntSelectByLabel(labelKeyword, value);
      if (r && r.ok) return { ok: true, via: "label", label: labelKeyword, value };
    } catch { /* fall through */ }
    return { ok: false, reason: "not-found", label: labelKeyword, id, value };
  }

  // 按候选列表顺序尝试填充属性，命中即止（用于选项文本不确定的字段）。
  async applyAttributeAny(labelKeyword, id, candidates) {
    for (const c of candidates) {
      const r = await this.applyAttribute(labelKeyword, id, c);
      if (r.ok) return { ok: true, via: r.via, id, value: r.value, tried: candidates };
    }
    return { ok: false, reason: "none-matched", label: labelKeyword, id, candidates };
  }

  // 设置品牌：该品类（乳贴 Choice 半托管）品牌由「产品属性模板 + 同步品牌」派生，
  // 表单中**没有独立可填的 brand 输入**（品牌(Brand Name) 表单项实际是模板+属性组容器，
  // 内含 型号 等文本输入，定位会误伤）。故品牌只能随模板同步，无法按 facts.brand 单设。
  async trySetBrand(value) {
    if (!value) return { ok: false, reason: "empty" };
    await this.connect();
    // 点「同步品牌」确保品牌从模板同步（幂等）
    const synced = await this.page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("a,button,span,.ant-typography"))
        .find((e) => /同步品牌/.test(e.innerText || ""));
      if (el) { el.click(); return true; }
      return false;
    });
    await sleep(800);
    // 该品类无独立 brand 输入，仅返回模板同步结果（不误填其它字段）
    return {
      ok: true,
      via: "template-sync",
      value: synced ? "synced-from-template" : "no-sync-button",
      requested: value,
      note: "该品类品牌由产品属性模板派生，表单无独立 brand 输入，已按模板同步"
    };
  }

  // 设置材质：箱包类目下 rc_select id 随渲染动态重排，故改用 label 定位（稳定）。
  // 若不命中完整文本，退回中文前半段（如 "硅胶 Silicone" → "硅胶"）。
  async trySetMaterial(value) {
    if (!value) return { ok: false, reason: "empty" };
    const candidates = [value];
    const cn = String(value).split(/[(\s/]/)[0];
    if (cn && cn !== value) candidates.push(cn);
    // 优先按 label 定位（箱包安全）；其次尝试 profile 提供的 id（乳贴 rc_select_18 稳定）
    for (const c of candidates) {
      try {
        const r = await this.selectAntSelectByLabel("材质", c);
        if (r && r.ok) return { ok: true, via: "label", value: r.value };
      } catch { /* try next */ }
    }
    const matId = (this.profile.requiredAttrs || []).find((a) => a.label.startsWith("材质"))?.id
      || (this.profile.besteffortAttrs || []).find((a) => a.label.startsWith("材质"))?.id;
    if (matId) {
      for (const c of candidates) {
        try {
          const r = await this.selectAntSelectById(matId, c);
          if (r && r.ok) return { ok: true, via: "id", value: r.value };
        } catch { /* try next */ }
      }
    }
    return { ok: false, reason: "material-not-set", value };
  }

  // B 模式主流程：空白创建页 → 固定配置 + 类目 + 类目属性 + AI 事实 → 保存草稿（不发布）。
  // 不引用任何源产品；全部内容来自 facts / 固定常量。
  async createCustomProduct(facts) {
    await this.connect();
    await this.openCreatePage();
    const applied = [];
    // 1) 固定三件套（必须先于类目，类目选项依赖店铺）
    const fixed = this.profile.fixed || DIANXIAOMI_FIXED;
    if (fixed.storeName) applied.push({ field: "storeName", ...(await this.selectAntSelectById("rc_select_0", fixed.storeName)) });
    if (fixed.stockType) applied.push({ field: "stockType", ...(await this.selectAntSelectById("rc_select_1", fixed.stockType)) });
    // 2) 类目（profile 固定；选好后类目属性才加载）
    applied.push({ field: "category", ...(await this.selectCategory(this.profile.category)) });
    await sleep(1200);
    // 3) 标题（优先英文，确保满足店小秘 >=15 字符限制）
    const titleValue = this.resolveTitle(facts);
    if (titleValue) applied.push({ field: "title", ...(await this.fillInputByLabel("产品标题", titleValue)) });
    // 4) 描述 PC端 / 无线端：PC 填 3.2 AEO 文案；无线端使用新版编辑器「根据PC端描述一键生成」，不再手填。
    if (facts.description) {
      if (facts.description.pc) applied.push({ field: "description.pc", ...(await this.fillCkeditorByLabel("PC端描述", facts.description.pc)) });
      const mbRes = await this.clickNewEditorThenGenerateFromPc();
      applied.push({ field: "description.mobile", ...mbRes });
    }
    // 5) 必填类目属性（空白页实测 option 文本，顺序尝试 id→label 定位）
    for (const a of (this.profile.requiredAttrs || DIANXIAOMI_REQUIRED_ATTRS)) {
      applied.push({ field: "attr:" + a.label, ...(await this.applyAttribute(a.label, a.id, a.value)) });
    }
    // 6) 尽力填充属性（材质优先用 facts，否则默认回退；内衣配件类型/性别尝试候选）
    for (const a of (this.profile.besteffortAttrs || DIANXIAOMI_BESTEFFORT_ATTRS)) {
      const cands = [];
      if (a.factsKey && facts[a.factsKey]) cands.push(facts[a.factsKey]);
      cands.push(...a.candidates);
      applied.push({ field: "attr:" + a.label, ...(await this.applyAttributeAny(a.label, a.id, cands)) });
    }
    // 7) 品牌（先选项，失败则尝试自定义键入）
    if (facts.brand) applied.push({ field: "brand", ...(await this.trySetBrand(facts.brand)) });
    // 8) 上传产品主图（facts.images.main 为文件名，拼 this.imageBaseDir；支持产品图/output子目录与png/jpg后缀兜底）
    if (facts.images && Array.isArray(facts.images.main) && facts.images.main.length) {
      const missing = [];
      const paths = facts.images.main.map((n) => {
        const p = resolveImagePath(this.imageBaseDir, n);
        if (!p) missing.push(n);
        return p;
      }).filter(Boolean);
      if (missing.length) applied.push({ field: "images", ok: false, reason: `missing-files: ${missing.join(", ")}` });
      if (paths.length) applied.push({ field: "images", ...(await this.uploadProductImages(paths)) });
    }
    // 9) 保存草稿（点「保存」，不发布/上架）
    let saved = null;
    try {
      saved = await this.save();
    } catch (e) {
      saved = { ok: false, error: e.message };
    }
    return { applied, saved, url: this.page.url() };
  }

  // 上传营销图片（营销图片区）。复用隐藏 file input #localFileUploadInp，先点营销图片区块的「选择图片」触发上下文。
  // 关键：引用模板会带出旧营销图，必须先清空，否则新图追加在旧图后面。
  async uploadMarketingImages(filePaths) {
    if (!Array.isArray(filePaths) || !filePaths.length) return { ok: false, reason: "no-files" };
    await this.connect();
    const cleared = await this.clearByLabelText("营销图片", "删除");
    const trigger = this.page.locator(".ant-form-item:has-text('营销图片') button:has-text('选择图片')").first();
    if (await trigger.count()) {
      await trigger.click({ timeout: 5000 }).catch(() => {});
      await sleep(800);
    }
    const input = this.page.locator("#localFileUploadInp").first();
    await input.setInputFiles(filePaths, { timeout: 15000 }).catch(async () => {
      await this.page.evaluate(() => {
        const el = document.querySelector("#localFileUploadInp");
        if (el) el.setAttribute("style", "display:block;position:fixed;z-index:99999");
      });
    });
    await sleep(3500);
    const thumbs = await this.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-form-item")).filter((it) => /营销图片/.test((it.innerText || "").slice(0, 20)));
      const mod = items.length ? items[0] : null;
      if (!mod) return 0;
      return mod.querySelectorAll("img").length;
    });
    return { ok: true, uploadedCount: filePaths.length, thumbnails: thumbs, cleared };
  }

  // 按 profile 的 aiSections 配置，填「AI 生成板块」：标题/属性信息/产品图片/营销图片/PC+无线描述。
  // 引用自带板块（店铺/备货/分类/海关/计件单位/来源/欧盟责任人/品牌制造商/型号/来源地 等）一律不触碰。
  // 仅覆盖引用未带出的空属性（类型/材质/品牌/产地），已带出且 facts 无值则保留。
  async fillAiSections(facts) {
    await this.connect();
    const applied = [];
    const p = this.profile;
    const aiAttrs = (p.requiredAttrs || []).filter((a) => a.aiSection === "attributes");

    // 1) 产品标题（AI 生成板块）
    const aiTitleValue = this.resolveTitle(facts);
    if (aiTitleValue) applied.push({ field: "title", ...(await this.fillInputByLabel("产品标题", aiTitleValue)) });
    // 2) 属性信息（品牌/材质/类型/产地）
    for (const a of aiAttrs) {
      let fv = null;
      if (a.factsKey) {
        if (a.factsKey === "origin") fv = (facts.origin && facts.origin.country) ? facts.origin.country : null;
        else fv = facts[a.factsKey];
      }
      if (!fv) { applied.push({ field: "attr:" + a.label, ok: true, skipped: true, reason: "no-fact" }); continue; }
      if (a.viaBrandTemplateSync) {
        applied.push({ field: "attr:" + a.label, ...(await this.trySetBrand(fv)) });
      } else if (/材质/.test(a.label)) {
        const cur = await this.readField("材质", a.id);
        const r = await this.trySetMaterial(fv);
        if (r.ok) applied.push({ field: "attr:" + a.label, ...r });
        else if (cur) applied.push({ field: "attr:" + a.label, ok: true, skipped: true, reason: "source-kept", value: cur });
        else applied.push({ field: "attr:" + a.label, ok: false, reason: r.reason || "material-not-set", value: fv });
      } else if (a.id) {
        // 下拉型属性：label 定位优先（箱包 rc_select 重排），其次 id
        const r = await this.applyAttribute(a.label, a.id, fv);
        if (r.ok) applied.push({ field: "attr:" + a.label, ...r });
        else {
          const r2 = await this.fillInputByLabel(a.label, fv).catch(() => ({ ok: false, reason: "label-fill-failed" }));
          applied.push({ field: "attr:" + a.label, ...r2 });
        }
      } else {
        applied.push({ field: "attr:" + a.label, ...(await this.fillInputByLabel(a.label, fv)) });
      }
    }
    // 3) 产品图片（AI 生成板块）
    if (facts.images && Array.isArray(facts.images.main) && facts.images.main.length) {
      const missing = [];
      const paths = facts.images.main.map((n) => {
        const p = resolveImagePath(this.imageBaseDir, n);
        if (!p) missing.push(n);
        return p;
      }).filter(Boolean);
      if (missing.length) applied.push({ field: "images", ok: false, reason: `missing-files: ${missing.join(", ")}` });
      if (paths.length) {
        const imgRes = await this.uploadProductImages(paths);
        applied.push({ field: "images", ...imgRes });
        // 记录已上传主图的 CDN URL，供第 5 步 PC 端描述插图使用
        if (Array.isArray(imgRes.srcs) && imgRes.srcs.length) this.lastMainSrcs = imgRes.srcs;
      }
    }
    // 4) 营销图片（AI 生成板块）
    if (facts.images && Array.isArray(facts.images.marketing) && facts.images.marketing.length) {
      const missing = [];
      const paths = facts.images.marketing.map((n) => {
        const p = resolveImagePath(this.imageBaseDir, n);
        if (!p) missing.push(n);
        return p;
      }).filter(Boolean);
      if (missing.length) applied.push({ field: "marketingImages", ok: false, reason: `missing-files: ${missing.join(", ")}` });
      if (paths.length) applied.push({ field: "marketingImages", ...(await this.uploadMarketingImages(paths)) });
    }
    // 5) PC端描述 / 无线端描述（AI 生成板块）
    if (facts.description) {
      // 5.1 PC端描述：先填 3.2 AEO 文案，再把已上传主图 CDN URL 插到正文下方
      if (facts.description.pc) {
        const pcRes = await this.fillCkeditorByLabel("PC端描述", facts.description.pc);
        applied.push({ field: "description.pc", ...pcRes });
        if (this.lastMainSrcs && this.lastMainSrcs.length) {
          const imgRes = await this.insertImagesIntoCkeditor("PC端描述", this.lastMainSrcs);
          applied.push({ field: "description.pc.images", ...imgRes });
        }
      }
      // 5.2 无线端描述：不手填文案，改用「使用新版编辑器 → 根据PC端描述一键生成」。
      //      PC 必须先于无线完成（5.1 已完成），否则一键生成拿不到 PC 内容。
      const mbRes = await this.clickNewEditorThenGenerateFromPc();
      applied.push({ field: "description.mobile", ...mbRes });
    }
    return applied;
  }

  // 引用模式下的「基于资料文档覆盖填写」。
  // 前提：已 referenceProduct(id) 引用源产品，表单已带出 类目 + 类目属性 + 品牌/材质/SKU 骨架（乳贴）。
  // 箱包(xiangBao)：只填「AI 生成板块」(fillAiSections) + 物流属性；变种板块人工填写，本系统不触。
  // 乳贴(ruTie)：沿用历史完整闭环（类目属性补全 + 物流 + 主图 + 销售属性 + SKU + 每色图）。
  async fillFromFacts(facts) {
    await this.connect();
    const isXiangBao = this.profile.key === "xiangBao";
    if (isXiangBao) {
      const applied = [];
      applied.push(...(await this.fillAiSections(facts)));
      // 物流属性（必填，引用不携带；箱包默认普货）。弹窗选择，非致命。
      applied.push({ field: "logistics", ...(await this.fillLogisticsAttribute(this.profile.logistics || "普货")) });
      // 合规信息（欧盟责任人/土耳其责任人/品牌制造商）
      applied.push(...(await this.fillComplianceInfo(facts)));
      return applied;
    }
    const applied = [];
    // 1) 产品标题
    const refTitleValue = this.resolveTitle(facts);
    if (refTitleValue) applied.push({ field: "title", ...(await this.fillInputByLabel("产品标题", refTitleValue)) });
    // 2) PC端描述 / 无线端描述：PC 填 3.2 AEO 文案；无线端使用新版编辑器「根据PC端描述一键生成」
    if (facts.description) {
      if (facts.description.pc) applied.push({ field: "description.pc", ...(await this.fillCkeditorByLabel("PC端描述", facts.description.pc)) });
      const mbRes = await this.clickNewEditorThenGenerateFromPc();
      applied.push({ field: "description.mobile", ...mbRes });
    }
    // 3) 品牌（引用后品牌为可搜索 select；先选项，失败则自定义键入）
    if (facts.brand) applied.push({ field: "brand", ...(await this.trySetBrand(facts.brand)) });
    // 4) 材质（非破坏式：源产品引用后已合法填材质则保留；仅当源为空才尝试用 facts 覆盖）
    if (facts.material) {
      const cur = await this.readField("材质", "rc_select_18");
      const r = await this.trySetMaterial(facts.material);
      if (r.ok) {
        applied.push({ field: "material", ...r });
      } else if (cur) {
        applied.push({ field: "material", ok: true, skipped: true, reason: "source-kept", value: cur });
      } else {
        applied.push({ field: "material", ok: false, reason: r.reason || "material-not-set", value: facts.material });
      }
    }
    // 4.5) 类目属性补全（必填默认 + 关键属性用主关键词 + 默认兜底）
    applied.push(...(await this.fillCategoryAttributes(facts)));
    // 4.6) 物流属性（必填，引用不携带；乳贴为布+胶 → 普货）。弹窗选择，非致命。
    applied.push({ field: "logistics", ...(await this.fillLogisticsAttribute("普货")) });
    // 5) 产品主图（覆盖上传；产品图目录下的文件名拼 this.imageBaseDir，支持子目录与后缀兜底）
    if (facts.images && Array.isArray(facts.images.main) && facts.images.main.length) {
      const missing = [];
      const paths = facts.images.main.map((n) => {
        const p = resolveImagePath(this.imageBaseDir, n);
        if (!p) missing.push(n);
        return p;
      }).filter(Boolean);
      if (missing.length) applied.push({ field: "images", ok: false, reason: `missing-files: ${missing.join(", ")}` });
      if (paths.length) {
        const imgRes = await this.uploadProductImages(paths);
        applied.push({ field: "images", ...imgRes });
        // 记录已上传主图 CDN URL，供后续 PC 端描述插图使用
        if (Array.isArray(imgRes.srcs) && imgRes.srcs.length) this.lastMainSrcs = imgRes.srcs;
      }
    }
    // 5.1) 描述：PC 填 3.2 AEO 文案并插图；无线端使用新版编辑器「根据PC端描述一键生成」
    if (facts.description) {
      if (facts.description.pc) {
        const pcRes = await this.fillCkeditorByLabel("PC端描述", facts.description.pc);
        applied.push({ field: "description.pc", ...pcRes });
        if (this.lastMainSrcs && this.lastMainSrcs.length) {
          const imgRes = await this.insertImagesIntoCkeditor("PC端描述", this.lastMainSrcs);
          applied.push({ field: "description.pc.images", ...imgRes });
        }
      }
      const mbRes = await this.clickNewEditorThenGenerateFromPc();
      applied.push({ field: "description.mobile", ...mbRes });
    }
    // 5.5) 销售属性（颜色/尺寸）必填勾选：从 facts.variants 勾选分类 checkbox（点 label 触发 React onChange）。
    //       颜色为实操必填（靠颜色区分子 SKU）；尺寸按 facts 默认（One Size），并取消引用带出的多余尺寸。
    applied.push({ field: "salesAttrs", ...(await this.fillSalesAttributes(facts)) });
    // 6) SKU 变种（引用后点「生成SKU」→ 填每组合价格/库存/图；无 variants 则跳过，不报错）
    const skuResult = await this.fillSkus(facts);
    if (skuResult) applied.push({ field: "sku", ...skuResult });
    // 6.5) 每色图绑定（实验性，非致命：组合表无图列，每色图只能挂到「颜色(Color)」字段的「选择图片」）
    try {
      const colorImg = await this.fillColorImages(facts);
      applied.push({ field: "colorImages", ...colorImg });
    }
    catch (e) {
      applied.push({ field: "colorImages", ok: false, reason: e.message });
    }
    // 7) 合规信息（欧盟责任人/土耳其责任人/品牌制造商）
    applied.push(...(await this.fillComplianceInfo(facts)));
    return applied;
  }

  // 每色图绑定（实验性，非致命）。店小秘「颜色(Color)」= 可搜索分类法 + 原生 checkbox(value=分类ID) + 「选择图片」按钮。
  // 颜色值在店小秘中固定为分类，无法改名；本方法按我们的颜色名匹配分类 checkbox 并点 label 勾选，
  // 再点该字段「选择图片」上传对应色图。全程守卫：单行失败只记日志，不中断 SOP，且在 save 之前调用。
  async fillColorImages(facts) {
    const v = facts && facts.variants;
    const colorImages = (v && v.colorImages) || {};
    const keys = Object.keys(colorImages).filter((c) => colorImages[c]);
    if (!keys.length) return { ok: true, skipped: true, reason: "no-color-images" };
    const results = [];
    for (const color of keys) {
      try {
        const local = resolveImagePath(this.imageBaseDir, colorImages[color]);
        let exists = false;
        try { exists = !!local && fs.existsSync(local); } catch (_e) { /* ignore */ }
        if (!exists) { results.push({ color, ok: false, reason: "file-not-found", file: colorImages[color] }); continue; }
        const r = await this.page.evaluate(({ color }) => {
          const labels = Array.from(document.querySelectorAll(".ant-form-item-label label, label"));
          const lab = labels.find((el) => { const t = (el.innerText || "").replace(/\s+/g, "").trim(); return t === "颜色(Color)" || t === "颜色"; });
          if (!lab) return { found: false };
          let item = lab;
          for (let i = 0; i < 6 && item; i++) { if (item.classList && item.classList.contains("ant-form-item")) break; item = item.parentElement; }
          const control = item.querySelector(".ant-form-item-control") || item;
          const cbs = Array.from(control.querySelectorAll('input[type=checkbox]'));
          const norm = (s) => (s || "").toLowerCase().trim();
          const c = norm(color);
          const target = cbs.find((cb) => {
            const wrap = cb.closest("label") || cb.parentElement;
            const txt = norm(wrap ? wrap.innerText : "");
            const bare = txt.replace(/\(.*\)/, "").trim();
            return txt.includes(c) || (c.includes(bare) && bare.length > 0);
          });
          if (!target) return { found: true, matched: false };
          if (!target.checked) {
            const wrap = target.closest("label") || target.parentElement;
            wrap.click(); // 必须点 label 触发 React onChange（原生 input.click 不生效）
            if (!target.checked) return { found: true, matched: true, checked: false };
          }
          const btn = Array.from(control.querySelectorAll("button")).find((b) => /选择图片|上传图片/.test(b.innerText || ""));
          if (!btn) return { found: true, matched: true, checked: target.checked, hasBtn: false };
          btn.click();
          return { found: true, matched: true, checked: target.checked, hasBtn: true, clickedBtn: true };
        }, { color });
        if (!r.matched) { results.push({ color, ok: false, reason: "no-matching-taxonomy" }); continue; }
        if (!r.hasBtn) { results.push({ color, ok: false, reason: "no-image-btn" }); continue; }
        await sleep(2200);
        // 定位可见弹窗内的 file input（按 index 精确命中，避免误传产品主图 input）
        const modalFileIdx = await this.page.evaluate(() => {
          const modals = Array.from(document.querySelectorAll(".ant-modal-content, .modal, .d-modal, [class*=modal]"));
          const vis = modals.filter((x) => { const rect = x.getBoundingClientRect(); const cs = getComputedStyle(x); return rect.width > 0 && cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0"; });
          const m = vis.find((x) => /图片|选择|上传|图库|空间|素材/.test(x.innerText || ""));
          if (!m) return -1;
          const fi = m.querySelector("input[type=file]");
          if (!fi) return -2;
          return Array.from(document.querySelectorAll("input[type=file]")).indexOf(fi);
        });
        if (modalFileIdx >= 0) {
          const handles = await this.page.$$("input[type=file]");
          try { await handles[modalFileIdx].setInputFiles(local); await sleep(3500); results.push({ color, ok: true, uploaded: colorImages[color] }); }
          catch (e) { results.push({ color, ok: false, reason: "upload-failed:" + e.message }); }
        }
        else { results.push({ color, ok: false, reason: modalFileIdx === -2 ? "no-file-input-in-modal" : "modal-not-found" }); }
        // 关闭弹窗（Esc），避免残留影响下一次（同物流属性弹窗教训）
        await this.page.keyboard.press("Escape").catch(() => {});
        await sleep(800);
      }
      catch (e) {
        results.push({ color, ok: false, reason: e.message });
      }
    }
    return { ok: true, attempted: results.length, results };
  }

  // 销售属性（颜色/尺寸）必填勾选：从 facts.variants 勾选店小秘分类 checkbox（点 label 触发 React onChange）。
  // 颜色为实操必填（靠颜色区分子 SKU）；尺寸按 facts 默认（One Size），并取消引用带出的多余尺寸（仅当成功匹配到 facts 尺寸后才取消，避免清空）。
  // 本步骤非实验性、必跑（在 fillSkus 之前，因为「生成SKU」依赖已勾选的销售属性）。
  async fillSalesAttributes(facts) {
    const v = facts && facts.variants;
    const colors = v && Array.isArray(v.colors) && v.colors.length ? v.colors : null;
    const sizes = v && Array.isArray(v.sizes) && v.sizes.length ? v.sizes : null;
    if (!colors && !sizes) return { ok: true, skipped: true, reason: "no-colors-or-sizes-in-facts" };
    const r = await this.page.evaluate(({ colors, sizes }) => {
      const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "").trim();
      const labels = Array.from(document.querySelectorAll(".ant-form-item-label label, label"));
      function findGroup(labelText) {
        const lab = labels.find((el) => { const t = (el.innerText || "").replace(/\s+/g, "").trim(); return t === labelText || t === labelText + "(Color)" || t === labelText + "(Size)"; });
        if (!lab) return null;
        let item = lab;
        for (let i = 0; i < 6 && item; i++) { if (item.classList && item.classList.contains("ant-form-item")) break; item = item.parentElement; }
        return item;
      }
      function matchAndCheck(cbs, want) {
        const wantNorm = want.map(norm);
        const checked = [], missed = [], unchecked = [];
        let matchedWant = 0;
        const isWantOf = (wrap) => {
          const txt = norm(wrap ? wrap.innerText : "");
          const bare = norm((wrap ? wrap.innerText : "").replace(/\(.*\)/, ""));
          return wantNorm.some((w) => txt.includes(w) || (w.includes(bare) && bare.length > 0));
        };
        // pass1: 勾选 facts 中想要的
        for (const cb of cbs) {
          const wrap = cb.closest("label") || cb.parentElement;
          if (isWantOf(wrap)) {
            if (!cb.checked) wrap.click();
            if (cb.checked) { checked.push((wrap.innerText || "").trim()); matchedWant++; }
            else missed.push((wrap.innerText || "").trim());
          }
        }
        // pass2: 仅当成功匹配到 facts 尺寸/颜色后，才取消引用带出的多余项
        if (matchedWant > 0) {
          for (const cb of cbs) {
            const wrap = cb.closest("label") || cb.parentElement;
            if (!isWantOf(wrap) && cb.checked) {
              wrap.click();
              if (!cb.checked) unchecked.push((wrap.innerText || "").trim());
            }
          }
        }
        return { checked, missed, unchecked };
      }
      const res = {};
      if (colors) { const g = findGroup("颜色"); res.colors = g ? matchAndCheck(Array.from(g.querySelectorAll('input[type=checkbox]')), colors) : { error: "group-not-found" }; }
      if (sizes) { const g = findGroup("尺寸"); res.sizes = g ? matchAndCheck(Array.from(g.querySelectorAll('input[type=checkbox]')), sizes) : { error: "group-not-found" }; }
      return res;
    }, { colors, sizes });
    const colorOk = !r.colors || (!r.colors.error && !(r.colors.missed && r.colors.missed.length));
    const sizeOk = !r.sizes || (!r.sizes.error && !(r.sizes.missed && r.sizes.missed.length));
    return { ok: colorOk && sizeOk, ...r };
  }

  // 读取某字段当前值（Ant Select 读 selection-item，普通 input 读 value）。用于「已填则跳过，不覆盖源产品值」。
  async readField(labelKeyword, id) {
    await this.connect();
    return this.page.evaluate(({ kw, selId }) => {
      const readSel = (sel) => {
        if (!sel) return "";
        const item = sel.querySelector(".ant-select-selection-item, .ant-select-selection-item-content");
        if (item && (item.innerText || "").trim()) return (item.innerText || "").trim();
        const inp = sel.querySelector("input");
        if (inp && inp.value) return inp.value;
        return "";
      };
      if (selId) {
        const input = document.querySelector("#" + selId);
        const sel = (input && input.closest(".ant-select")) || document.querySelector("#" + selId);
        const v = readSel(sel);
        if (v) return v;
      }
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (lab && lab.innerText.includes(kw)) {
          const v = readSel(item.querySelector(".ant-select"));
          if (v) return v;
          const inp = item.querySelector("input:not([type=hidden])");
          if (inp && inp.value) return inp.value;
        }
      }
      return "";
    }, { kw: labelKeyword, selId: id || "" });
  }

  // 引用模式下补全类目属性（非破坏性：源产品已填的值保留，仅填空字段 + 按决策覆盖关键标识项）。
  // 决策：通用/必填项「引用已带则用源值，空才用默认」；关键标识项（型号/内衣配件类型）用产品主关键词。
  // 非致命：单个属性失败只记日志，不中断整体流程。
  async fillCategoryAttributes(facts) {
    const applied = [];
    const kw = (facts && facts.mainKeyword) || "Nipple Covers";
    // 通用/必填属性：已填则跳过（复用源值），空才用默认兜底
    const defaults = [
      { label: "高关注化学品", id: "rc_select_12", value: "天然未处理(None)" },
      { label: "产地（国家或地区）", id: "rc_select_13", value: "中国大陆(Origin)(Mainland China)" },
      { label: "是否性暗示", id: "rc_select_14", value: "否(No)" },
      { label: "颜色风格", id: "rc_select_16", value: "自然色(Natural Color)" },
      { label: "是否暴露图片", id: "rc_select_15", value: "否(No)" },
      { label: "性别", id: "rc_select_20", value: "女性(Women)" },
      { label: "中国省份", id: "rc_select_22", value: "广东(Guangdong)" },
      { label: "计件单位", id: "form_item_productUnit", value: "件" },
      { label: "海关监管属性", id: null, value: "3", isInput: true }
    ];
    for (const a of defaults) {
      const cur = await this.readField(a.label, a.id);
      if (cur) {
        applied.push({ field: "attr:" + a.label, ok: true, skipped: true, value: cur });
        continue;
      }
      if (a.isInput) {
        applied.push({ field: "attr:" + a.label, ...(await this.fillInputByLabel(a.label, a.value)) });
      } else {
        applied.push({ field: "attr:" + a.label, ...(await this.applyAttribute(a.label, a.id, a.value)) });
      }
    }
    // 关键标识项：型号 用主关键词（决策2，强制覆盖源值 NPE0005 等）
    applied.push({ field: "attr:型号", ...(await this.fillInputByLabel("型号", kw)) });
    // 关键标识项：内衣配件类型 用主关键词；匹配不上则保留源值（不强行覆盖为错值）
    applied.push({ field: "attr:内衣配件类型", ...(await this.applyAttribute("内衣配件类型", "rc_select_17", kw)) });
    return applied;
  }

  // 物流属性（必填项，引用不会携带；乳贴=布+胶 → 选「普货」）。
  // UI：字段带编辑图标（icon_edit2 link），点击打开「修改物流属性」弹窗（选项为 ant-checkbox-wrapper），勾选后点确定。
  // 非致命：找不到编辑图标/选项/确定按钮只记日志，不中断整体流程。
  async fillLogisticsAttribute(value = "普货") {
    await this.connect();
    try {
      // 物流属性 是自定义结构（span.required「物流属性」+ span.link 编辑图标，非 .ant-form-item）。
      // 关键坑：
      //  - 店小秘会残留多个同名「批量修改物流属性」弹窗副本（离场动画未移除）；AntD 弹窗用 position:fixed
      //    导致 offsetParent 恒为 null，须用 getBoundingClientRect().width>0 判定可见（隐藏副本 rect 为 0）。
      //  - 若直接复用「上次运行残留的、正在 React 卸载中的可见弹窗」，点击 普货 不会生效（input.checked 不变），
      //    从而导致 option-not-found。故先关闭任何已存在的物流弹窗，再开一个全新的。
      const isLogisticsModalVisible = () => {
        const isVisibleModal = (m) => {
          const r = m.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = getComputedStyle(m);
          return !(s.display === "none" || s.visibility === "hidden" || s.opacity === "0");
        };
        const modals = Array.from(document.querySelectorAll(".ant-modal-content"));
        return modals.some((m) => {
          if (!isVisibleModal(m)) return false;
          const t = m.innerText || "";
          return t.includes("物流") && t.includes("普货");
        });
      };

      // 0) 关闭任何已存在的物流弹窗（点「取消」），直到不再有可见物流弹窗
      for (let i = 0; i < 6; i++) {
        const closed = await this.page.evaluate(() => {
          const isVisibleModal = (m) => {
            const r = m.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            const s = getComputedStyle(m);
            return !(s.display === "none" || s.visibility === "hidden" || s.opacity === "0");
          };
          const modals = Array.from(document.querySelectorAll(".ant-modal-content"));
          for (const m of modals) {
            if (!isVisibleModal(m)) continue;
            const t = m.innerText || "";
            if (!(t.includes("物流") && t.includes("普货"))) continue;
            const cancel = Array.from(m.querySelectorAll("button")).find((b) => /取消/.test(b.innerText || ""));
            if (cancel) { cancel.click(); return true; }
          }
          return false;
        });
        if (!closed) break;
        await sleep(700);
      }
      // 兜底：若仍有可见物流弹窗（无取消按钮等异常），按 Esc 清场
      if (await this.page.evaluate(isLogisticsModalVisible)) {
        await this.page.keyboard.press("Escape").catch(() => {});
        await sleep(700);
      }

      // 1) 打开弹窗：点编辑图标，最多重试 3 次
      let opened = false;
      for (let attempt = 0; attempt < 3 && !opened; attempt++) {
        const clicked = await this.page.evaluate(() => {
          const labels = Array.from(document.querySelectorAll("span, label, div"));
          const label = labels.find((el) => {
            const t = (el.innerText || "").replace(/\s+/g, "").trim();
            return t === "物流属性" || t === "物流属性*";
          });
          if (!label) return false;
          let scope = label;
          for (let i = 0; i < 5 && scope; i++) {
            const icon = scope.querySelector("i[class*=edit], .icon_edit2, .link, a.link, span.link, [class*=edit]");
            if (icon) { icon.click(); return true; }
            scope = scope.parentElement;
          }
          return false;
        });
        if (!clicked) return { ok: false, reason: "logistics-edit-not-found" };
        await sleep(2000);
        opened = await this.page.evaluate(isLogisticsModalVisible);
        if (!opened) {
          await this.page.keyboard.press("Escape").catch(() => {});
          await sleep(500);
        }
      }
      if (!opened) return { ok: false, reason: "logistics-edit-not-found" };

      // 2) 在「可见」的物流弹窗里精确勾选 普货（LABEL.ant-checkbox-wrapper，文本恰好为「普货」，排除「普货:」描述文本）
      //    注意：AntD 复选框为受控组件且原生 input 不可交互，必须 click LABEL（或 .ant-checkbox 可见区），
      //    input.click() 不会触发 React onChange；点击后等待 React 重渲染再读 checked。
      await sleep(800);
      const picked = await this.page.evaluate(async (val) => {
        const isVisibleModal = (m) => {
          const r = m.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = getComputedStyle(m);
          return !(s.display === "none" || s.visibility === "hidden" || s.opacity === "0");
        };
        const modals = Array.from(document.querySelectorAll(".ant-modal-content"));
        for (const m of modals) {
          if (!isVisibleModal(m)) continue;
          const t = m.innerText || "";
          if (!(t.includes("物流") && t.includes("普货"))) continue;
          const cb = Array.from(m.querySelectorAll(".ant-checkbox-wrapper"))
            .find((w) => (w.innerText || "").replace(/\s+/g, "").trim() === val);
          if (!cb) continue;
          const input = cb.querySelector("input[type=checkbox]");
          if (!input) continue;
          if (!input.checked) cb.click();
          await new Promise((r) => setTimeout(r, 400));
          if (!input.checked) {
            const box = cb.querySelector(".ant-checkbox");
            if (box) { box.click(); await new Promise((r) => setTimeout(r, 400)); }
          }
          return input.checked === true;
        }
        return false;
      }, value);
      if (!picked) {
        await this.page.keyboard.press("Escape").catch(() => {});
        return { ok: false, reason: "logistics-option-not-found", value };
      }

      await sleep(500);
      // 3) 点确定（仅可见的物流弹窗）
      const confirmed = await this.page.evaluate(() => {
        const isVisibleModal = (m) => {
          const r = m.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const s = getComputedStyle(m);
          return !(s.display === "none" || s.visibility === "hidden" || s.opacity === "0");
        };
        const modals = Array.from(document.querySelectorAll(".ant-modal-content"));
        for (const m of modals) {
          if (!isVisibleModal(m)) continue;
          const t = m.innerText || "";
          if (!(t.includes("物流") && t.includes("普货"))) continue;
          const ok = Array.from(m.querySelectorAll("button")).find((b) => /确定/.test(b.innerText || ""));
          if (ok) { ok.click(); return true; }
        }
        return false;
      });
      await sleep(1000);
      // 4) 成功判据：物流属性字段的错误态已消失
      const cleared = await this.page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll("span, label, div"));
        const label = labels.find((el) => {
          const t = (el.innerText || "").replace(/\s+/g, "").trim();
          return t === "物流属性" || t === "物流属性*";
        });
        if (!label) return true;
        let scope = label;
        for (let i = 0; i < 5 && scope; i++) {
          if (scope.classList && (scope.classList.contains("ant-form-item-has-error") || /error/i.test(scope.className || ""))) return false;
          scope = scope.parentElement;
        }
        return true;
      });
      return { ok: confirmed && cleared, value, picked, confirmed, cleared };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // 读取源产品销售属性矩阵（当前页须已引用源产品或停在引用草稿；读颜色/尺寸组合）
  async readSourceVariants() {
    await this.connect();
    const data = await this.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      const colors = [], sizes = [];
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (!lab) continue;
        const txt = (lab.innerText || "").replace(/\*/g, " ").trim();
        const inp = item.querySelector("input:not([type=hidden])");
        const val = inp ? (inp.value || "").trim() : "";
        if (/颜色\s*\(?Color\)?/i.test(txt) && val) colors.push(val);
        if (/尺寸\s*\(?Size\)?/i.test(txt) && val) sizes.push(val);
      }
      return { colors, sizes };
    });
    if (!data.colors.length && !data.sizes.length) {
      throw new Error("当前页未检测到源产品销售属性（颜色/尺寸）。请先引用源产品 1005005575013300 或停在引用后的草稿页，再点「载入源产品变种」。");
    }
    return data;
  }

  // 引用后：点「生成SKU」→ 按 variants.matrix 填每组合的价格/库存/重量
  // 非致命：单行失败只记日志，不中断整体流程
  async fillSkus(facts) {
    const v = facts && facts.variants;
    const matrix = v && v.matrix;
    if (!matrix || !matrix.length) {
      // 显式报错而非静默跳过：缺变种矩阵 → 店小秘保存会因价格/库存为空被校验拦截
      return { ok: false, skipped: false, reason: "no-variants-in-facts", hint: "请在 SKU 规划卡点「生成组合表」（默认 One Size）并保存规划后再上架" };
    }
    const gen = await this.page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll("button"));
      const t = (b) => (b.innerText || b.textContent || "").trim();
      const target = bs.find((b) => /生成\s*SKU/i.test(t(b))) || bs.find((b) => /生成销售属性|添加\s*SKU/i.test(t(b)));
      if (target) { target.click(); return t(target); }
      return null;
    });
    await sleep(1800);
    const applied = [];
    for (let i = 0; i < matrix.length; i++) {
      try {
        applied.push(await this.fillSkuRow(i, matrix[i]));
      }
      catch (e) {
        applied.push({ row: i, ok: false, error: e.message });
      }
    }
    return { ok: true, generated: gen, rows: applied.length };
  }

  // 填第 i 个 SKU 组合行（真实店小秘乳贴组合表：Size|Color|供货价(CNY)|SKU编码|货品条码|SKU分类|库存|申请销售）
  // 颜色/尺寸在组合表为只读文本（由销售属性定义决定），价格/库存/条码/SKU编码为可填 input。
  // 用表头文本定位列，避免硬编码索引（适配不同品类表头差异）。
  async fillSkuRow(index, m) {
    await this.connect();
    return this.page.evaluate(({ idx, row }) => {
      const tables = Array.from(document.querySelectorAll("table"));
      const table = tables.find((tb) => {
        const ths = Array.from(tb.querySelectorAll("thead th, thead td")).map((h) => h.innerText || "");
        return ths.some((t) => /供货价|库存/.test(t));
      });
      if (!table) return { ok: false, reason: "no-sku-combo-table" };
      const ths = Array.from(table.querySelectorAll("thead th, thead td")).map((h) => (h.innerText || "").replace(/\s+/g, " ").trim());
      const col = (re) => ths.findIndex((t) => re.test(t));
      const priceCol = col(/供货价/);
      const stockCol = col(/库存/);
      const barcodeCol = col(/货品条码/);
      const skuCol = col(/SKU编码/);
      const trs = Array.from(table.querySelectorAll("tbody tr"));
      const tr = trs[idx];
      if (!tr) return { ok: false, reason: "row-not-found", total: trs.length };
      const cells = Array.from(tr.children);
      const setVal = (ci, val) => {
        if (ci < 0) return;
        const cell = cells[ci];
        if (!cell) return;
        const inp = cell.querySelector("input:not([type=hidden])");
        if (inp && val != null && String(val) !== "") {
          inp.value = String(val);
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
        }
      };
      setVal(priceCol, row.price);
      setVal(stockCol, row.stock);
      setVal(barcodeCol, row.barcode);
      setVal(skuCol, row.sku);
      return { ok: true, priceCol, stockCol, filledPrice: !!row.price, filledStock: !!row.stock };
    }, { idx: index, row: m });
  }

  // 读取当前表单固定字段的选中值（核对用）
  async snapshotFixedFields() {
    await this.connect();
    return this.page.evaluate(() => {
      const read = (id) => {
        const input = document.querySelector("#" + id);
        const sel = (input && input.closest(".ant-select")) || document.querySelector("#" + id);
        if (!sel) return null;
        const inputEl = sel.querySelector("input");
        const cur = inputEl ? (inputEl.value || inputEl.getAttribute("placeholder") || "") : (sel.getAttribute("title") || "");
        const text = (sel.innerText || "").replace(/\*/g, " ").trim();
        return { id, current: String(cur), text: text.slice(0, 60) };
      };
      return {
        url: location.href,
        storeName: read("rc_select_0"),
        stockType: read("rc_select_1")
      };
    });
  }

  // 保存（不发布）。只点「保存」按钮，排除「上架/发布/提交」。
  async save() {
    await this.connect();
    const urlBefore = this.page.url();
    const label = await this.page.evaluate(() => {
      const bs = Array.from(document.querySelectorAll("button"));
      const t = (b) => (b.innerText || b.textContent || "").trim();
      const exact = bs.find((b) => t(b) === "保存");
      const safe = bs.find((b) => /保存/.test(t(b)) && !/上架|发布|提交/.test(t(b)));
      const target = exact || safe;
      if (!target) return null;
      target.click();
      return t(target);
    });
    if (!label) throw new Error("未找到保存按钮（非上架/发布）");
    // 等待保存结果（toast / 校验弹窗通常 1-3s 内出现；1.5s 读取以免 toast 自动消失后漏捕）
    await sleep(1500);
    // 读回页面状态，判断真实保存结果
    let readback = {};
    try {
      readback = await this.page.evaluate(() => {
        const out = { successToast: "", errorToast: "", errorText: "", url: location.href };
        const collect = (sel, bucket) => {
          document.querySelectorAll(sel).forEach((el) => {
            const txt = (el.innerText || el.textContent || "").trim();
            if (!txt) return;
            if (/成功|保存|已保存|待发布|草稿/.test(txt)) out.successToast = txt;
            if (/失败|错误|必填|请填写|校验|不完整|不能为空|required/i.test(txt)) out.errorToast = txt;
          });
        };
        // Ant Design message / notification
        collect(".ant-message .ant-message-success, .ant-message-success, .ant-notification-success", "ok");
        collect(".ant-message .ant-message-error, .ant-message-error, .ant-notification-error", "err");
        collect(".ant-message-notice-content, .ant-notification-notice-description, .ant-notification-notice-message", "any");
        // 店小秘 / Element 系 toast
        collect(".el-message, .el-message--success, .el-message--error, .toast, .toast-success, .toast-error, .tip-msg", "any");
        // 字段级校验红字（ant-form-item-explain-error / 红字）
        document.querySelectorAll(".ant-form-item-explain-error, .field-error, .error-text, [class*='error']").forEach((el) => {
          const txt = (el.innerText || el.textContent || "").trim();
          if (txt && /必填|请填写|不能为空|校验|错误/.test(txt)) out.errorText += (out.errorText ? " | " : "") + txt;
        });
        // 居中的校验失败弹窗（文案含「校验」）
        document.querySelectorAll(".ant-modal-body, .d-modal-body, .dialog-body").forEach((el) => {
          const txt = (el.innerText || el.textContent || "").trim();
          if (txt && /校验失败|保存失败|请完善|必填项|不完整/.test(txt)) out.errorText += (out.errorText ? " | " : "") + txt.slice(0, 80);
        });
        return out;
      });
    }
    catch (_e) {
      readback = { url: this.page.url() };
    }
    const urlAfter = readback.url || this.page.url();
    const urlChanged = urlBefore !== urlAfter;
    // 成功判据：捕获到成功 toast，或「无校验错误」（店小秘保存失败必弹「校验失败/请选择」错误；
    // 此前每次失败都弹出校验错误，现无错误即代表校验通过、草稿已存入「待发布」）。
    const saved = !!readback.successToast || (!readback.errorToast && !readback.errorText);
    const level = readback.errorToast || readback.errorText ? "err" : (saved ? "ok" : "unknown");
    const message = readback.errorToast || readback.errorText
      ? (readback.errorToast || readback.errorText)
      : (readback.successToast || (saved ? "保存成功（无错误提示，草稿已存待发布）" : "已点击保存，未捕获提示，请人工到待发布页确认草稿"));
    return {
      clicked: label,
      saved,
      level,
      message,
      urlBefore,
      urlAfter,
      urlChanged,
      successToast: readback.successToast || "",
      errorToast: readback.errorToast || "",
      errorText: readback.errorText || ""
    };
  }

  async close() {
    // 关闭 CDP 连接释放资源（下次 connect() 会重新连接）
    if (this.browser) { await this.browser.close().catch(() => {}); }
    this.browser = null;
    this.page = null;
  }

  // 检查当前连接是否可用（供外部诊断）
  isConnected() {
    return !!(this.browser && this.page);
  }
}

export default DianxiaomiAdapter;
