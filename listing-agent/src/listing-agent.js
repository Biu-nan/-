// Listing Agent 核心编排器：Parse → Generate → Validate(+自纠错) → [Publish]。
// 无 Express 依赖；AI 与上架均通过构造注入（依赖倒置），核心不 import 任何浏览器/网站内核。
import { normalizeRequest } from "./types.js";
import { resolveProfileKey, getProfile } from "./knowledge/profiles.js";
import { parseStage } from "./stages/parse-stage.js";
import { generateStage } from "./stages/generate-stage.js";
import { validateStage } from "./stages/validate-stage.js";
import { extractJson, Log } from "./util.js";

export class ListingAgent {
  /**
   * @param {object} deps
   * @param {object} [deps.ai] AIProvider 实例
   * @param {object} [deps.publisher] ListingPublisher 实例
   * @param {object} [deps.workspace] { scannedImages?: string[], factFile?: string }
   */
  constructor({ ai = null, publisher = null, workspace = {} } = {}) {
    this.ai = ai;
    this.publisher = publisher;
    this.workspace = workspace;
  }

  /**
   * 完整运行：解析→生成→校验(自纠错)→可选上架。
   * @param {object} rawRequest ListingRequest
   * @returns {Promise<object>} ListingResult
   */
  async run(rawRequest) {
    const request = normalizeRequest(rawRequest);
    const log = new Log();

    const profileKey = resolveProfileKey(request.profileKey, {
      category: request.input.factsJson && request.input.factsJson.category,
      mainKeyword: request.input.factsJson && request.input.factsJson.mainKeyword,
    });
    const profile = getProfile(profileKey);
    log.push("parse", `profileKey=${profileKey} (${profile.label || profile.key})`);

    // Stage 1 · PARSE
    let facts = parseStage({ request, profile });
    log.push("parse", "facts 草稿归一化完成");

    // Stage 2 · GENERATE（仅一次）
    const gen = await generateStage({ request, facts, profile, ai: this.ai, workspace: this.workspace });
    facts = gen.facts;
    log.push("generate", gen.note);

    // Stage 3 · VALIDATE + 自纠错循环
    const autoFixLog = [];
    const maxRounds = Math.max(0, request.options.maxAutoFixRounds || 3);
    let lastReport = null;
    let lastMissing = [];

    for (let round = 0; round <= maxRounds; round++) {
      const { report, missing } = await validateStage({ facts, profile });
      lastReport = report;
      lastMissing = missing;

      if (report.completeness.ok) {
        log.push("validate", `第 ${round} 轮通过（score=${report.qualityScore}）`);
        return this._buildResult("success", profileKey, facts, report, autoFixLog, log, request);
      }
      if (round === maxRounds) break;

      facts = await this._autoFix({ facts, missing, profile, request, round, autoFixLog, log });
    }

    // 自纠错耗尽：区分「可解但用尽」与「需人工」
    const unresolvable = lastMissing.filter((m) => !m.fixable);
    const status = unresolvable.length
      ? "needs_human"
      : "success_with_warnings";
    if (unresolvable.length) {
      log.push("validate", `自纠错耗尽，${unresolvable.length} 项需人工：${unresolvable.map((m) => m.label).join("、")}`);
    }
    return this._buildResult(status, profileKey, facts, lastReport, autoFixLog, log, request);
  }

  /**
   * 自纠错：按缺项类型补默认值 / 重跑 AI / 填店铺配置。
   * @returns {Promise<object>} 修复后的 facts
   */
  async _autoFix({ facts, missing, profile, request, round, autoFixLog, log }) {
    let next = { ...facts, keyAttributes: (facts.keyAttributes || []).slice() };
    let fixedAny = false;

    for (const m of missing) {
      if (!m.fixable) continue;
      if (m.kind === "requiredAttr" && m.defaultValue != null) {
        if (!next.keyAttributes.some((a) => (a.name || "").includes(m.label))) {
          next.keyAttributes.push({ name: m.label, value: m.defaultValue });
          autoFixLog.push(`已用默认值填充 ${m.label}=${m.defaultValue}`);
          fixedAny = true;
        }
      } else if (m.kind === "factLabel" && m.label === "计件单位") {
        if (!next.unit) { next.unit = "件(piece)"; autoFixLog.push("已用默认值填充 计件单位=件(piece)"); fixedAny = true; }
      } else if (m.kind === "factLabel" && m.label === "海关监管属性") {
        if (!next.hsCode) { next.hsCode = "3"; autoFixLog.push("已用默认填充 海关监管属性=3"); fixedAny = true; }
      } else if ((m.kind === "title" || m.kind === "desc") && this.ai && request.options.generateContent !== false) {
        next = await this._fillTextWithAi({ facts: next, profile });
        autoFixLog.push("AI 补生成缺失标题/描述");
        fixedAny = true;
      }
    }

    log.push("validate", fixedAny ? `第 ${round} 轮自纠错：${autoFixLog[autoFixLog.length - 1]}` : `第 ${round} 轮无可自动修复项`);
    return next;
  }

  async _fillTextWithAi({ facts, profile }) {
    const prompt = [
      "# 补全产品文案",
      "基于已有事实，仅输出 JSON 代码块：",
      '{ "title": { "zh": string, "en": string }, "description": { "pc": string, "mobile": string } }',
      "已有关键属性：" + JSON.stringify((facts.keyAttributes || []).map((a) => a.name + ":" + a.value)),
      "类目：" + (facts.category || profile.category || ""),
    ].join("\n");
    try {
      const res = await this.ai.generateText(prompt, "FACTS_FILL", { profileKey: profile.key });
      const patch = extractJson(res.text);
      const next = { ...facts };
      if (patch.title) next.title = { ...facts.title, ...patch.title };
      if (patch.description) next.description = { ...facts.description, ...patch.description };
      return next;
    } catch {
      return facts;
    }
  }

  async _buildResult(status, profileKey, facts, report, autoFixLog, log, request) {
    let publish = { status: "skipped" };
    if (request.options.publish && (status === "success" || status === "success_with_warnings") && this.publisher) {
      try {
        publish = await this.publisher.publish(facts, {
          mode: request.options.publishMode,
          operationId: request.options.operationId,
          targetStore: request.options.targetStore,
        });
      } catch (e) {
        publish = { status: "failed", errors: [e && e.message ? e.message : String(e)] };
      }
    }
    return {
      status,
      profileKey,
      facts,
      validation: report,
      autoFixLog,
      publish,
      artifacts: { factFile: this.workspace && this.workspace.factFile },
      log: log.all(),
    };
  }

  /**
   * 仅校验/归一化（供 collect-batch-generate 复用，不发布）。
   * @param {object} rawRequest
   * @returns {Promise<{profileKey:string, facts:object, report:object, missing:Array}>}
   */
  async validate(rawRequest) {
    const request = normalizeRequest(rawRequest);
    const profileKey = resolveProfileKey(request.profileKey);
    const profile = getProfile(profileKey);
    const facts0 = parseStage({ request, profile });
    const gen = await generateStage({ request, facts: facts0, profile, ai: this.ai, workspace: this.workspace });
    const { report, missing } = await validateStage({ facts: gen.facts, profile });
    return { profileKey, facts: gen.facts, report, missing };
  }
}
