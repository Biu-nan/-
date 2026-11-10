#!/usr/bin/env node
/**
 * 上品 Agent 离线评测器（D3b）
 *
 * 为什么需要它
 * ------------
 * `evals/cases.json` 是一份 21 条的「断言声明」，但它没有执行器——那些断言只是文字。
 * 这个 Agent 原有的验证方式只有整链跑（开浏览器、出 8 张图、约 30 分钟），
 * 意味着任何结构改动都无法快速验证 = 盲改。D3（骨架跨层化）要动这里 9 个文件，
 * 所以先把不联网的部分变成可执行、可回归、可变异测试的套件。
 *
 * 本文件只跑确定性路径：
 *   - 不调模型（不建 ModelClient，dryRun 分支在源码里就是 `model = null`）
 *   - 不开浏览器（不碰 CDP 9223）
 *   - 不联网（风格调研走 fallbackDossier / dry-run 短路）
 *
 * 用法
 * ----
 *   node agents/ae-product-design/evals/run-offline.mjs
 *   node agents/ae-product-design/evals/run-offline.mjs --only hero-score
 *   node agents/ae-product-design/evals/run-offline.mjs --json
 *   node agents/ae-product-design/evals/run-offline.mjs --list
 *
 * 退出码：0 = 无 FAIL（允许 SKIP）；1 = 有 FAIL。
 *
 * 覆盖纪律
 * --------
 * cases.json 里的每一条都必须被本文件显式归类为 full / partial / skip，
 * 并写明理由。新增用例却没归类 → 直接判 FAIL，防止用例被悄悄漏掉。
 * 这正是 D1b 那次「测试全绿但其实不可能失败」的教训。
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

const ROOT = path.join(import.meta.dirname, "..");
const CASES_FILE = path.join(import.meta.dirname, "cases.json");

// ---------- 被测代码（全部是真实模块，不是替身） ----------
const { composeQcResult, isQcDeliverable } = await import("../src/qc.js");
const { computeMetrics } = await import("../src/benchmark.js");
const { dimensionVerdict, readImageInfo } = await import("../src/image-info.js");
const { slotDataReadiness } = await import("../src/readiness.js");
const { loadSlots, loadInputs, buildFactsText } = await import("../src/inputs.js");
const { synthesizeStoryboard, synthesizePromptPack, fallbackDossier } = await import("../src/planning.js");
const { extractJson } = await import("../src/model.js");
const { fitSubjectScale, resolvePython } = await import("../src/image-tools.js");
const { runAgent } = await import("../src/runner.js");
const { validateStoryboard, validatePromptPack, validateHeroScoreStructure, judgeHeroScore } = await import(
  "../../../dist/src/agent-shared/schemas.js"
);
const { sanitizeFacts, assertWithin } = await import("../../../dist/src/agent-shared/permissions.js");
const { assertAtMost, fromLegacyResource } = await import("../../../dist/src/agent-safety-scale.js");

// ---------- 断言采集器 ----------
function probe() {
  const rows = [];
  const push = (name, cond, actual, expected) => {
    rows.push({ name, ok: Boolean(cond), actual: brief(actual), expected: brief(expected) });
  };
  return {
    rows,
    ok: (name, cond, actual, expected = true) => push(name, cond, actual, expected),
    eq: (name, actual, expected) => push(name, eq(actual, expected), actual, expected),
    near: (name, actual, expected, tol = 1e-6) =>
      push(name, Number.isFinite(actual) && Math.abs(actual - expected) <= tol, actual, `${expected}±${tol}`),
    has: (name, haystack, needle) => {
      const h = typeof haystack === "string" ? haystack : JSON.stringify(haystack ?? "");
      push(name, h.includes(needle), h.length > 160 ? `${h.slice(0, 160)}…` : h, `包含「${needle}」`);
    },
    LACKS: (name, haystack, needle) => {
      const h = typeof haystack === "string" ? haystack : JSON.stringify(haystack ?? "");
      push(name, !h.includes(needle), h.length > 160 ? `${h.slice(0, 160)}…` : h, `不含「${needle}」`);
    },
    /** 期望抛出带指定错误码的 AgentError */
    throws: async (name, fn, code, messagePart) => {
      try {
        await fn();
        push(name, false, "没有抛错", `抛 ${code}`);
      } catch (error) {
        const codeOk = !code || error?.code === code;
        const msgOk = !messagePart || String(error?.message ?? "").includes(messagePart);
        push(
          name,
          codeOk && msgOk,
          `${error?.code ?? error?.name ?? "?"}: ${error?.message ?? error}`,
          `${code}${messagePart ? ` / 含「${messagePart}」` : ""}`,
        );
      }
    },
  };
}

