// agents/ae-product-design/src/style-research.js
// S2：Amazon + 速卖通双源调研。只读公开搜索结果页，不登录、不进商品详情页。
// 抽图用「域名白名单 + 尺寸阈值」启发式，不用易碎的类选择器。

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium } from "playwright-core";
import { CHROME_DEBUG_PORT } from "../../../dist/src/config.js";
import { AgentError, CODES } from "../../_shared/errors.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DOWNLOAD_DELAY_MS = 1200;

const SOURCES = {
  aliexpress: {
    label: "速卖通",
    url: (kw) => `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(kw).replace(/%20/g, "-")}.html`,
    hosts: ["alicdn.com", "aliexpress-media.com", "ae01.alicdn.com"],
    blockHints: ["punish", "/login", "slide to verify"],
  },
  amazon: {
    label: "Amazon",
    url: (kw) => `https://www.amazon.com/s?k=${encodeURIComponent(kw)}`,
    hosts: ["media-amazon.com", "images-amazon.com"],
    blockHints: ["validatecaptcha", "errors/validate", "api-services-support", "robot check"],
  },
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "pack", "pcs", "set", "new", "hot", "sale", "high", "quality",
  "free", "shipping", "wholesale", "drop", "dropship", "2024", "2025", "2026",
]);

/** 从 facts 里找英文标题/类目，构建检索词 */
export function buildKeywords(facts = {}, extra = []) {
  const bag = [];
  const pushText = (value) => {
    if (typeof value === "string") bag.push(value);
    else if (Array.isArray(value)) value.slice(0, 8).forEach(pushText);
    else if (value && typeof value === "object") Object.values(value).slice(0, 12).forEach(pushText);
  };
  for (const key of ["title", "productTitle", "name", "category", "categoryPath", "productType", "keywords", "product"]) {
    if (facts[key] !== undefined) pushText(facts[key]);
  }
  const words = bag
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  const unique = [...new Set(words)].slice(0, 8);
  const queries = [];
  if (unique.length >= 2) queries.push(unique.slice(0, 5).join(" "));
  if (unique.length >= 4) queries.push(unique.slice(0, 6).join(" "));
  for (const kw of extra) if (kw && !queries.includes(kw)) queries.push(kw);
  return queries.slice(0, 3);
}

async function extractCandidates(page, hosts) {
  return page.evaluate((allowedHosts) => {
    const ok = (src) => {
      try {
        const host = new URL(src).hostname;
        return allowedHosts.some((h) => host === h || host.endsWith(`.${h}`) || host.includes(h));
      } catch {
        return false;
      }
    };
    const pick = (img) => {
      const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
      if (!src.startsWith("http") || !ok(src)) return null;
      const w = img.naturalWidth || Number(img.getAttribute("width")) || 0;
      const h = img.naturalHeight || Number(img.getAttribute("height")) || 0;
      if (w < 200 || h < 200) return null;
      let title = (img.alt || "").trim();
      if (title.length < 8) {
        let node = img.parentElement;
        for (let i = 0; i < 5 && node; i += 1) {
          const text = (node.innerText || "").trim();
          if (text.length >= 8) {
            title = text.split("\n")[0];
            break;
          }
          node = node.parentElement;
        }
      }
      return { src, title: title.slice(0, 120) };
    };
    const seen = new Set();
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const item = pick(img);
      if (!item) continue;
      const key = item.src.split("?")[0].replace(/_\d+x\d+\./, ".");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, key });
      if (out.length >= 40) break;
    }
    return out;
  }, hosts);
}

async function looksBlocked(page, hints) {
  const url = page.url().toLowerCase();
  if (hints.some((h) => url.includes(h))) return true;
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) ?? "").catch(() => "");
  const low = text.toLowerCase();
  return ["robot check", "enter the characters", "not a robot", "captcha", "验证", "安全验证"].some((h) =>
    low.includes(h),
  );
}

async function downloadImage(ctx, item, targetPath, referer) {
  try {
    const response = await ctx.request.get(item.src, {
      headers: { "user-agent": UA, referer },
      timeout: 30_000,
    });
    if (!response.ok()) return { ok: false, reason: `HTTP ${response.status()}` };
    const type = response.headers()["content-type"] ?? "";
    if (!type.startsWith("image/")) return { ok: false, reason: `content-type ${type}` };
    const body = await response.body();
    if (body.length < 5_000) return { ok: false, reason: `过小 ${body.length}B` };
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, body);
    return { ok: true, bytes: body.length, type };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

/** 复用上次已下载的竞品图（--resume 或 --reuse-refs 时），避免重复抓取与反爬风险 */
export async function loadExistingRefs(outRoot, maxRefs = 12) {
  const refs = [];
  const sources = {};
  for (const source of Object.keys(SOURCES)) {
    const dir = path.join(outRoot, source);
    const files = (await readdir(dir).catch(() => []))
      .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))
      .sort();
    for (const name of files) {
      if (refs.length >= maxRefs) break;
      refs.push({ file: path.join(dir, name), source, title: name, refIndex: refs.length + 1 });
      sources[source] = { status: "ok", downloaded: (sources[source]?.downloaded ?? 0) + 1 };
    }
  }
  return { refs, sources };
}

