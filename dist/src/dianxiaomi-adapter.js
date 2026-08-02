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

// 转义正则元字符，用于把任意字符串塞进 RegExp 而不破坏语法
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 等待并获取真实页面（过滤 about:blank）。供 clickSaveAndNext 等跨标签页跳转复用。
async function awaitRealPage(promise, timeoutMs = 10000) {
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
}

export class DianxiaomiAdapter {
  constructor(profile) {
    this.browser = null;
    this.page = null;
    // 图片基准目录（批量上架时切到产品包目录，单品流程恒为 PRODUCT_IMAGES_DIR）
    this.imageBaseDir = PRODUCT_IMAGES_DIR;
    // profile 解析：可为 key 字符串 / profile 对象 / 空（默认 ruTie，向后兼容）
    this.profile = getDianxiaomiProfile(profile || DIANXIAOMI_DEFAULT_PROFILE_KEY);
    // 端到端心跳（P1-2）：店小秘上品当前所处阶段 + 进入时刻；setStage 同时触发 onStage 回调。
    // 供 /api/status 暴露给前端显示「正在 XX 已等待 Ns」，消除「上架卡死无反馈」的错觉。
    this.stage = { name: "idle", detail: "", since: Date.now() };
    this.onStage = null;
  }

  // 设置当前上品阶段（心跳）。detail 可附简短上下文（如当前产品名/行号）。
  setStage(name, detail) {
    this.stage = { name: name || "idle", detail: detail || "", since: Date.now() };
    if (typeof this.onStage === "function") {
      try { this.onStage(this.stage); } catch { /* 回调异常不影响主流程 */ }
    }
    return this.stage;
  }

  getStage() {
    return this.stage || { name: "idle", detail: "", since: Date.now() };
  }