function eq(a, b) {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
function brief(v) {
  if (typeof v === "string") return v.length > 180 ? `${v.slice(0, 180)}…` : v;
  if (typeof v === "number" || typeof v === "boolean" || v == null) return v;
  try {
    const s = JSON.stringify(v);
    return s.length > 180 ? `${s.slice(0, 180)}…` : s;
  } catch {
    return String(v);
  }
}
const exists = (p) => stat(p).then(() => true).catch(() => false);
const readJson = (p) => readFile(p, "utf8").then(JSON.parse);

/** 复制一份产品目录到临时区：绝不在 fixtures/ 里写文件 */
async function cloneProduct(name) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aepd-"));
  const dst = path.join(tmp, name);
  await cp(path.join(ROOT, "fixtures", name), dst, { recursive: true });
  // fixtures/sample-product 里带着一份历史 design/ 产物（含旧 trace.jsonl）。
  // 不清掉的话，本次运行会往旧 trace 上追加，断言会读到上一轮的事件——
  // 看起来"通过"，其实测的是别人的输出。必须先清空再跑。
  await rm(path.join(dst, "design"), { recursive: true, force: true });
  return { tmp, productDir: dst };
}

async function slotsConfig() {
  return loadSlots(null); // null = 读 config/image-slots.json
}

/** 造一个各必查项全通过的 QC 骨架，供不同用例注水 */
function passingQc(slot) {
  const base = {
    slotId: slot.id,
    verdict: "pass",
    productFidelity: { pass: true, issues: [] },
    background: { pass: true },
    text: { present: false, policyOk: true },
    composition: { pass: true },
    sku: { pass: true, detected: "carrot" },
  };
  if (slot.shot) base.shotType = { present: slot.shot, match: true };
  return base;
}

const dimensionPass = { pass: true, problems: [], width: 2000, height: 2000, ratio: 1, target: "1:1", bytes: 270634 };

// =====================================================================
// 覆盖清单：cases.json 的 21 条，逐条归类
// mode = "full" 可离线完整验证 / "partial" 只验证到某一段 / "skip" 需要浏览器或网络
// =====================================================================
const COVERAGE = new Map();

function full(id, note, run) {
  COVERAGE.set(id, { mode: "full", note, run });
}
function partial(id, note, run) {
  COVERAGE.set(id, { mode: "partial", note, run });
}
function skip(id, note) {
  COVERAGE.set(id, { mode: "skip", note, run: null });
}

