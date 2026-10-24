// 秘书 Agent 的大模型意图编译层。
//
// 定位（不可越界）：
//   模型只做「把用户一句话 + 页面上下文 编译成结构化草稿 intent」。
//   模型不执行任何动作、不写业务数据、不直接改状态。
//   P0 协议的 L0-L3 风险分级与 requires_confirmation 闸门保持原样，
//   且模型给出的风险等级只能被"抬高"，不能被降低（见 computeRiskFloor）。
//
// 失败策略：任何异常（无 key / 超时 / HTTP 错误 / JSON 解析失败）都返回
//   { ok: false, reason }，由调用方降级回本地占位逻辑。秘书不允许因为模型挂了而变砖。
//
// 配置来源（优先级从高到低）：
//   1. 环境变量  SECRETARY_LLM_KEY / SECRETARY_LLM_BASE_URL / SECRETARY_LLM_MODEL
//   2. 本地未入库文件 <PROJECT_ROOT>/.secretary-llm.json
//      { "api_key": "...", "base_url": "https://api.deepseek.com", "model": "deepseek-chat" }
//
// 注意：watchdog 通过 spawn 拉起 server，父进程环境变量不会自动继承到已运行实例，
//       因此改环境变量后需要重启 server；改用 .secretary-llm.json 则无需重启（按请求读取）。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { PROJECT_ROOT } from "./config.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = Number(process.env.SECRETARY_LLM_TIMEOUT_MS ?? 20000);
const CREDENTIALS_FILE = path.join(PROJECT_ROOT, ".secretary-llm.json");

export const RISK_ORDER = ["L0", "L1", "L2", "L3"];

// 确定性风险下限：模型无权把风险降到这个线以下。
// 宁可误判过严，也不允许模型替用户解锁高风险动作。
const RISK_FLOOR_RULES = [
    { level: "L3", pattern: /发布|上架|刊登|提交审核|下单|付款|退款|删除|清空|移除|下架|批量删除/ },
    { level: "L2", pattern: /修改|覆盖|重写|重跑|批量|归档|移动|重命名|执行|生成图片|上传|下载|调整|改一下|改成|改为|换个|替换|设置|填入|填写/ }
];

let cachedCredentials = null;

export function computeRiskFloor(message) {
    const text = String(message ?? "");
    for (const rule of RISK_FLOOR_RULES) {
        if (rule.pattern.test(text))
            return rule.level;
    }
    return "L0";
}

function maxRisk(a, b) {
    const ia = RISK_ORDER.indexOf(RISK_ORDER.includes(a) ? a : "L1");
    const ib = RISK_ORDER.indexOf(RISK_ORDER.includes(b) ? b : "L1");
    return RISK_ORDER[Math.max(ia, ib)];
}

// 最终风险 = max(模型判定, 确定性关键词下限)。
// 即使模型不可用（降级），下限依然生效：高风险措辞不会被漏判。
export function resolveEffectiveRisk(modelRisk, message) {
    const base = RISK_ORDER.includes(modelRisk) ? modelRisk : "L1";
    return maxRisk(base, computeRiskFloor(message));
}

