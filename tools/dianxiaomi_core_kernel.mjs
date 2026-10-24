#!/usr/bin/env node
/**
 * 店小秘上品「可移植内核」· 箱包配件（profileKey = xiangBao）
 *
 * 特点：
 *   - 不 import 工作台任何模块、不连 3000 服务、不占工作台单实例 —— 可整段搬进你自己的项目
 *   - 唯一依赖 playwright-core，通过 CDP 连已登录的 Chrome（店小秘后台）
 *   - 默认【只保存草稿、不发布】—— 发布闸门留在人工手里
 *
 * 前置：chrome.exe --remote-debugging-port=9223 --user-data-dir=<你的 profile>，并登录店小秘
 *
 * 用法：
 *   node tools/dianxiaomi_core_kernel.mjs \
 *     --facts "F:/facts.json" --images "F:/img/a.jpg,F:/img/b.jpg" \
 *     --template "1005012741652735" --mode reference
 *
 * 环境变量：CDP=http://127.0.0.1:9223
 *
 * ⚠ 标注 [需实测校准] 的选择器：店小秘改版时最容易失效，跑一次确认后固化。
 */

import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import path from "node:path";

const CDP = process.env.CDP || "http://127.0.0.1:9223";

// ── 箱包配件 profile 常量（与 dist/src/config.js xiangBao 一致）──
const XIANG_BAO = {
  url: "https://www.dianxiaomi.com/web/smtChoice/add",
  draftUrl: "https://www.dianxiaomi.com/web/smtChoice/draft",
  templateProductId: "1005012741652735",
  storeName: "自营箱包全托2店",
  stockType: "国内履约",           // 注意：不是「国内备货」
  category: "箱包配件(Bag Parts & Accessories)",
  logistics: "普货",
  attrs: {
    type: "rc_select_13",        // 类型(Type)
    material: "rc_select_15",    // 材质(Material)
    brand: "rc_select_11",       // 品牌(Brand Name)
    origin: "rc_select_14",      // 产地（国家或地区）
  },
  customs: { mode: "添加全球海关监管属性", hsCode: "8308909000", kind: "其他" },
  compliance: { euResponsible: "GET RICH", manufacturer: "Yiwu Sumu Arts and Crafts Co., Ltd" },
  packageSize: { l: "15", w: "10", h: "5" },   // cm，必填，源无值时兜底
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const a = { images: [] };
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i], v = process.argv[++i];
    if (k === "--facts") a.facts = v;
    else if (k === "--images") a.images = String(v).split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--template") a.template = v || XIANG_BAO.templateProductId;
    else if (k === "--mode") a.mode = v || "reference";     // reference | collect
    else if (k === "--draft-title") a.draftTitle = v;        // 采集箱模式：按标题定位草稿行
    else if (k === "--publish") a.publish = v === "true";   // 默认 false
  }
  if (!a.facts) throw new Error("缺少 --facts（产品事实 JSON 路径）");
  return a;
}

class DianxiaomiBot {
  constructor(page) { this.page = page; }
  stage(name) { console.log("[stage]", name); }

