// 关键词库读端（生产模块）：把"词"变成"选词"，而不是换一种猜法
//
// 两个数据源，严格分开、绝不混算：
//   A) keyword_rank（官方词库）：有搜索量/转化率/竞争度 → 可作依据
//   B) product_rank.titles（竞品标题）：只有"多少竞品在用 + 这些竞品周期销量" → 只作候选
//
// 红线：
//   1. 匹配不上就 matched=false，绝不退化成"挑个高分词"。
//   2. 品牌词（黑名单）永不进候选。
//   3. 红海词（C 层）只进 avoid。
//   4. 标题词的指标与官方词库不同源，输出必带 source 标记，禁止合并排序。
//   5. 只读本地文件，不联网、不花积分。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LIBRARY_PATH = process.env.KEYWORD_LIBRARY_PATH || path.join(PROJECT_ROOT, 'data', 'keywords', 'library.json');
const TITLE_PATH = process.env.KEYWORD_TITLE_PATH || path.join(PROJECT_ROOT, 'data', 'keywords', 'title-keywords.json');
const BRAND_PATH = path.join(PROJECT_ROOT, 'data', 'keywords', 'brand-blocklist.json');
const RULES_PATH = path.join(PROJECT_ROOT, 'data', 'keywords', 'category-rules.json');

const STOP = new Set([
  'for', 'with', 'and', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'by', 'from',
  'pcs', 'pc', 'set', 'new', 'hot', 'high', 'quality', 'large', 'small', 'mini',
  'travel', 'portable', 'waterproof', 'durable', 'multi', 'function', 'fashion',
  'women', 'men', 'unisex', 'gift', 'gifts', 'accessories', 'accessory', 'item', 'items',
]);

// 泛化词：只有这些词重合不算命中（否则任何含 bag 的产品都会匹配到 women's bag）
const GENERIC = new Set([
  'bag', 'bags', 'women', 'woman', 'men', 'man', 'ladies', 'girl', 'girls',
  'item', 'items', 'accessorie', 'gift', 'gifts', 'set', 'sets', 'piece', 'pieces',
]);

const _cache = {};
function cached(key, file, loader) {
  if (_cache[key]) return _cache[key];
  try { _cache[key] = loader(file); } catch { _cache[key] = null; }
  return _cache[key];
}

