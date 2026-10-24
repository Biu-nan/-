// agents/ae-product-design/src/a-plus-runner.js
// A+ 套图流水线：识别 → 套图设计（模块编排 + 问句卖点）→ 逐图出图 → 精确尺寸 → 模块级验收。
// 产物：design/a-plus/<module>__<slot>.jpg + a-plus-plan.json + a-plus-qc.json

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { buildAplusPlan, buildAplusImagePrompt, expandAplusPlan, loadCatalog, runAplusQc, toExactSize } from "./a-plus.js";
import { buildFactsText, loadInputs } from "./inputs.js";
import { buildSkuLockText, identifyProduct } from "./vision-identify.js";

export async function runAplus({ productDir, outDir, model, tracer, opts = {} }) {
  const catalog = loadCatalog();
  const aplusDir = path.join(outDir, "a-plus");
  await mkdir(aplusDir, { recursive: true });

  const inputs = await loadInputs({ productDir });
  const vision = await identifyProduct({
    images: inputs.images,
    title: inputs.facts?.title?.en ?? inputs.facts?.title?.zh ?? "",
    workDir: path.join(aplusDir, "vision"),
    tracer,
  });
  const skuLock = buildSkuLockText(vision);
  const referenceImages = (vision.available && vision.referenceFiles?.length ? vision.referenceFiles : inputs.images).slice(0, 1);
  const factsText = buildFactsText(inputs, { vision, skuLockText: skuLock });

  const planFile = path.join(aplusDir, "a-plus-plan.json");
  let plan = null;
  if (opts.reusePlan) {
    const { readJson } = await import("../../_shared/state.js");
    plan = await readJson(planFile);
  }
  if (!plan) {
    plan = await buildAplusPlan({ model, catalog, factsText, skuLock });
  }
  await model.tracer.write("context.selected", {
    output_summary: { modules: plan.modules.map((m) => m.moduleId) },
  });
  const { writeJson } = await import("../../_shared/state.js");
  await writeJson(planFile, plan);
  await writeJson(path.join(aplusDir, "a-plus-copy.json"), {
    modules: plan.modules.map((m) => ({ moduleId: m.moduleId, why: m.why, copy: m.copy })),
  });

  let tasks = expandAplusPlan(plan);
  if (opts.aplusModules) {
    const allow = new Set(String(opts.aplusModules).split(",").map((x) => x.trim()).filter(Boolean));
    tasks = tasks.filter((t) => allow.has(t.moduleId));
  }
  if (opts.aplusMaxImages && tasks.length > opts.aplusMaxImages) {
    tasks = tasks.slice(0, opts.aplusMaxImages);
  }

  // 一个会话连续出图：只上传一次参考图，同对话框依次生成整套图
  const genTasks = tasks.map((t) => ({
    ...t,
    outputPath: path.join(aplusDir, t.fileName),
    prompt: buildAplusImagePrompt(t, { skuLock, globalRules: catalog.globalRules }),
  }));
  const genResults = await model.generateImageSeries({ tasks: genTasks, productImages: referenceImages });
  await model.tracer.write("tool.called", {
    tool_call: { name: "chatgpt.image-series", count: genTasks.length },
    output_summary: { ok: genResults.filter((r) => r.ok).length, failed: genResults.filter((r) => !r.ok).length },
    validation: { ok: true },
  });

  const seenHashes = new Set();
  const results = [];
  for (const gen of genResults) {
    const record = {
      module: gen.moduleId,
      slot: gen.slot,
      file: gen.fileName,
      requiredSize: gen.size,
      sellingPointQuestion: gen.sellingPointQuestion,
    };
    if (!gen.ok) {
      record.error = gen.error;
      results.push(record);
      await writeJson(path.join(aplusDir, "a-plus-qc.json"), { updatedAt: new Date().toISOString(), results });
      continue;
    }
    // 同一套图里不允许出现两张完全一样的图（单会话里偶发会重复下载同一张）
    const hash = createHash("md5").update(await readFile(gen.outputPath)).digest("hex");
    if (seenHashes.has(hash)) {
      record.error = { code: "E_DUPLICATE_IMAGE", message: "与本次已产出的图完全相同，判失败" };
      results.push(record);
      continue;
    }
    seenHashes.add(hash);

    record.sized = await toExactSize(gen.outputPath, gen.size);
    if (!record.sized?.ok) {
      record.error = { code: "E_SIZE_FAILED", message: `精确尺寸化失败：${record.sized?.reason}` };
      results.push(record);
      continue;
    }
    try {
      record.qc = await runAplusQc({
        model,
        task: gen,
        imageFile: gen.outputPath,
        referenceFile: referenceImages[0],
        catalog,
      });
    } catch (qcError) {
      // 云端验收不可用（配额/未返回 JSON/CDP 断连）→ 本地视觉模型兜底（只覆盖 SKU 与图内文字）
      const { auditImage } = await import("./vision-identify.js");
      const audit = await auditImage({
        generatedFile: gen.outputPath,
        referenceFile: referenceImages[0],
        targetSku: vision.targetVariant,
        expectedShot: "any",
        workDir: path.join(aplusDir, "vision", "audit"),
      });
      const localPass = audit.available && audit.isTargetSku && audit.hasText === false;
      record.qc = {
        verdict: localPass ? "pass" : "fail",
        source: "local-vl",
        coverage: ["sku", "text"],
        showsIntendedContent: null,
        bannedTextInPixels: audit.hasText === true,
        productMatchesReference: audit.isTargetSku,
        issues: audit.notes ? [audit.notes] : [],
        reason: `云端验收不可用（${String(qcError?.message ?? qcError).slice(0, 80)}），改由本地视觉模型兜底（仅覆盖 SKU/图内文字）`,
      };
    }
    results.push(record);
    await writeJson(path.join(aplusDir, "a-plus-qc.json"), { updatedAt: new Date().toISOString(), results });
  }

  const passed = results.filter((r) => r.qc?.verdict === "pass").length;
  return { catalog, plan, vision, results, passed, total: results.length, outDir: aplusDir };
}