  /** 按 label 文本在 ant-form-item 内找 input 并填值（回读校验，失败重试一次） */
  async fillInputByLabel(label, value) {
    if (!value) return { ok: false, reason: "empty-value" };
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
    }, label);
    const inp = handle.asElement();
    if (!inp) return { ok: false, reason: "input-not-found:" + label };
    const setValue = async (val) => {
      await inp.click({ timeout: 5000 }).catch(() => {});
      await inp.focus();
      await this.page.keyboard.press("Control+A");
      await this.page.keyboard.press("Delete");
      await this.page.keyboard.type(String(val), { delay: 10 });
      await this.page.keyboard.press("Tab").catch(() => {});
      await sleep(300);
    };
    await setValue(value);
    let actual = await inp.evaluate((el) => el.value || "").catch(() => "");
    if (String(actual).trim() !== String(value).trim()) {
      await sleep(500);
      await setValue(value);
      actual = await inp.evaluate((el) => el.value || "").catch(() => "");
    }
    return { ok: String(actual).trim() === String(value).trim(), field: label };
  }

  /** Ant Select：按 rc_select id 展开并选值（精确优先，其次包含） */
  async selectById(id, value) {
    if (!value) return { skipped: true, reason: "empty-value" };
    await this.page.mouse.click(5, 5).catch(() => {});
    await sleep(400);
    const box = await this.page.evaluate((selId) => {
      const input = document.querySelector("#" + selId);
      const sel = (input && input.closest(".ant-select")) || document.querySelector("#" + selId);
      if (!sel) return null;
      sel.scrollIntoView({ block: "center" });
      const trig = sel.querySelector(".ant-select-selector") || sel;
      const r = trig.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
    if (!box) return { ok: false, reason: "select-not-found:" + id };
    await this.page.mouse.click(box.x, box.y);
    await sleep(600);
    const searchInput = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) input");
    if (await searchInput.count()) {
      await searchInput.first().fill(value).catch(() => {});
      await this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
        .first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      await sleep(300);
    }
    const opts = this.page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content");
    const exact = opts.filter({ hasText: new RegExp(`^${value}$`) });
    const contains = opts.filter({ hasText: value });
    if (await exact.count()) await exact.first().click({ timeout: 5000 });
    else if (await contains.count()) await contains.first().click({ timeout: 5000 });
    else { await this.page.mouse.click(5, 5).catch(() => {}); return { ok: false, reason: `no-option:${id}=${value}` }; }
    await sleep(400);
    return { ok: true, id, value };
  }

  /** 按 label 定位的 Ant Select（id 失效时的兜底） */
  async selectByLabel(label, value) {   // [需实测校准]
    const id = await this.page.evaluate((kw) => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (lab && lab.innerText.includes(kw)) {
          const inp = item.querySelector(".ant-select input, input");
          if (inp && inp.id) return inp.id;
        }
      }
      return null;
    }, label);
    if (!id) return { ok: false, reason: "label-select-not-found:" + label };
    return this.selectById(id, value);
  }

  /** 属性双通道：先 id，失败回落 label（箱包 rc_select 会重排，label 更稳） */
  async applyAttribute(label, id, value) {
    try { const r = await this.selectById(id, value); if (r?.ok) return { ok: true, via: "id", value }; } catch {}
    try { const r = await this.selectByLabel(label, value); if (r?.ok) return { ok: true, via: "label", value }; } catch {}
    return { ok: false, reason: "not-found", label, id, value };
  }

  /** CKEditor 描述框：优先写隐藏 textarea 并派发 input，其次写 iframe 正文 */
  async fillCkeditorByLabel(label, value) {   // [需实测校准]
    if (!value) return { ok: false, reason: "empty-value" };
    const ok = await this.page.evaluate(({ kw, text }) => {
      const items = Array.from(document.querySelectorAll(".ant-form-item, [class*=form-item]"));
      for (const item of items) {
        const lab = item.querySelector(".ant-form-item-label label, label");
        if (!lab || !lab.innerText.includes(kw)) continue;
        const ta = item.querySelector("textarea");
        if (ta) {
          ta.value = text;
          ta.dispatchEvent(new Event("input", { bubbles: true }));
          ta.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }
        const frame = item.querySelector("iframe");
        if (frame && frame.contentDocument) {
          const body = frame.contentDocument.querySelector("body[contenteditable], .cke_editable");
          if (body) { body.innerHTML = text; return true; }
        }
      }
      return false;
    }, { kw: label, text: value });
    await sleep(500);
    return { ok, field: label };
  }

  /** 上传产品图：店小秘图片选择器的 file input */
  async uploadImages(files) {   // [需实测校准]
    if (!files?.length) return { ok: true, skipped: true };
    const input = this.page.locator('input[type="file"]').first();
    await input.setInputFiles(files, { timeout: 120_000 });
    for (let i = 0; i < 90; i++) {
      const pending = await this.page.locator(".ant-upload-list-item-progress, .animate-pulse").count();
      if (pending === 0) break;
      await sleep(1000);
    }
    return { ok: true, count: files.length };
  }

  /** 引用产品模板：必须最先执行，模板会一次性带入海关/产品属性/物流/合规 */
  async referenceProduct(templateId) {
    this.stage("引用产品模板");
    await this.page.keyboard.press("Escape").catch(() => {});
    await this.page.mouse.click(5, 5).catch(() => {});
    await sleep(400);
    const refBtn = this.page.locator("button:has-text('引用产品')").first();
    await refBtn.waitFor({ state: "visible", timeout: 15_000 });
    await refBtn.click({ timeout: 5000 });
    await sleep(1500);
    const item = this.page.locator(".ant-dropdown:visible").last()
      .locator('.ant-dropdown-menu-item:has-text("引用现有产品")');
    await item.waitFor({ state: "visible", timeout: 10_000 }).catch(async () => {
      await sleep(3000);
      if (!await item.isVisible().catch(() => false)) throw new Error("未出现「引用现有产品」选项");
    });
    await item.click({ timeout: 5000 });
    await sleep(2000);

    const idTab = this.page.locator(".d-tag-group-item", { hasText: "产品ID" }).first();
    if (await idTab.count()) {
      await idTab.click({ timeout: 5000 });
      await sleep(800);
      if (!await idTab.evaluate((el) => el.classList.contains("active"))) {
        await idTab.click({ timeout: 3000 });
        await sleep(800);
      }
    }
    // 在引用面板内填模板 ID 并搜索
    const searchBox = this.page.locator(".d-tag-group-wrapper").locator('xpath=ancestor::*[contains(@class,"modal") or contains(@class,"Modal") or @role="dialog"][1]')
      .locator('input[type="text"]').first();
    await searchBox.fill(templateId).catch(async () => {
      await this.page.locator('input[type="text"]:visible').first().fill(templateId);
    });
    await sleep(500);
    await this.page.locator("button:has-text('搜索')").first().click({ timeout: 5000 }).catch(() => {});
    await sleep(2500);
    // 勾选第一行并按确定
    const firstRow = this.page.locator(".ant-table-tbody tr, .vxe-body--row").first();
    await firstRow.locator('input[type="checkbox"], .ant-checkbox-input').first().check({ timeout: 5000 }).catch(async () => {
      await firstRow.click({ timeout: 3000 });
    });
    await this.page.locator("button:has-text('确定'), button:has-text('引用')").last().click({ timeout: 8000 });
    await sleep(3000);
    return { ok: true, templateId };
  }

  async save({ publish = false } = {}) {   // [需实测校准] 按钮文案以页面为准
    this.stage(publish ? "保存并发布" : "保存草稿");
    const btn = publish
      ? this.page.locator("button:has-text('保存并发布'), button:has-text('发布')").first()
      : this.page.locator("button:has-text('保存')").first();
    await btn.waitFor({ state: "visible", timeout: 15_000 });
    await btn.click({ timeout: 8000 });
    await sleep(4000);
    const err = await this.page.locator(".ant-message-error, .ant-form-item-explain-error").first()
      .innerText().catch(() => "");
    return { ok: !err, error: err || undefined };
  }
}

