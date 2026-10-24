// listing-agent/cli.mjs
// 命令行入口：供「对话子 agent（yikuaborder-listing-agent Skill）」或终端直接调用
// Listing Agent 引擎的 HTTP API（run / validate / preview）。
//
// 默认打已运行的「一跨而境工作台」(http://127.0.0.1:3000，已挂载 /api/listing/* 且
// 进程内兜底)；若独立起了引擎服务，可用 AGENT_HTTP_BASE=http://127.0.0.1:3200 覆盖。
//
// 用法示例：
//   node listing-agent/cli.mjs validate --images /abs/Image_01.png
//   node listing-agent/cli.mjs preview  --images /abs/Image_01.png --profile generic
//   node listing-agent/cli.mjs run --images /abs/Image_01.png --profile ruTie \
//        --publish true --target-store "smtChoice:店铺A" --mode full
//   node listing-agent/cli.mjs run --images /abs/Image_01.png --publish false --json
//
// 落盘：run / preview / validate 成功取到 facts 后，自动把产物写入
//   ./当前产品/<产品包名>/product-facts.json  +  product-meta.json
//   并把源图（与 full 模式生图）归档到 ./当前产品/<产品包名>/images/，
//   重写 facts.images.main 为归档后的绝对路径（修复剪贴板临时路径丢失）。
//   可用 --name 指定包名，--no-save 关闭落盘。

import { resolve, join, basename, extname, isAbsolute, dirname, sep } from "node:path";
import { existsSync, statSync } from "node:fs";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const BASE = process.env.AGENT_HTTP_BASE || "http://127.0.0.1:3000";
const SUB = process.argv[2] || "run";

function parseArgs(argv) {
  const out = { images: [], overrides: {}, extra: {} };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--images") {
      out.images = (argv[++i] || "").split(",").map((s) => resolve(s.trim())).filter(Boolean);
    } else if (a === "--profile") {
      out.extra.profileKey = argv[++i];
    } else if (a === "--publish") {
      out.extra.publish = argv[++i] === "true";
    } else if (a === "--publish-mode") {
      out.extra.publishMode = argv[++i];
    } else if (a === "--target-store") {
      out.extra.targetStore = argv[++i];
    } else if (a === "--mode") {
      out.extra.mode = argv[++i];
    } else if (a === "--max-fix") {
      out.extra.maxAutoFixRounds = Number(argv[++i]);
    } else if (a === "--operation-id") {
      out.extra.operationId = argv[++i];
    } else if (a === "--name") {
      out.extra._name = argv[++i];
    } else if (a === "--image-out-dir") {
      out.extra._imageOutDir = resolve(argv[++i]);
    } else if (a === "--no-save") {
      out.extra._noSave = true;
    } else if (a === "--generate-content") {
      out.extra.generateContent = argv[++i] !== "false";
    } else if (a === "--override") {
      const kv = argv[++i] || "";
      const idx = kv.indexOf("=");
      if (idx > -1) out.overrides[kv.slice(0, idx)] = kv.slice(idx + 1);
    } else if (a === "--overrides-json") {
      Object.assign(out.overrides, JSON.parse(argv[++i] || "{}"));
    } else if (a === "--json") {
      out.extra._json = true;
    }
  }
  return out;
}

function buildRequest(p) {
  const options = {};
  for (const k of ["publish", "publishMode", "targetStore", "mode", "maxAutoFixRounds", "operationId", "generateContent"]) {
    if (p.extra[k] !== undefined) options[k] = p.extra[k];
  }
  return {
    profileKey: p.extra.profileKey || "auto",
    input: {
      type: "images",
      images: p.images,
      overrides: p.overrides,
    },
    options,
  };
}

// ---------- 落盘 / 归档 ----------

function sanitizeName(s) {
  return (s || "")
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "product";
}