async function loadCredentials() {
    if (cachedCredentials)
        return cachedCredentials;
    const envKey = String(process.env.SECRETARY_LLM_KEY ?? "").trim();
    if (envKey) {
        cachedCredentials = {
            apiKey: envKey,
            baseUrl: String(process.env.SECRETARY_LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
            model: String(process.env.SECRETARY_LLM_MODEL ?? DEFAULT_MODEL)
        };
        return cachedCredentials;
    }
    try {
        const parsed = JSON.parse(await readFile(CREDENTIALS_FILE, "utf8"));
        const apiKey = String(parsed?.api_key ?? "").trim();
        if (!apiKey)
            return null; // 不缓存 null：补上 key 后无需重启即可生效
        cachedCredentials = {
            apiKey,
            baseUrl: String(parsed?.base_url ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
            model: String(parsed?.model ?? DEFAULT_MODEL)
        };
        return cachedCredentials;
    }
    catch {
        return null;
    }
}

// 只读快照：让秘书能答"现在跑到哪了"。严格只引用字段值，不允许推断。
export async function readWorkbenchSnapshot() {
    const snapshot = { run_state: null, read_errors: [] };
    try {
        const raw = await readFile(path.join(PROJECT_ROOT, "run-state.json"), "utf8");
        const state = JSON.parse(raw);
        snapshot.run_state = {
            stage: state?.stage ?? null,
            running: state?.running === true,
            message: state?.message ?? null,
            workflow_mode: state?.workflowMode ?? null,
            image_count: Number(state?.imageCount ?? 0),
            updated_at: state?.updatedAt ?? null
        };
    }
    catch (error) {
        snapshot.read_errors.push(`run-state.json: ${error instanceof Error ? error.message : String(error)}`);
    }
    return snapshot;
}

function buildSystemPrompt() {
    return [
        "你是一跨而境跨境电商工作台右侧抽屉里的本地秘书。",
        "你的唯一职责：把用户的一句话编译成一条结构化的「待确认草稿指令」，并给出一句人话回复。",
        "",
        "硬约束（违反即无效）：",
        "1. 你没有任何执行权限。禁止声称你已经执行、发布、修改、删除或上架任何东西。",
        "2. 禁止编造数据。上下文里没有的进度、数量、状态，一律回答「当前上下文里没有这个信息」。",
        "3. 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释性前后缀。",
        "",
        "输出 JSON 字段：",
        '{',
        '  "interpreted_intent": "把你理解到的意图压成一句话（中文，不超过 40 字）",',
        '  "reply": "给用户的人话回复。直接回答或直接说清你要做什么，不寒暄，不超过 120 字",',
        '  "suggested_next_action": "建议的下一步（中文，不超过 30 字）",',
        '  "command_type": "给草稿指令用的类型标识，形如 secretary.<动作>，全小写英文与点号",',
        '  "risk_level": "L0 | L1 | L2 | L3",',
        '  "reason": "这样定级的理由（中文，不超过 40 字）"',
        '}',
        "",
        "风险定级标准：",
        "- L0：纯查询/只读，不改任何东西。例如查看进度、问状态。",
        "- L1：生成本地草稿或建议，需人工确认后才可能被采纳（默认档）。",
        "- L2：会修改本地文件、重建目录、批量跑流程。",
        "- L3：对外部世界生效或不可逆。例如发布、上架、删除、清空、下单、付款。",
        "不确定时一律往高一级定，绝不降级。"
    ].join("\n");
}

function buildUserPrompt({ message, pageContext, snapshot, riskFloor }) {
    return [
        `用户原话：${message}`,
        "",
        `页面上下文：${JSON.stringify(pageContext ?? {})}`,
        `确定性风险下限（不可低于它）：${riskFloor}`,
        "",
        "工作台当前状态快照（只可引用字段值，不可推断）：",
        JSON.stringify(snapshot ?? {}, null, 2),
        "",
        "请输出 JSON。"
    ].join("\n");
}

function stripCodeFence(text) {
    const trimmed = String(text ?? "").trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}

function parseModelJson(content) {
    const cleaned = stripCodeFence(content);
    try {
        return JSON.parse(cleaned);
    }
    catch {
        // 容忍模型输出残留（尾逗号、单引号、缺引号等），复用项目既有 jsonrepair 约定
        return JSON.parse(jsonrepair(cleaned));
    }
}

function clampText(value, maxLength, fallback = "") {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text)
        return fallback;
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * 编译秘书意图。
 * @returns {Promise<{ok: true, model: string, latency_ms: number, data: object} | {ok: false, reason: string, latency_ms: number}>}
 */
export async function compileSecretaryIntent({ message, pageContext, riskLevel }) {
    const startedAt = Date.now();
    const riskFloor = computeRiskFloor(message);
    const credentials = await loadCredentials();
    if (!credentials) {
        return {
            ok: false,
            reason: "未配置模型凭据（SECRETARY_LLM_KEY 或 .secretary-llm.json）",
            latency_ms: Date.now() - startedAt
        };
    }
    const snapshot = await readWorkbenchSnapshot();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetch(`${credentials.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${credentials.apiKey}`
            },
            body: JSON.stringify({
                model: credentials.model,
                messages: [
                    { role: "system", content: buildSystemPrompt() },
                    { role: "user", content: buildUserPrompt({ message, pageContext, snapshot, riskFloor }) }
                ],
                temperature: 0.2,
                max_tokens: 800,
                response_format: { type: "json_object" }
            }),
            signal: controller.signal
        });
        if (!response.ok) {
            const detail = clampText(await response.text().catch(() => ""), 200);
            return {
                ok: false,
                reason: `模型接口 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
                latency_ms: Date.now() - startedAt
            };
        }
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (!content)
            return { ok: false, reason: "模型返回内容为空", latency_ms: Date.now() - startedAt };
        const parsed = parseModelJson(content);
        const modelRisk = RISK_ORDER.includes(parsed?.risk_level) ? parsed.risk_level : "L1";
        const effectiveRisk = maxRisk(modelRisk, riskFloor);
        const requestRisk = RISK_ORDER.includes(riskLevel) ? riskLevel : "L1";
        return {
            ok: true,
            model: credentials.model,
            latency_ms: Date.now() - startedAt,
            data: {
                interpreted_intent: clampText(parsed?.interpreted_intent, 60, message),
                reply: clampText(parsed?.reply, 160, ""),
                suggested_next_action: clampText(parsed?.suggested_next_action, 40, "等待人工确认下一步"),
                command_type: clampText(parsed?.command_type, 60, "secretary.chat.command").replace(/[^a-z0-9._-]/gi, "") || "secretary.chat.command",
                risk_level: effectiveRisk,
                risk_model: modelRisk,
                risk_floor: riskFloor,
                risk_requested: requestRisk,
                risk_escalated: RISK_ORDER.indexOf(effectiveRisk) > RISK_ORDER.indexOf(modelRisk),
                reason: clampText(parsed?.reason, 60, ""),
                requires_confirmation: effectiveRisk !== "L0",
                snapshot
            }
        };
    }
    catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        return {
            ok: false,
            reason: aborted
                ? `模型调用超时（${DEFAULT_TIMEOUT_MS}ms）`
                : `模型调用失败：${error instanceof Error ? error.message : String(error)}`,
            latency_ms: Date.now() - startedAt
        };
    }
    finally {
        clearTimeout(timer);
    }
}
