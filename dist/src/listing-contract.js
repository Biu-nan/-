// Listing 解析层（Node 版）——src/listing_contract.py 的移植，P1 第一件产物。
//
// 边界：只负责「从 04_LISTING_CONTENT.md 提取可上架字段」，不生成、不调用模型、不碰浏览器。
// 目的：让一跨在**不开浏览器**之前就能判定「这份 Listing 到底能不能用」，
//       而不是把整段 markdown 直接喂给店小秘页面。
//
// 移植原则：与 Python 版**逐字段等价**（金标对比见 tools/verify-listing-contract.mjs）。
// 注释保留了 Python 侧的真实事故背景，因为那些坑不是靠读代码能重新发现的。
//
// 状态（2026-10-27）：sample 级验证完成。description_images 尚未移植
// （依赖 src/assets_contract.py 的图片三级回退），当前恒返回 [] 并计入 warnings。

export const CONTRACT_VERSION = 1;
export const CONTRACT_NAME = "listing_fields.json";

// 本系统 SEO 规范区间，不是平台限制。超出只警告、不判失败 ——
// 否则仅差几个字符就会让产品永远卡在 Listing 阶段重试（Python 侧原注释）。
export const TITLE_MIN = 126;
export const TITLE_MAX = 128;

// 「核算字符数：N」断言向前回看的非空行数（O-082）。
export const ANCHOR_LOOKBACK_LINES = 4;

// 措辞型起点必须紧贴 ✅ 五点条目（O-085）。
// 实测：P1 的「1.1 AliExpress AEO 关键词筛选逻辑」距真正五点 395 行，
// 却被当成区间起点，把 91 行中文关键词表格推进了描述。真正的节标题距首个 ✅ 仅 1–3 行。
export const MAX_HEADING_GAP_LINES = 12;

const clean = (value, limit = 1000) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

// 起点按优先级降级：语义固定小标题 → AEO 节标题 → 旧版英文标记 → ✅ 内容锚点。
// 前四级都是「枚举措辞」，而措辞无法穷尽（实测已出现 Basic Information / Quick Product Facts /
// Product Quick Facts / 完全无小标题 / AEO Structured Bullet Points And Q&A）。最后一级用内容特征兜底。
const START_PATTERNS = [
  [/^\s*Basic Information\s*$/im, "Basic Information"],
  [/^\s*(?:Product\s+)?Quick\s+Product\s+Facts\s*$/im, "Quick Product Facts"],
  [/^\s*\d+(?:\.\d+)+\s*[^\n]*AEO[^\n]*$/im, "AEO 节标题"],
  [/^\s*AEO Structured Bullet Points[^\n]*$/im, "AEO 英文标记"],
  [/^\s*✅/im, "首个勾选条目"],
];

// 终点取区间内最早出现的边界；节标题可能带编号也可能没有，故只要求整行以该短语结尾。
const END_PATTERNS = [
  [/^\s*(?:\d+(?:\.\d+)+\s*)?[^\n]{0,20}Product Detail Page\s*$/im, "Product Detail Page"],
  [/^\s*Product Overview\s*$/im, "Product Overview"],
  [/^\s*Backend LSI Semantic Tags\s*$/im, "旧版英文标记"],
];

const TITLE_PATTERNS = [
  /^\s*(?:final\s+title|product\s+title|title)\s*[:：]\s*(.+?)\s*$/gim,
  /^\s*最终标题\s*[:：]\s*(.+?)\s*$/gim,
  /^\s*.*?(?:clean|final|product)\s+title\s*[:：]?\s*\r?\n\s*\r?\n?\s*(.+?)\s*$/gim,
  /^\s*重新生成\s*[:：]\s*\r?\n\s*(.+?)\s*$/gim,
  /^.*?最终采用\s*[:：]\s*\r?\n\s*(.+?)\s*$/gim,
];

// 纯标签行：整行只是标题标签（可带编号/中文前缀，冒号可省略）。
// 1066978509658 事故：宽松正则把「…Clean Title\nFinal Title」整体吃掉、捕获到下一个标签，
// 结果标题被填成字面量 "Final Title"。这两条正则就是那道防线。
const TITLE_LABEL_LINE_RE =
  /^\s*[^\n]{0,30}?(?:final\s+title|clean\s+title|product\s+title|title|最终标题|标题)\s*[:：]?\s*$/i;
const TITLE_LABEL_VALUE_RE =
  /^(?:final\s+title|clean\s+title|product\s+title|title|最终标题|标题)\s*[:：]?\s*$/i;