export async function collectStyleRefs({ keywords, outRoot, maxRefs = 8, tracer, manualDir }) {
  // 人工投放优先：直接把目录内图片当作参考图（不联网）
  if (manualDir) {
    const dir = path.resolve(manualDir);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((e) => e.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(e.name))
      .map((e) => path.join(dir, e.name))
      .sort()
      .slice(0, maxRefs);
    if (files.length === 0) {
      throw new AgentError(CODES.RESEARCH_EMPTY, `人工参考图目录内没有图片：${dir}`, { manualDir: dir });
    }
    const refs = files.map((file, index) => ({ file, source: "manual", title: path.basename(file), refIndex: index + 1 }));
    await tracer.write("tool.called", {
      tool_call: { name: "fs.read", purpose: "manual-style-refs", count: refs.length },
      validation: { ok: true },
    });
    return { styleSource: "manual", refs, sources: { manual: { status: "ok", downloaded: refs.length } } };
  }
  if (!keywords.length) {
    return {
      styleSource: "none",
      refs: [],
      sources: {},
      note: "无法从产品事实提取英文检索词，请用 --keywords 指定",
    };
  }

  let browser;
  const sources = {};
  const refs = [];
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CHROME_DEBUG_PORT}`);
    const context = browser.contexts()[0] ?? (await browser.newContext({ userAgent: UA }));
    for (const [id, source] of Object.entries(SOURCES)) {
      const record = { status: "pending", found: 0, downloaded: 0, error: null };
      let page;
      try {
        page = await context.newPage();
        let candidates = [];
        for (const query of keywords) {
          await page.goto(source.url(query), { waitUntil: "domcontentloaded", timeout: 45_000 });
          for (let scroll = 0; scroll < 3; scroll += 1) {
            await page.mouse.wheel(0, 2200).catch(() => {});
            await page.waitForTimeout(1200);
          }
          if (await looksBlocked(page, source.blockHints)) {
            record.error = `反爬/登录墙（${query}）`;
            break;
          }
          candidates = await extractCandidates(page, source.hosts).catch(() => []);
          if (candidates.length >= 4) break;
        }
        record.found = candidates.length;
        if (candidates.length === 0) {
          record.status = "failed";
          record.error ??= "未抽到符合条件的图片";
        } else {
          for (const [index, item] of candidates.slice(0, maxRefs).entries()) {
            const hash = createHash("sha1").update(item.key).digest("hex").slice(0, 10);
            const ext = item.src.toLowerCase().includes(".png") ? ".png" : ".jpg";
            const file = path.join(outRoot, id, `${String(index + 1).padStart(2, "0")}_${hash}${ext}`);
            const result = await downloadImage(context, item, file, page.url());
            if (result.ok) {
              refs.push({ file, source: id, title: item.title, refIndex: refs.length + 1 });
              record.downloaded += 1;
            }
            await page.waitForTimeout(DOWNLOAD_DELAY_MS);
          }
          record.status = record.downloaded > 0 ? "ok" : "failed";
          if (record.downloaded === 0) record.error = "图片全部下载失败";
        }
      } catch (error) {
        record.status = "failed";
        record.error = error?.message ?? String(error);
      } finally {
        await page?.close().catch(() => {});
      }
      sources[id] = record;
      await tracer.write("tool.called", {
        tool_call: { name: "cdp-browser", source: id, found: record.found, downloaded: record.downloaded },
        validation: { ok: record.status === "ok" },
        error: record.error ? { message: record.error } : undefined,
      });
    }
  } catch (error) {
    if (error?.code === CODES.SCOPE_VIOLATION) throw error;
    return {
      styleSource: "none",
      refs: [],
      sources,
      note: `浏览器不可用（CDP :${CHROME_DEBUG_PORT}）：${error?.message ?? error}`,
    };
  } finally {
    // 只断开连接，不关闭用户自己的 Chrome
    await browser?.close().catch(() => {});
  }

  const okSources = Object.entries(sources).filter(([, s]) => s.status === "ok").map(([id]) => id);
  if (refs.length === 0) {
    throw new AgentError(CODES.RESEARCH_EMPTY, "Amazon 与速卖通均未取得可用参考图", { sources });
  }
  return {
    styleSource: okSources.length === 2 ? "aliexpress+amazon" : okSources[0],
    refs,
    sources,
    note: okSources.length < 2 ? "仅单源成功，风格覆盖度有限" : undefined,
  };
}
