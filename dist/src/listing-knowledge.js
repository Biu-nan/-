// 清单（listing）知识单一入口 —— 重构：把散落在巨型 config.js / automation-service.js 里的
// listing 相关常量、模型档位、桥接 prompt、乳贴字段规范，聚合成「listing 知识」的唯一导入面。
//
// 设计取舍（与原计划 §6 的微小偏离，为安全）：
//   - 不修改 config.js 的定义，也不让 config.js `export *` 反向依赖本文件，避免 ES Module
//     循环依赖（TDZ）破坏现有正在运行的系统。本文件以 re-export 方式聚合 config.js 里的
//     listing 常量，并在本地定义 prompt 与字段规范 loader。
//   - agent 与其余模块都从本文件取 listing 知识，不再散落 import config.js 内部常量；
//     独立部署时随包携带本文件及所引用的少量 config 常量即可。

import {
  DIANXIAOMI_CATEGORY_PROFILES,
  getDianxiaomiProfile,
  isXiangBaoProfile,
  MODEL_PROFILES,
  resolveModelProfile,
  DIANXIAOMI_DEFAULT_PROFILE_KEY,
  DIANXIAOMI_URL_CHOICE,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID,
} from "./config.js";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── re-export：来自 config.js 的 listing 常量（唯一真相仍在 config.js，此处聚合） ──
export {
  DIANXIAOMI_CATEGORY_PROFILES,
  getDianxiaomiProfile,
  isXiangBaoProfile,
  MODEL_PROFILES,
  resolveModelProfile,
  DIANXIAOMI_DEFAULT_PROFILE_KEY,
  DIANXIAOMI_URL_CHOICE,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID,
};

// ── 桥接整理 prompt（从 automation-service.js 迁出，避免 agent 依赖 automation-service） ──
// 把 MVP1 事实提取 + MVP5 SEO/Listing 文案整理成 normalizeDianxiaomiFacts 形状的 JSON。
export const PRODUCT_FACTS_STRUCTURE_PROMPT = `你现在是「店小秘 ERP 上品资料整理员」。
下面给你两份已经生成的商品文本：
A) 产品事实提取（MVP1 回复）
B) SEO / Listing 文案（MVP5 交付）

请综合这两份文本，输出**一个且仅一个** JSON 代码块（用 \`\`\`json 包裹），符合以下形状：

{
  "title": { "zh": string, "en": string },
  "category": string,
  "brand": string | null,
  "material": string | null,
  "origin": { "country": string, "province": string },
  "keyAttributes": Array<{ "name": string, "value": string }>,
  "variants": {
    "colors": string[],
    "sizes": string[],
    "defaultPrice": string,
    "defaultStock": string,
    "defaultWeight": string
  },
  "unit": string | null,
  "weight": number | null,
  "dimensionsCm": { "length": number, "width": number, "height": number },
  "description": { "pc": string, "mobile": string },
  "hsCode": string,
  "sourceUrl": string,
  "mainKeyword": string
}

规则：
- 只输出 JSON 代码块，不要任何解释性文字、不要前后缀。
- 字段缺失就留空字符串 / 空数组 / null，绝对不要编造。
- **title.en 必须取自 B) Listing 文案中「3.1 算法标题 Clean Title」下的完整 Clean Title 一行**，不要自行概括或重写。如果 Clean Title 不存在，再退而使用 B) 中的其它英文标题。
- **description.pc 与 description.mobile 必须优先取自 B) Listing 文案中「3.2 AEO 结构化五点描述 Bullet Points And Q And A」下的完整内容（包含 Basic Information、Core Selling Points、Q And A、WARM NOTE，保留其 markdown 结构）**。若该段落不存在，再退而组合 B) 中的其它属性与卖点段落。
- images.main 不要填（后端会自动注入当前产品图文件名）。
- 颜色 / 尺寸 / 价格 / 重量尽量从文本推断；推断不出就留空数组 / 空字符串。`;

// ── 乳贴必填字段规范（店小秘 Choice 半托管创建页扫描结果）loader ──
// 返回 乳贴必填字段规范_v1.json 的解析对象（含 fields[] 必填项、sku 结构）。
export async function loadRutieFieldSpec() {
  const file = path.join(__dirname, "..", "..", "乳贴必填字段规范_v1.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw);
}

// 同步取必填字段 label 列表（用于校验阶段业务完整性）。
// 字段规范里 required=true 且属于「产品事实可覆盖」的字段才纳入；店铺/备货类型等店铺级
// 配置由 profile.fixed 兜底，不算作产品事实缺失。
const RUTIE_FACT_REQUIRED_LABELS = [
  "产品标题",
  "产品分类",
  "产品图片",
  "尺寸(Size)",
  "PC端描述",
  "计件单位",
  "海关监管属性",
];

export function getRutieRequiredFactLabels() {
  return RUTIE_FACT_REQUIRED_LABELS.slice();
}