async function main() {
  const args = parseArgs();
  const facts = JSON.parse(await readFile(args.facts, "utf8"));
  const p = XIANG_BAO;

  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((x) => x.url().includes("dianxiaomi.com")) || (await ctx.newPage());
  const bot = new DianxiaomiBot(page);

  if (args.mode === "collect") {
    await page.goto(p.draftUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    // 采集箱：按标题搜到草稿行并点编辑（长英文标题搜不到时，取前两个词重试）
    const title = facts?.title?.en || args.draftTitle || "";
    const trySearch = async (kw) => {
      await page.locator('input[placeholder*="标题"], input[placeholder*="搜索"]').first().fill(kw);
      await page.locator("button:has-text('搜索')").first().click({ timeout: 5000 }).catch(() => {});
      await sleep(2500);
      return page.locator(".vxe-body--row").count();
    };
    let n = await trySearch(title);
    if (n === 0) n = await trySearch(title.split(/\s+/).slice(0, 2).join(" "));
    if (n === 0) throw new Error(`采集箱未找到草稿：${title}`);
    await page.locator(".vxe-body--row").first().locator("button:has-text('编辑')").first().click({ timeout: 8000 });
    await sleep(6000);
  } else {
    await page.goto(p.url, { waitUntil: "domcontentloaded" });
    await sleep(4000);
  }

  const log = [];

  // 0) 引用产品模板 —— 必须最先
  if (args.mode === "reference") {
    log.push({ step: "reference", ...(await bot.referenceProduct(args.template || p.templateProductId)) });
  }

  // 1) AI 板块
  bot.stage("AI 板块");
  await bot.fillInputByLabel("产品标题", facts?.title?.en || facts?.title?.zh).then((r) => log.push({ step: "title", ...r }));
  await bot.applyAttribute("类型", p.attrs.type, facts?.type || facts?.mainKeyword).then((r) => log.push({ step: "type", ...r }));
  await bot.applyAttribute("材质", p.attrs.material, facts?.material).then((r) => log.push({ step: "material", ...r }));
  await bot.applyAttribute("品牌", p.attrs.brand, facts?.brand || "NONE").then((r) => log.push({ step: "brand", ...r }));
  await bot.applyAttribute("产地", p.attrs.origin, facts?.origin?.country).then((r) => log.push({ step: "origin", ...r }));
  if (args.mode === "reference" && args.images.length) {
    await bot.uploadImages(args.images).then((r) => log.push({ step: "images", ...r }));
  }
  await bot.fillCkeditorByLabel("PC端描述", facts?.description?.pc).then((r) => log.push({ step: "pcDesc", ...r }));

  // 2) 备货类型（必填）
  await bot.applyAttribute("备货类型", "", p.stockType).then((r) => log.push({ step: "stockType", ...r }));
  // 3) 物流属性
  await bot.applyAttribute("物流属性", "", p.logistics).then((r) => log.push({ step: "logistics", ...r }));
  // 4.7) 包装尺寸（必填，源无值用 15/10/5）
  const ps = facts?.packageSize || p.packageSize;
  await bot.fillInputByLabel("长", ps.l).catch(() => {});
  await bot.fillInputByLabel("宽", ps.w).catch(() => {});
  await bot.fillInputByLabel("高", ps.h).catch(() => {});
  // 5) 合规 + 6) 海关（引用模式一般由模板带入，这里做兜底覆盖）
  await bot.fillInputByLabel("欧盟责任人", p.compliance.euResponsible).catch(() => {});
  await bot.fillInputByLabel("品牌制造商", p.compliance.manufacturer).catch(() => {});

  // 7) 保存（默认只存草稿）
  const saved = await bot.save({ publish: args.publish });
  log.push({ step: "save", ...saved });

  console.log(JSON.stringify(log, null, 2));
  console.log("[done] 页面：", page.url());
  await browser.close();
}

main().catch((e) => { console.error("[fail]", e.message); process.exit(1); });