// 「字符核算行」：模型把标题逐词拆成 Word(3) Word(3) … 做字数自证。必须排除，否则会被当成标题。
// 实测（2026-10-27）1056073865651 毛绒小熊、1073240245747 挂式收纳袋两份产物：
// 真实标题只有 118 字，模型在「（核算字符数：126）」里声称 126 → 118 不落 126–128
// → 走锚点回退 → 回看窗口里的 Teddy(5) Bear(4)… 折叠后正好 128 字，与断言只差 2，分数最高
// → 被选为标题。结果一整串 Word(N) 被填进店小秘标题栏。
// 判据用内容特征而非措辞：≥3 组「非空白串(数字)」且整行只由它们构成。
const WORDCOUNT_LINE_RE = /^(?:\S+\(\d+\)\s*){3,}$/;

export function fencedScope(text, name) {
  const re = new RegExp(`<<<\\s*${name}_START\\s*>>>(.*?)<<<\\s*${name}_END\\s*>>>`, "si");
  const m = re.exec(String(text ?? ""));
  return m ? m[1] : "";
}

/**
 * 提取最终标题。
 * 顺序：围栏 → 全文档扫描 → 围栏内容兜底 → 标签行后继 → 126–128 优先 → 锚点回退 → 最长候选兜底。
 */
export function extractTitle(text) {
  const doc = String(text ?? "");
  const fenced = fencedScope(doc, "FINAL_TITLE");
  if (fenced) {
    const value = scanTitle(fenced);
    if (value) return value;
    // 围栏语义就是「这里面是标题」。模型只输出标题本身时，内部既无标签也无字符数断言，
    // 而 scanTitle 恰恰靠这两者收集候选 —— 于是它返回空。这时直接认围栏内容。
    let rows = fenced.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    rows = rows.filter((r) => !TITLE_LABEL_VALUE_RE.test(r) && !r.endsWith(":") && !r.endsWith("："));
    if (rows.length) {
      const english = rows.filter((r) => !/[\u4e00-\u9fff]/.test(r));
      const pool = english.length ? english : rows;
      return clean(pool.reduce((a, b) => (b.length > a.length ? b : a), pool[0]), TITLE_MAX);
    }
  }
  return scanTitle(doc);
}

export function scanTitle(text) {
  const doc = String(text ?? "");
  const candidates = [];
  for (const re of TITLE_PATTERNS) {
    for (const m of doc.matchAll(re)) candidates.push(clean(m[1], TITLE_MAX));
  }

  const lines = doc.split(/\r?\n/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i += 1) {
    if (!TITLE_LABEL_LINE_RE.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!lines[j]) continue;
      // 标签链（Final Title 下还有 Clean Title）、以冒号结尾的中文前导语、
      // 字符核算行（Word(3) Word(3)…）都不是标题。
      if (TITLE_LABEL_VALUE_RE.test(lines[j]) || lines[j].endsWith(":") || lines[j].endsWith("：")) continue;
      if (WORDCOUNT_LINE_RE.test(lines[j])) continue;
      candidates.push(clean(lines[j], TITLE_MAX));
      break;
    }
  }

  const unique = [];
  const seen = new Set();
  for (const value of candidates) {
    if (!value || seen.has(value) || TITLE_LABEL_VALUE_RE.test(value)) continue;
    seen.add(value);
    unique.push(value);
  }

  const valid = unique.filter((v) => v.length >= TITLE_MIN && v.length <= TITLE_MAX);
  if (valid.length) return valid[valid.length - 1];

  // 回退锚点：标准扫描找不到合规长度时，"核算字符数：N" 附近的非空行几乎就是交付标题。
  const anchorCandidates = [];
  const anchorScores = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const assertion = /核算字符数\s*[:：]\s*(\d+)/.exec(lines[i]);
    if (!assertion) continue;
    const asserted = Number(assertion[1]);
    const window = [];
    for (let j = i - 1; j >= 0; j -= 1) {
      if (lines[j]) window.push(lines[j]);
      if (window.length >= ANCHOR_LOOKBACK_LINES) break;
    }
    window.forEach((candidate, gap) => {
      if (!candidate || TITLE_LABEL_VALUE_RE.test(candidate)) return;
      if (candidate.endsWith(":") || candidate.endsWith("：")) return;
      if (WORDCOUNT_LINE_RE.test(candidate)) return;
      const cleaned = clean(candidate, TITLE_MAX);
      if (!cleaned) return;
      const score = [Math.abs(cleaned.length - asserted), gap];
      const prior = anchorScores.get(cleaned);
      if (!prior || score[0] < prior[0] || (score[0] === prior[0] && score[1] < prior[1])) {
        anchorScores.set(cleaned, score);
      }
      anchorCandidates.push(cleaned);
    });
  }

  const anchorUnique = [];
  const seenAnchor = new Set();
  for (const value of anchorCandidates) {
    if (!value || seenAnchor.has(value) || TITLE_LABEL_VALUE_RE.test(value)) continue;
    seenAnchor.add(value);
    anchorUnique.push(value);
  }
  const validAnchor = anchorUnique.filter((v) => v.length >= TITLE_MIN && v.length <= TITLE_MAX);
  if (validAnchor.length) {
    return validAnchor.reduce((best, v) => {
      const a = anchorScores.get(v);
      const b = anchorScores.get(best);
      if (a[0] !== b[0]) return a[0] < b[0] ? v : best;
      return a[1] < b[1] ? v : best;
    }, validAnchor[0]);
  }

  // 兜底：长度欠佳但像英文标题的候选仍可用（与契约阶段「警告不判死」一致）；
  // 标签、中文前导语一律返回空串转人工。多候选取最长 —— 越接近 126–128 的越可能是真标题。
  const plausible = [...unique, ...anchorCandidates].filter(
    (v) => v.length >= 20 && !/[\u4e00-\u9fff]/.test(v)
  );
  if (!plausible.length) return "";
  return plausible.reduce((a, b) => (b.length > a.length ? b : a), plausible[0]);
}