function sanitizeFile(base) {
  const ext = extname(base);
  const stem = basename(base, ext).replace(/[\\/:*?"<>|\r\n\t]+/g, "_").replace(/_+/g, "_").slice(0, 40);
  return `${stem || "image"}${ext || ".png"}`;
}

function deriveName(facts) {
  const f = facts || {};
  const brand = (f.brand || "").toString().trim();
  const t = (f.title && (f.title.zh || f.title.en)) || "";
  const cat = (f.category || "").toString().trim();
  const raw = [brand, t, cat].filter(Boolean).join("_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return sanitizeName(raw) + "_" + ts.slice(0, 10);
}

async function collectAndArchiveImages(facts, sourceImages, imageOutDir, imageDir) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (p) => {
    if (!p || !isAbsolute(p)) return;
    if (!existsSync(p) || !statSync(p).isFile()) return;
    const r = resolve(p);
    if (seen.has(r)) return;
    seen.add(r);
    candidates.push(r);
  };
  (sourceImages || []).forEach(pushCandidate);
  const mains = (facts && facts.images && Array.isArray(facts.images.main) ? facts.images.main : []);
  mains.forEach(pushCandidate);
  // full 模式生图：fact 中可能是相对文件名，去 imageOutDir 找
  if (imageOutDir) {
    mains.forEach((p) => {
      if (isAbsolute(p)) return;
      const rp = resolve(imageOutDir, p);
      if (existsSync(rp) && statSync(rp).isFile()) pushCandidate(rp);
    });
  }

  const resolvedDir = resolve(imageDir);
  const used = new Set();
  const finalPaths = [];
  for (const src of candidates) {
    let dest;
    if (dirname(src) === resolvedDir) {
      dest = src; // 已在目标目录
    } else {
      let name = sanitizeFile(basename(src));
      let base = name;
      let i = 1;
      while (used.has(name)) {
        const e = extname(base);
        name = `${base.slice(0, base.length - e.length)}_${i++}${e}`;
      }
      used.add(name);
      dest = join(resolvedDir, name);
      await copyFile(src, dest);
    }
    finalPaths.push(dest);
  }
  if (facts && facts.images) facts.images.main = finalPaths;
  return finalPaths;
}

async function saveProductPackage(data, opts) {
  const facts = data && data.facts;
  if (!facts || typeof facts !== "object") return null;
  const name = opts.name || deriveName(facts);
  const baseDir = resolve("当前产品", name);
  const imageDir = join(baseDir, "images");
  await mkdir(imageDir, { recursive: true });

  const archived = await collectAndArchiveImages(facts, opts.images, opts.imageOutDir, imageDir);

  const factFile = join(baseDir, "product-facts.json");
  const metaFile = join(baseDir, "product-meta.json");
  await writeFile(factFile, JSON.stringify(facts, null, 2), "utf8");
  const meta = {
    name,
    profileKey: data.profileKey,
    status: data.status,
    qualityScore: data.validation && data.validation.qualityScore,
    generatedAt: new Date().toISOString(),
    sourceImages: opts.images,
    savedImages: archived,
    mode: opts.mode,
  };
  await writeFile(metaFile, JSON.stringify(meta, null, 2), "utf8");

  return { packageDir: baseDir, factFile, metaFile, imageDir, images: archived };
}

function savedLines(sf) {
  if (!sf) return [];
  const lines = [];
  lines.push(`产品包目录:         ${sf.packageDir}`);
  lines.push(`事实文件(factFile):  ${sf.factFile}`);
  lines.push(`元数据(metaFile):   ${sf.metaFile}`);
  lines.push(`主图归档(${sf.images.length}):  ${sf.imageDir}`);
  return lines;
}

function pretty(result) {
  if (!result || typeof result !== "object") return JSON.stringify(result, null, 2);

  // 形状 A：validate() 返回 { profileKey, facts, report, missing }
  if (result.report && !result.status) {
    const r = result.report || {};
    const lines = [];
    lines.push(`类目(profileKey):    ${result.profileKey}`);
    if (r.qualityScore !== undefined) lines.push(`质量分(qualityScore): ${r.qualityScore}`);
    if (r.schemaValid !== undefined) lines.push(`schema 校验:         ${r.schemaValid ? "通过" : "未通过"}`);
    const missing = (r.completeness && r.completeness.missing) || [];
    if (missing.length) lines.push(`缺字段(missing):     ${missing.join(", ")}`);
    const hardErrors = (r.schemaErrors || []).filter((e) => e.keyword !== "additionalProperties");
    if (hardErrors.length) {
      lines.push(`schema 硬错误:`);
      for (const e of hardErrors.slice(0, 8)) lines.push(`  - ${e.instancePath || "/"} ${e.message || ""}`);
    }
    if (Array.isArray(r.warnings) && r.warnings.length) lines.push(`警告(多余字段·软):  ${r.warnings.join("; ")}`);
    if (result.savedFiles) lines.push("", ...savedLines(result.savedFiles));
    return lines.join("\n");
  }

  // 形状 B：run / preview 返回 ListingResult { status, validation, publish, artifacts, ... }
  const lines = [];
  lines.push(`状态(status):        ${result.status}`);
  lines.push(`类目(profileKey):    ${result.profileKey}`);
  const v = result.validation || {};
  if (v.qualityScore !== undefined) lines.push(`质量分(qualityScore): ${v.qualityScore}`);
  if (Array.isArray(v.warnings) && v.warnings.length) lines.push(`警告:                ${v.warnings.join("; ")}`);
  const missing = (v.completeness && v.completeness.missing) || [];
  if (missing.length) lines.push(`缺字段(missing):     ${missing.join(", ")}`);
  if (result.publish && result.publish.status) {
    lines.push(`上架(publish):       ${result.publish.status}${result.publish.target ? " → " + result.publish.target : ""}`);
    if (Array.isArray(result.publish.errors) && result.publish.errors.length)
      lines.push(`  上架错误:          ${result.publish.errors.join("; ")}`);
  }
  const art = result.artifacts || {};
  if (art.factFile) lines.push(`事实文件(factFile):  ${art.factFile}`);
  if (Array.isArray(art.contentFiles) && art.contentFiles.length)
    lines.push(`内容产物(contentFiles): ${art.contentFiles.join(", ")}`);
  if (Array.isArray(result.autoFixLog) && result.autoFixLog.length) {
    lines.push(`自纠错(autoFixLog):`);
    for (const l of result.autoFixLog) lines.push(`  - ${l}`);
  }
  if (Array.isArray(result.log) && result.log.length) {
    lines.push(`过程日志(log):`);
    for (const l of result.log.slice(-8)) lines.push(`  - ${l}`);
  }
  if (result.savedFiles) lines.push("", ...savedLines(result.savedFiles));
  return lines.join("\n");
}

async function main() {
  if (!["run", "validate", "preview"].includes(SUB)) {
    console.error(`未知子命令: ${SUB}（应为 run | validate | preview）`);
    process.exit(2);
  }
  const p = parseArgs(process.argv);
  const body = buildRequest(p);
  const path = SUB === "validate" ? "/api/listing/validate" : SUB === "preview" ? "/api/listing/preview" : "/api/listing/run";

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `非 JSON 响应，HTTP ${res.status}` }));

  // 落盘产品包（run/preview/validate 取到 facts 即保存；--no-save 可关）
  if (!p.extra._noSave && data && data.facts) {
    try {
      const sf = await saveProductPackage(data, {
        name: p.extra._name,
        images: p.images,
        imageOutDir: p.extra._imageOutDir,
        mode: p.extra.mode,
      });
      if (sf) data.savedFiles = sf;
    } catch (e) {
      console.error("⚠️ 落盘失败（不影响引擎结果）:", e instanceof Error ? e.message : String(e));
    }
  }

  if (p.extra._json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`=== Listing Agent · ${SUB} @ ${BASE}${path} ===`);
    console.log(pretty(data));
  }
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("CLI 错误:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