  // 注册阶段变化回调（前端心跳钩子）。回调签名 (stage) => void。
  setOnStage(cb) {
    this.onStage = (typeof cb === "function") ? cb : null;
    return this;
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

  // 清场：关掉所有可见的 ant-modal / ant-drawer / 残留 dropdown / 提示弹窗。
  // 流程内多步操作可能在主页面留下"图片白底 / 模板引用 / 列设置 / 筛选"等 dialog，挡后续点击。
  async _dismissAllOverlays() {
    if (!this.page || this.page.isClosed()) return;
    try {
      // 1) 点所有可见 ant-modal 的关闭按钮
      const modalCloseBtns = this.page.locator(".ant-modal-wrap:visible .ant-modal-close");
      const mc = await modalCloseBtns.count();
      for (let i = 0; i < mc; i++) {
        await modalCloseBtns.nth(i).click({ force: true, timeout: 2000 }).catch(() => {});
        await sleep(200);
      }
      // 2) 兜底：evaluate 暴力关掉所有可见 modal-wrap / drawer（保留 backdrop 无所谓）
      await this.page.evaluate(() => {
        const sel = [".ant-modal-wrap", ".ant-drawer", ".ant-popover"];
        for (const s of sel) {
          document.querySelectorAll(s).forEach((el) => {
            try {
              if (s === ".ant-popover") {
                // popover 用 ESC 关
                return;
              }
              // modal/drawer：先找关闭按钮 click，没有就强制隐藏
              const close = el.querySelector(".ant-modal-close, .ant-drawer-close, [class*='close']");
              if (close) { close.click(); return; }
              el.style.display = "none";
            } catch { /* ignore */ }
          });
        }
      }).catch(() => {});
      // 3) 按 ESC 收尾（关残留 popover / dropdown）
      await this.page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
      await this.page.keyboard.press("Escape").catch(() => {});
      await sleep(300);
    } catch { /* 静默吞错 — 本步为防御性清场 */ }
  }

  async openCreatePage() {
    await this.connect();
    await this.page.goto(this.profile.url || DIANXIAOMI_URL, { waitUntil: "domcontentloaded" });
    await this.page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
  }

  // 引用现有产品（不保存）。引用后表单被模板源产品预填。
  // B-1: openCreatePage() 已被前置到 server.js:runBatchListing（在选店铺/备货之前）。
  // 这里只负责点「引用产品」按钮 + 选模板 + 填产品ID。调用方必须先确保页面已 openCreatePage + 选完店铺/备货。
  async referenceProduct(templateId = this.profile.templateProductId) {
    await this.connect();
    // B-1: 不再调 openCreatePage() —— 已在 runBatchListing 前置。
    // await this.openCreatePage();

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

  // 选店铺名称（label 定位，引用模板前必须执行；类目选项依赖店铺先选）
  // B-1: 新增方法替代旧 fillFixedFields 的 rc_select_0 脆弱索引定位。顺序：在 referenceProduct 之前。
  async selectStoreByName(name) {
    await this.connect();
    try {
      if (!name) return { ok: false, reason: "store-name-empty" };
      const item = this.page.locator(".ant-form-item").filter({
        has: this.page.locator(".ant-form-item-label label, label").filter({ hasText: /^店铺名称$/ })
      }).first();
      if (await item.count() === 0) return { ok: false, reason: "field-not-found" };
      const sel = item.locator(".ant-select").first();
      if (await sel.count() === 0) return { ok: false, reason: "select-not-found" };
      await sel.click({ timeout: 5000, force: true }).catch(() => {});
      await sleep(600);
      const opt = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content, .ant-select-dropdown:visible .ant-select-item-option")
        .filter({ hasText: new RegExp(`^\\s*${escapeRegex(String(name))}\\s*$`) }).first();
      if (await opt.count() > 0 && await opt.isVisible().catch(() => false)) {
        await opt.click({ timeout: 5000 }).catch(() => {});
        await sleep(400);
        return { ok: true, value: name };
      }
      await this.page.keyboard.press("Escape").catch(() => {});
      return { ok: false, reason: `option-not-found:${name}` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  // 选备货类型（label 定位，仿 fillStockingType 模式）
  async selectStockingTypeByLabel(name) {
    await this.connect();
    try {
      if (!name) return { ok: false, reason: "stocking-type-empty" };
      const item = this.page.locator(".ant-form-item").filter({
        has: this.page.locator(".ant-form-item-label label, label").filter({ hasText: /备货类型/ })
      }).first();
      if (await item.count() === 0) return { ok: false, reason: "field-not-found" };
      const sel = item.locator(".ant-select").first();
      if (await sel.count() === 0) return { ok: false, reason: "select-not-found" };
      await sel.click({ timeout: 5000, force: true }).catch(() => {});
      await sleep(600);
      const opt = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content, .ant-select-dropdown:visible .ant-select-item-option")
        .filter({ hasText: new RegExp(`^\\s*${escapeRegex(String(name))}\\s*$`) }).first();
      if (await opt.count() > 0 && await opt.isVisible().catch(() => false)) {
        await opt.click({ timeout: 5000 }).catch(() => {});
        await sleep(400);
        return { ok: true, value: name };
      }
      await this.page.keyboard.press("Escape").catch(() => {});
      return { ok: false, reason: `option-not-found:${name}` };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  // 填固定字段（本店配置，来自 profile.fixed）
  // B-1: 不再用脆弱的 rc_select_0/rc_select_1 索引化定位，改 label 定位；店铺/备货已在 runBatchListing
  // 前置选好，这里只兜底 profile 默认值（覆盖场景：表格没填但 profile 里有兜底值）。
  async fillFixedFields() {
    const fixed = this.profile.fixed || DIANXIAOMI_FIXED;
    const results = [];
    if (fixed.storeName) {
      // 已被前置选择时，重复选也无害（不抛错）；这里兜底 profile 默认
      const r = await this.selectStoreByName(fixed.storeName);
      results.push({ field: "storeName", ...r });
    }
    if (fixed.stockType) {
      const r = await this.selectStockingTypeByLabel(fixed.stockType);
      results.push({ field: "stockType", ...r });
    }
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
      // 空字符串 / null / undefined 表示「明确不填/留空」（如土耳其责任人）
      if (value === "" || value == null) {
        results.push({ field: label, ok: true, skipped: true, reason: "explicitly-empty" });
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
        await sleep(1200);
        results.push({ field: "刷新资质信息", ok: true });
      } else {
        results.push({ field: "刷新资质信息", ok: false, reason: "button-not-found" });
      }
    } catch (e) {
      results.push({ field: "刷新资质信息", ok: false, reason: e.message });
    }
    return results;
  }

  // 海关监管属性（截图基准：添加全球海关监管属性 / 税率代码 8308909000 / 种类 其他）。
  // 当引用产品模板未带入海关信息，或需要强制覆盖为固定值时调用。
  async fillCustomsInfo(customs = {}) {
    await this.connect();
    const result = { ok: false, fields: [] };
    const mode = customs.mode || "添加全球海关监管属性";
    const hsCode = customs.hsCode || "";
    const kind = customs.kind || "";
    try {
      // 1) 定位海关监管属性区块（可能在基本信息或属性信息 tab，先切属性信息兜底）
      await this.clickAnchorTab("属性信息").catch(() => {});
      await this.clickAnchorTab("基本信息").catch(() => {});
      await sleep(500);

      // 2) 确保 radio「添加全球海关监管属性」被选中
      const radioOk = await this.page.evaluate((m) => {
        const items = Array.from(document.querySelectorAll(".ant-form-item, [class*='form-item'], .ant-row"));
        const container = items.find((it) => /海关监管属性|海关监管/.test((it.innerText || "").slice(0, 80)));
        if (!container) return false;
        // 找 radio / checkbox 里含 "添加全球海关监管属性" 的选项
        const radios = Array.from(container.querySelectorAll("input[type='radio'], .ant-radio-wrapper, .ant-checkbox-wrapper, label"));
        const target = radios.find((el) => /添加全球海关监管属性|全球海关监管/.test((el.innerText || "").trim()));
        if (target) {
          // 若是原生 radio/checkbox，直接点最外层 label 触发 React onChange
          const clickable = target.tagName.toLowerCase() === "input" ? target.closest("label, .ant-radio-wrapper, .ant-checkbox-wrapper") : target;
          if (clickable) { clickable.click(); return true; }
        }
        return false;
      }, mode);
      result.fields.push({ field: "海关监管属性-添加方式", ok: radioOk, value: mode });
      await sleep(400);

      // 3) 填税率代码（input）
      if (hsCode) {
        const hsOk = await this.page.evaluate((code) => {
          const items = Array.from(document.querySelectorAll(".ant-form-item, [class*='form-item'], .ant-row"));
          const container = items.find((it) => /海关监管属性|海关监管/.test((it.innerText || "").slice(0, 120)));
          if (!container) return false;
          const labels = Array.from(container.querySelectorAll("label, span, div"));
          const rateLabel = labels.find((el) => /税率代码|HS|hs.code|海关编码/i.test((el.innerText || "").trim()));
          if (!rateLabel) return false;
          let scope = rateLabel.parentElement;
          for (let i = 0; i < 5 && scope; i++) {
            const input = scope.querySelector("input[type='text'], input:not([type])");
            if (input) { input.value = code; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true; }
            scope = scope.parentElement;
          }
          return false;
        }, hsCode);
        result.fields.push({ field: "海关监管属性-税率代码", ok: hsOk, value: hsCode });
      }

      // 4) 选种类(Kind)（Ant Select）
      if (kind) {
        try {
          const kindRes = await this.selectAntSelectByLabel("种类", kind);
          result.fields.push({ field: "海关监管属性-种类", ...kindRes });
        } catch (e) {
          result.fields.push({ field: "海关监管属性-种类", ok: false, reason: e.message });
        }
      }

      // 5) 点「更新海关监管」按钮
      const updateOk = await this.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a, span"));
        const btn = btns.find((el) => /更新海关监管|更新/.test((el.innerText || "").trim()) && /海关|监管/.test((el.innerText || "").trim()));
        if (btn) { btn.click(); return true; }
        return false;
      });
      result.fields.push({ field: "海关监管属性-更新按钮", ok: updateOk });
      if (updateOk) await sleep(800);

      result.ok = result.fields.every((f) => f.ok !== false);
    } catch (e) {
      result.fields.push({ field: "exception", ok: false, reason: e.message });
    }
    return result;
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
    await sleep(800);

    // 3.1) 处理「一键生成将会替换掉现有的无线端内容」确认弹窗
    // 该弹窗在点击生成后弹出，必须点「确定」才会真正生成；否则流程会卡在这里。
    // 用短轮询等弹窗稳定出现，再点确定。
    let confirmModal = null;
    for (let i = 0; i < 10 && !confirmModal; i++) {
      const candidates = [
        this.page.locator(".ant-modal-confirm, .ant-modal-wrap, .ant-modal, [role='dialog']").filter({ hasText: /一键生成将会替换掉现有的无线端内容|确定一键生成吗/ }).first(),
        this.page.locator(".ant-modal-confirm, .ant-modal-wrap, .ant-modal, [role='dialog']").filter({ hasText: /提示/ }).first()
      ];
      for (const cand of candidates) {
        if (await cand.count() > 0 && await cand.isVisible().catch(() => false)) { confirmModal = cand; break; }
      }
      if (!confirmModal) await sleep(250);
    }
    if (confirmModal) {
      step("confirm modal appeared -> clicking 确定");
      let okClicked = false;
      const okSelectors = [
        'button:has-text("确定")',
        'a:has-text("确定")',
        'span:has-text("确定")',
        '.ant-btn-primary:has-text("确定")',
        '.ant-btn:has-text("确定")',
        '.ant-modal-confirm-btns button',
        '.ant-modal-footer button'
      ];
      for (const sel of okSelectors) {
        const btn = confirmModal.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 5000 }).catch((e) => step("confirm ok click err: " + e.message));
          okClicked = true;
          break;
        }
      }
      if (!okClicked) {
        // 兜底：在弹窗 DOM 内 evaluate 找含「确定」的元素点击
        okClicked = await confirmModal.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a, span, .ant-btn, .ant-btn-primary"));
          const ok = btns.find((e) => /^确定$/.test((e.innerText || "").trim()));
          if (ok) { ok.click(); return true; }
          return false;
        }).catch(() => false);
      }
      await sleep(1200);
      // 若弹窗还在，再点一次（有些 ant-modal 第一次 click 没触发）
      const stillThere = await confirmModal.isVisible().catch(() => false);
      if (stillThere) {
        step("confirm modal still visible -> retry clicking 确定");
        await confirmModal.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button, a, span, .ant-btn, .ant-btn-primary"));
          const ok = btns.find((e) => /^确定$/.test((e.innerText || "").trim()));
          if (ok) ok.click();
        }).catch(() => {});
        await sleep(1000);
      }
    }

    await sleep(3000);

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
    // 关键修复（v1.6.37）：优先点新版编辑器头部右侧橙色「保存」按钮（class 含 smt-new-editor-save-btn），
    // 兜底再按文本「保存/完成」找。注意：店小秘新版编辑器头部有「批量操作」下拉含「保存」菜单项，
    // 跳过它直接点顶部 button，避免点错。
    let saved = false;
    const saveBtnSelectors = [
      'button.smt-new-editor-save-btn:visible',
      'button[class*="save"]:visible',
      '.new-editor-header button:has-text("保存"):visible',
      '.smt-new-editor-header button:has-text("保存"):visible',
      'button.ant-btn-primary:has-text("保存"):visible'
    ];
    for (const sel of saveBtnSelectors) {
      const b = modal.locator(sel).first();
      if (await b.count() > 0 && await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 5000, force: true }).catch((e) => step("save err: " + e.message));
        saved = true;
        break;
      }
    }
    if (!saved) {
      // 兜底：在 modal 内精确文本「保存」/「完成」（避免匹配「保存并移入待发布」主页面顶部按钮）
      const exactSave = modal.locator("button").filter({ hasText: /^保存$|^完成$/ }).first();
      if (await exactSave.count() > 0 && await exactSave.isVisible().catch(() => false)) {
        await exactSave.click({ timeout: 5000, force: true }).catch((e) => step("exact save err: " + e.message));
        saved = true;
      } else {
        // 最后兜底：用 clickByTextIn 在 modal 内找
        saved = await clickByTextIn(modal, /^保存$|^完成$|^确定$/);
      }
    }
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
    // 采集箱模式默认「沿用采集带来的变种信息」：不勾选/取消颜色尺寸、不重建 SKU 矩阵、不补默认颜色。
    // 采集箱草稿的变种是从 1688 源商品采下来的真实数据，比 facts（尤其 local_fallback 兜底档）更准；
    // 用 facts 去 toggle 会把源变种取消掉（fillSalesAttributes 的 pass2 会 uncheck 非目标项）。
    // 仅当模板行显式提供变种覆盖（variantOverride）时才允许改动变种。
    const variantOverride = !!(options && options.variantOverride);
    // B-3: keepVariants 选项让引用路径也能沿用引用模板自带的变种（不勾选/不重建）。
    // 引用路径默认 keepVariants=true：表格「变种参数」列没填时，沿用引用模板带出的颜色/尺寸/SKU。
    // 表格显式填了变种参数 → server.js 在 fillFromFacts 前重建 facts.variants.matrix，fillSkuRow 会用 setVal 写价格/库存。
    const keepSourceVariants = variantOverride ? false : (collectMode || !!(options && options.keepVariants));
    // 表格模板「物流属性」列：非空则优先于 profile.logistics / 默认「普货」。
    const logisticsAttribute = (options && options.logisticsAttribute) ? String(options.logisticsAttribute).trim() : "";
    // 表格模板「材质」列：非空则优先于 facts.material（用户可显式指定材质）。
    const tableMaterial = (options && options.material) ? String(options.material).trim() : "";
    const isXiangBao = isXiangBaoProfile(this.profile);
    if (isXiangBao) {
      const applied = [];
      // 0) ★ 引用产品模板（最先执行）：店小秘产品模板会一次性带入 海关监管属性 / 产品属性 /
      //    物流属性 / 合规信息。必须排在所有填写动作之前——模板引用会整体覆盖这些区块，
      //    若先填后引用，我们填的值会被模板冲掉；先引用则后续只需覆盖标题/描述等差异项。
      let tplOk = false;
      const productTemplate = options && options.productTemplate;
      // 采集箱沿用源变种时，在引用模板前先记录当前已勾选的颜色；模板引用可能重置页面表单，
      // 引用后把颜色恢复为采集箱源数据，避免程序自主多勾/少勾颜色。
      const preservedColors = (keepSourceVariants) ? await this.readCheckedColors() : { ok: true, colors: [] };
      if (productTemplate) {
        try {
          const tpl = await this.applyProductTemplate(productTemplate);
          applied.push({ field: "productTemplate", ...tpl });
          tplOk = !!(tpl && tpl.ok);
        } catch (e) { applied.push({ field: "productTemplate", ok: false, reason: e.message }); }
        await sleep(800);
      }
      if (keepSourceVariants && preservedColors.colors && preservedColors.colors.length) {
        try {
          const restored = await this.restoreCheckedColors(preservedColors.colors);
          applied.push({ field: "color-restore", ...restored, preserved: preservedColors.colors });
        } catch (e) { applied.push({ field: "color-restore", ok: false, reason: e.message }); }
        await sleep(600);
      }
      // 1) AI 板块（标题 / 属性信息 / PC端描述）——放在模板之后，用我方文案覆盖模板带来的通用值。
      this.setStage("采集箱上架·②AI板块");
      applied.push(...(await this.fillAiSections(facts, { collectMode })));
      // 2) 备货类型（必填，采集箱草稿不预填；模板未必包含，始终填一次，重复填无害）。
      applied.push({ field: "stockingType", ...(await this.fillStockingType(this.profile.stockingType || "国内备货")) });
      this.setStage("采集箱上架·③备货类型");
      // 3) 物流属性：表格模板「物流属性」列优先，否则按 profile 强制选「普货」/默认「普货」。
      //    模板引用后也可能带错，重复填可确保最终值正确。
      const logisticsValue = logisticsAttribute || this.profile.logistics || "普货";
      this.setStage("采集箱上架·④物流属性");
      applied.push({ field: "logistics", ...(await this.fillLogisticsAttribute(logisticsValue)) });
      // 销售属性：按 facts.variants 勾选颜色/尺寸（箱包以颜色区分 SKU）。
      // 采集箱默认沿用源变种，整段跳过（否则会把采集下来的真实颜色/尺寸取消掉）。
      if (keepSourceVariants) {
        applied.push({ field: "salesAttrs", ok: true, skipped: true, reason: "collect-keep-source-variants" });
      } else {
        applied.push({ field: "salesAttrs", ...(await this.fillSalesAttributes(facts)) });
      }
      await sleep(800);
      // 每色自定义名称 + 每色图（仅当 facts.variants.colorMap 存在时）。采集箱模式跳过（不覆盖源图）。
      if (!collectMode) {
        try {
          applied.push({ field: "colorCustom", ...(await this.fillColorCustomNamesAndImages(facts)) });
        } catch (e) {
          applied.push({ field: "colorCustom", ok: false, reason: e.message });
        }
      }
      // 4) 合规信息：按 profile.compliance 强制选择（欧盟责任人/土耳其责任人/品牌制造商）。
      //    即使模板已引用，也用 profile 值再覆盖一次，确保与截图一致。
      this.setStage("采集箱上架·⑤合规信息");
      applied.push(...(await this.fillComplianceInfo(facts)));
      // 4.5) 海关监管属性：按 profile.customs 强制填（全球海关 / 税率代码 / 种类）。
      const customsCfg = this.profile.customs || (facts && facts.customs);
      if (customsCfg) {
        try {
          this.setStage("采集箱上架·⑥海关属性");
          const cusRes = await this.fillCustomsInfo(customsCfg);
          applied.push({ field: "customs", ...cusRes });
        } catch (e) { applied.push({ field: "customs", ok: false, reason: e.message }); }
      }
      // 采集箱兜底：facts 缺必填项时填默认值，确保能存草稿（仅产品属性；变种一律沿用源数据，
      // 只有下面 autofix 循环里店小秘明确报「缺必选变种」时才触发 ensureDefaultVariantColor）。
      if (collectMode) {
        // 若已引用产品模板，产品属性已被模板带入，不再手工逐项填写。
        if (!tplOk) {
          try {
            this.setStage("采集箱上架·⑦产品属性");
            const pattr = await this.fillProductAttributes(facts);
            for (const f of (pattr.fields || [])) applied.push({ field: "attr:" + f.field, ...f });
          } catch (e) { applied.push({ field: "attr", ok: false, reason: e.message }); }
        } else {
          applied.push({ field: "productAttributes", ok: true, skipped: true, reason: "product-template-applied" });
        }
        // 材质：表格模板显式提供「材质」列时，用它覆盖模板/源产品带入的值（表格优先于 facts.material）。
        if (tableMaterial) {
          try {
            const mr = await this.trySetMaterial(tableMaterial);
            applied.push({ field: "material(table)", ...mr });
          } catch (e) { applied.push({ field: "material(table)", ok: false, reason: e.message }); }
        }
        // 一键翻译：把 fillProductAttributes 填的中文默认值转成英文，避免保存校验「请输入英文、数字或空格符号」。
        try {
          this.setStage("采集箱上架·⑧一键翻译");
          const tr = await this.translatePageToEnglish();
          applied.push({ field: "translate-to-en", ...tr });
        } catch (e) { applied.push({ field: "translate-to-en", ok: false, reason: e.message }); }
        // 注：保存与迭代自动纠错统一交由 server.js 的 processCollectBatchRow 处理（单owner，且已带
        // 「仅遇英文/数字校验错误才重翻」的节流）。此处不再内嵌第二套 save+翻译循环，避免箱包分支
        // 对同一产品重复 save 7 次 / 翻译 8 次（每次翻译 10~12s）造成的严重卡顿。
      }
      return applied;
    }
    const applied = [];
    // 0) ★ 引用产品模板（最先执行，与箱包分支同一原则）：模板一次性带入
    //    海关监管属性 / 产品属性 / 物流属性 / 合规信息，必须排在所有填写动作之前，
    //    否则模板会把我们先填的值整体覆盖掉。
    let tplOk = false;
    const refProductTemplate = options && options.productTemplate;
    const preservedColorsRutie = (keepSourceVariants) ? await this.readCheckedColors() : { ok: true, colors: [] };
    if (refProductTemplate) {
      try {
        const tpl = await this.applyProductTemplate(refProductTemplate);
        applied.push({ field: "productTemplate", ...tpl });
        tplOk = !!(tpl && tpl.ok);
      } catch (e) { applied.push({ field: "productTemplate", ok: false, reason: e.message }); }
      await sleep(800);
    }
    if (keepSourceVariants && preservedColorsRutie.colors && preservedColorsRutie.colors.length) {
      try {
        const restored = await this.restoreCheckedColors(preservedColorsRutie.colors);
        applied.push({ field: "color-restore", ...restored, preserved: preservedColorsRutie.colors });
      } catch (e) { applied.push({ field: "color-restore", ok: false, reason: e.message }); }
      await sleep(600);
    }
    // 1) 产品标题
    const refTitleValue = this.resolveTitle(facts);
    if (refTitleValue) applied.push({ field: "title", ...(await this.fillInputByLabel("产品标题", refTitleValue)) });
    // 2) PC端描述（3.2 AEO 文案）。无线端描述统一在下方第 5.1 步生成（仅一次，避免重复弹窗）。
    if (facts.description && facts.description.pc) {
      applied.push({ field: "description.pc", ...(await this.fillCkeditorByLabel("PC端描述", facts.description.pc)) });
    }
    // 3) 品牌（引用后品牌为可搜索 select；先选项，失败则自定义键入）
    if (facts.brand) applied.push({ field: "brand", ...(await this.trySetBrand(facts.brand)) });
    // 4) 材质（非破坏式：源产品引用后已合法填材质则保留；仅当源为空/明显错误时才尝试用 facts 覆盖）
    //    表格模板「材质」列优先于 facts.material（用户可显式指定）。
    const materialValue = tableMaterial || facts.material;
    if (materialValue) {
      const BAD_MATERIAL_KWS = /nipple|breast|petal|bra|乳贴|乳罩|胸贴/i;
      const cur = await this.readField("材质", "rc_select_18");
      const curIsBad = cur && BAD_MATERIAL_KWS.test(cur);
      let r = await this.trySetMaterial(materialValue);
      if (!r.ok && (curIsBad || !cur)) {
        // 当前值为错误默认值（如 Nipple Covers 串到箱包页），先清空为安全项再试
        const cleared = await this.page.evaluate(() => {
          const items = Array.from(document.querySelectorAll(".ant-form-item"));
          for (const item of items) {
            const lab = item.querySelector(".ant-form-item-label label, label");
            if (lab && /材质/.test(lab.innerText || "")) {
              const sel = item.querySelector(".ant-select");
              if (sel) { sel.click(); return true; }
            }
          }
          return false;
        });
        if (cleared) {
          await sleep(700);
          const safeOpt = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: /^(NONE|None|无|否|合金|Alloy|Metal|default)$/i }).first();
          if (await safeOpt.count() > 0) await safeOpt.click({ timeout: 3000 }).catch(() => {});
          else {
            const firstOpt = this.page.locator(".ant-select-dropdown:visible .ant-select-item-option-content").first();
            if (await firstOpt.count() > 0) await firstOpt.click({ timeout: 3000 }).catch(() => {});
          }
          await sleep(400);
          r = await this.trySetMaterial(materialValue);
        }
      }
      if (r.ok) {
        applied.push({ field: "material", ...r });
      } else if (cur && !curIsBad) {
        applied.push({ field: "material", ok: true, skipped: true, reason: "source-kept", value: cur });
      } else {
        applied.push({ field: "material", ok: false, reason: r.reason || "material-not-set", value: materialValue });
      }
    }
    // 4.5) 类目属性补全（必填默认 + 关键属性用主关键词 + 默认兜底）。模板已带入则跳过。
    if (tplOk) {
      applied.push({ field: "categoryAttrs", ok: true, skipped: true, reason: "product-template-applied" });
    } else {
      applied.push(...(await this.fillCategoryAttributes(facts)));
    }
    // 4.6) 物流属性（必填，引用不携带；乳贴为布+胶 → 普货）。弹窗选择，非致命。
    //      表格模板「物流属性」列优先；模板已带入且表格未指定时跳过（避免重复弹窗）。
    const ruTieLogistics = logisticsAttribute || "普货";
    if (tplOk && !logisticsAttribute) {
      applied.push({ field: "logistics", ok: true, skipped: true, reason: "product-template-applied" });
    } else {
      applied.push({ field: "logistics", ...(await this.fillLogisticsAttribute(ruTieLogistics)) });
    }
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
      // 无线端描述：仅生成一次（已移除上方重复调用）。若首次失败则重试一次，取成功结果。
      let mbRes = await this.clickNewEditorThenGenerateFromPc();
      if (!mbRes.ok) mbRes = await this.clickNewEditorThenGenerateFromPc();
      applied.push({ field: "description.mobile", ...mbRes });
    }
    // 5.5) 销售属性（颜色/尺寸）必填勾选：从 facts.variants 勾选分类 checkbox（点 label 触发 React onChange）。
    //       颜色为实操必填（靠颜色区分子 SKU）；尺寸按 facts 默认（One Size），并取消引用带出的多余尺寸。
    //       采集箱模式沿用源变种，整段跳过。
    // 6) SKU 变种（引用后点「生成SKU」→ 填每组合价格/库存/图；无 variants 则跳过，不报错）
    //       采集箱模式沿用源 SKU 矩阵（价格/库存已由采集带入），不重建。
    if (keepSourceVariants) {
      applied.push({ field: "salesAttrs", ok: true, skipped: true, reason: "collect-keep-source-variants" });
      applied.push({ field: "sku", ok: true, skipped: true, reason: "collect-keep-source-variants" });
    } else {
      applied.push({ field: "salesAttrs", ...(await this.fillSalesAttributes(facts)) });
      const skuResult = await this.fillSkus(facts);
      if (skuResult) applied.push({ field: "sku", ...skuResult });
    }
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
    // 7) 合规信息（欧盟责任人/土耳其责任人/品牌制造商）。模板已带入则跳过。
    if (tplOk) {
      applied.push({ field: "compliance", ok: true, skipped: true, reason: "product-template-applied" });
    } else {
      applied.push(...(await this.fillComplianceInfo(facts)));
    }
    // 8) 采集箱模式：一键翻译为英文（处理自定义属性/名称中文值导致的保存校验失败）
    if (collectMode) {
      try {
        const tr = await this.translatePageToEnglish();
        applied.push({ field: "translate-to-en", ...tr });
      } catch (e) { applied.push({ field: "translate-to-en", ok: false, reason: e.message }); }
    }
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
  // 勾选/取消颜色尺寸 checkbox
  // B-2: 变种 SKU 点击全删。函数体改为函数体开头直接 return，跳过所有 checkbox 勾选/取消。
  // 采集箱路径靠现有 keepSourceVariants 门控保护源变种；引用路径靠 keepVariants 选项（默认 true）保护引用模板带出的变种。
  // 若用户在表格里手动填了「变种参数」列，server.js 会在 fillFromFacts 之前重建 facts.variants.colors/sizes/matrix，
  // 然后由 fillSkuRow 走 setVal（非 click）写价格/库存；不依赖本函数勾选。
  async fillSalesAttributes(facts) {
    return { ok: true, skipped: true, reason: "variant-skus-deprecated" };
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
    const isRutie = (this.profile && this.profile.key === "ruTie") || /ruTie|乳贴|nipple/i.test((this.profile && this.profile.label) || "");
    const kw = (facts && facts.mainKeyword) || (isRutie ? "Nipple Covers" : "通用");
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
    // 关键标识项：内衣配件类型 用主关键词；匹配不上则保留源值（不强行覆盖为错值）。仅限乳贴类目，避免箱包/钥匙扣页误填。
    if (isRutie) {
      applied.push({ field: "attr:内衣配件类型", ...(await this.applyAttribute("内衣配件类型", "rc_select_17", kw)) });
    }
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
      await sleep(600);
      const candidates = Array.from(new Set([defaultValue, "国内备货", "国内履约", "海外备货"].filter(Boolean)));
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
    if (await tab.count() > 0) { await tab.click({ timeout: 5000 }).catch(() => {}); await sleep(700); return true; }
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
      await sleep(800);
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
          const def = /重量|weight/i.test(label) ? "0.1" : (/型号|model/i.test(label) ? "Universal" : "None");
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

  // 引用产品模板：店小秘编辑页顶部「引用产品」→「引用产品模板」，按模板名自动引用。
  // 用于箱包配件等类目，模板已预填海关属性、产品属性，避免人工逐项填写。
  async applyProductTemplate(templateName) {
    await this.connect();
    const result = { ok: false, reason: "", templateName };
    if (!templateName) { result.reason = "template-name-empty"; return result; }
    try {
      // 1) 点顶部「引用产品」下拉按钮
      const refBtnSelectors = [
        'button:has-text("引用产品")',
        '.ant-btn:has-text("引用产品")',
        '[class*="reference"]:has-text("引用产品")',
        'a:has-text("引用产品")'
      ];
      let clicked = false;
      for (const sel of refBtnSelectors) {
        const loc = this.page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 5000 }).catch(() => {});
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        clicked = await this.page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("button, a, span"));
          const el = els.find((e) => /引用产品/.test((e.innerText || "").trim()));
          if (el) { el.click(); return true; }
          return false;
        }).catch(() => false);
      }
      if (!clicked) { result.reason = "reference-button-not-found"; return result; }
      await sleep(600);

      // 2) 点下拉菜单里的「引用产品模板」
      const tplOptSelectors = [
        '.ant-dropdown-menu-item:has-text("引用产品模板")',
        '.ant-dropdown-menu-item:has-text("产品模板")',
        'a:has-text("引用产品模板")',
        'span:has-text("引用产品模板")',
        'li:has-text("引用产品模板")'
      ];
      let tplClicked = false;
      for (const sel of tplOptSelectors) {
        const loc = this.page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
          await loc.click({ timeout: 5000 }).catch(() => {});
          tplClicked = true;
          break;
        }
      }
      if (!tplClicked) {
        tplClicked = await this.page.evaluate(() => {
          const els = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, a, span, li"));
          const el = els.find((e) => /引用产品模板/.test((e.innerText || "").trim()));
          if (el) { el.click(); return true; }
          return false;
        }).catch(() => false);
      }
      if (!tplClicked) { result.reason = "template-menu-item-not-found"; return result; }
      await sleep(800);

      // 3) 等「引用模板」弹窗
      const modalSelectors = [
        '.ant-modal:has-text("引用")',
        '.ant-modal:has-text("模板")',
        '.ant-modal-wrap:has-text("引用")',
        '[role="dialog"]:has-text("模板")'
      ];
      let modal = null;
      for (let i = 0; i < 15 && !modal; i++) {
        for (const sel of modalSelectors) {
          const loc = this.page.locator(sel).first();
          if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) { modal = loc; break; }
        }
        if (!modal) await sleep(300);
      }
      if (!modal) { result.reason = "template-modal-not-found"; return result; }

      // 4) 在弹窗表格里匹配模板名行，点「引用」
      let row = null;
      const safeName = templateName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exactRow = modal.locator("tr, .ant-list-item, .ant-table-row").filter({ hasText: new RegExp(safeName, "i") }).first();
      if (await exactRow.count() > 0 && await exactRow.isVisible().catch(() => false)) row = exactRow;
      if (!row) {
        const fuzzyRow = modal.locator("tr, .ant-list-item, .ant-table-row").filter({ hasText: /箱包配件|包饰|bag/i }).first();
        if (await fuzzyRow.count() > 0 && await fuzzyRow.isVisible().catch(() => false)) row = fuzzyRow;
      }

      let applyClicked = false;
      if (row) {
        // 优先点行内操作列的「引用」：可能是 a / button / span / ant-btn-link / ant-btn-primary
        const refBtnSelectors = [
          'button:has-text("引用")',
          'a:has-text("引用")',
          'span:has-text("引用")',
          '.ant-btn-link:has-text("引用")',
          '.ant-btn-primary:has-text("引用")',
          '.ant-btn:has-text("引用")',
          'button:has-text("使用")',
          'a:has-text("使用")',
          '.ant-btn:has-text("使用")'
        ];
        for (const sel of refBtnSelectors) {
          const btn = row.locator(sel).first();
          if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click({ timeout: 5000 }).catch(() => {});
            applyClicked = true;
            break;
          }
        }
        // 兜底：在行内直接 evaluate 找包含「引用」的最可能元素
        if (!applyClicked) {
          applyClicked = await row.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll("button, a, span, .ant-btn, .ant-btn-link, .ant-btn-primary"));
            const btn = candidates.find((e) => /引用|使用/.test((e.innerText || "").trim()));
            if (btn) { btn.click(); return true; }
            return false;
          }).catch(() => false);
        }
        if (!applyClicked) {
          // 最后兜底：点击整行
          await row.click({ timeout: 5000 }).catch(() => {});
          applyClicked = true;
        }
      } else {
        // 找不到行：在整个 modal 里按模板名匹配行并点引用
        applyClicked = await modal.evaluate((name) => {
          const rows = Array.from(document.querySelectorAll("tr, .ant-list-item, .ant-table-row"));
          for (const r of rows) {
            const t = (r.innerText || "").trim();
            if (new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(t)) {
              const candidates = Array.from(r.querySelectorAll("button, a, span, .ant-btn, .ant-btn-link, .ant-btn-primary"));
              const btn = candidates.find((e) => /引用|使用/.test((e.innerText || "").trim()));
              if (btn) { btn.click(); return true; }
            }
          }
          return false;
        }, templateName).catch(() => false);
        if (!applyClicked) { result.reason = "template-row-not-found"; return result; }
      }
      await sleep(1200);

      // 5) 等弹窗关闭、加载完成
      let completed = false;
      for (let i = 0; i < 20 && !completed; i++) {
        const stillModal = await this.page.locator('.ant-modal-wrap:has-text("引用"), .ant-modal:has-text("模板"), [role="dialog"]:has-text("模板")').count() > 0;
        const loading = await this.page.evaluate(() => {
          const spin = document.querySelector(".ant-spin, .ant-spin-spinning, .loading, [class*='loading']");
          return spin && spin.offsetParent !== null;
        }).catch(() => false);
        if (!stillModal && !loading) { completed = true; break; }
        await sleep(400);
      }
      result.ok = completed;
      if (!result.ok && !result.reason) result.reason = "template-apply-timeout";
      return result;
    } catch (e) {
      result.reason = "exception:" + (e && e.message || e);
      return result;
    }
  }

  // 一键翻译：店小秘编辑页顶部「一键翻译」按钮，将中文内容翻译为英文。
  // 用于解决自定义属性、自定义名称等字段填中文后保存报「请输入英文、数字或空格符号」的问题。
  async translatePageToEnglish(options = {}) {
    await this.connect();
    const result = { ok: false, reason: "", translated: [] };
    // 节流：非强制且距上次翻译 < 20s 时跳过（避免 fillFromFacts 末尾翻译后 autofix 轮次里重复翻译同一页面）。
    // 单次上架每个产品最多翻译 1 次（首次），仅在 autofix 明确遇到「英文/数字」校验错误时由调用方传 force:true 再翻。
    const now = Date.now();
    if (!options.force && this._lastTranslateAt && (now - this._lastTranslateAt) < 20000) {
      return { ok: true, skipped: true, reason: "recently-translated", translated: [] };
    }
    // 1) 点击顶部「一键翻译」按钮（兼容多种 DOM 形态）
    // 关键修复（v1.6.37）：店小秘按钮 class 是 `translation-btn`，但有时 click 会被页面上其他 ant-modal
    // 残留的 mask 拦截导致超时——加 force:true 强制点击。
    const translateBtnSelectors = [
      'button.translation-btn:has-text("一键翻译")',
      'button:has-text("一键翻译")',
      'a:has-text("一键翻译")',
      '.ant-btn:has-text("一键翻译")',
      '[class*="translate"]:has-text("一键翻译")'
    ];
    let clicked = false;
    for (const sel of translateBtnSelectors) {
      const loc = this.page.locator(sel).first();
      if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
        await loc.click({ timeout: 5000, force: true }).catch(() => {});
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      clicked = await this.page.evaluate(() => {
        const els = Array.from(document.querySelectorAll("button, a, span, div"));
        const el = els.find((e) => /一键翻译/.test((e.innerText || "").trim()));
        if (el) { el.click(); return true; }
        return false;
      }).catch(() => false);
    }
    if (!clicked) { result.reason = "translate-button-not-found"; return result; }
    await sleep(800);

    // 2) 定位翻译弹窗：店小秘实际是 ant-popover（不是 ant-modal，截图5/6 v1.6.37 实测），
    //    默认已选「中文 → 英文」+ 默认翻译内容已含「标题、自定义属性、自定义名称、PC端描述、无线端描述」，
    //    无「确定」按钮——点外面/关闭按钮即触发翻译。
    const popoverSelectors = [
      '.ant-popover:visible:has-text("翻译方式")',
      '.ant-popover:visible:has-text("选择语种")',
      '.translate-panel:visible',
      '.ant-popover-inner:visible',
      // 兜底旧版 ant-modal
      '.ant-modal:visible:has-text("翻译方式")',
      '.ant-modal:has-text("翻译方式")',
      '.ant-modal:has-text("翻译")',
      '[role="dialog"]:has-text("翻译方式")'
    ];
    let popover = null;
    for (let i = 0; i < 8 && !popover; i++) {
      for (const sel of popoverSelectors) {
        const loc = this.page.locator(sel).first();
        if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) { popover = loc; break; }
      }
      if (!popover) await sleep(300);
    }
    if (!popover) { result.reason = "translate-popover-not-found"; return result; }

    try {
      // 3) 默认「中文 → 英文」已选中（v1.6.37 实测：行 class 仅有 panel-language-item，
      //    激活态是 CSS-only 无 class 标记，无法可靠判断；强制点会切语种）。
      //    故完全信任店小秘默认行为，跳过自动点击「中文 → 英文」避免误触切语种。
      result.translated.push('lang-default-zh2en');

      // 4) 校验默认翻译内容（标题/自定义属性/PC端描述/无线端描述）是否已勾选；不再手动操作以免误触取消
      const targets = [
        { text: "自定义属性", key: "custom-attr" },
        { text: "自定义名称", key: "custom-name" },
        { text: "标题", key: "title" },
        { text: "PC端描述", key: "pc-desc" },
        { text: "无线端描述", key: "mobile-desc" }
      ];
      for (const t of targets) {
        const has = await popover.evaluate((m, txt) => {
          const items = Array.from(m.querySelectorAll('label, .ant-checkbox-wrapper, li, p, span, div'))
            .filter(e => e.offsetParent !== null);
          const item = items.find(e => {
            const t2 = (e.innerText || '').trim();
            return t2.startsWith(txt) || (t2.includes(txt) && t2.length < txt.length + 30);
          });
          if (!item) return null;
          const cb = item.querySelector('input[type="checkbox"]');
          if (!cb) return null;
          return cb.checked;
        }, t.text).catch(() => null);
        if (has === true) result.translated.push(t.key);
      }
      // 一个都没识别到时记全部 key（默认全勾场景兜底）
      if (!result.translated.includes('custom-attr') && !result.translated.includes('title')) {
        targets.forEach((t) => { if (!result.translated.includes(t.key)) result.translated.push(t.key); });
      }
    } catch (e) {
      result.reason = "configure-popover:" + (e && e.message || e);
    }

    // 5) 触发翻译：店小秘 popover 没有「确定」按钮——先尝试「开始翻译/确定」按钮；找不到则点关闭按钮触发翻译
    const triggerBtn = popover.locator("button").filter({ hasText: /^开始翻译$|^确定$|^确认$|^翻译$|^确定翻译$/ }).first();
    if (await triggerBtn.count() > 0 && await triggerBtn.isVisible().catch(() => false)) {
      await triggerBtn.click({ timeout: 5000, force: true }).catch(() => {});
    } else {
      // 兜底：点 popover 关闭按钮（X），店小秘在关闭时会触发翻译流程
      const closeBtn = popover.locator(".ant-popover-close, .ant-popover-close-x, [class*='close']").first();
      if (await closeBtn.count() > 0 && await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ timeout: 3000, force: true }).catch(() => {});
      } else {
        await this.page.keyboard.press("Escape").catch(() => {});
      }
    }
    this._lastTranslateAt = Date.now();
    await sleep(800);

    // 6) 等待翻译完成：loading 消失且翻译弹窗关闭（同时识别 ant-popover 和 ant-modal）
    let completed = false;
    for (let i = 0; i < 15 && !completed; i++) {
      const stillLoading = await this.page.evaluate(() => {
        const spin = document.querySelector(".ant-spin, .ant-spin-spinning, .loading, [class*='loading']");
        return spin && spin.offsetParent !== null;
      }).catch(() => false);
      const stillPopover = await this.page.locator('.ant-popover:has-text("翻译方式"):visible, .ant-modal:has-text("翻译方式"):visible, .ant-modal:has-text("翻译"):visible').count() > 0;
      if (!stillLoading && !stillPopover) { completed = true; break; }
      await sleep(400);
    }
    result.ok = completed;
    if (!result.ok && !result.reason) result.reason = "translation-timeout";
    return result;
  }

  // 变种颜色兜底（采集箱模式 facts 缺 colors 时）：勾选 颜色(Color) 组里第一个未勾选的颜色，
  // 避免「请选择必选变种属性」。优先 checkbox 包裹，否则直接点颜色 chip。
  async ensureDefaultVariantColor() {
    await this.connect();
    try {
      // B-2: 移除 clickAnchorTab("变种参数") —— 此点击不写数据，仅切视图；保留下方 checkbox / chip 兜底。
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

  // 读取当前「颜色(Color)」属性组里已勾选的 checkbox 文本列表（用于采集箱源变种保护）。
  async readCheckedColors() {
    await this.connect();
    try {
      const colors = await this.page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(".ant-form-item"));
        for (const item of items) {
          const lab = item.querySelector(".ant-form-item-label label, label");
          if (lab && /^\s*颜色\s*\(?\s*Color\s*\)?\s*$/i.test((lab.innerText || "").trim())) {
            const wraps = Array.from(item.querySelectorAll(".ant-checkbox-wrapper, label:has(input[type=checkbox])"));
            const checked = [];
            for (const w of wraps) {
              const input = w.querySelector("input[type=checkbox]");
              const txt = (w.innerText || "").trim();
              if (input && input.checked && txt) checked.push(txt);
            }
            return checked;
          }
        }
        return [];
      });
      return { ok: true, colors };
    } catch (e) { return { ok: false, reason: e.message, colors: [] }; }
  }

  // 恢复「颜色(Color)」属性组的勾选状态：只保留 wantColors 列表里的项，取消其他已勾选项。
  // 用原生 input.click() 触发 React onChange；每个 checkbox 操作后短暂等待，避免批量点击丢事件。
  async restoreCheckedColors(wantColors) {
    await this.connect();
    try {
      const result = await this.page.evaluate(async (wants) => {
        const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "").replace(/[()（）]/g, "");
        const wantSet = new Set(wants.map(norm));
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const items = Array.from(document.querySelectorAll(".ant-form-item"));
        for (const item of items) {
          const lab = item.querySelector(".ant-form-item-label label, label");
          if (lab && /^\s*颜色\s*\(?\s*Color\s*\)?\s*$/i.test((lab.innerText || "").trim())) {
            const wraps = Array.from(item.querySelectorAll(".ant-checkbox-wrapper, label:has(input[type=checkbox])"));
            let changed = 0;
            for (const w of wraps) {
              const input = w.querySelector("input[type=checkbox]");
              const txt = (w.innerText || "").trim();
              if (!input) continue;
              const isWant = wantSet.has(norm(txt));
              if (isWant && !input.checked) { input.click(); changed++; await sleep(250); }
              else if (!isWant && input.checked) { input.click(); changed++; await sleep(250); }
            }
            return { found: true, changed, wantCount: wants.length };
          }
        }
        return { found: false, changed: 0, wantCount: wants.length };
      }, wantColors);
      return { ok: true, ...result };
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
        let clicked = false;
        // 1.1) Playwright locator 方式：找「物流属性」同行/同容器里的编辑图标
        const logisticsLabel = this.page.locator("span, label, div").filter({ hasText: /^\s*物流属性\s*\*?\s*$/ }).first();
        if (await logisticsLabel.count() > 0) {
          const container = this.page.locator(".ant-form-item, .ant-row, [class*='form-item']").filter({ has: this.page.locator("span, label, div").filter({ hasText: /^\s*物流属性\s*\*?\s*$/ }) }).first();
          if (await container.count() > 0) {
            const editIcon = container.locator("i[class*=edit], .icon_edit2, .link, a.link, span.link, [class*=edit]").first();
            if (await editIcon.count() > 0 && await editIcon.isVisible().catch(() => false)) {
              await editIcon.click({ timeout: 5000 }).catch(() => {});
              clicked = true;
            }
          }
        }
        // 1.2) evaluate 兜底
        if (!clicked) {
          clicked = await this.page.evaluate(() => {
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
        }
        if (!clicked) return { ok: false, reason: "logistics-edit-not-found" };
        await sleep(1000);
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
    // B-2: 生成SKU 按钮加守卫 —— 组合表已有 ≥ matrix.length 行则不点（沿用已有结构），避免无谓的破坏性重新生成。
    const tableHasRows = await this.page.evaluate(() => {
      try {
        const tables = Array.from(document.querySelectorAll("table"));
        const tb = tables.find((t) => Array.from(t.querySelectorAll("thead th, thead td")).some((h) => /供货价|库存/.test(h.innerText || "")));
        return tb ? tb.querySelectorAll("tbody tr").length : 0;
      } catch { return 0; }
    }).catch(() => 0);
    let gen = null;
    if (tableHasRows < matrix.length) {
      gen = await this.page.evaluate(() => {
        const bs = Array.from(document.querySelectorAll("button"));
        const t = (b) => (b.innerText || b.textContent || "").trim();
        const target = bs.find((b) => /生成\s*SKU/i.test(t(b))) || bs.find((b) => /生成销售属性|添加\s*SKU/i.test(t(b)));
        if (target) { target.click(); return t(target); }
        return null;
      });
      await sleep(1800);
    }
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
      const safe = bs.find((b) => /保存/.test(t(b)) && !/上架|发布|提交|下一步/.test(t(b)));
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
  // 用户明确可跳过的字段（缺下拉选项时也不报失败）：尺码表、土耳其责任人、来源地。
  async fillFieldDefaultByLabel(label) {
    await this.connect();
    const TAB_HINTS = {
      "尺码表": "基本信息", "海关监管属性": "基本信息", "计件单位": "基本信息",
      "欧盟责任人": "合规信息", "土耳其责任人": "合规信息", "品牌制造商": "合规信息"
      // B-2: 移除 "颜色": "变种参数" —— 「变种参数」tab 的纯视图点击已废除，颜色字段若需切换 tab 由调用方按需触发。
    };
    const core = String(label || "").replace(/[（(].*?[)）]/g, "").trim();
    const USER_SKIP_FIELDS = ["尺码表", "土耳其责任人", "来源地"];
    const isUserSkip = USER_SKIP_FIELDS.some((kw) => core.includes(kw));
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
      if (isUserSkip) return { ok: true, skipped: true, reason: "user-skip-no-option" };
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
      const def = /重量|weight/i.test(core) ? "0.1" : (/型号|model/i.test(core) ? "Universal" : "None");
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
      const href = location.href || "";
      // 分类映射页 URL 强信号（如 /web/modifyCategory）
      const isCategoryPageByUrl = /\/modifyCategory/i.test(href) || /category/i.test(href) && /编辑分类|选择分类|modify/.test(bodyText);
      const hasSaveNext = !!buttons.find((b) => /保存[，并]?下一步|保存$|下一步$/.test((b.innerText || "").trim()));
      const hasCategorySelect = !!Array.from(document.querySelectorAll(".ant-select-selection-placeholder, .ant-select-selection-item")).find((el) => /请选择分类|请选择类目|选择分类/.test((el.innerText || "").trim()));
      const hasVariantTable = /(1688)?变种主题/.test(bodyText) && /对应速卖通|速卖通/.test(bodyText);
      // 提示弹窗（两个按钮：编辑分类 / 跳过，去编辑产品）
      const hasEditCategoryBtn = !!buttons.find((b) => /^编辑分类$/.test((b.innerText || "").trim()));
      const hasSkipToEditBtn = !!buttons.find((b) => /跳过，?去编辑产品/.test(b.innerText || ""));
      const hasPromptProgress = /选择产品.*编辑分类.*编辑产品.*保存/.test(bodyText.replace(/\s+/g, ""));
      // 是否已经直接进到编辑表单页
      const isEditPage = /(产品标题|商品标题|quoteEdit|productEdit)/.test(bodyText) || /quoteEdit|productEdit/.test(location.href);
      return {
        isCategoryPage: isCategoryPageByUrl || (hasSaveNext && (hasCategorySelect || hasVariantTable)),
        isCategoryPrompt: hasEditCategoryBtn && hasSkipToEditBtn && hasPromptProgress,
        isEditPage,
        url: href,
        title: document.title
      };
    });

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
      return { ok: true, skipped: true, reason: "not-category-page", url: page.url(), state };
    }

    // 3) 映射页：选类目
    // 「auto」/空/未指定 → 沿用页面已选分类（采集箱草稿自带类目、或引用模板带入），跳过不抛错。
    // 真实叶子类目 → 已正确选中则跳过；未选(请选择)则从下拉选；已选但≠目标则走「更换分类」弹窗。
    const categoryName = (profile.category || "").toString().trim();
    const IS_AUTO = !categoryName || /^auto$/i.test(categoryName);
    if (!IS_AUTO) {
      const placeholderEl = page.locator(".ant-select-selection-placeholder").first();
      const placeholderVisible = await placeholderEl.isVisible().catch(() => false);
      const selectedItem = page.locator(".ant-select-selection-item").first();
      const currentValue = placeholderVisible ? "" : (await selectedItem.innerText().catch(() => "") || "").trim();
      if (currentValue && currentValue === categoryName) {
        // 已正确选中，跳过
      } else if (placeholderVisible) {
        // 未选 → 从下拉选
        const categorySelect = page.locator(".ant-select", {
          has: page.locator(".ant-select-selection-placeholder, .ant-select-selection-item", { hasText: /请选择分类|请选择类目|选择分类|选择产品分类/ })
        }).first();
        if (await categorySelect.count() === 0 || !(await categorySelect.isVisible().catch(() => false))) {
          throw new Error(`分类映射页未找到分类下拉控件（expected for "${categoryName}"）`);
        }
        await categorySelect.click();
        await sleep(500);
        // exact-label 匹配：去掉首尾空白后整词匹配，不降级到短名/包含匹配
        const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option-content")
          .filter({ hasText: new RegExp(`^\\s*${escapeRegex(categoryName)}\\s*$`) }).first();
        if (await option.count() === 0) {
          await page.keyboard.press("Escape").catch(() => {});
          throw new Error(`分类映射页未找到分类选项 "${categoryName}"（表格填写的分类与店小秘分类映射页选项不匹配）`);
        }
        await option.click();
        await sleep(400);
      } else {
        // 已选中但≠目标 → 点「更换分类」改
        await this.changeCategoryViaModal(categoryName);
      }
    }

    // 4) 映射页：变种主题映射（先扫一遍是否已自动填好；未填才走 select 自动填，且 sleep 砍半）
    // 优化点：原版每行 sleep 600+300ms，5-10 个变种累加到 4-9s。改：先扫页面若必填项已全部映射则直接跳到保存，
    //        未填才逐行快速填（200+150ms）；点击用 evaluate DOM click 避免 mouse over 事件冗余等待。
    const variantThemeMap = profile.variantThemeMap || {};
    const mapped = [];
    if (Object.keys(variantThemeMap).length > 0) {
      const rows = page.locator("table tbody tr");
      const rowCount = await rows.count();
      // 第一遍：扫页面所有「对应速卖通变种主题」select 是否已全部填好
      // 「已映射」= 必填项全部已填：selText 非空、不是 placeholder、且等于目标值。
      // 之前的写法误把 selText===target 与 placeholder 都塞进 continue 分支，导致 placeholder=true（未填）也被 skip，
      // allMapped 永远 = true → 循环永不填。即便配合下面的 for 兜底，placeholder 行也无法进入自动填。
      let allMapped = true;
      if (rowCount > 0) {
        const rowSummary = await rows.evaluateAll((rs, map) => {
          return rs.map((r) => {
            const firstCell = (r.querySelector("td")?.innerText || "").trim();
            const sel = r.querySelector(".ant-select");
            const selText = (sel?.innerText || "").trim();
            const placeholder = !!sel?.querySelector(".ant-select-selection-placeholder");
            return { firstCell, selText, placeholder, target: map[firstCell] || null };
          });
        }, variantThemeMap);
        for (const it of rowSummary) {
          if (!it.target) continue;
          // 未填 或 已填不等于目标 → 视为未映射
          if (it.placeholder || !it.selText || it.selText !== it.target) {
            allMapped = false;
            break;
          }
        }
      }
      if (allMapped && rowCount > 0) {
        console.log("[dianxiaomi] 映射页：变种主题已自动填好，跳过循环");
      } else {
        for (let i = 0; i < rowCount; i++) {
          try {
            const row = rows.nth(i);
            const firstCell = row.locator("td").first();
            const themeText = (await firstCell.innerText().catch(() => "")).trim();
            const target = variantThemeMap[themeText];
            if (!target) continue;
            const select = row.locator(".ant-select").first();
            if (await select.count() === 0 || !(await select.isVisible().catch(() => false))) continue;
            // 快速：evaluate click 避免 mouseover/hover 等待
            await select.evaluate((el) => el.click()).catch(() => {});
            await sleep(250);
            // 在浮层下拉框里找选项（精确匹配 target）
            const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option-content")
              .filter({ hasText: new RegExp(`^\\s*${escapeRegex(target)}\\s*$`) }).first();
            if (await option.count() > 0 && await option.isVisible().catch(() => false)) {
              await option.evaluate((el) => el.click()).catch(() => {});
              mapped.push({ theme: themeText, target });
            } else {
              // 兜底：按 ESC 关闭下拉框，不阻塞
              await page.keyboard.press("Escape").catch(() => {});
            }
            await sleep(150);
          } catch (e) {
            // 单个主题映射失败不阻塞整体保存
            await page.keyboard.press("Escape").catch(() => {});
          }
        }
      }
    }

    // 5) 保存并进入下一步（共用 clickSaveAndNext 方法，采集/引用路径都可用）
    await this.clickSaveAndNext();

    return { ok: true, url: this.page.url(), mapped, state };
  }

  // 点击「保存，下一步 / 保存并下一步」按钮，处理新标签页跳转。
  // 共用于采集箱路径（编辑分类后）和引用路径（如需新增分类中间页）。
  async clickSaveAndNext() {
    await this.connect();
    let page = this.page;
    const context = page.context();
    const newPagePromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await page.locator("button").filter({ hasText: /保存[，并]?下一步|保存下一步/ }).first().click({ timeout: 8000 }).catch(() => {
      return clickVisibleByText(page, "保存，下一步", 8000);
    });
    const newPage = await awaitRealPage(newPagePromise, 8000);
    if (newPage && !newPage.isClosed()) {
      this.page = newPage;
      page = newPage;
    }
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(1500);
    return { ok: true, url: page.url() };
  }

  // ★ 共用：在「更换分类」弹窗里搜索并选择目标类目。引用 C-2 与采集箱改类目都调它。
  // 流程：点「更换分类」链接 → 弹窗搜索框填值 → 点搜索 → 点搜索结果 → （选「选择」）→ 等弹窗关。
  async changeCategoryViaModal(categoryName) {
    const target = String(categoryName || "").trim();
    if (!target) return { ok: false, reason: "no-category-specified" };
    await this.connect();
    const page = this.page;
    // 1) 点「更换分类」链接（exact text）
    const changeLink = page.locator("a, button, span").filter({ hasText: /^更换分类$/ }).first();
    try {
      await changeLink.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      return { ok: false, reason: "change-category-link-not-found", target };
    }
    await changeLink.click();
    // 2) 等弹窗
    const modal = page.locator(".ant-modal:visible").first();
    try {
      await modal.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      return { ok: false, reason: "category-modal-not-opened", target };
    }
    await page.waitForTimeout(400);
    // 3) 搜索框填值 + 点搜索
    const searchInput = modal.locator('input[placeholder*="搜索"], input[type="text"]').first();
    try {
      await searchInput.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      return { ok: false, reason: "search-input-not-found", target };
    }
    await searchInput.fill(target);
    const searchBtn = modal.locator("button").filter({ hasText: /^搜索$/ }).first();
    await searchBtn.click();
    // 4) 等搜索结果，点含目标文本的那一条（优先 ant-select 选项，兜底按文本匹配，避免匹配到面包屑父类目）
    await page.waitForTimeout(1000);
    let resultItem = modal.locator(".ant-select-dropdown:visible .ant-select-item-option-content").filter({ hasText: target }).first();
    if (await resultItem.count() === 0) {
      resultItem = modal.locator(".ant-modal-body button, .ant-modal-body li, .ant-list-item").filter({ hasText: target }).first();
    }
    try {
      await resultItem.waitFor({ state: "visible", timeout: 5000 });
    } catch {
      return { ok: false, reason: "search-result-not-found", target };
    }
    await resultItem.click();
    await page.waitForTimeout(400);
    // 5) 点弹窗底部「选择」确认（部分 UI 是单击结果即关，部分需要二次确认；都兼容）
    const selectBtn = modal.locator("button").filter({ hasText: /^选择$/ }).first();
    if (await selectBtn.isVisible().catch(() => false)) {
      await selectBtn.click();
    }
    // 6) 等弹窗关
    try {
      await modal.waitFor({ state: "hidden", timeout: 10000 });
    } catch {
      /* 兼容：有些 UI 关得很快或自动关，不阻断 */
    }
    await page.waitForTimeout(300);
    return { ok: true, value: target };
  }

  // ★ 引用路径分类更改（C-2）：点击「更换分类」链接，在弹窗里搜索 xlsx 填写的精确类目标签，点结果后
  //   关弹窗，再点主页面「保存，下一步」。仅当 row.category 不是已知 profile key 时调用（即用户填了
  //   精确叶子类目如「便携式折叠包」而非 profile key 如「xiangBaoFold」）。
  async changeCategoryTo(categoryName) {
    const res = await this.changeCategoryViaModal(categoryName);
    if (!res.ok) return res;
    // 弹窗改完类目后，主页面点「保存，下一步」收尾（与采集路径 collectDraftCategory 末尾一致）
    const sn = await this.clickSaveAndNext();
    return { ok: true, value: res.value, saveNext: sn };
  }

  // 采集箱每行「编辑保存」后置：行内「更多 → 添加备注（默认 待上架）→ 提交」，再点操作列「移入待发布」。
  // 选「操作」列直链「移入待发布」而不是「更多」下拉里的「保存并移入待发布」：前者一步、不依赖下拉可见性。
  // 失败 try/catch 包裹不抛——本步为辅助，不阻断 done 状态；失败原因回传 server 写进 item.reason。
  async markCollectRowAsPending(searchTitle, opts = {}) {
    const remark = (opts.remark || "待上架").toString().trim();
    const skipRemark = !!opts.skipRemark;
    const skipMove = !!opts.skipMoveToPending;
    const log = opts.log || ((m) => console.log("[dianxiaomi] markCollect: " + m));
    const out = { ok: true, remark: null, movedToPending: null, steps: [], reason: "" };
    try {
      log(`打开采集箱 (searchTitle=${searchTitle})`);
      await this.openCollectBox();
      out.steps.push("openCollectBox");
      // 清场：关闭所有残留 modal/drawer/dropdown（编辑流程里可能弹出"分类映射"中间页 / 列设置 / 筛选 dialog），
      // 否则后续 search 会被遮挡，.first() 元素不可点击。
      await this._dismissAllOverlays().catch(() => {});
      log("搜索标题");
      await this.searchCollectBox(searchTitle);
      out.steps.push("search");
      // 等表格行出现（vxe body）
      await this.page.waitForSelector(".vxe-body--row", { timeout: 10000 }).catch(() => {});
      await sleep(800);
      const rowCount = await this.page.locator(".vxe-body--row").count();
      if (!rowCount) throw new Error(`采集箱搜索后无行 (searchTitle=${searchTitle})`);
      log(`匹配 ${rowCount} 行，取第 1 行`);
      // 3) 备注
      if (!skipRemark) {
        log("更多→添加备注");
        const moreBtn = this.page.locator(".vxe-body--row").first().locator("button.ant-dropdown-trigger").last();
        await moreBtn.click({ timeout: 8000, force: true });
        await this.page.waitForTimeout(800);
        const addMemoItem = this.page.locator(".ant-dropdown-menu-item:visible").filter({ hasText: "添加备注" }).first();
        await addMemoItem.click({ timeout: 5000, force: true });
        await this.page.waitForTimeout(1500);
        const ta = this.page.locator("textarea[placeholder*='请填写您要备注的内容']:visible").first();
        await ta.fill(remark, { timeout: 5000 });
        // 提交按钮（在 ant-modal 里精确匹配「提交」字样，避免误中主页面顶部「保存」等）
        const submitBtn = this.page.locator(".ant-modal:visible button").filter({ hasText: /^提交$/ }).first();
        await submitBtn.click({ timeout: 5000, force: true });
        // 等 modal 关闭
        try { await this.page.waitForFunction(() => !document.querySelector(".ant-modal-wrap:not([style*='display: none'])"), null, { timeout: 6000 }); }
        catch (ex) { log(`备注 modal 关闭超时(非致命): ${ex.message}`); }
        out.remark = remark;
        out.steps.push("remark");
        log("备注提交完成");
      }
      // 4) 移入待发布（操作列直链按钮）
      if (!skipMove) {
        // DOM 可能在备注后刷新（搜索+列表可能在某些情况下重新渲染），重新定位
        await this.page.waitForTimeout(500);
        await this.page.waitForSelector(".vxe-body--row", { timeout: 5000 }).catch(() => {});
        log("操作列→移入待发布");
        const moveBtn = this.page.locator(".vxe-body--row").first().locator("button").filter({ hasText: /^移入待发布$/ }).first();
        const hasMove = await moveBtn.count();
        if (!hasMove) {
          // 草稿状态可能没有「移入待发布」（已是待发布/已发布）—— 视为跳过非错误
          log("操作列无「移入待发布」按钮（已非草稿状态？），跳过移入");
          out.movedToPending = "skipped";
        } else {
          await moveBtn.click({ timeout: 8000, force: true });
          await this.page.waitForTimeout(1200);
          // 二次确认：ant-modal-confirm / 简化 ant-modal
          const confirmBtn = this.page.locator(".ant-modal-confirm-btns button, .ant-modal:visible button").filter({ hasText: /^确定$|^确认$/ }).first();
          if (await confirmBtn.count() > 0) {
            log("二次确认→确定");
            await confirmBtn.click({ timeout: 5000, force: true });
            await this.page.waitForTimeout(1000);
          }
          out.movedToPending = true;
        }
        out.steps.push("moveToPending");
      }
      return out;
    } catch (e) {
      out.ok = false;
      out.reason = e && e.message ? e.message : String(e);
      log(`FAILED at step ${out.steps.join("→") || "(init)"}: ${out.reason}`);
      return out;
    }
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