export function isTitleLabel(value) {
  return TITLE_LABEL_VALUE_RE.test(String(value ?? "").trim());
}

function firstBulletOffset(text) {
  const m = /^\s*✅/m.exec(String(text ?? ""));
  return m ? m.index : -1;
}

function countNewlines(text, from, to) {
  let n = 0;
  for (let i = from; i < to && i < text.length; i += 1) if (text[i] === "\n") n += 1;
  return n;
}

function startOffset(text, re, bulletOffset) {
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
    const end = m.index + m[0].length;
    if (bulletOffset < 0 || end > bulletOffset) return end;
    if (countNewlines(text, end, bulletOffset) <= MAX_HEADING_GAP_LINES) return end;
  }
  return -1;
}

/** 定位买家描述区间（五点条目 → 详情页）。 */
export function describeBoundary(text) {
  const doc = String(text ?? "");
  const bulletOffset = firstBulletOffset(doc);
  let offset = -1;
  let startLabel = "";
  for (const [re, label] of START_PATTERNS) {
    offset = startOffset(doc, re, bulletOffset);
    if (offset >= 0) {
      startLabel = label;
      break;
    }
  }
  if (offset < 0) return { content: "", matched: "" };

  const tail = doc.slice(offset);
  let endIndex = -1;
  let endLabel = "";
  for (const [re, label] of END_PATTERNS) {
    for (const m of tail.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
      if (endIndex < 0 || m.index < endIndex) {
        endIndex = m.index;
        endLabel = label;
      }
    }
  }
  if (endIndex < 0) return { content: "", matched: "" };
  return { content: tail.slice(0, endIndex), matched: `${startLabel} → ${endLabel}` };
}

/** 买家描述逐行（页面执行器再拼成段落）。 */
export function descriptionLines(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => clean(line, 600))
    .filter(Boolean);
}

/**
 * 解析一份 Listing 产物，返回 { ok, problems, warnings, fields }。
 * 与 Python 版一致：problems 非空即不可用；warnings 只提示不阻断。
 */
export function buildContract(text, opts = {}) {
  const problems = [];
  const warnings = [];
  const doc = String(text ?? "");
  if (!doc.trim()) problems.push("缺少 04_LISTING_CONTENT.md");

  const title = extractTitle(doc);
  const boundary = describeBoundary(doc);
  const lines = descriptionLines(boundary.content);

  if (!title) problems.push("未能提取到最终标题");
  else if (title.length < TITLE_MIN || title.length > TITLE_MAX) {
    warnings.push(`标题长度 ${title.length}，建议 ${TITLE_MIN}–${TITLE_MAX}`);
  }
  if (!boundary.matched) problems.push("未能定位买家描述区间（已知格式均未命中）");
  else if (!lines.length) problems.push("买家描述区间为空");

  // 描述图由图片阶段产出，Listing 自身修不了 —— 只提示不判失败。
  const descriptionImages = Array.isArray(opts.descriptionImages) ? opts.descriptionImages : [];
  if (!descriptionImages.length) warnings.push("没有可用的描述图（需在图片阶段补齐）");

  const fields = {
    schema_version: CONTRACT_VERSION,
    generated_at: new Date().toISOString().slice(0, 19),
    source: "04_LISTING_CONTENT.md",
    title,
    title_length: title.length,
    // 与 Python 版一致：存的是命中的区间标签（如 "Basic Information → Product Detail Page"），
    // 不是布尔。字符串保留了「从哪个小标题到哪个终点」的溯源信息，判空用 truthy 即可。
    description_boundary: boundary.matched,
    description_lines: lines,
    description_images: descriptionImages,
    problems,
    warnings,
  };
  return { ok: problems.length === 0, problems, warnings, fields };
}