// ---------------------------------------------------------------- 金路径
full(
  "golden-dry-run-plumbing",
  "真跑 runAgent({dryRun:true})：全链路 S0–S5，不建 ModelClient、不开浏览器",
  async (t) => {
    const { tmp, productDir } = await cloneProduct("sample-product");
    const outDir = path.join(productDir, "design");
    try {
      const { status, report: r, error } = await runAgent({ productDir, dryRun: true, outDir });
      t.ok("没有把错误吞成 failed", !error, error ?? "无 error");
      t.eq("status", status, "partial");
      for (const f of ["style-dossier.json", "storyboard.json", "prompt-pack.json", "design-report.json", "trace.jsonl"]) {
        t.ok(`artifacts/${f}`, await exists(path.join(outDir, f)), "存在");
      }
      const storyboard = await readJson(path.join(outDir, "storyboard.json"));
      const pack = await readJson(path.join(outDir, "prompt-pack.json"));
      t.eq("storyboard.schemaVersion", storyboard.schemaVersion, "2.0");
      t.eq("storyboard.items 数", storyboard.items.length, 8);
      t.ok("storyboard 标记 synthetic", storyboard.synthetic === true, storyboard.synthetic);
      const bySlot = new Map(pack.prompts.map((p) => [p.slotId, p]));
      t.has("P1 声明 1:1", bySlot.get("P1")?.prompt, "1:1 composition, 1000x1000 px");
      t.has("MK2 声明 3:4", bySlot.get("MK2")?.prompt, "3:4 composition, 1000x1334 px");
      t.eq("budget.modelCalls", r.budget.modelCalls, 0);
      t.eq("budget.imageGenerations", r.budget.imageGenerations, 0);
      // dry-run 绝不允许谎报风格来源
      t.eq("styleSource 不冒充真实调研", r.styleSource, "dry-run");
      // trace 必须干净：一次 run 恰好一对 started/completed，不能多也不能少
      const trace = (await readFile(path.join(outDir, "trace.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
      const countOf = (type) => trace.filter((e) => e.event_type === type).length;
      t.eq("agent.started 恰好 1 条", countOf("agent.started"), 1);
      t.eq("agent.completed 恰好 1 条", countOf("agent.completed"), 1);
      t.eq("guardrail.checked 存在", countOf("guardrail.checked"), 1);
      t.ok("trace 有 context.selected", countOf("context.selected") >= 1, countOf("context.selected"));
      t.eq("trace 无 agent.failed", countOf("agent.failed"), 0);
      t.ok(
        "trace 每行都有 trace_id/run_id",
        trace.every((e) => e.trace_id === r.runId && e.run_id === r.runId),
        trace.length + " 条",
      );
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
);

full(
  "golden-marketing-module-separate",
  "商品图 6 / 营销图 2 分模块；textPolicy=forbidden 的槽位 headline 必须为空串",
  async (t) => {
    const { tmp, productDir } = await cloneProduct("sample-product");
    const outDir = path.join(productDir, "design");
    try {
      const { report: r } = await runAgent({ productDir, dryRun: true, outDir });
      const product = r.slots.filter((s) => s.module === "product");
      const marketing = r.slots.filter((s) => s.module === "marketing");
      t.eq("report.slots[module=product]", product.length, 6);
      t.eq("report.slots[module=marketing]", marketing.length, 2);
      t.eq("商品图槽位 id", product.map((s) => s.id), ["P1", "P2", "P3", "P4", "P5", "P6"]);
      t.eq("营销图槽位 id", marketing.map((s) => s.id), ["MK1", "MK2"]);

      const cfg = await slotsConfig();
      const storyboard = await readJson(path.join(outDir, "storyboard.json"));
      const item = new Map(storyboard.items.map((i) => [i.slotId, i]));
      const forbidden = cfg.slots.filter((s) => s.textPolicy === "forbidden").map((s) => s.id);
      t.eq("forbidden 槽位", forbidden, ["P1", "P2", "MK1", "MK2"]);
      for (const id of forbidden) {
        t.eq(`${id}.headline 必须为空`, item.get(id)?.headline, "");
      }
      // 允许文字的槽位不应该被一刀切清空
      t.ok("P4 允许文字（尺寸标注）", cfg.slots.find((s) => s.id === "P4")?.textPolicy === "allowed", "allowed");
      // 尺寸断言只能落在配置/提示词层：dry-run 没有真实成图，不能假装有像素尺寸
      t.eq("spec.marketing_scene.targetSize", cfg.spec.marketing_scene.targetSize, "1000x1334");
      t.eq("spec.marketing_scene.aspect", cfg.spec.marketing_scene.aspect, "3:4");
      t.eq("spec.product.targetSize", cfg.spec.product.targetSize, "1000x1000");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------- 输入失败
full("failure-no-product-images", "空目录必须抛 E_INPUT_IMAGES，且不能先建出 design/ 再报错", async (t) => {
  const { tmp, productDir } = await cloneProduct("empty-product");
  const outDir = path.join(productDir, "design");
  try {
    // 连文案一起断言：只查错误码的话，把「没有任何可用图片」那层守卫删掉后，
    // 后面「所有产品图都无法解析」会抛出同一个码，测试照样绿 = 假通过。
    await t.throws(
      "空产品目录被拦截",
      () => runAgent({ productDir, dryRun: true, outDir }),
      "E_INPUT_IMAGES",
      "没有任何可用图片",
    );
    t.ok("未创建 design/", !(await exists(outDir)), "design/ 不存在");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

full("failure-scope-violation", "outDir 越出产品目录必须抛 E_SCOPE_VIOLATION；前缀陷阱 /a/b 与 /a/bc 要分开", async (t) => {
  // 注意：loadInputs 与 assertWithin 在 runner.js 的 try 之外，所以是真抛错，
  // 不会被 catch 转成 {status:"failed"}。这里必须用有图的目录，否则会先撞 E_INPUT_IMAGES。
  const { tmp, productDir } = await cloneProduct("sample-product");
  try {
    await t.throws(
      "runAgent 越界输出被拒",
      () => runAgent({ productDir, dryRun: true, outDir: path.join(tmp, "outside") }),
      "E_SCOPE_VIOLATION",
    );
    // 前缀陷阱：/a/bc 以 /a/b 开头，但不是子目录
    await t.throws("前缀相同但非子目录被拒", () => assertWithin("/a/b", "/a/bc"), "E_SCOPE_VIOLATION");
    t.eq("真正的子目录放行", assertWithin("/a/b", "/a/b/c"), path.resolve("/a/b/c"));
    t.eq("root 本身放行", assertWithin("/a/b", "/a/b"), path.resolve("/a/b"));
    await t.throws(
      "P6 破坏性动作超出 P5 上限，框架直接拒绝",
      () => assertAtMost(fromLegacyResource("DESTRUCTIVE"), "P5"),
      "PERMISSION_DENIED",
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 脱敏
full("failure-sensitive-egress", "供应商/成本/利润字段必须整键剔除，且不得出现在给模型的文本里", async (t) => {
  const facts = await readJson(path.join(ROOT, "fixtures/sample-product/product-facts.json"));
  Object.assign(facts, {
    supplierName: "Yiwu XX Factory",
    purchaseCost: 3.1,
    profitMargin: 0.42,
    nested: { deeper: { 采购价: 2.5, keepMe: "ok" } },
    rows: [{ cost: 9, label: "a" }],
  });
  const { facts: safe, redacted } = sanitizeFacts(facts);
  t.ok("$.supplierName 被剔除", redacted.includes("$.supplierName"), redacted);
  t.ok("$.purchaseCost 被剔除", redacted.includes("$.purchaseCost"), redacted);
  t.ok("$.profitMargin 被剔除", redacted.includes("$.profitMargin"), redacted);
  t.ok("嵌套中文键也被剔除", redacted.includes("$.nested.deeper.采购价"), redacted);
  t.ok("数组内成本键也被剔除", redacted.includes("$.rows[0].cost"), redacted);
  t.eq("供应商名不在输出里", safe.supplierName, undefined);
  t.eq("非敏感字段保留", safe.nested?.deeper?.keepMe, "ok");

  const text = buildFactsText({
    productDir: "/tmp/p",
    images: ["a.jpg"],
    facts: safe,
    factsSource: "product-facts.json",
    materialText: "",
    redacted,
  });
  t.LACKS("给模型的文本不含供应商名", text, "Yiwu XX Factory");
  t.has("给模型的文本声明了脱敏字段", text, "已脱敏字段");
});

// ---------------------------------------------------------------- 首图 100 分模型
full("failure-hero-score-below-threshold", "73 分（识别度 12/25）必须判 fail，不能因为总分凑够就放行", async (t) => {
  const cfg = await slotsConfig();
  const slot = cfg.slots.find((s) => s.id === "P1");
  const heroScore = {
    dimensions: [
      { key: "identification", score: 12, evidence: "缩略图已认不出材质" },
      { key: "attraction", score: 16, evidence: "配色可读" },
      { key: "differentiation", score: 15, evidence: "结构可辨" },
      { key: "subject", score: 13, evidence: "主体完整" },
      { key: "authenticity", score: 9, evidence: "颜色一致" },
      { key: "mobile", score: 8, evidence: "缩略图模糊" },
    ],
    total: 73,
  };
  const result = { ...passingQc(slot), heroScore };
  const qc = composeQcResult({
    slot,
    dimension: dimensionPass,
    result,
    scoringConfig: cfg.config.heroScoring,
    thumbnail: { file: "/tmp/P1_160.jpg", size: 160 },
  });
  t.eq("P1.verdict", qc.verdict, "fail");
  t.eq("P1.heroJudge.pass", qc.heroJudge.pass, false);
  t.eq("heroJudge.total", qc.heroJudge.total, 73);
  t.has("理由含识别度不足", qc.reason, "产品识别度 12/25 低于下限");
  t.has("理由含总分不足", qc.reason, "总分 73 低于阈值 80");
  t.ok("不可交付", isQcDeliverable(qc, slot) === false, isQcDeliverable(qc, slot));
});

full("failure-hero-score-tampered", "total 与分项之和不一致必须抛 E_SCHEMA_INVALID；容差边界要钉住", async (t) => {
  const cfg = await slotsConfig();
  const dims = [
    { key: "identification", score: 12 },
    { key: "attraction", score: 16 },
    { key: "differentiation", score: 15 },
    { key: "subject", score: 13 },
    { key: "authenticity", score: 9 },
    { key: "mobile", score: 8 },
  ];
  // 注意：cases.json 原本写的是 messageIncludes="与分项之和不一致"，
  // 而 schemas.js 实际抛的是「total 95 与分项之和 73 不一致」——那句期望从来没被真跑过。
  // 这里断言真实文案，不迁就文档。（cases.json 属于既有契约文件，未擅自改，仅在此记录偏差。）
  await t.throws(
    "total 95 vs 分项 73 被拒",
    () => validateHeroScoreStructure({ dimensions: dims, total: 95 }, cfg.config.heroScoring),
    "E_SCHEMA_INVALID",
    "与分项之和",
  );
  // 容差 0.51：73.5 应放过，73.6 应拒绝
  const withinTolerance = (() => {
    try {
      validateHeroScoreStructure({ dimensions: dims, total: 73.5 }, cfg.config.heroScoring);
      return true;
    } catch {
      return false;
    }
  })();
  t.ok("容差内放过（73.5）", withinTolerance, withinTolerance);
  await t.throws(
    "超出容差被拒（73.6）",
    () => validateHeroScoreStructure({ dimensions: dims, total: 73.6 }, cfg.config.heroScoring),
    "E_SCHEMA_INVALID",
  );
  await t.throws(
    "分项超权重被拒",
    () => validateHeroScoreStructure({ dimensions: dims.map((d, i) => (i === 0 ? { ...d, score: 26 } : d)), total: 87 }, cfg.config.heroScoring),
    "E_SCHEMA_INVALID",
  );
  await t.throws(
    "缺维度被拒",
    () => validateHeroScoreStructure({ dimensions: dims.slice(0, 5), total: 65 }, cfg.config.heroScoring),
    "E_SCHEMA_INVALID",
  );
});

// ---------------------------------------------------------------- 尺寸
full("failure-mk2-square-instead-of-3x4", "MK2 出成 1000×1000 必须判比例不合；1000×1334 应放过", async (t) => {
  const cfg = await slotsConfig();
  const spec = cfg.spec.marketing_scene;
  const bad = dimensionVerdict({ readable: true, width: 1000, height: 1000, bytes: 300000 }, spec);
  t.eq("dimension.pass", bad.pass, false);
  t.has("理由点明 3:4", bad.problems.join("；"), "不符合 3:4");
  const good = dimensionVerdict({ readable: true, width: 1000, height: 1334, bytes: 300000 }, spec);
  t.eq("1000x1334 通过", good.pass, true);
  t.eq("比例入档", good.ratio, 0.7496);

  // 真实文件路径也要走通：这条用例原本引用的 fixtures/bad-1000x1000-as-mk2.jpg 并不存在，
  // 只测「构造一个 info 对象」等于没测图片头解析。现在补了真实图，从读头开始测。
  const file = path.join(ROOT, "fixtures/bad-1000x1000-as-mk2.jpg");
  const info = await readImageInfo(file);
  t.eq("读到真实尺寸", `${info.width}x${info.height}`, "1000x1000");
  t.eq("识别为 jpeg", info.format, "jpeg");
  t.eq("真实文件被判不合格", dimensionVerdict(info, spec).pass, false);
  t.ok("文件够大不会被「过小」误伤", info.bytes >= spec.minBytes, info.bytes);
});

full("regression-upscale-detected", "780×780 必须被 800px 下限拦住", async (t) => {
  const cfg = await slotsConfig();
  const spec = cfg.spec.product;
  const bad = dimensionVerdict({ readable: true, width: 780, height: 780, bytes: 300000 }, spec);
  t.eq("dimension.pass", bad.pass, false);
  t.has("理由点明宽度不足", bad.problems.join("；"), "宽 780px < 800px");
  t.eq("800x800 恰好通过", dimensionVerdict({ readable: true, width: 800, height: 800, bytes: 300000 }, spec).pass, true);
  t.has(
    "小于 60KB 也拦",
    dimensionVerdict({ readable: true, width: 1000, height: 1000, bytes: 50000 }, spec).problems.join("；"),
    "文件仅 50000B",
  );
  t.has(
    "超过 2MB 也拦",
    dimensionVerdict({ readable: true, width: 1000, height: 1000, bytes: 2097153 }, spec).problems.join("；"),
    "超过 2.0MB",
  );
  // 走真实文件的 JPEG 头解析，确认 780 是解析出来的、不是我写死的
  const info = await readImageInfo(path.join(ROOT, "fixtures/bad-780x780.jpg"));
  t.eq("读到真实尺寸", `${info.width}x${info.height}`, "780x780");
  t.has("真实文件被判宽度不足", dimensionVerdict(info, spec).problems.join("；"), "宽 780px < 800px");
  t.ok("文件本身够大", info.bytes >= spec.minBytes, info.bytes);
  // 完全无法解析的输入不允许被当成合格
  t.eq("不可解析判不合格", dimensionVerdict({ readable: false, width: null, height: null, bytes: 0 }, spec).pass, false);
});

// ---------------------------------------------------------------- 基准回填
full("regression-benchmark-math", "每千次曝光成交单量 = 1000×CTR×CVR，不能退化成只看 CTR", async (t) => {
  const cur = computeMetrics({ impressions: 12000, clicks: 360, orders: 18 });
  const base = computeMetrics({ impressions: 12000, clicks: 240, orders: 12 });
  t.eq("ctr", cur.ctr, 0.03);
  t.eq("cvr", cur.cvr, 0.05);
  t.eq("ordersPer1000Exposures", cur.ordersPer1000Exposures, 1.5);
  t.eq("baseline.ordersPer1000Exposures", base.ordersPer1000Exposures, 1);
  t.near("deltaVsBaseline", cur.ordersPer1000Exposures - base.ordersPer1000Exposures, 0.5);
  t.near("不变式 1000×ctr×cvr", 1000 * cur.ctr * cur.cvr, cur.ordersPer1000Exposures, 1e-3);
  await t.throws("impressions=0 被拒", () => computeMetrics({ impressions: 0, clicks: 0, orders: 0 }), undefined, "impressions");
  await t.throws("clicks>impressions 被拒", () => computeMetrics({ impressions: 100, clicks: 200, orders: 1 }), undefined, "clicks");
  await t.throws("orders>clicks 被拒", () => computeMetrics({ impressions: 100, clicks: 10, orders: 20 }), undefined, "orders");
  // 0 点击不能除零
  t.eq("clicks=0 时 cvr=0", computeMetrics({ impressions: 1000, clicks: 0, orders: 0 }).cvr, 0);
});

// ---------------------------------------------------------------- JSON 抽取
full("failure-json-fence-or-truncated", "带围栏/带前后缀能取出；截断必须抛 E_MODEL_JSON 而不是返回半成品", async (t) => {
  t.eq("带围栏可解析", extractJson('```json\n{"a":1}\n```'), { a: 1 });
  t.eq("带前后缀可解析", extractJson('好的，结果如下：\n{"a":1}\n以上。'), { a: 1 });
  t.eq("数组可解析", extractJson("前言 [1,2,3] 后语"), [1, 2, 3]);
  await t.throws(
    "截断必须报错",
    () => extractJson('```json\n{"series":[{"id":"a","nam'),
    "E_MODEL_JSON",
  );
  await t.throws("完全无 JSON 必须报错", () => extractJson("抱歉我无法完成"), "E_MODEL_JSON");
  await t.throws("空回复必须报错", () => extractJson(""), "E_MODEL_JSON");
});

// ---------------------------------------------------------------- 槽位跳过
full("regression-skip-optional-slot", "--skip-slots P6 后 requested=7，P6 必须以 skipped 出现在报告里而不是消失", async (t) => {
  const { tmp, productDir } = await cloneProduct("sample-product");
  const outDir = path.join(productDir, "design");
  try {
    const { report: r } = await runAgent({ productDir, dryRun: true, outDir, skipSlots: ["P6"] });
    t.eq("counts.requested", r.counts.requested, 7);
    const p6 = r.slots.find((s) => s.id === "P6");
    t.ok("P6 仍在报告里（不是静默消失）", Boolean(p6), p6 ? "存在" : "缺失");
    t.eq("P6.qc.verdict", p6?.qc?.verdict, "skipped");
    t.has("P6 跳过原因", p6?.qc?.reason ?? "", "手动跳过");
    const storyboard = await readJson(path.join(outDir, "storyboard.json"));
    t.eq("storyboard 只含 7 条", storyboard.items.length, 7);
    t.ok("storyboard 不含 P6", !storyboard.items.some((i) => i.slotId === "P6"), "不含");
    const pack = await readJson(path.join(outDir, "prompt-pack.json"));
    t.eq("prompt-pack 只含 7 条", pack.prompts.length, 7);
    t.ok("P6 没有提示词", !pack.prompts.some((p) => p.slotId === "P6"), "没有");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

full("regression-stale-dossier-reuse", "旧 storyboard 的条数与新槽位配置不一致必须抛错，不能被复用", async (t) => {
  const cfg = await slotsConfig();
  const dossier = await fallbackDossier({ refs: [], categoryKey: "home_decor" });
  const full8 = synthesizeStoryboard({ slots: cfg.slots, dossier });

  // 用例原本引用的 fixtures/slots-6.json 不存在；现在补上，并顺带把 loadSlots 的
  // 配置校验（id 唯一、textPolicy 合法、specKey 存在、heroScoring 齐全）也走一遍
  const sixBundle = await loadSlots(path.join(ROOT, "fixtures/slots-6.json"));
  t.eq("6 槽位配置可加载", sixBundle.slots.length, 6);
  t.eq("只有商品图槽位", sixBundle.slots.map((s) => s.id), ["P1", "P2", "P3", "P4", "P5", "P6"]);
  const six = sixBundle.slots;

  await t.throws(
    "8 条 storyboard 对 6 个槽位被拒",
    () => validateStoryboard(full8, six),
    "E_SCHEMA_INVALID",
    "应有 6 条，实际 8 条",
  );
  t.ok("同构时放行", validateStoryboard(full8, cfg.slots) === full8);
  const pack8 = synthesizePromptPack({ slots: cfg.slots, specMap: cfg.spec });
  await t.throws(
    "prompt-pack 条数不符被拒",
    () => validatePromptPack(pack8, six, cfg.spec),
    "E_SCHEMA_INVALID",
    "应有 6 条，实际 8 条",
  );
  // 提示词质量红线：缺 reference image / no watermark / 比例声明都要拦
  const broken = JSON.parse(JSON.stringify(pack8));
  broken.prompts[0].prompt = "a nice product photo";
  await t.throws("过短提示词被拒", () => validatePromptPack(broken, cfg.slots, cfg.spec), "E_SCHEMA_INVALID");
});

// ---------------------------------------------------------------- 主体占比校正
full("regression-fit-scale-padding", "白底 90% 主体扩画布补白到约 0.775，商品像素不缩放；再跑一次应 already-in-range", async (t) => {
  const python = await resolvePython();
  if (!python) {
    t.ok("需要 Python + Pillow", false, "未找到可用 Python/Pillow —— 本机应装 PIL，否则此项应视为未验证");
    return;
  }
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aepd-fit-"));
  try {
    const gen = path.join(tmp, "_gen.py");
    await writeFile(
      gen,
      [
        "import sys",
        "from PIL import Image, ImageDraw",
        "out = sys.argv[1]",
        "W = 1254",
        "def paint(path, bg, ratio, corner_bg):",
        "    img = Image.new('RGB', (W, W), bg)",
        "    if corner_bg is not None:",
        "        ImageDraw.Draw(img).rectangle([0, 0, W - 1, W - 1], fill=corner_bg)",
        "    side = int(W * ratio)",
        "    off = (W - side) // 2",
        "    ImageDraw.Draw(img).rectangle([off, off, off + side - 1, off + side - 1], fill=(180, 90, 40))",
        "    img.save(path, 'JPEG', quality=95)",
        "paint(out + '/white90.jpg', (255, 255, 255), 0.90, None)",
        "paint(out + '/inrange.jpg', (255, 255, 255), 0.60, None)",
        "paint(out + '/scene.jpg', (255, 255, 255), 0.90, (40, 120, 60))",
      ].join("\n"),
      "utf8",
    );
    await execFileP(python, [gen, tmp], { timeout: 120000 });

    const white = path.join(tmp, "white90.jpg");
    const first = await fitSubjectScale(white, { min: 0.7, max: 0.85, target: 0.775 });
    t.ok("返回了结果（非 null）", Boolean(first), first ? "ok" : "null");
    t.eq("action", first?.action, "padded");
    t.ok("校正前 > 0.85", first?.subjectScaleBefore > 0.85, first?.subjectScaleBefore);
    t.ok(
      "校正后落在 0.76–0.80",
      first?.subjectScaleAfter >= 0.76 && first?.subjectScaleAfter <= 0.8,
      first?.subjectScaleAfter,
    );
    t.ok("画布被扩大", first?.sizeAfter?.[0] > first?.sizeBefore?.[0], `${first?.sizeBefore} → ${first?.sizeAfter}`);

    const second = await fitSubjectScale(white, { min: 0.7, max: 0.85, target: 0.775 });
    t.eq("第二次 action", second?.action, "skip");
    t.eq("第二次 reason", second?.reason, "already-in-range");
    const subjectW1 = first.bbox[2] - first.bbox[0];
    const subjectW2 = second.bbox[2] - second.bbox[0];
    t.ok("商品像素未被缩放", Math.abs(subjectW1 - subjectW2) <= 4, `${subjectW1} vs ${subjectW2}`);

    const scene = await fitSubjectScale(path.join(tmp, "scene.jpg"), { min: 0.7, max: 0.85, target: 0.775 });
    t.eq("非白底不补边", scene?.reason, "not-white-background");
    t.eq("非白底不改画布", scene?.action, "skip");

    const inrange = await fitSubjectScale(path.join(tmp, "inrange.jpg"), { min: 0.7, max: 0.85, target: 0.775 });
    t.eq("本来就在范围内", inrange?.reason, "already-in-range");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 部分覆盖
partial(
  "failure-text-on-marketing-image",
  "只验证「文字不合规 → 必判 fail 且理由可见」的合成逻辑；视觉检出本身需要模型+浏览器，未验证",
  async (t) => {
    const cfg = await slotsConfig();
    const slot = cfg.slots.find((s) => s.id === "MK1");
    const result = {
      ...passingQc(slot),
      verdict: "fail",
      text: { present: true, policyOk: false, watermarkOrSticker: true },
      reason: "画面检出促销文字/水印，违反无文字策略",
    };
    const qc = composeQcResult({ slot, dimension: dimensionPass, result, scoringConfig: cfg.config.heroScoring });
    t.eq("MK1.verdict", qc.verdict, "fail");
    t.has("理由点名文字/水印", qc.reason, "文字/水印");
    t.ok("不可交付", isQcDeliverable(qc, slot) === false, isQcDeliverable(qc, slot));
    // 关键不变式：存在失败项却判 pass，schema 层直接拒绝
    await t.throws(
      "policyOk=false 却判 pass 被 schema 拒绝",
      () =>
        composeQcResult({
          slot,
          dimension: dimensionPass,
          result: { ...passingQc(slot), verdict: "pass", text: { present: true, policyOk: false } },
          scoringConfig: cfg.config.heroScoring,
        }),
      "E_SCHEMA_INVALID",
      "存在失败项却判 pass",
    );
  },
);

partial(
  "failure-research-fallback-declared",
  "验证降级必须自报 source=fallback；双源抓取失败的真实触发需要断网打靶，未验证",
  async (t) => {
    const dossier = await fallbackDossier({ refs: [], categoryKey: "home_decor" });
    t.eq("source 自报 fallback", dossier.source, "fallback");
    t.ok("有可用系列", dossier.series.length > 0, dossier.series.length);
    t.ok("选定了一个系列", Boolean(dossier.chosen), dossier.chosen);
    t.has("说明为什么降级", dossier.reason, "使用预置风格库");
    t.has("要求人工复核", dossier.reason, "人工复核");
    t.has("市场信号不装作有调研", dossier.marketSignal?.dominantPattern ?? "", "未联网调研");
    t.eq("无参考图时不留假证据", dossier.series[0].evidence.length, 0, []);

    // dry-run 同理：绝不允许把 fallback 说成真实调研
    const { tmp, productDir } = await cloneProduct("sample-product");
    const outDir = path.join(productDir, "design");
    try {
      const { report: r } = await runAgent({ productDir, dryRun: true, outDir });
      t.LACKS("dry-run 不冒充 aliexpress+amazon", String(r.styleSource), "aliexpress");
      t.eq("dry-run styleSource", r.styleSource, "dry-run");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------- 只能跳过
skip("golden-happy-path", "需要 CDP 9223 + 8 次真实出图 + 视觉 QC，单次约 30 分钟。改动骨架后由 D4 真实跑通时一并验证");
skip("failure-silent-text-instead-of-image", "需要构造「创建图片」工具不可用的浏览器会话，离线无法模拟");
skip("failure-product-drift", "需要真实视觉 QC 判定（模型看图），离线只能验证它之后的 fail 传播，无法验证检出本身");
skip("failure-research-empty", "需要在 collectStyleRefs 打靶双源抓取失败（断网/反爬），属联网场景");
skip("failure-out-of-scope-request", "纯 prompt 层契约（拒绝写 Listing / 上架店小秘），没有代码可执行；由 contract.md §边界 保证");

// =====================================================================
// 执行
// =====================================================================
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const allCases = JSON.parse(await readFile(CASES_FILE, "utf8"));

if (flag("--list")) {
  for (const c of allCases) {
    const cov = COVERAGE.get(c.id);
    console.log(`${(cov?.mode ?? "MISSING").padEnd(8)} ${c.id}`);
  }
  process.exit(0);
}

const only = opt("--only");
const selected = only ? allCases.filter((c) => c.id.includes(only)) : allCases;

const started = Date.now();
const report = [];

for (const c of selected) {
  const cov = COVERAGE.get(c.id);
  if (!cov) {
    report.push({ id: c.id, mode: "MISSING", ok: false, note: "cases.json 里有这条用例，但 run-offline.mjs 没有归类它" });
    continue;
  }
  if (cov.mode === "skip") {
    report.push({ id: c.id, mode: "skip", ok: true, note: cov.note });
    continue;
  }
  const t = probe();
  let crash = null;
  try {
    await cov.run(t);
  } catch (error) {
    crash = `${error?.code ?? error?.name ?? "Error"}: ${String(error?.message ?? error).split("\n")[0]}`;
  }
  const failed = t.rows.filter((r) => !r.ok);
  report.push({
    id: c.id,
    mode: cov.mode,
    ok: !crash && failed.length === 0,
    note: cov.note,
    crash,
    rows: t.rows,
    failed,
  });
}

const elapsed = Date.now() - started;
const nFull = report.filter((r) => r.mode === "full").length;
const nPart = report.filter((r) => r.mode === "partial").length;
const nSkip = report.filter((r) => r.mode === "skip").length;
const nMissing = report.filter((r) => r.mode === "MISSING").length;
const failing = report.filter((r) => !r.ok);
const assertionCount = report.reduce((n, r) => n + (r.rows?.length ?? 0), 0);

if (flag("--json")) {
  console.log(
    JSON.stringify(
      {
        report,
        summary: {
          total: report.length,
          full: nFull,
          partial: nPart,
          skipped: nSkip,
          missing: nMissing,
          failing: failing.length,
          assertionCount,
          elapsed,
        },
      },
      null,
      2,
    ),
  );
} else {
  for (const r of report) {
    if (r.mode === "skip") {
      console.log(`SKIP  ${r.id}\n      ${r.note}`);
      continue;
    }
    if (r.mode === "MISSING") {
      console.log(`FAIL  ${r.id}\n      ${r.note}`);
      continue;
    }
    const tag = r.ok ? (r.mode === "partial" ? "PART" : "PASS") : "FAIL";
    console.log(`${tag}  ${r.id}  (${r.rows.length} 条断言)`);
    if (!r.ok) {
      if (r.crash) console.log(`      ✗ 崩溃：${r.crash}`);
      for (const f of r.failed) {
        console.log(`      ✗ ${f.name}\n          实际=${brief(f.actual)}\n          期望=${brief(f.expected)}`);
      }
    }
    if (r.mode === "partial") console.log(`      局限：${r.note}`);
  }
  console.log("");
  console.log(
    `共 ${report.length} 条用例｜完整覆盖 ${nFull}｜部分覆盖 ${nPart}｜跳过 ${nSkip}` +
      `${nMissing ? `｜未归类 ${nMissing}` : ""}`,
  );
  console.log(`断言 ${assertionCount} 条｜失败用例 ${failing.length}｜耗时 ${elapsed}ms`);
}

process.exit(failing.length === 0 ? 0 : 1);