export function loadLibrary(p = LIBRARY_PATH) {
  return cached(`lib:${p}`, p, (f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}
export function loadTitleKeywords(p = TITLE_PATH) {
  return cached(`title:${p}`, p, (f) => JSON.parse(fs.readFileSync(f, 'utf8')));
}
export function loadBrandBlocklist(p = BRAND_PATH) {
  return cached(`brand:${p}`, p, (f) => JSON.parse(fs.readFileSync(f, 'utf8'))) || { brands: [], patterns: [] };
}

export function loadCategoryRules(p = RULES_PATH) {
  return cached(`rules:${p}`, p, (f) => JSON.parse(fs.readFileSync(f, 'utf8'))) || { rules: [], fallback: null };
}

/** 产品文本 -> IXSPY 类目 ID；未命中返回 null（fail-closed，绝不猜） */
export function resolveCategoryId(text, rules = loadCategoryRules()) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  for (const r of rules.rules || []) {
    for (const m of r.match || []) {
      if (hay.includes(String(m).toLowerCase())) return String(r.categoryId);
    }
  }
  return rules.fallback ? String(rules.fallback) : null;
}

export function isBrandKeyword(keyword, blocklist = loadBrandBlocklist()) {
  const lower = String(keyword || '').toLowerCase();
  for (const b of blocklist.brands || []) if (lower === b || lower.includes(b)) return true;
  for (const pat of blocklist.patterns || []) {
    try { if (new RegExp(pat).test(lower)) return true; } catch { /* 忽略坏正则 */ }
  }
  return false;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/[\s-]+/)
    .map((t) => t.replace(/'s$/, '').replace(/(es|s)$/, ''))
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

const flatten = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** 三段式严格匹配：整词压平命中 / 有效词重合 / 单词作为子串 */
export function strictMatch(keyword, productTokens, productFlat, minOverlap = 0.5) {
  const kwTokens = tokenize(keyword);
  const kwFlat = flatten(keyword);
  if (!kwTokens.length) return { matched: false, overlap: 0, distinctiveHits: 0 };
  const set = new Set(productTokens);
  const hits = kwTokens.filter((t) => set.has(t));
  const overlap = hits.length / kwTokens.length;
  const distinctiveHits = hits.filter((t) => !GENERIC.has(t)).length;
  const hitA = kwFlat.length >= 4 && productFlat.includes(kwFlat);
  const hitB = overlap >= minOverlap && distinctiveHits >= 1 && kwTokens.length >= 2;
  const hitC = kwTokens.length === 1 && kwTokens[0].length >= 5 && productFlat.includes(kwTokens[0]);
  return { matched: hitA || hitB || hitC, overlap: Math.round(overlap * 100) / 100, distinctiveHits };
}

export function suggestKeywords({ text, categoryId, region = 'ALL', limit = 6, minOverlap = 0.5, allowTitleFallback = true, library, titleLib } = {}) {
  const lib = library || loadLibrary();
  const productTokens = tokenize(text);
  if (!productTokens.length) {
    return { matched: false, source: 'keyword_rank', reason: 'EMPTY_PRODUCT_TEXT', primary: null, secondary: [], avoid: [] };
  }
  const productFlat = flatten(text);
  const blocklist = loadBrandBlocklist();
  const cat = lib?.categories?.[String(categoryId)];

  let avoid = [];
  if (cat) {
    const pool = (cat.keywords || []).filter((k) => k.tier !== 'X' && !k.brand && !isBrandKeyword(k.keyword, blocklist));
    avoid = pool
      .filter((k) => k.tier === 'C' && strictMatch(k.keyword, productTokens, productFlat, minOverlap).matched)
      .map((k) => ({ keyword: k.keyword, comp: k.comp, reason: 'RED_OCEAN' }));

    const scored = pool
      .filter((k) => k.tier !== 'C')
      .map((k) => {
        const m = strictMatch(k.keyword, productTokens, productFlat, minOverlap);
        const regionW = k.region === region ? 1 : k.region === 'ALL' ? 0.9 : 0.55;
        return { ...k, ...m, finalScore: Math.round((0.7 * m.overlap + 0.3 * (k.score / 100)) * regionW * 1000) / 1000 };
      })
      .filter((k) => k.matched)
      .sort((a, b) => b.finalScore - a.finalScore);

    if (scored.length) {
      const [primary, ...rest] = scored;
      return { matched: true, source: 'keyword_rank', reason: 'OK', primary, secondary: rest.slice(0, Math.max(0, limit - 1)), avoid };
    }
  }

  // 官方词库无匹配 -> 退回竞品标题词（仅候选，不可当依据）
  if (allowTitleFallback) {
    const tl = titleLib || loadTitleKeywords();
    const tcat = tl?.categories?.[String(categoryId)];
    if (tcat) {
      const mined = (tcat.phrases || [])
        .filter((p) => !isBrandKeyword(p.phrase, blocklist))
        .map((p) => ({ ...p, ...strictMatch(p.phrase, productTokens, productFlat, minOverlap) }))
        .filter((p) => p.matched)
        .sort((a, b) => b.weightedSales - a.weightedSales || b.count - a.count);
      if (mined.length) {
        const [primary, ...rest] = mined;
        return {
          matched: true,
          source: 'title-mining',
          reason: 'OFFICIAL_KEYWORDS_UNAVAILABLE_FELL_BACK_TO_COMPETITOR_TITLES',
          caveat: '该词来自竞品标题高频组合，无搜索量/转化率/竞争度，只能当候选，不能当依据。',
          primary,
          secondary: rest.slice(0, Math.max(0, limit - 1)),
          avoid,
        };
      }
    }
  }

  return {
    matched: false,
    source: cat ? 'keyword_rank' : 'none',
    reason: cat
      ? 'NO_KEYWORD_MATCH:该类目库与竞品标题都覆盖不到这个产品形态，需补抓更细子类目，不得硬套高分词'
      : `NO_CATEGORY_LIBRARY:${categoryId}`,
    primary: null,
    secondary: [],
    avoid,
  };
}

/** 渲染成 prompt 块；无匹配返回空串（让上层保持原有逻辑，不注入假信息） */
export function renderPromptBlock(result, { maxSecondary = 4 } = {}) {
  if (!result || !result.matched) return '';
  const lines = [];
  if (result.action === 'supplement' && result.source === 'keyword_rank') {
    const p = result.primary;
    lines.push('【关键词库·同类目实测高频词（辅助埋词，不替换已有关键词）】');
    lines.push(`已有关键词 ${result.historyKeyword} 与产品自洽，保留为型号/类型用词。`);
    lines.push(`同类目实测高频词：${p.keyword}（周搜索 ${p.searches.toLocaleString('en-US')}｜转化 ${(p.cvr * 100).toFixed(2)}%｜竞争 ${p.comp}）`);
    if (result.secondary.length) lines.push(`其它可用词：${result.secondary.slice(0, maxSecondary).map((k) => k.keyword).join(', ')}`);
    lines.push('规则：标题后半段与描述须自然融入上述高频词，但**不得覆盖已有主关键词**，也不得堆砌。');
    if (result.avoid.length) lines.push(`禁止使用的红海词：${result.avoid.map((k) => k.keyword).join(', ')}`);
    lines.push('数据来源：IXSPY 速卖通关键词周榜（真实搜索量/转化/竞争度）。');
    return lines.join('\n');
  }
  if (result.source === 'keyword_rank') {
    const p = result.primary;
    lines.push('【关键词库·官方实测数据（必须优先采用）】');
    lines.push(`主关键词：${p.keyword}  （周搜索 ${p.searches.toLocaleString('en-US')}｜转化 ${(p.cvr * 100).toFixed(2)}%｜竞争 ${p.comp}｜区域 ${p.region}）`);
    if (result.secondary.length) lines.push(`辅助关键词：${result.secondary.slice(0, maxSecondary).map((k) => k.keyword).join(', ')}`);
    lines.push('规则：标题必须包含主关键词原词（不可改写单复数、不可同义替换）；辅助词只用于描述与属性；下列红海词不得使用。');
    if (result.avoid.length) lines.push(`禁止使用的红海词：${result.avoid.map((k) => k.keyword).join(', ')}`);
    lines.push('数据来源：IXSPY 速卖通关键词周榜（真实搜索量/转化/竞争度）。');
  } else {
    const p = result.primary;
    lines.push('【竞品标题用词参考（降级来源，仅供措辞参考）】');
    lines.push(`参考词组：${p.phrase}  （${p.count} 个竞品在用｜这些竞品周期销量合计 ${p.weightedSales}｜${p.stores} 家店）`);
    if (result.secondary.length) lines.push(`其它高频组合：${result.secondary.slice(0, maxSecondary).map((k) => k.phrase).join(' / ')}`);
    lines.push('注意：本组词没有搜索量、转化率、竞争度数据，只能用于竞品措辞参考，不得据此断言搜索需求。');
  }
  return lines.join('\n');
}

/**
 * 从 product-facts.json 直接产出可注入 prompt 的关键词块（上品流程调用入口）
 * 任何异常都返回空块，绝不影响主链路。
 */
export function buildKeywordPromptBlockFromProductFacts(factsPath, { region = 'ALL' } = {}) {
  try {
    const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
    const parts = [
      facts.title?.en, facts.title?.zh, facts.category,
      ...(Array.isArray(facts.keyAttributes) ? facts.keyAttributes.map((a) => `${a?.name || ''} ${a?.value || ''}`) : []),
    ].filter(Boolean);
    const text = parts.join(' ');
    const categoryId = resolveCategoryId(`${facts.category || ''} ${facts.title?.en || ''} ${facts.title?.zh || ''}`);
    if (!categoryId) return { block: '', meta: { reason: 'NO_CATEGORY_RULE', matched: false } };

    const result = suggestKeywords({ text, categoryId, region });
    if (!result.matched) {
      const meta = { categoryId, matched: false, source: result.source, reason: result.reason, primary: null };
      return { block: '', meta };
    }

    // 分档：历史 mainKeyword 是否可信
    //   明显错（Nipple Covers / 空 / 与标题零交集） -> override：用库词当主词
    //   自洽（词元能在标题/类目里找到）          -> supplement：保留历史词，库词只作辅助埋词
    const history = String(facts.mainKeyword || '').trim();
    const hay = text.toLowerCase();
    const histTokens = tokenize(history);
    const selfConsistent = histTokens.length > 0 && histTokens.some((t) => hay.includes(t));
    const obviouslyWrong = !history || /^nipple covers?$/i.test(history) || !selfConsistent;
    result.action = obviouslyWrong ? 'override' : 'supplement';
    result.historyKeyword = history || '(空)';

    return {
      block: renderPromptBlock(result),
      meta: {
        categoryId,
        matched: true,
        source: result.source,
        action: result.action,
        historyKeyword: result.historyKeyword,
        primary: result.primary.keyword || result.primary.phrase || null,
        reason: result.reason,
      },
    };
  } catch (e) {
    return { block: '', meta: { reason: `READ_FAILED:${e && e.message}`, matched: false } };
  }
}
