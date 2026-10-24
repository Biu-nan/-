// 店小秘创建产品页 · 字段框架枚举（只读探索）
// 连接 Chrome CDP(9223)，复用已登录的店小秘标签页，进入创建产品页，
// 枚举所有表单字段（section / label / 类型 / 必填 / 选项），输出 JSON。
// 纯只读：打开页面、读 DOM，不点击"引用/保存"等任何写操作。

import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9223);
const OUT_FILE = path.join(process.cwd(), "dianxiaomi-field-framework.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findDianxiaomiPage(browser) {
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      if (!page.isClosed() && page.url().includes("dianxiaomi.com")) return page;
    }
  }
  return undefined;
}

// 在页面中点击包含指定文字的可点击元素（按钮/链接/菜单项）
async function clickByText(page, text, timeout = 15000) {
  const candidates = page.locator(`text=${JSON.stringify(text)}`);
  const count = await candidates.count();
  if (count === 0) throw new Error(`找不到包含「${text}」的元素`);
  // 优先点可见的
  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 5000 });
      return i;
    }
  }
  await candidates.first().click({ timeout: 5000 });
  return 0;
}

async function main() {
  console.log("[1] 连接 CDP ...");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
  // 自动接受任何 JS 确认/告警对话框，避免阻塞枚举（延迟接受避免竞态）
  browser.on("dialog", (dialog) => {
    setTimeout(() => dialog.accept().catch(() => {}), 50);
  });

  let page = await findDianxiaomiPage(browser);
  if (!page) {
    console.log("[!] 未找到店小秘标签页，新开一页并导航到 home");
    page = await browser.contexts()[0].newPage();
  }
  console.log("[2] 复用店小秘标签页:", page.url());

  const targetUrl = process.argv[2];
  if (targetUrl && !page.url().includes("/web/smt/add")) {
    console.log("[3] 直接导航到创建产品页:", targetUrl);
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  } else {
    console.log("[3] 标签页已在创建产品页，跳过导航");
  }
  if (!targetUrl && !page.url().includes("/web/smt/add") && !page.url().includes("/web/product")) {
    console.log("[3] 尝试进入「创建产品」...");
    try {
      await clickByText(page, "产品", 8000);
      await sleep(800);
      await clickByText(page, "创建产品", 8000);
    } catch (err) {
      console.log("[!] 自动点击失败，尝试直接找创建产品链接:", err.message);
    }
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await sleep(2000);
  console.log("[4] 当前 URL:", page.url());

  // 等待表单容器出现（店小秘是 SPA，给足时间）
  console.log("[6] 等待创建产品表单渲染 ...");
  await page.waitForSelector("form, .el-form, [class*='create'], input, textarea, select", { timeout: 20000 }).catch(() => {});
  await sleep(3000);

  console.log("[7] 枚举字段 ...");
  if (process.env.DEBUG) await page.evaluate(() => { window.__DEBUG__ = true; }).catch(() => {});
  const result = await page.evaluate(() => {
    const txt = (n) => (n && n.innerText ? n.innerText : "").toString();
    const DASH_RX = /[\-‑—–~｜|]+/g;
    // 定位真正的 .ant-form-item 行容器（注意：rc-select 自身带 ant-select-in-form-item，
    // 不能用 [class*='form-item'] 子串匹配，否则会误命中 select 自身）
    const findFormItem = (el) => {
      const direct = el.closest(".ant-form-item");
      if (direct) return direct;
      let anc = el.parentElement;
      let depth = 0;
      while (anc && anc !== document.body && depth < 10) {
        const hasLabel = anc.querySelector(":scope > .ant-form-item-label, [class*='form-item-label']");
        const hasControl = anc.querySelector(":scope > .ant-form-item-control, [class*='form-item-control']");
        if (hasLabel || hasControl) return anc;
        anc = anc.parentElement;
        depth += 1;
      }
      return null;
    };
    // 占位符提示词（纯提示，不算字段名）
    const isPlaceholderHint = (s) => /^(请选择|请输入|选择|输入|请填写|未设置|暂无)$/.test(s.trim());
    const clean = (s) => (s || "").replace(/\*/g, " ").replace(DASH_RX, " ").replace(/\s+/g, " ").trim();
    const cleanSection = (s) => clean(s)
      .replace(/请选择【.+?】/g, "")
      .replace(/请选择/g, "")
      .replace(/（收起）|\(收起\)|\( 收起 \)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    // 取某祖先元素"自身标签文本"：剔除其内部所有控件/占位符文本后的剩余文字
    const ownLabelText = (anc, control) => {
      let t = txt(anc);
      const nested = anc.querySelectorAll("input, select, textarea, [class*='placeholder'], [class*='selection-item'], [role='combobox']");
      for (const c of nested) {
        if (c === control) continue;
        const ct = txt(c).trim();
        if (ct && t.includes(ct)) t = t.replace(ct, " ");
      }
      const ctrlText = txt(control).trim();
      if (ctrlText && t.includes(ctrlText)) t = t.replace(ctrlText, " ");
      return clean(t);
    };
    // 统一计算控件 label：
    //  1) 标准 .ant-form-item-label（最准）
    //  2) 从控件向上爬，取最近的"局部标签"（含 请选择【X】模板 这类）
    const computeLabel = (el) => {
      // 0) 组合框占位符常含真实字段名：请选择【产品属性模板】→ 产品属性模板
      const isCombo = el.getAttribute && (el.getAttribute("role") === "combobox" || (el.classList && el.classList.contains("rc-select-selection-search-input")));
      if (isCombo) {
        const sel = el.closest(".ant-select, [class*='select']");
        if (sel) {
          const ph = sel.querySelector("[class*='placeholder']");
          const pt = ph ? txt(ph) : "";
          const mm = pt.match(/请选择【(.+?)】/) || pt.match(/请选择(.+?)(模板)?\s*$/);
          if (mm && mm[1]) return mm[1].replace(DASH_RX, " ").trim().slice(0, 60);
        }
      }
      const fi = el.closest(".ant-form-item");
      if (fi) {
        const lr = fi.querySelector(".ant-form-item-label, [class*='form-item-label']");
        if (lr) {
          const lt = clean(txt(lr));
          if (lt && !isPlaceholderHint(lt)) return lt.slice(0, 60);
        }
      }
      let anc = el.parentElement;
      while (anc && anc !== document.body) {
        const ol = ownLabelText(anc, el);
        if (ol) {
          // 模板类标签：请选择【产品属性模板】→ 产品属性模板
          const m = ol.match(/请选择【(.+?)】/) || ol.match(/请选择(.+?)(模板|$)/);
          if (m) return (m[1] || ol).slice(0, 60);
          if (ol.length >= 2 && ol.length <= 24 && !isPlaceholderHint(ol)) return ol.slice(0, 60);
        }
        anc = anc.parentElement;
      }
      return "";
    };
    // 已知组合框的"真实字段名"覆盖（这些字段的 label 以 请选择【X】 形式渲染在卡片内，
    // 自动化爬取会误抓卡片首个嵌套 label，这里显式校正）
    const LABEL_OVERRIDE = {
      rc_select_2: "产品属性模板",
      rc_select_3: "变种模板",
      rc_select_6: "区域调价模板",
      rc_select_7: "区域调价(商品编码/发货期限)",
      rc_select_9: "产品模板"
    };

    const fields = [];
    const seen = new Set();
    const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
    for (const el of inputs) {
      const tag = el.tagName.toLowerCase();
      const type = (el.type || tag).toLowerCase();
      if (["hidden", "file", "submit", "button", "reset"].includes(type)) continue;
      const key = `${tag}#${el.id}#${el.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const formItem = findFormItem(el);

      // label：已知组合框覆盖优先（这些字段自动化爬取会误抓卡片首个嵌套 label）
      let label = LABEL_OVERRIDE[el.id] || computeLabel(el);
      if (!label) {
        const cl = el.closest("label");
        if (cl) label = txt(cl).trim();
      }
      if (!label) label = el.getAttribute("aria-label") || "";
      if (!label) label = el.getAttribute("placeholder") || "";

      // section / 卡片标题
      let section = "";
      let anc = el;
      while (anc && anc !== document.body) {
        const hit = anc.querySelector(":scope > legend, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > [class*='title'], :scope > [class*='card-head'], :scope > [class*='section']");
        const st = txt(hit).replace(DASH_RX, " ").replace(/\s+/g, " ").trim();
        if (hit && st && !isPlaceholderHint(st)) { section = st.slice(0, 50); break; }
        anc = anc.parentElement;
      }
      if (!section && formItem) {
        const card = formItem.closest("[class*='card'], [class*='Card']");
        if (card) {
          const ch = card.querySelector("[class*='title'], [class*='head']");
          const cst = txt(ch).replace(DASH_RX, " ").replace(/\s+/g, " ").trim();
          if (ch && cst && !isPlaceholderHint(cst)) section = cst.slice(0, 50);
        }
      }

      let options = [];
      if (tag === "select") {
        options = Array.from(el.options).map((o) => o.text.trim()).filter(Boolean).slice(0, 60);
      } else if (type === "search" || el.classList.contains("rc-select-selection-search-input")) {
        options = ["<combobox>"];
      }

      fields.push({
        tag,
        type,
        name: el.name || "",
        id: el.id || "",
        formItemId: (formItem && (formItem.id || "")) || "",
        label: label.slice(0, 100),
        placeholder: el.getAttribute("placeholder") || "",
        required: (el.getAttribute("aria-required") === "true") || el.required || el.getAttribute("required") !== null || (formItem && (formItem.className || "").includes("required")),
        section: cleanSection(section).slice(0, 60),
        options
      });

      const DEBUG = (typeof process !== "undefined" && process.env && process.env.DEBUG) || window.__DEBUG__;
      if (DEBUG) {
        if (!window.__DBG__) window.__DBG__ = [];
        if (el.id.startsWith("rc_select") || !label) {
          window.__DBG__.push({
            id: el.id,
            type,
            formItemClass: formItem ? formItem.className.slice(0, 80) : "(none)",
            formItemText: formItem ? txt(formItem).slice(0, 120) : "(none)",
            labelRegionText: formItem ? txt(formItem.querySelector(".ant-form-item-label, [class*='form-item-label']")).slice(0, 80) : "(none)",
            controlPlaceholder: el.getAttribute("placeholder") || "(none)",
            extractedLabel: label
          });
        }
      }
    }
    const debug = (typeof window !== "undefined" && window.__DBG__) || [];
    return {
      url: location.href,
      title: document.title,
      total: fields.length,
      fields,
      debug
    };
  });

  await writeFile(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`[8] 已枚举 ${result.total} 个字段，写入 ${OUT_FILE}`);
  console.log("     URL:", result.url);
  console.log("     前 10 个字段:");
  for (const f of result.fields.slice(0, 10)) {
    console.log(`       [${f.section}] ${f.label} (${f.tag}/${f.type})${f.required ? " *必填" : ""}`);
  }
  if (process.env.DEBUG && result.debug && result.debug.length) {
    console.log("\n[DEBUG] 原始字段探测:");
    for (const d of result.debug) {
      console.log("  id=" + d.id + " type=" + d.type);
      console.log("    formItemClass : " + d.formItemClass);
      console.log("    formItemText  : " + JSON.stringify(d.formItemText));
      console.log("    labelRegion   : " + JSON.stringify(d.labelRegionText));
      console.log("    placeholder   : " + JSON.stringify(d.controlPlaceholder));
      console.log("    extractedLabel: " + JSON.stringify(d.extractedLabel));
    }
  }
  await browser.close();
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
