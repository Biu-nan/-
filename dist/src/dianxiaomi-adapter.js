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
import { spawn } from "node:child_process";
import net from "node:net";
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
  DIANXIAOMI_URL_CHOICE_DRAFT,
  getDianxiaomiProfile,
  isXiangBaoProfile,
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

// 检查本地端口是否可连
function isPortReachable(port, host = "127.0.0.1", timeout = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

// 按需启动 Chrome（CDP 未监听时）
async function ensureChrome(debugPort = CHROME_DEBUG_PORT) {
  if (await isPortReachable(debugPort)) return true;
  const chromePath = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
  try {
    if (!fs.existsSync(chromePath)) {
      // 尝试常见备用路径
      const fallbacks = [
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Users/User/AppData/Local/Google/Chrome/Application/chrome.exe",
        "C:/Program Files/Google/Chrome/Application/chrome.exe"
      ];
      let found = chromePath;
      for (const p of fallbacks) { if (fs.existsSync(p)) { found = p; break; } }
      if (!fs.existsSync(found)) return false;
    }
    const userDataDir = path.join(process.cwd(), ".chrome-profile");
    const proc = spawn(chromePath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--start-maximized",
      "https://www.dianxiaomi.com/"
    ], { detached: true, stdio: "ignore" });
    proc.unref();
    // 等待 CDP 可用（最多 15s）
    for (let i = 0; i < 30; i += 1) {
      await sleep(500);
      if (await isPortReachable(debugPort)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

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
    // 复用策略：优先复用已有连接与当前页面，避免每次重连导致「复用第一个店小秘标签页」的不确定性。
    // 仅当连接不存在/已断开时才重连（重连时在 browser 级注册一次 dialog 自动接受处理器）。
    // 关键修复：以前每次 connect 都重连 + 选「第一个店小秘标签页」，导致采集箱批量流程里
    // 编辑分类/保存下一步打开的新标签页变成「第一个」，后续步骤在错页面上操作、弹窗不可见。
    const selectPage = () => {
      let page = null;
      // 1) 优先复用当前 this.page（仍存活且为店小秘页）
      if (this.page && !this.page.isClosed()) {
        try { const u = this.page.url(); if (u.includes("dianxiaomi.com")) page = this.page; } catch { /* detached */ }
      }
      // 2) 否则挑第一个店小秘页
      if (!page) {
        for (const ctx of this.browser.contexts()) {
          for (const p of ctx.pages()) {
            if (!p.isClosed() && p.url().includes("dianxiaomi.com")) { page = p; break; }
          }
          if (page) break;
        }
      }
      return page;
    };

    // 轻量健康检查：browser 对象存在且 contexts() 不抛异常即视为存活
    let healthy = false;
    try {
      if (this.browser && typeof this.browser.contexts === "function" && this.browser.contexts()) {
        healthy = true;
      }
    } catch { healthy = false; }

    if (healthy) {
      const p = selectPage();
      if (p) { this.page = p; return this.page; }
      // 无可用店小秘页，开新页
      try {
        this.page = await this.browser.contexts()[0].newPage();
        return this.page;
      } catch { /* 落到重连 */ }
    }

    // 重连
    try { if (this.browser) await this.browser.close().catch(() => {}); } catch { /* ignore */ }
    this.browser = null;
    this.page = null;

    // CDP 未监听时自动启动 Chrome（避免用户手动启动）
    const chromeReady = await ensureChrome(CHROME_DEBUG_PORT);
    if (!chromeReady) throw new Error(`Chrome CDP 端口 ${CHROME_DEBUG_PORT} 未监听，且自动启动失败。请手动启动 Chrome：--remote-debugging-port=${CHROME_DEBUG_PORT}`);

    // connectOverCDP 协议握手偶发卡死（浏览器目标多/某标签 DOM 过大时），加超时 + 重试自愈。
    let connected = false;
    let lastConnErr = null;
    for (let attempt = 1; attempt <= 3 && !connected; attempt += 1) {
      try {
        if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`, { timeout: 60000 });
        connected = true;
      } catch (e) {
        lastConnErr = e;
        if (this.browser) { await this.browser.close().catch(() => {}); this.browser = null; }
        await sleep(2000);
      }
    }
    if (!connected) throw new Error(`Chrome CDP 连接失败（已重试 3 次）：${lastConnErr && lastConnErr.message}`);

    // 自动接受任何 JS 对话框（confirm/alert/beforeunload）。
    // 只注册在 browser 级别一次（重连时）。browser 级 handler 覆盖其下所有 context/page。
    const _handle = async (d) => {
      try { await d.accept(); } catch { /* 对话框已消失或被内置处理，忽略 */ }
    };
    this.browser.on("dialog", _handle);

    const p = selectPage();
    if (p) { this.page = p; return this.page; }
    this.page = await this.browser.contexts()[0].newPage();
    return this.page;
  }

  // 关闭除 this.page 外的所有店小秘标签页，避免多标签导致 connect 复用错乱 / 弹窗落在错页面。
  async _closeExtraDianxiaomiTabs() {
    if (!this.browser) return;
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) {
        if (p === this.page) continue;
        try {
          const u = p.url();
          if (u && u.includes("dianxiaomi.com")) await p.close();
        } catch { /* ignore */ }
      }
    }
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
    else {
      // 兜底：选第一个可用项（任意合法值优于留空，用于草稿兜底）
      const firstOpt = opt.first();
      if (await firstOpt.count()) {
        const chosen = (await firstOpt.innerText().catch(() => "")).trim();
        await firstOpt.click({ timeout: 5000 });
        await sleep(400);
        return { ok: true, label: labelKeyword, value: chosen, fallback: true };
      }
      await this.page.mouse.click(5, 5).catch(() => {});
      return { ok: false, reason: "option-not-found:" + value };
    }
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

  // 无线端描述：点击「使用新版编辑器」打开弹窗 → 弹窗内点「根据PC端描述一键生成」→ 保存。
  // 设计要点（针对此前“弹窗流程没生效”进行重写，更稳健 + 全程可诊断）：
  //   1) 以「根据PC端描述一键生成」按钮是否出现作为“弹窗已开”的可靠信号（该按钮只存在于弹窗内），
  //      不再依赖弹窗标题文字（旧版依赖“新版编辑器”标题，匹配不上就整段失败）。
  //   2) 「使用新版编辑器」可能是 form-item 内的小链接，也可能是 Ant Select 的下拉项：
  //      点击后若弹出 .ant-select-dropdown，则再点其中的「新版编辑器」选项。
  //   3) 点生成后轮询弹窗内 ckeditor33（无线端实例）是否已有内容，最长 15s。
  //   4) 生成后点弹窗「保存」（退路：右上角关闭 X），并验证弹窗已关闭 + 无线端字段有内容。
  //   5) 全程把每一步写入 result.steps，实跑失败时把 steps 贴回即可定位 DOM 差异。
  async clickNewEditorThenGenerateFromPc() {
    await this.connect();
    const tag = "[mobileEditor]";
    const log = (m) => console.log(tag + " " + m);
    const result = { ok: false, steps: [], reason: "" };
    const step = (s) => { result.steps.push(s); log(s); };

    // 在给定根定位器内按模糊正则点按钮（button/a/span/div 都试），返回是否点到
    const clickByTextIn = async (root, re) => {
      let b = root.getByText(re).first();
      if (await b.count() === 0) b = root.locator("button, a, span, div").filter({ hasText: re }).first();
      if (await b.count() === 0) return false;
      await b.click({ timeout: 8000 }).catch((e) => log("click err: " + e.message));
      await sleep(400);
      return true;
    };

    // 「根据PC端描述一键生成」按钮定位（只存在于弹窗内）。
    // 关键：该控件是 <span class="link">根据PC端描述一键生成</span> 叶子节点。
    // 旧的 `button, a, span, div` 模糊匹配会命中「包含该文字的最外层容器 div」（整个弹窗），
    // 点击被该容器拦截而无效（generated 永远 = false）。故必须精确取 span.link 叶子。
    const genBtnLocator = () => this.page
      .locator('span.link:has-text("根据PC端描述一键生成"), span:has-text("根据PC端描述一键生成"), a:has-text("根据PC端描述一键生成"), button:has-text("根据PC端描述一键生成")')
      .first();

    // 找到包含某按钮的可视 modal/drawer/dialog（退路：直接以按钮为根）
    const findModalOf = async (btn) => {
      for (const sel of [".ant-modal-content", ".ant-drawer-content", "[role=dialog]", ".ant-modal"]) {
        const m = this.page.locator(sel).filter({ has: btn }).first();
        if (await m.count() > 0 && await m.isVisible().catch(() => false)) return m;
      }
      return btn;
    };

    // 关闭上一轮中断可能残留的「新版编辑器」弹窗（否则 genBtn 会命中旧弹窗里的按钮，导致生成失败/错填）
    const staleModal = this.page.locator(".ant-modal.smt-new-editor").first();
    if (await staleModal.count() > 0 && await staleModal.isVisible().catch(() => false)) {
      step("closing stale new-editor modal");
      const xBtn = staleModal.locator(".ant-modal-close, .smt-new-editor-close, [class*=close]").first();
      if (await xBtn.count() > 0) await xBtn.click({ timeout: 5000 }).catch(() => {});
      await this.page.keyboard.press("Escape").catch(() => {});
      await sleep(800);
    }

    // 若生成按钮已存在（弹窗已开），直接进入生成步骤
    let genBtn = await genBtnLocator();
    if (await genBtn.count() === 0) {
      step("clicking 使用新版编辑器");
      let ne = this.page.locator(".ant-form-item").filter({ hasText: /无线端描述/ }).getByText(/使用新版编辑器|新版编辑器/).first();
      if (await ne.count() === 0) ne = this.page.getByText(/使用新版编辑器|新版编辑器/).first();
      if (await ne.count() === 0) { result.reason = "no-new-editor-btn"; return result; }
      await ne.click({ timeout: 8000 }).catch((e) => step("click err: " + e.message));
      await sleep(1500);

      // 处理可能的下拉：点击后弹出 .ant-select-dropdown，需再点其中的「新版编辑器」选项
      const dd = this.page.locator(".ant-select-dropdown").filter({ hasText: /新版编辑器|使用新版编辑器/ }).first();
      if (await dd.count() > 0 && await dd.isVisible().catch(() => false)) {
        step("select dropdown appeared -> choose 新版编辑器");
        await dd.locator("div, li").filter({ hasText: /新版编辑器/ }).first()
          .click({ timeout: 5000 }).catch((e) => step("dd choose err: " + e.message));
        await sleep(1500);
      }

      // 等生成按钮出现（=弹窗已开）作为可靠信号
      let w = 0;
      while ((await genBtnLocator()).count() === 0 && w < 10000) { await sleep(500); w += 500; }
      genBtn = await genBtnLocator();
      if (await genBtn.count() === 0) { result.reason = "modal-not-opened(no-generate-btn)"; return result; }
      step("modal opened (generate btn visible)");
    } else {
      step("modal already open");
    }

    const modal = await findModalOf(genBtn);

    // 3) 点「根据PC端描述一键生成」
    step("clicking 根据PC端描述一键生成");
    await genBtn.click({ timeout: 8000 }).catch((e) => step("gen click err: " + e.message));
    await sleep(6000);

    // 4) 等弹窗内编辑器有内容（ckeditor33 = 无线端实例）
    let w2 = 0, generated = false;
    while (w2 < 15000 && !generated) {
      generated = await this.page.evaluate(() => {
        const i33 = window.CKEDITOR && window.CKEDITOR.instances["ckeditor33"];
        if (i33 && (i33.getData() || "").length > 50) return true;
        return false;
      }).catch(() => false);
      if (generated) break;
      await sleep(1500); w2 += 1500;
    }
    step("generated=" + generated);

    // 5) 保存并关闭弹窗
    step("saving modal");
    let saved = await clickByTextIn(modal, /保存|完成|确定/);
    if (!saved) {
      const x = modal.locator(".ant-modal-close, .ant-drawer-close, [class*=close]").first();
      if (await x.count() > 0) await x.click({ timeout: 5000 }).catch(() => {});
    }
    await sleep(2000);

    // 6) 验证弹窗已关闭且无线端字段有内容
    let closed = (await genBtnLocator()).count() === 0;
    // 兜底强制关闭弹窗：无线端描述用「新版模块编辑器」，店小秘不依赖其内容为保存前提
    // （save 读回已不校验 mobile），故无论是否生成成功都强制关窗，避免残留 modal 拦截
    // 后续字段点击（如备货类型下拉被 ant-modal-wrap 拦截导致 option-not-found）。
    if (!closed) {
      step("force-closing new-editor modal");
      const x2 = modal.locator(".ant-modal-close, .ant-drawer-close, .smt-new-editor-close, [class*=close]").first();
      if (await x2.count() > 0) await x2.click({ timeout: 5000, force: true }).catch(() => {});
      await this.page.keyboard.press("Escape").catch(() => {});
      await sleep(1200);
      closed = (await genBtnLocator()).count() === 0;
    }
    const mobileHasContent = await this.page.evaluate(() => {
      const i33 = window.CKEDITOR && window.CKEDITOR.instances["ckeditor33"];
      if (i33 && (i33.getData() || "").length > 50) return true;
      const items = Array.from(document.querySelectorAll(".ant-form-item"))
        .filter((it) => /无线端描述/.test((it.innerText || "").slice(0, 30)));
      const item = items[0];
      if (!item) return false;
      const frame = item.querySelector("iframe");
      if (frame && frame.contentDocument && frame.contentDocument.body)
        return (frame.contentDocument.body.innerText || "").length > 50;
      return item.innerText.length > 60;
    }).catch(() => false);

    result.closed = closed;
    result.generated = generated;
    result.mobileHasContent = mobileHasContent;
    result.ok = closed && (mobileHasContent || generated);
    step("done ok=" + result.ok + " closed=" + closed + " generated=" + generated + " mobileHasContent=" + mobileHasContent);
    return result;
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
    // 关键：日志写到 imageBaseDir 所在的产品包目录（始终存在），不再用全局 PRODUCT_IMAGES_DIR/../（当前产品/ 可能不存在）。
    // 老的全局路径在 PRODUCT_IMAGES_DIR 不存在时 writeFileSync 抛错被 try/catch 吞掉，导致完全无诊断信息。
    const LOG = path.join(this.imageBaseDir || PRODUCT_IMAGES_DIR, "..", "upload_debug.log");
    const ulog = (...a) => { try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `[${new Date().toISOString()}] ` + a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n"); } catch { /* ignore */ } };
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, ""); } catch { /* ignore */ }
    ulog("START upload count=", filePaths.length, "imageBaseDir=", this.imageBaseDir, filePaths.map((p) => path.basename(p)));

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
      if (!fp || !fs.existsSync(fp)) { ulog(`[${i}] SKIP missing file: ${fp}`); continue; }
      await this.dismissModals();
      const before = await mainCount();

      // 店小秘「本地图片」走原生文件选择器（Playwright filechooser）。逐张上传：
      // 点「选择图片」→ 下拉「本地图片」→ 捕获 filechooser → setFiles([单张]) → 主图区实时追加（无需网格选择/确定）。
      // 实测：6 张一次 setFiles 不稳定，逐张最稳；单张 setFiles 已验证 main 0→1→2… 可靠。
      const fcPromise = this.page.waitForEvent("filechooser", { timeout: 8000 }).catch(() => null);
      const trigger = this.page.locator(".productMainImgModule button:has-text('选择图片')").first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 8000 }).catch((e) => ulog(`[${i}] trigger err`, e.message.slice(0, 80)));
        await sleep(700);
        const localItem = this.page.locator(".ant-dropdown:visible .ant-dropdown-menu-item").filter({ hasText: "本地图片" }).last();
        if (await localItem.count()) {
          await localItem.click({ timeout: 5000 }).catch((e) => ulog(`[${i}] localItem err`, e.message.slice(0, 80)));
          ulog(`[${i}] clicked 本地图片`);
        } else {
          ulog(`[${i}] no 本地图片 dropdown item`);
        }
      }
      const fc = await fcPromise;
      if (!fc) { ulog(`[${i}] NO filechooser captured`); continue; }
      try {
        await fc.setFiles([fp]);
        ulog(`[${i}] setFiles ok: ${path.basename(fp)}`);
      } catch (e) {
        ulog(`[${i}] setFiles err`, e.message.slice(0, 80));
        continue;
      }
      // 等待主图区增加该图（店小秘上传后实时追加）
      let added = false;
      for (let w = 0; w < 12; w += 1) {
        await sleep(800);
        const after = await mainCount();
        if (after > before) { okCount = after; added = true; ulog(`[${i}] main ${before}->${after} added`); break; }
      }
      if (!added) ulog(`[${i}] main did NOT increase after upload (before=${before}, file=${path.basename(fp)})`);
      await this.dismissModals();
    }

    const finalv = await this.page.evaluate(() => {
      const m = document.querySelector(".productMainImgModule");
      if (!m) return { count: 0, real: 0, srcs: [] };
      const imgs = Array.from(m.querySelectorAll("img")).map((i) => i.getAttribute("src") || "").filter(Boolean);
      const isReal = (s) => s.length > 60 && !/placeholder|empty|default|svg\+xml/.test(s);
      return { count: imgs.length, real: imgs.filter(isReal).length, srcs: imgs };
    });
    ulog("FINAL", finalv);
    const realOk = finalv.real >= filePaths.length;
    return {
      ok: realOk,
      // 关键：返回 reason 让 server 端 / 前端日志能看到失败原因
      reason: realOk ? undefined : `real-thumbs-short: got ${finalv.real}/${filePaths.length} (clearedMain=${clearedMain})`,
      uploadedCount: filePaths.length,
      thumbnails: finalv.count,
      realThumbnails: finalv.real,
      clearedMain,
      clearedVideo,
      srcs: finalv.srcs
    };
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
  async fillAiSections(facts, options = {}) {
    await this.connect();
    const collectMode = !!(options && options.collectMode);
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
    // 3) 产品图片（AI 生成板块）。采集箱模式跳过：保留采集箱自带源图。
    if (!collectMode && facts.images && Array.isArray(facts.images.main) && facts.images.main.length) {
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
    // 4) 营销图片（AI 生成板块）。采集箱模式跳过。
    if (!collectMode && facts.images && Array.isArray(facts.images.marketing) && facts.images.marketing.length) {
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
      // 5.2 无线端描述：采集箱模式跳过「新版编辑器」弹窗——该弹窗关闭不可靠时会残留并拦截后续
      //      必填字段（如备货类型下拉被 ant-modal-wrap 拦截致 option-not-found）。无线端内容非保存必填项
      //      （save 读回已不校验 mobile），留空即可存草稿。引用模式仍走一键生成。
      if (!collectMode) {
        const mbRes = await this.clickNewEditorThenGenerateFromPc();
        applied.push({ field: "description.mobile", ...mbRes });
      } else {
        applied.push({ field: "description.mobile", ok: true, skipped: true, reason: "collect-mode-skip" });
      }
    }
    return applied;
  }

  // 引用模式下的「基于资料文档覆盖填写」。
  // 前提：已 referenceProduct(id) 引用源产品，表单已带出 类目 + 类目属性 + 品牌/材质/SKU 骨架（乳贴）。
  // 箱包(xiangBao)：只填「AI 生成板块」(fillAiSections) + 物流属性；变种板块人工填写，本系统不触。
  // 乳贴(ruTie)：沿用历史完整闭环（类目属性补全 + 物流 + 主图 + 销售属性 + SKU + 每色图）。
  async fillFromFacts(facts, options = {}) {
    await this.connect();
    // 采集箱模式：保留采集箱自带源图，只填文字/属性/描述/合规，跳过一切图片上传。
    const collectMode = !!(options && options.collectMode);
    const isXiangBao = isXiangBaoProfile(this.profile);
    if (isXiangBao) {
      const applied = [];
      applied.push(...(await this.fillAiSections(facts, { collectMode })));
      // 备货类型（必填，采集箱草稿不预填）。非致命：填不上由 save 读回暴露。
      applied.push({ field: "stockingType", ...(await this.fillStockingType(this.profile.stockingType || "国内履约")) });
      // 物流属性（必填，引用不携带；箱包默认普货）。弹窗选择，非致命。
      applied.push({ field: "logistics", ...(await this.fillLogisticsAttribute(this.profile.logistics || "普货")) });
      // 销售属性：按 facts.variants 勾选颜色/尺寸（箱包以颜色区分 SKU）
      applied.push({ field: "salesAttrs", ...(await this.fillSalesAttributes(facts)) });
      await sleep(800);
      // 每色自定义名称 + 每色图（仅当 facts.variants.colorMap 存在时）。采集箱模式跳过（不覆盖源图）。
      if (!collectMode) {
        try {
          applied.push({ field: "colorCustom", ...(await this.fillColorCustomNamesAndImages(facts)) });
        } catch (e) {
          applied.push({ field: "colorCustom", ok: false, reason: e.message });
        }
      }
      // 合规信息（欧盟责任人/土耳其责任人/品牌制造商）
      applied.push(...(await this.fillComplianceInfo(facts)));
      // 采集箱兜底：facts 缺必填项时填默认值，确保能存草稿（颜色变种 + 产品属性通用兜底）。
      if (collectMode) {
        try {
          const vd = await this.ensureDefaultVariantColor();
          applied.push({ field: "variantDefault", ...vd });
        } catch (e) { applied.push({ field: "variantDefault", ok: false, reason: e.message }); }
        try {
          const pattr = await this.fillProductAttributes(facts);
          for (const f of (pattr.fields || [])) applied.push({ field: "attr:" + f.field, ...f });
        } catch (e) { applied.push({ field: "attr", ok: false, reason: e.message }); }
        // 迭代自动兜底：保存 → 读校验错误 → 逐个填默认值 → 再保存，直到无错或达到轮次上限。
        let saved = false;
        for (let round = 1; round <= 3 && !saved; round += 1) {
          const sv = await this.save();
          applied.push({ field: "save", round, saved: sv.saved, level: sv.level, message: sv.message, errorText: sv.errorText || "" });
          if (sv.saved) { saved = true; break; }
          const errs = await this.readValidationErrors();
          if (!errs.length) break;
          const handled = new Set();
          for (const e of errs) {
            const lbl = e.label;
            if (!lbl || handled.has(lbl)) continue;
            handled.add(lbl);
            const core = lbl.replace(/[（(].*?[)）]/g, "").trim();
            try {
              const r = await this.fillFieldDefaultByLabel(core || lbl);
              applied.push({ field: "autofix:" + (core || lbl), ...r });
            } catch (ex) { applied.push({ field: "autofix:" + (core || lbl), ok: false, reason: ex.message }); }
          }
          await sleep(900);
        }
      }
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
    // 5) 产品主图（覆盖上传；产品图目录下的文件名拼 this.imageBaseDir，支持子目录与后缀兜底）。
    //    采集箱模式跳过：保留采集箱自带源图，不覆盖主图与每色图。
    if (!collectMode && facts.images && Array.isArray(facts.images.main) && facts.images.main.length) {
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
    //      采集箱模式跳过（保留源图）。
    if (!collectMode) {
      try {
        const colorImg = await this.fillColorImages(facts);
        applied.push({ field: "colorImages", ...colorImg });
      }
      catch (e) {
        applied.push({ field: "colorImages", ok: false, reason: e.message });
      }
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

  // 箱包类目：按 facts.variants.colorMap 为每个颜色填「自定义名称」并上传对应图片。
  // 前提：颜色 checkbox 已由 fillSalesAttributes 勾选；本方法只操作颜色属性区下方的每色表格。
  // 表格格式：colorMap = [{ color, customName, image }]；image 为已完成产品包目录下的图片文件名。
  async fillColorCustomNamesAndImages(facts) {
    const v = facts && facts.variants;
    const colorMap = (v && Array.isArray(v.colorMap)) ? v.colorMap : [];
    if (!colorMap.length) return { ok: true, skipped: true, reason: "no-color-map" };
    const colorItem = this.page.locator(".ant-form-item").filter({
      has: this.page.locator(".ant-form-item-label label, label").filter({
        hasText: /^\s*颜色\s*(\(Color\))?\s*$/i
      })
    });
    const results = [];
    for (const { color, customName, image } of colorMap) {
      const res = { color, customSet: false, imageUploaded: false };
      try {
        if (!color) { res.reason = "empty-color"; results.push(res); continue; }
        // 颜色行匹配：去掉括号后比较，兼容「古铜色（Bronze）」与表格里「古铜色」
        const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "");
        const rows = await colorItem.locator("tr, .ant-table-row").all();
        let row = null;
        for (const r of rows) {
          const txt = await r.innerText().catch(() => "");
          if (norm(txt).includes(norm(color))) { row = r; break; }
        }
        if (!row) { res.reason = "row-not-found"; results.push(res); continue; }
        await row.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(400);
        if (customName) {
          const input = row.locator('input[type=text], input:not([type])').first();
          if (await input.count()) {
            await input.click({ timeout: 3000 }).catch(() => {});
            await input.fill(String(customName), { timeout: 5000 });
            await input.evaluate((el) => {
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await sleep(300);
            res.customSet = true;
          }
        }
        if (image) {
          const local = resolveImagePath(this.imageBaseDir, image);
          let exists = false;
          try { exists = !!local && fs.existsSync(local); } catch { /* ignore */ }
          if (!exists) {
            res.imageError = "file-not-found";
          } else {
            const btn = row.locator("button").filter({ hasText: /选择图片|上传图片/ }).first();
            if (await btn.count()) {
              await btn.click({ timeout: 5000 });
              await sleep(2200);
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
                try {
                  const all = await this.page.$$('input[type=file]');
                  await all[modalFileIdx].setInputFiles(local);
                  await sleep(3500);
                  res.imageUploaded = true;
                } catch (e) { res.imageError = "upload-failed:" + e.message; }
              } else {
                res.imageError = modalFileIdx === -2 ? "no-file-input-in-modal" : "modal-not-found";
              }
              await this.page.keyboard.press("Escape").catch(() => {});
              await sleep(800);
            } else {
              res.imageError = "no-image-btn";
            }
          }
        }
        res.ok = res.customSet || res.imageUploaded || (!customName && !image);
        results.push(res);
      } catch (e) {
        res.ok = false;
        res.reason = e.message;
        results.push(res);
      }
    }
    const allOk = results.every((r) => r.ok !== false);
    return { ok: allOk, attempted: results.length, results };
  }

  // 销售属性（颜色/尺寸）必填勾选：从 facts.variants 勾选店小秘分类 checkbox（点 label 触发 React onChange）。
  // 颜色为实操必填（靠颜色区分子 SKU）；尺寸按 facts 默认（One Size），并取消引用带出的多余项。
  // 本步骤非实验性、必跑（在 fillSkus 之前，因为「生成SKU」依赖已勾选的销售属性）。
  async fillSalesAttributes(facts) {
    const v = facts && facts.variants;
    const colors = v && Array.isArray(v.colors) && v.colors.length ? v.colors : null;
    const sizes = v && Array.isArray(v.sizes) && v.sizes.length ? v.sizes : null;
    if (!colors && !sizes) return { ok: true, skipped: true, reason: "no-colors-or-sizes-in-facts" };
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "").trim();
    const isMatch = (labelText, wantList) => {
      const t = norm(labelText);
      const bare = t.replace(/[()（）].*$/, ""); // 去掉括号及之后的内容
      return wantList.some((w) => {
        const wn = norm(w);
        return t.includes(wn) || (wn.includes(bare) && bare.length > 0) || bare.includes(wn);
      });
    };
    const toggleGroup = async (groupLabel, wantList) => {
      if (!wantList || !wantList.length) return { skipped: true };
      // 找到属性组容器：优先匹配 label 文本为「颜色(Color)」或「尺寸(Size)」的 .ant-form-item
      const item = this.page.locator(".ant-form-item").filter({
        has: this.page.locator(".ant-form-item-label label, label").filter({
          hasText: new RegExp(`^\\s*${groupLabel}\\s*(\\(Color\\)|\\(Size\\))?\\s*$`, "i")
        })
      }).first();
      if (await item.count() === 0) return { error: "group-not-found" };
      await item.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(500);
      // 拿到该组下所有 checkbox 包装 label
      const wraps = await item.locator(".ant-checkbox-wrapper, label:has(input[type=checkbox])").all();
      const states = [];
      for (const wrap of wraps) {
        const txt = await wrap.innerText().catch(() => "");
        const input = wrap.locator("input[type=checkbox]").first();
        const checked = await input.isChecked().catch(() => false);
        states.push({ wrap, text: txt.trim(), checked, want: isMatch(txt, wantList) });
      }
      // pass1: 勾选目标
      let matched = 0;
      for (const st of states) {
        if (st.want && !st.checked) {
          await st.wrap.click({ timeout: 5000 }).catch(() => {});
          await sleep(600);
          matched++;
        } else if (st.want && st.checked) {
          matched++;
        }
      }
      // pass2: 仅当成功匹配到目标后，才取消引用带出的多余项
      const unchecked = [];
      if (matched > 0) {
        for (const st of states) {
          if (!st.want && st.checked) {
            await st.wrap.click({ timeout: 5000 }).catch(() => {});
            await sleep(600);
            unchecked.push(st.text);
          }
        }
      }
      return { matched, unchecked, total: states.length };
    };
    const colorRes = colors ? await toggleGroup("颜色", colors) : { skipped: true };
    const sizeRes = sizes ? await toggleGroup("尺寸", sizes) : { skipped: true };
    const colorOk = !colorRes.error && (colorRes.matched || 0) > 0;
    const sizeOk = !sizeRes.error && (sizeRes.skipped || (sizeRes.matched || 0) > 0);
    return { ok: colorOk && sizeOk, colors: colorRes, sizes: sizeRes };
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

  // 备货类型（速卖通 Choice 半托管必填）：国内履约 / 海外备货。店小秘用 Ant Select。
  // 采集箱编辑草稿默认不预填，需手动选择；否则保存报「请选择备货类型」。
  // 非致命：找不到字段/选项只记日志，不中断整体流程（缺它店小秘会拒绝保存，由 save 读回暴露）。
  async fillStockingType(defaultValue = "国内履约") {
    await this.connect();
    try {
      const item = this.page.locator(".ant-form-item").filter({
        has: this.page.locator(".ant-form-item-label label, label").filter({ hasText: /备货类型/ })
      }).first();
      if (await item.count() === 0) return { ok: false, reason: "field-not-found" };
      const sel = item.locator(".ant-select").first();
      if (await sel.count() === 0) return { ok: false, reason: "select-not-found" };
      // 该 Select 点击常被遮挡，用 force 打开下拉
      await sel.click({ timeout: 5000, force: true }).catch(() => {});
      await sleep(1200);
      const candidates = Array.from(new Set([defaultValue, "国内履约", "海外备货"].filter(Boolean)));
      let clicked = false;
      for (const c of candidates) {
        const opt = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content, .ant-select-dropdown:visible .ant-select-item-option").filter({ hasText: c }).first();
        if (await opt.count() > 0 && await opt.isVisible().catch(() => false)) {
          await opt.click({ timeout: 5000 }).catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) { await this.page.keyboard.press("Escape").catch(() => {}); return { ok: false, reason: "option-not-found" }; }
      await sleep(600);
      return { ok: true, value: defaultValue };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // 切到锚点 tab（基本信息/属性信息/变种参数/变种信息…）。店小秘编辑表单是 tab 结构，
  // 不同必填项分布在不同 tab，填之前先确保对应 tab 激活。
  async clickAnchorTab(name) {
    await this.connect();
    const tab = this.page.locator("a, div, span, li").filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
    if (await tab.count() > 0) { await tab.click({ timeout: 5000 }).catch(() => {}); await sleep(1300); return true; }
    return false;
  }

  // 产品属性兜底（采集箱模式必填项常为空）：通用填充「产品属性」控件内所有空 Ant-Select / 空 input。
  // 这些在「产品属性」控件点开后才渲染（required-attrs 初始为空），故先点开控件。
  // 策略：每个空 select 优先选 NONE/None/无/否/default 类兜底项，否则选第一个可用项；
  // 空 input（重量/型号等）填安全默认值。覆盖 品牌/类型/材质/高关注化学品/产地/来源地/重量/型号 等任意类目属性。
  async fillProductAttributes(facts) {
    await this.connect();
    const result = { ok: true, fields: [] };
    const pickDefaultOption = async (selLocator) => {
      await selLocator.click({ force: true, timeout: 6000 }).catch(() => {});
      await sleep(1500);
      const allOpts = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content");
      const n = await allOpts.count();
      let chosen = null;
      if (n > 0) {
        // 优先 NONE/None/无/否/default
        const preferred = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content")
          .filter({ hasText: /NONE|None|无|否|default/i }).first();
        const target = (await preferred.count() > 0) ? preferred : allOpts.first();
        chosen = (await target.innerText()).trim();
        await target.click({ timeout: 6000 }).catch(() => {});
      }
      await sleep(400);
      await this.page.keyboard.press("Escape").catch(() => {});
      await sleep(400);
      return chosen;
    };

    try {
      await this.clickAnchorTab("属性信息").catch(() => {});
      const ctrl = this.page.locator(".product-attrs, .attr-gray-container").first();
      if (await ctrl.count() > 0) await ctrl.click({ timeout: 5000 }).catch(() => {});
      await sleep(2000);
    } catch (_) {}

    const rows = await this.page.locator(".product-attrs .ant-form-item, .attr-gray-container .ant-form-item, .required-attrs .ant-form-item").all();
    for (const row of rows) {
      const label = (await row.locator(".ant-form-item-label label, label").first().innerText().catch(() => "")).trim();
      if (!label) continue;
      // 已经填了值的 select 跳过（如 品牌 已 NONE）
      const sel = row.locator(".ant-select").first();
      const selCount = await sel.count();
      if (selCount > 0) {
        const cur = await sel.locator(".ant-select-selection-item, .ant-select-selection-item-content").first().innerText().catch(() => "");
        if (cur && cur.trim()) { result.fields.push({ field: label, ok: true, skipped: true, value: cur.trim() }); continue; }
        try {
          const chosen = await pickDefaultOption(sel);
          if (chosen) result.fields.push({ field: label, ok: true, value: chosen });
          else { result.fields.push({ field: label, ok: false, reason: "no-option" }); result.ok = false; }
        } catch (e) { result.fields.push({ field: label, ok: false, reason: e.message }); result.ok = false; }
        await sleep(500);
      } else {
        // 非 select：尝试填 input（重量/型号等）
        const inp = row.locator("input:not([type=hidden]), textarea").first();
        if (await inp.count() > 0) {
          const cur = await inp.inputValue().catch(() => "");
          if (cur && cur.trim()) { result.fields.push({ field: label, ok: true, skipped: true, value: cur.trim() }); continue; }
          const def = /重量|weight/i.test(label) ? "0.1" : (/型号|model/i.test(label) ? "通用" : "无");
          try {
            await inp.click({ timeout: 4000 }).catch(() => {});
            await inp.fill(def, { timeout: 4000 }).catch(() => {});
            await sleep(400);
            result.fields.push({ field: label, ok: true, value: def });
          } catch (e) { result.fields.push({ field: label, ok: false, reason: e.message }); result.ok = false; }
        }
      }
    }
    return result;
  }

  // 变种颜色兜底（采集箱模式 facts 缺 colors 时）：勾选 颜色(Color) 组里第一个未勾选的颜色，
  // 避免「请选择必选变种属性」。优先 checkbox 包裹，否则直接点颜色 chip。
  async ensureDefaultVariantColor() {
    await this.connect();
    try {
      await this.clickAnchorTab("变种参数").catch(() => {});
      const item = this.page.locator(".ant-form-item").filter({
        has: this.page.locator(".ant-form-item-label label, label").filter({ hasText: /^颜色\s*\(Color\)\s*$/i })
      }).first();
      if (await item.count() === 0) return { ok: false, reason: "color-group-not-found" };
      await item.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(700);
      let wraps = await item.locator(".ant-checkbox-wrapper, label:has(input[type=checkbox])").all();
      let clicked = null;
      for (const wrap of wraps) {
        const input = wrap.locator("input[type=checkbox]").first();
        const checked = await input.isChecked().catch(() => false);
        if (!checked) {
          const txt = (await wrap.innerText().catch(() => "")).trim();
          await wrap.click({ timeout: 5000 }).catch(() => {});
          await sleep(700);
          clicked = txt || "checked";
          break;
        }
      }
      if (!clicked) {
        const chip = await item.evaluate(() => {
          const block = document.querySelector(".sku-attrs-container");
          if (!block) return null;
          const cb = Array.from(block.children).find(c => /颜色\(Color\)/.test(c.innerText || ""));
          if (!cb) return null;
          const c = Array.from(cb.querySelectorAll("span, div, a, label")).find(el => { const t = (el.innerText || "").trim(); return /\(/.test(t) && el.children.length === 0 && t.length < 40 && !/^颜色/.test(t); });
          if (c) { c.click(); return (c.innerText || "").trim(); }
          return null;
        }).catch(() => null);
        if (chip) { clicked = chip; await sleep(700); }
      }
      if (!clicked) return { ok: true, skipped: true, reason: "all-checked-or-no-chip" };
      return { ok: true, value: clicked };
    } catch (e) { return { ok: false, reason: e.message }; }
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
    // 店小秘自身结果判定：
    //  - 明确失败：捕获到校验错误文本（如「请选择备货类型」「产品信息中有错误」）→ 直接判失败；
    //  - 明确成功：捕获到成功 toast → 信任店小秘；
    //  - 含糊（无 toast 无错误）：才用下方读回硬校验兜底。
    // 关键修复：无线端描述是「新版模块编辑器」，内容以模块形式存在，ckeditor33 恒为空，
    // 旧逻辑会据此误判 mobile-desc-empty 把店小秘已成功的保存翻转为失败。故店小秘明确成功时不再被子读回否决。
    const shopFailed = !!(readback.errorToast || readback.errorText);
    const shopOk = !!readback.successToast;
    const saved = !shopFailed && (shopOk || (!readback.errorToast && !readback.errorText));
    // 读回校验：保存后实际页面状态（防止「无 toast + 无 error」→ 假成功）。
    // 必查：主图区真实张数、PC端/无线端 ckeditor 实际内容长度。
    // 引用模板自带 1 张占位图（thumbnail 计入，real 不会算它），故 realThumbnails >= 1 才算「有图」。
    let readbackCheck = { mainReal: 0, pcLen: 0, mobileLen: 0, ok: true, reason: "" };
    try {
      readbackCheck = await this.page.evaluate(() => {
        const m = document.querySelector(".productMainImgModule");
        const imgs = m ? Array.from(m.querySelectorAll("img")) : [];
        const realImgs = imgs.filter((i) => {
          const s = i.getAttribute("src") || "";
          return s.length > 60 && !/placeholder|empty|default|svg\+xml/.test(s);
        });
        // PC 端 ckeditor：优先 window.CKEDITOR.instances[id]，否则从 iframe 取 body 文本长度
        const getCkLen = (id) => {
          if (window.CKEDITOR && window.CKEDITOR.instances && window.CKEDITOR.instances[id]) {
            return (window.CKEDITOR.instances[id].getData() || "").length;
          }
          return 0;
        };
        const pcLen = getCkLen("ckeditor1") || getCkLen("ckeditor01") || getCkLen("PC端描述") || 0;
        const mobileLen = getCkLen("ckeditor33") || getCkLen("ckeditor3") || getCkLen("无线端描述") || 0;
        // 退路：从表单 item 内文本里抓
        const findText = (re) => {
          const it = Array.from(document.querySelectorAll(".ant-form-item")).find((x) => re.test((x.innerText || "").slice(0, 30)));
          if (!it) return 0;
          const f = it.querySelector("iframe");
          if (f && f.contentDocument && f.contentDocument.body) {
            return (f.contentDocument.body.innerText || "").length;
          }
          return (it.innerText || "").length;
        };
        const pcLen2 = pcLen || findText(/PC端描述/);
        const mobileLen2 = mobileLen || findText(/无线端描述/);
        return { mainReal: realImgs.length, pcLen: pcLen2, mobileLen: mobileLen2 };
      });
    } catch (_e) {
      readbackCheck = { mainReal: -1, pcLen: -1, mobileLen: -1 };
    }
    // 强制最低门槛（仅当店小秘结果含糊时用于兜底判失败）：实际有真实主图 + PC 端文本非空。
    // 无线端描述用「新版模块编辑器」，ckeditor33 恒空，故不再把 mobile 空视为失败（避免 false-negative）。
    const hardIssues = [];
    if (readbackCheck.mainReal < 1) hardIssues.push(`main-img-empty(${readbackCheck.mainReal})`);
    if (readbackCheck.pcLen < 50) hardIssues.push(`pc-desc-empty(${readbackCheck.pcLen})`);
    let finalSaved;
    if (shopFailed) finalSaved = false;
    else if (shopOk) finalSaved = true;
    else finalSaved = (hardIssues.length === 0);
    if (hardIssues.length) readbackCheck.reason = hardIssues.join(",");
    readbackCheck.ok = finalSaved;
    const level = (readback.errorToast || readback.errorText || hardIssues.length) ? "err" : (finalSaved ? "ok" : "unknown");
    const message = readback.errorToast || readback.errorText
      ? (readback.errorToast || readback.errorText)
      : (readback.successToast || (finalSaved ? "保存成功（无错误提示，草稿已存待发布）" : (hardIssues.length ? `读回校验失败: ${hardIssues.join(", ")}（店小秘保存成功但页面实际为空）` : "已点击保存，未捕获提示，请人工到待发布页确认草稿")));
    return {
      clicked: label,
      saved: finalSaved,
      level,
      message,
      urlBefore,
      urlAfter,
      urlChanged,
      successToast: readback.successToast || "",
      errorToast: readback.errorToast || "",
      errorText: readback.errorText || "",
      readback: readbackCheck,
      hardIssues
    };
  }

  // 读取当前编辑表单上所有字段级校验错误，返回 [{label, hint}]。
  // label=出错的 .ant-form-item 的 label（无则空）；hint=错误短语。用于保存失败后的迭代自动兜底。
  async readValidationErrors() {
    await this.connect();
    return await this.page.evaluate(() => {
      const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
      const errs = [];
      for (const e of document.querySelectorAll(".ant-form-item-explain-error")) {
        const t = clean(e.innerText);
        if (t) errs.push({ label: "", hint: t });
      }
      for (const it of document.querySelectorAll(".ant-form-item")) {
        const t = clean(it.innerText);
        if (/请选择|必填|不能为空|校验失败|不完整|至少选择一项/.test(t)) {
          const label = clean(it.querySelector(".ant-form-item-label label, label")?.innerText);
          if (label) errs.push({ label, hint: t.slice(0, 50) });
        }
      }
      for (const el of document.querySelectorAll(".ant-modal-body, .d-modal-body")) {
        const t = clean(el.innerText);
        if (/校验失败|保存失败|请完善|必填项|不完整/.test(t)) errs.push({ label: "", hint: t.slice(0, 80) });
      }
      return errs;
    });
  }

  // 按 label 关键词定位字段并填一个安全默认值（用于保存失败后的迭代兜底）：
  //  - Ant-Select → 选 NONE/None/无/否/default 或第一个选项；
  //  - 复选框组（颜色必选等）→ 勾选第一个未勾选；
  //  - input → 填安全默认（重量=0.1 / 型号=通用 / 其他=无）。
  // 已知分布在不同 tab 的字段会先切到对应 tab。返回 {ok, value/skipped/reason}。
  async fillFieldDefaultByLabel(label) {
    await this.connect();
    const TAB_HINTS = {
      "尺码表": "基本信息", "海关监管属性": "基本信息", "计件单位": "基本信息",
      "欧盟责任人": "合规信息", "土耳其责任人": "合规信息", "品牌制造商": "合规信息",
      "颜色": "变种参数",
    };
    const core = String(label || "").replace(/[（(].*?[)）]/g, "").trim();
    for (const [kw, tab] of Object.entries(TAB_HINTS)) {
      if (core.includes(kw)) { await this.clickAnchorTab(tab).catch(() => {}); await sleep(900); break; }
    }
    // 1) 产品属性控件内的 attr（XPath 锚定 attr-label）
    let item = this.page.locator(`xpath=//span[contains(@class,'attr-label') and contains(.,'${core}')]/ancestor::div[contains(@class,'ant-form-item')]`).first();
    if (await item.count() === 0) {
      // 2) 普通 form-item by label 文本
      item = this.page.locator(".ant-form-item").filter({ has: this.page.locator(".ant-form-item-label label, label").filter({ hasText: core }) }).first();
    }
    if (await item.count() === 0) return { ok: false, reason: "field-not-found:" + label };
    const sel = item.locator(".ant-select").first();
    if (await sel.count() > 0) {
      const cur = await sel.locator(".ant-select-selection-item, .ant-select-selection-item-content").first().innerText().catch(() => "");
      if (cur && cur.trim()) return { ok: true, skipped: true, value: cur.trim() };
      await sel.click({ force: true, timeout: 6000 }).catch(() => {});
      await sleep(1400);
      const allOpts = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content");
      if (await allOpts.count() > 0) {
        const preferred = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: /NONE|None|无|否|default/i }).first();
        const target = (await preferred.count() > 0) ? preferred : allOpts.first();
        const chosen = (await target.innerText()).trim();
        await target.click({ timeout: 6000 }).catch(() => {});
        await sleep(400);
        await this.page.keyboard.press("Escape").catch(() => {});
        await sleep(400);
        return { ok: true, value: chosen };
      }
      await this.page.keyboard.press("Escape").catch(() => {});
      return { ok: false, reason: "no-option" };
    }
    const cb = item.locator(".ant-checkbox-wrapper").first();
    if (await cb.count() > 0) {
      const wraps = await item.locator(".ant-checkbox-wrapper, label:has(input[type=checkbox])").all();
      for (const wrap of wraps) {
        const input = wrap.locator("input[type=checkbox]").first();
        if (!(await input.isChecked().catch(() => false))) {
          await wrap.click({ timeout: 5000, force: true }).catch(() => {});
          await sleep(500);
          return { ok: true, value: (await wrap.innerText().catch(() => "")).trim() };
        }
      }
      return { ok: true, skipped: true, reason: "all-checked" };
    }
    const inp = item.locator("input:not([type=hidden]), textarea").first();
    if (await inp.count() > 0) {
      const cur = await inp.inputValue().catch(() => "");
      if (cur && cur.trim()) return { ok: true, skipped: true, value: cur.trim() };
      const def = /重量|weight/i.test(core) ? "0.1" : (/型号|model/i.test(core) ? "通用" : "无");
      await inp.click({ timeout: 4000 }).catch(() => {});
      await inp.fill(def, { timeout: 4000 }).catch(() => {});
      await sleep(400);
      return { ok: true, value: def };
    }
    return { ok: false, reason: "no-fillable-control" };
  }

  async close() {
    // 关闭 CDP 连接释放资源（下次 connect() 会重新连接）
    if (this.browser) { await this.browser.close().catch(() => {}); }
    this.browser = null;
    this.page = null;
  }

  // ───────────────────────── 采集箱批量上架（v 新路径） ─────────────────────────
  // 路径：打开「速卖通全托管采集箱」草稿列表 → 搜标题 → 点编辑 → 填 facts（保留源图）→ 保存不发布。
  // 采集箱编辑表单与 smtChoice/add 同源组件，fillFromFacts 复用；本段只负责「列表页导航 + 行定位」。

  // 打开采集箱草稿列表页（smtChoice/draft）。
  async openCollectBox() {
    await this.connect();
    // 清理：关闭除 this.page 外的所有店小秘标签页，确保每行都在干净单一标签上从采集箱草稿列表开始，
    // 避免上一行「编辑分类/保存下一步」留下的 /web/smtChoice/edit 标签被 connect 误选为「第一个页」。
    await this._closeExtraDianxiaomiTabs().catch(() => {});
    const url = DIANXIAOMI_URL_CHOICE_DRAFT;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(2000);
    return { ok: true, url: this.page.url() };
  }

  // 在采集箱列表页的搜索框输入标题并触发搜索。
  async searchCollectBox(title) {
    await this.connect();
    if (!title || !title.trim()) throw new Error("采集箱搜索：标题为空");
    const sel = await this.page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input")).filter((i) => i.offsetParent !== null && i.type === "text");
      // 1) 店小秘采集箱标题搜索框有稳定 name="tableSearchInput"，优先命中
      const byName = inputs.find((i) => i.name === "tableSearchInput");
      if (byName) return 'input[name="tableSearchInput"]';
      // 2) placeholder 含 搜索/标题/关键词/查询
      const byPh = inputs.find((i) => /搜索|标题|关键词|查询/i.test(i.getAttribute("placeholder") || ""));
      if (byPh) return byPh.id ? "#" + byPh.id : `input[placeholder="${byPh.getAttribute("placeholder")}"]`;
      // 3) 回退：列表页顶部第一个可见 text input（排除 ant-select 内部搜索框）
      const fb = inputs.find((i) => !/ant-select|rc_select/i.test(i.className || ""));
      if (fb) return fb.id ? "#" + fb.id : (fb.getAttribute("placeholder") ? `input[placeholder="${fb.getAttribute("placeholder")}"]` : ".__collect_search_fallback__");
      return null;
    });
    if (!sel) throw new Error("采集箱：找不到搜索输入框");
    let box = this.page.locator(sel).first();
    if (sel === ".__collect_search_fallback__") {
      box = this.page.locator("input[type=text]").filter({ hasNot: this.page.locator("[class*=ant-select]") }).first();
    }
    await box.click({ timeout: 5000 }).catch(() => {});
    await box.fill("", { timeout: 5000 }).catch(() => {});
    try {
      await box.fill(title, { timeout: 5000 });
    } catch {
      await box.click({ timeout: 5000 });
      await this.page.keyboard.type(title, { delay: 30 });
    }
    await sleep(500);
    // 触发搜索：先回车，再尝试点「搜索」按钮（二者择一）
    await this.page.keyboard.press("Enter").catch(() => {});
    await clickVisibleByText(this.page, "搜索", 4000).catch(() => {});
    // 等待表格重新加载（店小秘用 vxe-table，通过行数变化或 loading 消失判断）
    await this.page.waitForFunction(
      () => document.querySelectorAll("tbody tr, .vxe-table--body-wrapper tr").length > 0 && !document.querySelector(".vxe-table--loading"),
      { timeout: 15000 }
    ).catch(() => {});
    await sleep(1500);
    return { ok: true };
  }

  // 在搜索结果中定位含标题的行并点击其「编辑」按钮。
  // 店小秘采集箱点「编辑」后会在当前页弹出提示框（编辑分类 / 跳过，去编辑产品），
  // 不是直接新开标签页，故本函数只负责定位并点击，后续由 fillCollectDraftCategory 处理弹窗。
  async openCollectDraftByTitle(title) {
    await this.connect();

    const found = await this.page.evaluate((t) => {
      const norm = (s) => (s || "").replace(/\s+/g, "").trim().toLowerCase();
      const keywords = (s) => norm(s).split(/[^\u4e00-\u9fa5a-z0-9]+/).filter(Boolean);
      const tk = keywords(t);
      const rows = Array.from(document.querySelectorAll("tr")).filter((r) => r.querySelector("td"));
      let bestRowText = "", bestScore = 0;
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll("td"));
        // 优先取看起来是标题的单元格（文本较长），否则取整行文本
        const titleCells = cells.filter((td) => (td.innerText || "").length > 8);
        const candidates = titleCells.length ? titleCells : cells;
        let rowScore = 0;
        let rowTitle = "";
        for (const td of candidates) {
          const ct = norm(td.innerText);
          const ck = keywords(td.innerText);
          let score = 0;
          if (ct && (ct === norm(t) || ct.includes(norm(t)) || norm(t).includes(ct))) {
            score = Math.max(score, ct === norm(t) ? 4 : (ct.includes(norm(t)) ? 3 : 2));
          }
          // 关键词交集比例（中文/英文词）
          const inter = ck.filter((w) => tk.includes(w)).length;
          if (tk.length && inter) {
            const ratio = inter / Math.max(tk.length, ck.length);
            score = Math.max(score, ratio * 2);
          }
          if (score > rowScore) { rowScore = score; rowTitle = (td.innerText || "").trim(); }
        }
        if (rowScore < 0.3) continue;
        const btns = Array.from(r.querySelectorAll("button, a")).filter((b) => /编辑/.test(b.innerText || ""));
        if (!btns.length) continue;
        if (rowScore > bestScore) { bestScore = rowScore; bestRowText = rowTitle; }
      }
      if (!bestRowText) return { ok: false };
      return { ok: true, score: bestScore, rowTitle: bestRowText.slice(0, 80) };
    }, title);

    if (!found.ok) {
      throw new Error(`采集箱：搜索结果中未找到含标题「${title}」的行 / 编辑按钮，请把表格「搜索标题」改成采集箱里的真实标题`);
    }
    if (found.score < 0.5) {
      throw new Error(`采集箱：标题「${title}」与搜索结果匹配度过低(score=${found.score.toFixed(2)})，请核对表格「搜索标题」`);
    }

    // 用 Playwright 真实点击行内「编辑」按钮（Vue/Ant 需要真实鼠标事件）。
    // 点击后店小秘可能：① 新开「编辑」标签页（最常见）；② 本页弹「编辑分类/跳过」modal；③ 本页直接跳编辑表单。
    // 由于浏览器原生 window.open 的新标签不一定触发 Playwright 的 page 事件，这里改为【轮询 browser 所有 page】
    // 检测是否出现新的 /web/smtChoice/edit 标签（用 page 对象身份而非 URL 判定，因为同商品 edit 标签 URL 相同）。
    let targetPage = null;
    let modalOnCurrent = false;
    let samePageEdit = false;
    let lastErr = "";
    const isEditNow = async (p) => p.evaluate(() => /(产品标题|商品标题|quoteEdit|productEdit)/.test((document.body && document.body.innerText) || "") || /quoteEdit|productEdit/.test(location.href)).catch(() => false);
    const listPages = () => this.browser.contexts().flatMap((c) => c.pages().filter((p) => !p.isClosed()));
    const findEditBtn = async () => {
      const h = await this.page.evaluateHandle((t) => {
        const norm = (s) => (s || "").replace(/\s+/g, "").trim().toLowerCase();
        const tn = norm(t);
        const rows = Array.from(document.querySelectorAll("tr")).filter((r) => r.querySelector("td"));
        for (const r of rows) {
          if (!r.innerText || !norm(r.innerText).includes(tn)) continue;
          const btns = Array.from(r.querySelectorAll("button, a")).filter((b) => {
            const bt = (b.innerText || "").trim();
            return bt === "编辑" || /编辑产品|编辑草稿/.test(bt) || (/编辑/.test(bt) && !/编辑分类|编辑映射|编辑类目/.test(bt));
          });
          if (btns.length) return btns[0];
        }
        return null;
      }, title);
      return h.asElement();
    };
    // 清理上一轮残留的 edit 标签（避免累积导致 connect 卡死）
    for (const p of listPages()) { if (p !== this.page && /web\/smtChoice\/edit/.test(p.url())) { await p.close().catch(() => {}); } }
    await sleep(600);
    for (let attempt = 1; attempt <= 3 && !targetPage && !modalOnCurrent && !samePageEdit; attempt += 1) {
      const beforeAttempt = new Set(listPages());
      // 若上一轮残留 modal 仍开着，先关掉再点（否则再点编辑可能被 modal 遮挡）。
      const staleModal = await this.page.$(".ant-modal").catch(() => null);
      if (staleModal) { await this.page.keyboard.press("Escape").catch(() => {}); await sleep(400); }
      const editBtn = await findEditBtn();
      if (!editBtn) { lastErr = "edit-btn-not-found"; await sleep(800); continue; }
      await editBtn.scrollIntoViewIfNeeded().catch(() => {});
      await editBtn.click({ timeout: 8000, force: true }).catch(async (e) => {
        lastErr = String(e && e.message || e);
        // 兜底：页面内第一个精确「编辑」按钮
        await this.page.locator("button, a").filter({ hasText: /^编辑$/ }).first().click({ timeout: 5000, force: true }).catch((e2) => { lastErr = String(e2 && e2.message || e2); });
      });
      // 轮询检测新标签 / modal / 本页跳编辑表单（最多 ~14s）
      let detected = false;
      for (let i = 0; i < 28 && !detected; i += 1) {
        const pages = listPages();
        const newEdit = pages.find((p) => /web\/smtChoice\/edit/.test(p.url()) && !beforeAttempt.has(p) && !p.isClosed());
        if (newEdit) { targetPage = newEdit; this.page = newEdit; detected = true; break; }
        if (await this.page.$(".ant-modal").catch(() => null)) { modalOnCurrent = true; detected = true; break; }
        if (await isEditNow(this.page)) { samePageEdit = true; detected = true; break; }
        await sleep(500);
      }
      if (!detected) {
        // 关闭本次误开的新标签，避免跨重试累积
        for (const p of listPages()) { if (p !== this.page && !beforeAttempt.has(p) && /web\/smtChoice\/edit/.test(p.url())) { await p.close().catch(() => {}); } }
      } else break;
    }
    if (!targetPage && !modalOnCurrent && !samePageEdit) {
      throw new Error(`采集箱：点击「编辑」后未出现新标签页/提示弹窗/编辑页（已重试 3 次）。lastErr=${lastErr || "(无)"}。可能：1) 搜索标题未定位到正确行；2) 编辑按钮被遮挡/页面结构变化；3) 上一轮残留弹窗未清除。`);
    }
    await sleep(2000);

    return { ok: true, url: this.page.url(), score: found.score, mode: targetPage ? "new-tab" : (modalOnCurrent ? "modal" : "same-page") };
  }

  // 采集箱「编辑」后可能出现的「分类/变种主题映射」中间页处理。
  // 流程：列表页点编辑 → 提示弹窗（编辑分类 / 跳过）→ 分类映射页（选类目 + 1688→SMT 主题映射）→ 保存下一步 → 编辑表单。
  // 本函数负责从弹窗/映射页一路处理到编辑表单，并确保 this.page 指向编辑表单页。
  async fillCollectDraftCategory(facts) {
    await this.connect();
    let page = this.page;
    const profile = this.profile;

    const detect = async (p) => p.evaluate(() => {
      const bodyText = document.body ? (document.body.innerText || "") : "";
      const buttons = Array.from(document.querySelectorAll("button"));
      const hasSaveNext = !!buttons.find((b) => /保存，下一步|保存下一步/.test(b.innerText || ""));
      const hasCategorySelect = !!Array.from(document.querySelectorAll(".ant-select-selection-placeholder")).find((el) => /请选择分类/.test(el.innerText || ""));
      const hasVariantTable = /1688变种主题/.test(bodyText) && /对应速卖通/.test(bodyText);
      // 提示弹窗（两个按钮：编辑分类 / 跳过，去编辑产品）
      const hasEditCategoryBtn = !!buttons.find((b) => /^编辑分类$/.test((b.innerText || "").trim()));
      const hasSkipToEditBtn = !!buttons.find((b) => /跳过，?去编辑产品/.test(b.innerText || ""));
      const hasPromptProgress = /选择产品.*编辑分类.*编辑产品.*保存/.test(bodyText.replace(/\s+/g, ""));
      // 是否已经直接进到编辑表单页
      const isEditPage = /(产品标题|商品标题|quoteEdit|productEdit)/.test(bodyText) || /quoteEdit|productEdit/.test(location.href);
      return {
        isCategoryPage: hasSaveNext && (hasCategorySelect || hasVariantTable),
        isCategoryPrompt: hasEditCategoryBtn && hasSkipToEditBtn && hasPromptProgress,
        isEditPage,
        url: location.href,
        title: document.title
      };
    });

    // 辅助：等待并获取真实页面（过滤 about:blank）
    const awaitRealPage = async (promise, timeoutMs = 10000) => {
      const start = Date.now();
      let p = await promise;
      if (!p) return null;
      while (Date.now() - start < timeoutMs) {
        if (!p.isClosed()) {
          try {
            const url = p.url();
            if (url && url !== "about:blank" && !url.startsWith("about:blank")) return p;
          } catch {}
        }
        await sleep(200);
      }
      return p.isClosed() ? null : p;
    };

    // 1) 等待弹窗或映射页或编辑页出现（最多 10 秒）
    let state = null;
    for (let i = 0; i < 40; i++) {
      state = await detect(page);
      if (state.isEditPage || state.isCategoryPage || state.isCategoryPrompt) break;
      await sleep(250);
    }

    if (state.isEditPage) {
      return { ok: true, skipped: true, reason: "already-edit-page", state };
    }

    // 2) 处理提示弹窗：点「编辑分类」
    if (state.isCategoryPrompt) {
      const context = page.context();
      const newPagePromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
      await page.locator(".ant-modal button").filter({ hasText: "编辑分类" }).first().click({ timeout: 5000 }).catch(() => {
        return clickVisibleByText(page, "编辑分类", 5000);
      });
      // 等待页面变化：可能是当前页导航，也可能是新标签页
      let newPage = await awaitRealPage(newPagePromise, 8000);
      if (newPage && !newPage.isClosed()) {
        page = newPage;
        this.page = newPage;
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      await sleep(2500);
      state = await detect(page);
      if (state.isEditPage) return { ok: true, skipped: true, reason: "already-edit-page", state };
    }

    if (!state.isCategoryPage) {
      return { ok: true, skipped: true, reason: "not-category-page", state };
    }

    // 3) 映射页：选类目
    const categoryName = profile.category;
    if (categoryName) {
      const categorySelect = page.locator(".ant-select", {
        has: page.locator(".ant-select-selection-placeholder", { hasText: "请选择分类" })
      }).first();
      if (await categorySelect.count() > 0 && await categorySelect.isVisible().catch(() => false)) {
        await categorySelect.click();
        await sleep(800);
        let option = page.locator(".ant-select-item-option-content").filter({ hasText: categoryName }).first();
        if (await option.count() === 0) {
          const shortName = categoryName.split(/[（(]/)[0].trim();
          option = page.locator(".ant-select-item-option-content").filter({ hasText: shortName }).first();
        }
        if (await option.count() > 0) await option.click();
        else await page.mouse.click(5, 5);
        await sleep(600);
      }
    }

    // 4) 映射页：变种主题映射（非阻塞；失败只记录，不影响保存）
    const variantThemeMap = profile.variantThemeMap || {};
    const mapped = [];
    if (Object.keys(variantThemeMap).length > 0) {
      const rows = page.locator("table tbody tr");
      const rowCount = await rows.count();
      for (let i = 0; i < rowCount; i++) {
        try {
          const row = rows.nth(i);
          const firstCell = row.locator("td").first();
          const themeText = (await firstCell.innerText().catch(() => "")).trim();
          const target = variantThemeMap[themeText];
          if (!target) continue;
          const select = row.locator(".ant-select").first();
          if (await select.count() === 0 || !(await select.isVisible().catch(() => false))) continue;
          await select.click();
          await sleep(600);
          // 在浮层下拉框里找选项
          const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: target }).first();
          if (await option.count() > 0 && await option.isVisible().catch(() => false)) {
            await option.click();
            mapped.push({ theme: themeText, target });
          } else {
            // 兜底：按 ESC 关闭下拉框，不阻塞
            await page.keyboard.press("Escape").catch(() => {});
          }
          await sleep(300);
        } catch (e) {
          // 单个主题映射失败不阻塞整体保存
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
    }

    // 5) 保存并进入下一步
    const context = page.context();
    const newPagePromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await page.locator("button").filter({ hasText: /保存，下一步|保存下一步/ }).first().click({ timeout: 8000 }).catch(() => {
      return clickVisibleByText(page, "保存，下一步", 8000);
    });
    let newPage = await awaitRealPage(newPagePromise, 8000);
    if (newPage && !newPage.isClosed()) {
      page = newPage;
      this.page = newPage;
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(3000);

    return { ok: true, url: page.url(), mapped, state };
  }

  // 探索：dump 采集箱列表页结构（搜索框 / 表头 / 编辑按钮 / 所有按钮文案），
  // 供前端「探索采集箱」按钮调用，便于在真实 Chrome+店小秘登录后校准导航选择器。
  async exploreCollectBox() {
    await this.openCollectBox();
    const dump = await this.page.evaluate(() => {
      const visInputs = Array.from(document.querySelectorAll("input")).filter((i) => i.offsetParent !== null);
      return {
        url: location.href,
        title: document.title,
        inputs: visInputs.map((i) => ({ type: i.type, placeholder: i.getAttribute("placeholder") || "", id: i.id, name: i.name, cls: (i.className || "").slice(0, 60) })),
        tableHeaders: (() => { const t = document.querySelector("table"); return t ? Array.from(t.querySelectorAll("th, thead td")).map((th) => (th.innerText || "").trim()) : []; })(),
        rowCount: document.querySelectorAll("tbody tr, .ant-table-row").length,
        editButtons: Array.from(document.querySelectorAll("button, a")).filter((b) => /编辑/.test(b.innerText || "")).slice(0, 8).map((b) => ({ tag: b.tagName, text: (b.innerText || "").trim().slice(0, 24), cls: (b.className || "").slice(0, 60) })),
        allButtonTexts: Array.from(new Set(Array.from(document.querySelectorAll("button, a")).map((b) => (b.innerText || "").trim()))).filter(Boolean).slice(0, 60),
        hasSearchArea: !!document.querySelector(".ant-input-search, .ant-input-affix-wrapper, [class*=search], input[placeholder*=搜索], input[placeholder*=标题]")
      };
    });
    return dump;
  }

  // 检查当前连接是否可用（供外部诊断）
  isConnected() {
    return !!(this.browser && this.page);
  }
}

export default DianxiaomiAdapter;
