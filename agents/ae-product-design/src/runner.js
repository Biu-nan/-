// agents/ae-product-design/src/runner.js
// 主流程编排：S0 输入 → S1 事实 → S2 双源调研 → S3 风格聚类 → [风格闸门] →
// S4 storyboard → S5 prompt pack → S6 逐张出图 → S7 QC → S8 报告。
// 契约见 ../contract.md，本文件不得偏离契约的权限级与停机条件。

import { randomUUID } from "node:crypto";
import { access, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";

import { AgentError, CODES, asAgentError } from "../../_shared/errors.js";
import { assertWithin } from "../../_shared/permissions.js";
import { markStage, newState, loadState, readJson, saveState, stageDone, writeJson } from "../../_shared/state.js";
import { Tracer } from "../../_shared/trace.js";
import { generateSlot, guardPrompt } from "./generate.js";
import { buildFactsText, buildSlotText, loadInputs } from "./inputs.js";
import { ModelClient } from "./model.js";
import {
  buildPromptPack,
  buildStoryboard,
  clusterStyles,
  fallbackDossier,
  synthesizePromptPack,
  synthesizeStoryboard,
} from "./planning.js";
import { runQc, buildLocalQc, deterministicQc, isQcDeliverable } from "./qc.js";
import { fitSubjectScale, parseScaleRange } from "./image-tools.js";
import { slotDataReadiness } from "./readiness.js";
import { auditImage, buildSkuLockText, identifyProduct } from "./vision-identify.js";
import { loadBenchmark } from "./benchmark.js";
import { buildKeywords, collectStyleRefs, loadExistingRefs } from "./style-research.js";
import { validatePromptPack, validateStoryboard } from "../../_shared/schemas.js";

export const LIMITS = {
  maxAttemptsPerSlot: 3,
  maxModelCalls: 20,
  maxRuntimeMs: 90 * 60 * 1000,
  maxImages: (slots) => slots * 3,
};

const slug = (text) =>
  String(text ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "unknown";

function pickCategoryKey(facts, keywords, override) {
  if (override) return slug(override);
  const raw = facts?.category ?? facts?.product?.category ?? facts?.productType ?? keywords?.[0] ?? "unknown";
  return slug(Array.isArray(raw) ? raw[0] : raw);
}

async function styleGate({ dossier, opts, tracer, runId }) {
  const recommended = dossier.series.find((s) => s.recommended) ?? dossier.series[0];
  const lines = dossier.series.map(
    (s) =>
      `  ${s.id}${s.recommended ? " ★推荐" : "     "} | ${s.name} | ${s.thesis}\n` +
      `            构图=${s.composition} 背景=${s.background} 文字=${s.textDensity}`,
  );
  const summary = lines.join("\n");

  const approve = (seriesId, approvedBy) => ({
    seriesId,
    approvedBy,
    approvedAt: new Date().toISOString(),
  });

  if (opts.series) {
    const found = dossier.series.find((s) => s.id === opts.series);
    if (!found) {
      throw new AgentError(CODES.GATE_REJECTED, `指定的系列不存在：${opts.series}\n可选：${dossier.series.map((s) => s.id).join(", ")}`);
    }
    return approve(found.id, "human");
  }
  if (opts.autoApprove) return approve(recommended.id, "auto");

  await tracer.write("approval.requested", {
    input_summary: { gate: "style-dossier", recommended: recommended.id },
    output_summary: { series: dossier.series.map((s) => s.id) },
  });

  if (!process.stdin.isTTY) {
    throw new AgentError(
      CODES.APPROVAL_REQUIRED,
      `风格闸门需要人工确认（当前非交互环境）。\n${summary}\n\n` +
        `确认方式：--series <id> 选定某套，或 --auto 直接放行推荐系列后重跑同一命令（加 --resume）。\n` +
        `runId=${runId}`,
      { series: dossier.series.map((s) => s.id), recommended: recommended.id },
    );
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\n=== 风格闸门：请选择本次出图使用的风格系列 ===");
    console.log(summary);
    const answer = (await rl.question(`\n输入系列 id（回车=采用推荐 ${recommended.id}，n=中止）：`)).trim();
    if (answer.toLowerCase() === "n") {
      throw new AgentError(CODES.GATE_REJECTED, "人工中止于风格闸门");
    }
    if (!answer) return approve(recommended.id, "human");
    const found = dossier.series.find((s) => s.id === answer);
    if (!found) throw new AgentError(CODES.GATE_REJECTED, `无效系列 id：${answer}`);
    return approve(found.id, "human");
  } finally {
    rl.close();
  }
}

export async function runAgent(opts) {
  const startedAt = Date.now();
  const inputs = await loadInputs({
    productDir: opts.productDir,
    factsFile: opts.factsFile,
    slotsFile: opts.slotsFile,
  });
  const outDir = path.resolve(opts.outDir ?? path.join(inputs.productDir, "design"));
  assertWithin(inputs.productDir, outDir, "输出目录");

  const designImageDir = path.join(outDir, "images");
  const thumbDir = path.join(outDir, "thumbs");
  const stateFile = path.join(outDir, "run-state.json");
  const traceFile = path.join(outDir, "trace.jsonl");

  // 规格按槽位分：商品图 1:1 / 白底营销图 1:1 / 场景营销图 3:4
  const specMap = inputs.spec ?? {};
  const scoringConfig = inputs.config?.heroScoring;
  const manualSkip = new Set(opts.skipSlots ?? []);
  const requestedSlots = inputs.slots.filter((slot) => !manualSkip.has(slot.id));
  const skippedByOption = inputs.slots.filter((slot) => manualSkip.has(slot.id));

  const previous = opts.resume ? await loadState(stateFile) : null;
  const runId = previous?.runId ?? randomUUID();
  const slotIds = inputs.slots.map((s) => s.id);
  const state = previous ?? newState({ runId, productDir: inputs.productDir, outDir, slotIds, engine: "chatgpt" });
  state.outDir = outDir;
  state.warnings = [...new Set([...(state.warnings ?? []), ...inputs.warnings])];
  state.redacted = [...new Set([...(state.redacted ?? []), ...inputs.redacted])];

  const tracer = new Tracer({
    file: traceFile,
    runId,
    agentId: "ae-product-design",
    principal: "agent:ae-product-design@local",
    delegatedBy: "human:lance@local",
    captureContent: Boolean(opts.traceContent),
  });

  const save = async (file, data) => {
    assertWithin(outDir, file, "写入");
    await writeJson(file, data);
    return file;
  };

  const budgetCheck = () => {
    if (tracer.modelCalls >= LIMITS.maxModelCalls) {
      throw new AgentError(CODES.BUDGET_EXCEEDED, `模型调用已达上限 ${LIMITS.maxModelCalls}`);
    }
    if (tracer.imageGenerations >= LIMITS.maxImages(inputs.slots.length)) {
      throw new AgentError(CODES.BUDGET_EXCEEDED, `出图次数已达上限 ${LIMITS.maxImages(inputs.slots.length)}`);
    }
    if (Date.now() - startedAt > LIMITS.maxRuntimeMs) {
      throw new AgentError(CODES.BUDGET_EXCEEDED, "运行超过 90 分钟上限");
    }
  };

  await tracer.write("agent.started", {
    input_summary: {
      productDir: inputs.productDir,
      images: inputs.images.length,
      slots: slotIds,
      factsSource: inputs.factsSource,
      dryRun: Boolean(opts.dryRun),
      resume: Boolean(previous),
    },
  });
  await tracer.write("guardrail.checked", {
    validation: { ok: true, redacted: inputs.redacted, warnings: inputs.warnings },
  });

  // ---------- S1.5 本地视觉识别（不占云端附件配额）----------
  let vision = { available: false, reason: opts.noVisionIdentify ? "disabled" : "not-run" };
  if (!opts.noVisionIdentify && !opts.dryRun) {
    vision = await identifyProduct({
      images: inputs.images,
      title: inputs.facts?.title?.en ?? inputs.facts?.title?.zh ?? "",
      workDir: path.join(outDir, "vision"),
      tracer,
    });
    if (vision.available) {
      await save(path.join(outDir, "vision-profile.json"), vision);
      if (vision.forbiddenVariants?.length) {
        state.warnings.push(
          `MULTI_SKU_REFS: 参考图含 ${vision.forbiddenVariants.length} 个其它 SKU（${vision.forbiddenVariants.join(", ")}），已按目标 ${vision.targetVariant} 反选参考图`,
        );
      }
    } else {
      state.warnings.push(`VISION_IDENTIFY_SKIPPED: ${vision.reason}`);
    }
  }
  const skuLockText = buildSkuLockText(vision);
  const referenceImages = (
    vision.available && vision.referenceFiles?.length ? vision.referenceFiles : inputs.images
  ).slice(0, opts.productImageLimit ?? 2);

  const report = {
    schemaVersion: "1.0",
    agentId: "ae-product-design",
    runId,
    productDir: inputs.productDir,
    outDir,
    status: "running",
    dryRun: Boolean(opts.dryRun),
    styleSource: null,
    styleSeriesChosen: null,
    slots: [],
    counts: { requested: requestedSlots.length, delivered: 0, qcPassed: 0 },
    heroScore: null,
    gate: null,
    budget: {},
    referenceImages: referenceImages.map((f) => path.basename(f)),
    targetVariant: vision.targetVariant ?? null,
    forbiddenVariants: vision.forbiddenVariants ?? [],
    redacted: state.redacted,
    warnings: state.warnings,
  };

  const holdCandidate = async (slot, slotState, file, qc) => {
    assertWithin(outDir, file, "候选图片");
    slotState.file = null;
    slotState.candidateFile = file;
    slotState.qc = qc;
    slotState.status = qc?.verdict === "fail" ? "qc-failed" : "unverified";
    await save(stateFile, state);
    const candidatesDir = path.join(outDir, "candidates");
    if (path.dirname(file) !== candidatesDir) {
      await mkdir(candidatesDir, { recursive: true });
      const isolated = path.join(candidatesDir, `${slot.id}_${Date.now()}_${randomUUID().slice(0, 8)}.jpg`);
      // 隔离失败必须报错，不能留下交付目录中的假合格图。
      await rename(file, isolated);
      slotState.candidateFile = isolated;
      await save(stateFile, state);
    }
  };

  const acceptCandidate = async (slot, slotState, file, qc) => {
    const target = path.join(designImageDir, `${slot.id}.jpg`);
    if (file !== target) {
      if (await access(target).then(() => true).catch(() => false)) {
        throw new AgentError(CODES.GATE_REJECTED, `交付路径存在未经核验的文件：${slot.id}`);
      }
      await mkdir(designImageDir, { recursive: true });
      await rename(file, target);
    }
    slotState.status = "passed";
    slotState.file = target;
    slotState.candidateFile = null;
    slotState.qc = qc;
    await save(stateFile, state);
  };

  const finalize = async (status, extra = {}) => {
    if (!opts.dryRun) {
      for (const slot of requestedSlots) {
        const slotState = state.slots[slot.id];
        if (!slotState || (slotState.status === "passed" && isQcDeliverable(slotState.qc, slot))) continue;
        const possible = [slotState.candidateFile, slotState.file, path.join(designImageDir, `${slot.id}.jpg`)];
        const candidate = [];
        for (const file of possible.filter(Boolean)) {
          if (!candidate.includes(file) && await access(file).then(() => true).catch(() => false)) candidate.push(file);
        }
        slotState.file = null;
        for (const file of candidate) {
          await holdCandidate(slot, slotState, file, slotState.qc ?? { verdict: "unverified", reason: "任务中断，尚未完成检查" });
        }
        const reported = report.slots.find(s => s.id === slot.id);
        if (reported) reported.file = null;
      }
    }
    report.status = status;
    report.budget = {
      modelCalls: tracer.modelCalls,
      imageGenerations: tracer.imageGenerations,
      elapsedMs: Date.now() - startedAt,
    };
    const byId = new Map(report.slots.map((s) => [s.id, s]));
    report.slots = [
      ...requestedSlots.map((s) => byId.get(s.id)).filter(Boolean),
      ...skippedByOption.map((s) => ({
        id: s.id,
        module: s.module,
        file: null,
        attempts: 0,
        qc: { verdict: "skipped", reason: "手动跳过（--skip-slots）" },
      })),
    ];
    const verifiedSlots = report.slots.filter(s => s.file && isQcDeliverable(s.qc, inputs.slots.find(slot => slot.id === s.id)));
    const delivered = verifiedSlots.length;
    const qcPassed = verifiedSlots.length;
    report.counts = { requested: requestedSlots.length, delivered, qcPassed };
    const hero = report.slots.find((s) => s.id === "P1");
    report.heroScore = hero?.qc?.heroScore
      ? { total: hero.qc.heroScore.total, threshold: scoringConfig?.threshold ?? 80, pass: hero.qc.heroJudge?.pass ?? null }
      : null;
    report.benchmark = await loadBenchmark(outDir);
    state.status = status;
    await save(stateFile, state);
    await save(path.join(outDir, "design-report.json"), { ...report, ...extra });
    return report;
  };

  const model = opts.dryRun ? null : new ModelClient({ tracer, agentId: "ae-product-design" });
  const checkCandidate = async (slot, imageFile) => {
    try {
      return await runQc({ model, slot, imageFile, referenceImage: inputs.images[0],
        spec: specMap[slot.specKey] ?? specMap.product, scoringConfig,
        vision: opts.visionQc !== false, thumbDir, skuLock: skuLockText });
    } catch (error) {
      if (!/E_UPLOAD_UNAVAILABLE|附件|入口当前被禁用/.test(`${error?.code ?? ""} ${error?.message ?? ""}`) || !vision.available) throw error;
      const audit = await auditImage({ generatedFile: imageFile,
        referenceFile: vision.referenceFiles?.[0] ?? inputs.images[0], targetSku: vision.targetVariant,
        expectedShot: slot.shot ?? "any", workDir: path.join(outDir, "vision", "audit") });
      const deterministic = await deterministicQc(imageFile, specMap[slot.specKey] ?? specMap.product);
      report.warnings.push(`${slot.id}_QC_FALLBACK_LOCAL: 局部检查仅保留候选，待补验`);
      return buildLocalQc({ slot, dimension: deterministic.dimension, audit });
    }
  };
  const factsText = buildFactsText(inputs, { vision, skuLockText });
  const slotText = buildSlotText(requestedSlots, specMap);
  const keywords = buildKeywords(inputs.facts, opts.keywords ?? []);
  const categoryKey = pickCategoryKey(inputs.facts, keywords, opts.categoryKey);

  try {
    // ---------- S2 风格调研 ----------
    let research = { styleSource: "none", refs: [], sources: {}, note: "dry-run 跳过调研" };
    let dossier;
    const reusable = opts.reuseDossier
      ? await readJson(path.join(outDir, "style-dossier.json"))
      : null;

    if (opts.dryRun) {
      dossier = await fallbackDossier({ refs: [], categoryKey });
      research.styleSource = "dry-run";
      markStage(state, "style-research", "done", { note: "dry-run 跳过" });
    } else if (reusable?.schemaVersion) {
      dossier = reusable;
      research.styleSource = reusable.source ?? "cached";
      markStage(state, "style-research", "done", { note: "复用已有 dossier" });
    } else if (stageDone(state, "style-research") && (await readJson(path.join(outDir, "style-dossier.json")))) {
      dossier = await readJson(path.join(outDir, "style-dossier.json"));
      research.styleSource = dossier.source ?? "cached";
    } else {
      // 续跑或显式 --reuse-refs：优先复用上次已下载的竞品图，避免重复抓取触发反爬
      const cached = opts.reuseRefs || opts.resume
        ? await loadExistingRefs(path.join(outDir, "style-refs"), Math.min(opts.maxRefs ?? 8, 12) * 2)
        : { refs: [], sources: {} };
      if (cached.refs.length >= 2) {
        research = {
          styleSource: Object.keys(cached.sources).join("+") || "manual",
          refs: cached.refs,
          sources: cached.sources,
          note: "复用已下载的竞品参考图",
        };
        await tracer.write("tool.called", {
          tool_call: { name: "fs.read", purpose: "reuse-style-refs", count: cached.refs.length },
        });
      } else {
        try {
          research = await collectStyleRefs({
            keywords,
            outRoot: path.join(outDir, "style-refs"),
            maxRefs: Math.min(opts.maxRefs ?? 8, 12),
            tracer,
            manualDir: opts.styleRefsDir,
          });
        } catch (error) {
          const err = asAgentError(error, CODES.RESEARCH_EMPTY);
          if (err.code !== CODES.RESEARCH_EMPTY || !opts.allowResearchFallback) throw err;
          research = { styleSource: "fallback", refs: [], sources: err.details?.sources ?? {}, note: err.message };
        }
      }

      if (research.styleSource === "fallback" || research.refs.length === 0) {
        dossier = await fallbackDossier({ refs: [], categoryKey });
        report.warnings.push(`STYLE_SOURCE=${research.styleSource}: ${research.note ?? ""}`);
      } else {
        budgetCheck();
        await model.openPlanningChat(research.refs.map((r) => r.file));
        dossier = await clusterStyles({
          model,
          tracer,
          factsText,
          refs: research.refs,
          categoryKey,
        });
      }
      markStage(state, "style-research", "done", {
        styleSource: research.styleSource,
        refs: research.refs.length,
        sources: research.sources,
      });
    }

    report.styleSource = research.styleSource ?? dossier.source ?? "unknown";
    dossier.categoryKey ||= categoryKey;
    await save(path.join(outDir, "style-dossier.json"), dossier);
    await tracer.write("context.selected", {
      output_summary: { stage: "style-dossier", chosen: dossier.chosen, series: dossier.series.length },
    });

    // ---------- 风格闸门 ----------
    if (!opts.dryRun) {
      const gate = await styleGate({ dossier, opts, tracer, runId });
      report.gate = gate;
      dossier.chosen = gate.seriesId;
      dossier.series = dossier.series.map((s) => ({ ...s, recommended: s.id === gate.seriesId }));
      await save(path.join(outDir, "style-dossier.json"), dossier);
      state.gate = gate;
      await save(stateFile, state);
    } else {
      report.gate = { seriesId: dossier.chosen, approvedBy: "dry-run", approvedAt: new Date().toISOString() };
    }
    report.styleSeriesChosen = dossier.chosen;

    // ---------- S4 storyboard ----------
    let storyboard;
    const cachedStoryboard = stageDone(state, "storyboard")
      ? await readJson(path.join(outDir, "storyboard.json"))
      : null;
    const storyboardReusable =
      cachedStoryboard?.items?.length === requestedSlots.length &&
      cachedStoryboard.items.every((item, i) => item.slotId === requestedSlots[i].id);
    if (opts.dryRun) {
      storyboard = synthesizeStoryboard({ slots: requestedSlots, dossier });
      validateStoryboard(storyboard, requestedSlots);
    } else if (storyboardReusable) {
      storyboard = cachedStoryboard;
      validateStoryboard(storyboard, requestedSlots);
      await tracer.write("context.selected", { output_summary: { stage: "storyboard", reused: true } });
    } else {
      budgetCheck();
      storyboard = await buildStoryboard({ model, slots: requestedSlots, factsText, slotText, dossier, skuLock: skuLockText });
    }
    await save(path.join(outDir, "storyboard.json"), storyboard);
    markStage(state, "storyboard", "done");
    await save(stateFile, state);

    // ---------- S5 prompt pack ----------
    let pack;
    const cachedPack = stageDone(state, "prompt-pack")
      ? await readJson(path.join(outDir, "prompt-pack.json"))
      : null;
    const packReusable =
      cachedPack?.prompts?.length === requestedSlots.length &&
      cachedPack.prompts.every((item, i) => item.slotId === requestedSlots[i].id);
    if (opts.dryRun) {
      pack = synthesizePromptPack({ slots: requestedSlots, specMap });
      validatePromptPack(pack, requestedSlots, specMap);
    } else if (packReusable) {
      pack = cachedPack;
      validatePromptPack(pack, requestedSlots, specMap);
      await tracer.write("context.selected", { output_summary: { stage: "prompt-pack", reused: true } });
    } else {
      budgetCheck();
      pack = await buildPromptPack({
        model,
        slots: requestedSlots,
        specMap,
        factsText,
        slotText,
        dossier,
        storyboard,
        skuLock: skuLockText,
      });
    }
    await save(path.join(outDir, "prompt-pack.json"), pack);
    markStage(state, "prompt-pack", "done");
    await save(stateFile, state);

    if (opts.dryRun) {
      for (const slot of requestedSlots) {
        report.slots.push({ id: slot.id, module: slot.module, file: null, attempts: 0, qc: { verdict: "unverified", reason: "dry-run 未出图" } });
      }
      await tracer.write("agent.completed", { output_summary: { dryRun: true, stages: "S0-S5" } });
      return { status: "partial", report: await finalize("partial", { dryRunNote: "dry-run 止于 prompt-pack，未出图" }) };
    }

    // ---------- S6 出图 + S7 QC ----------
    const failures = [];
    let lastErrorCode = null;
    let sameCodeStreak = 0;

    for (const slot of requestedSlots) {
      const slotState = state.slots[slot.id] ?? { status: "pending", attempts: 0 };
      state.slots[slot.id] = slotState;
      // 恢复文件是输入数据，先验证路径，再做文件读取或模型上传。
      if (slotState.file) assertWithin(outDir, slotState.file, "历史交付图片");
      if (slotState.candidateFile) assertWithin(outDir, slotState.candidateFile, "待补验图片");
      // 模型可在 storyboard 里显式跳过可选槽位（不为凑数量重复图片）
      // 数据就绪守卫：缺尺寸/配件信息时跳过，而不是让模型编造
      const readiness = slotDataReadiness(slot, inputs.facts);
      if (!readiness.ready) {
        slotState.status = "skipped";
        slotState.skipReason = readiness.reason;
        report.warnings.push(`${slot.id}_SKIPPED: ${readiness.reason}`);
        report.slots.push({
          id: slot.id,
          module: slot.module,
          file: null,
          attempts: 0,
          qc: { verdict: "skipped", reason: readiness.reason },
        });
        await save(stateFile, state);
        continue;
      }
      const planItem = storyboard.items.find((i) => i.slotId === slot.id);
      if (planItem?.skip === true) {
        slotState.status = "skipped";
        slotState.skipReason = planItem.skipReason;
        report.slots.push({
          id: slot.id,
          module: slot.module,
          file: null,
          attempts: 0,
          qc: { verdict: "skipped", reason: planItem.skipReason },
        });
        await save(stateFile, state);
        continue;
      }
      if (slotState.status === "passed" && slotState.file && isQcDeliverable(slotState.qc, slot) &&
          (await access(slotState.file).then(() => true).catch(() => false))) {
        report.slots.push({
          id: slot.id,
          module: slot.module,
          file: path.relative(outDir, slotState.file).replace(/\\/g, "/"),
          width: slotState.qc?.dimension?.width ?? null,
          height: slotState.qc?.dimension?.height ?? null,
          attempts: slotState.attempts,
          qc: slotState.qc ?? null,
          postProcess: slotState.postProcess ?? null,
        });
        continue;
      }

      const prompt = guardPrompt(pack.prompts.find((p) => p.slotId === slot.id)?.prompt ?? "", slot, { skuLock: skuLockText });
      let passed = false;
      let lastQc = null;

      // 待补验候选与合格交付分开保存。恢复时先检查原候选，不再自动重新生图。
      if (slotState.candidateFile && await access(slotState.candidateFile).then(() => true).catch(() => false)) {
        budgetCheck();
        lastQc = await checkCandidate(slot, slotState.candidateFile);
        if (isQcDeliverable(lastQc, slot)) {
          await acceptCandidate(slot, slotState, slotState.candidateFile, lastQc);
          passed = true;
        } else {
          await holdCandidate(slot, slotState, slotState.candidateFile, lastQc);
          if (lastQc.verdict === "unverified") failures.push(slot.id);
        }
        if (passed || lastQc.verdict === "unverified") {
          report.slots.push({ id: slot.id, module: slot.module,
            file: passed ? path.relative(outDir, slotState.file).replace(/\\/g, "/") : null,
            attempts: slotState.attempts, qc: lastQc, width: lastQc.dimension?.width, height: lastQc.dimension?.height });
          continue;
        }
      }

      // 每轮续跑允许再试 maxAttempts 次（attempts 只做累计记录），
      // 否则中断后 attempts 已达上限会导致该槽位永远无法重试。
      const previousAttempts = slotState.attempts ?? 0;
      for (let attempt = 1; attempt <= LIMITS.maxAttemptsPerSlot; attempt += 1) {
        budgetCheck();
        slotState.status = "generating";
        slotState.attempts = previousAttempts + attempt;
        await save(stateFile, state);
        try {
          const imageFile = await generateSlot({
            model,
            slot,
            prompt,
            imagesDir: designImageDir,
            productImages: referenceImages,
            attempt,
          });
          slotState.candidateFile = imageFile;
          slotState.file = null;
          await save(stateFile, state);
          // 纯白底图主体占比校正：模型有撑满画面的惯性（实测 88%/93%），
          // 这里用确定性补白把占比拉回目标区间，商品像素不缩放、可重复执行。
          let postProcess = null;
          const scaleRange = parseScaleRange(slot.productScale);
          if (scaleRange && /white/i.test(slot.background ?? "")) {
            postProcess = await fitSubjectScale(imageFile, scaleRange);
            if (postProcess?.action === "padded") {
              slotState.postProcess = postProcess;
              await tracer.write("tool.called", {
                tool_call: { name: "image.fit-scale", slotId: slot.id, attempt },
                output_summary: {
                  before: postProcess.subjectScaleBefore,
                  after: postProcess.subjectScaleAfter,
                  size: postProcess.sizeAfter,
                },
                validation: { ok: true },
              });
            }
          }
          lastQc = await checkCandidate(slot, imageFile);
          await save(path.join(outDir, "qc-report.json"), {
            runId,
            updatedAt: new Date().toISOString(),
            items: [
              ...(report.slots.map((s) => s.qc).filter(Boolean)),
              lastQc,
            ],
          });
          if (isQcDeliverable(lastQc, slot)) {
            await acceptCandidate(slot, slotState, imageFile, lastQc);
            passed = true;
            break;
          }
          await holdCandidate(slot, slotState, imageFile, lastQc);
          // 缺少检查应等待补验，不能因为检查不可用而重复消耗生图次数。
          if (lastQc.verdict === "unverified") {
            break;
          }
        } catch (error) {
          let err = asAgentError(error, CODES.UNKNOWN);
          // 附件入口被禁用多数是临时限流，不该被误判成"出图超时"
          if (/入口当前被禁用|添加照片和文件|未确认全部产品图片/.test(err.message || "")) {
            err = new AgentError(CODES.UPLOAD_UNAVAILABLE, err.message, err.details);
          }
          if (err.code === CODES.IMAGE_TOOL_UNAVAILABLE || err.code === CODES.MODEL_UNAVAILABLE) throw err;

          // 配额断供时：若该槽位已有上一轮生成的成图，改用本地视觉模型兜底判定，
          // 通过就采纳（qc.source=local-vl），不白白丢掉已经画好的图。
          if (err.code === CODES.UPLOAD_UNAVAILABLE && vision.available) {
            const existing = path.join(designImageDir, `${slot.id}.jpg`);
            const hasExisting = await access(existing).then(() => true).catch(() => false);
            if (hasExisting) {
              const audit = await auditImage({
                generatedFile: existing,
                referenceFile: vision.referenceFiles?.[0] ?? inputs.images[0],
                targetSku: vision.targetVariant,
                expectedShot: slot.shot ?? "any",
                workDir: path.join(outDir, "vision", "audit"),
              });
              const deterministic = await deterministicQc(existing, specMap[slot.specKey] ?? specMap.product);
              lastQc = buildLocalQc({ slot, dimension: deterministic.dimension, audit });
              await holdCandidate(slot, slotState, existing, lastQc);
              report.warnings.push(`${slot.id}_QC_FALLBACK_LOCAL: 已有候选保留待补验，不作为合格交付`);
              await save(stateFile, state);
              break;
            }
          }
          if (passed) break; // 已用本地兜底采纳现成图，无需再试
          slotState.status = "failed";
          slotState.lastError = err.toPayload();
          await save(stateFile, state);
          await tracer.write("tool.called", {
            tool_call: { name: "chatgpt.image", slotId: slot.id, attempt },
            validation: { ok: false },
            error: err.toPayload(),
          });
        }
      }

      if (!passed) {
        failures.push(slot.id);
        // 断流判定按"槽位"累计：同一个错误码连续命中 2 个槽位才停机，
        // 单个槽位内部重试不计入，避免一次限流就把整轮打断。
        const slotErrorCode = slotState.lastError?.code ?? null;
        if (slotErrorCode && slotErrorCode === lastErrorCode) {
          sameCodeStreak += 1;
        } else if (slotErrorCode) {
          lastErrorCode = slotErrorCode;
          sameCodeStreak = 1;
        }
        if (sameCodeStreak >= 2) {
          throw new AgentError(
            CODES.BUDGET_EXCEEDED,
            `连续 2 个槽位同一错误（${lastErrorCode}），已停止批量出图`,
            { slots: failures },
          );
        }
      }
      report.slots.push({
        id: slot.id,
        module: slot.module,
        file: slotState.file ? path.relative(outDir, slotState.file).replace(/\\/g, "/") : null,
        width: lastQc?.dimension?.width ?? null,
        height: lastQc?.dimension?.height ?? null,
        attempts: slotState.attempts,
        qc: slotState.qc ?? null,
        postProcess: slotState.postProcess ?? null,
      });
      await save(stateFile, state);
    }

    // 本地独立审计（不占云端配额）：给每张成图打 SKU/镜头/文字标签，作为交叉验证
    if (vision.available && vision.targetVariant) {
      const referenceForAudit = vision.referenceFiles?.[0] ?? inputs.images[0];
      const auditItems = [];
      for (const slot of requestedSlots) {
        const file = path.join(designImageDir, `${slot.id}.jpg`);
        const exists = await access(file).then(() => true).catch(() => false);
        if (!exists) continue;
        const audit = await auditImage({
          generatedFile: file,
          referenceFile: referenceForAudit,
          targetSku: vision.targetVariant,
          expectedShot: slot.shot ?? "any",
          workDir: path.join(outDir, "vision", "audit"),
        });
        auditItems.push({ slot: slot.id, expectedShot: slot.shot ?? "any", ...audit });
      }
      if (auditItems.length) {
        await save(path.join(outDir, "local-audit.json"), {
          auditedAt: new Date().toISOString(),
          model: vision.model,
          targetVariant: vision.targetVariant,
          items: auditItems,
        });
        report.localAudit = {
          targetVariant: vision.targetVariant,
          items: auditItems.map((i) => ({
            slot: i.slot,
            skuOk: i.isTargetSku ?? null,
            shotOk: i.shotMatch ?? null,
            hasText: i.hasText ?? null,
          })),
        };
      }
    }

    markStage(state, "generate", "done", { failures });
    await tracer.write("agent.completed", {
      output_summary: { delivered: report.slots.filter((s) => s.file).length, failures },
    });
    const status = failures.length === 0 ? "completed" : "partial";
    return {
      status,
      report: await finalize(status, failures.length ? { failedSlots: failures } : {}),
    };
  } catch (error) {
    const err = asAgentError(error);
    const status = [
      CODES.APPROVAL_REQUIRED,
      CODES.GATE_REJECTED,
      CODES.MODEL_UNAVAILABLE,
      CODES.IMAGE_TOOL_UNAVAILABLE,
      CODES.RESEARCH_EMPTY,
      CODES.BUDGET_EXCEEDED,
      CODES.IMAGE_TIMEOUT,
    ].includes(err.code)
      ? "escalated"
      : "failed";
    markStage(state, "error", status, err.toPayload());
    await tracer.write("agent.failed", { error: err.toPayload() });
    const report2 = await finalize(status, { error: err.toPayload() });
    return { status, report: report2, error: err.toPayload() };
  }
}
