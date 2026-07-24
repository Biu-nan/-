// 乳贴产品事实服务（店小秘自动化上品 · Phase 1 基础设施）
// 职责：产品事实的读写 + JSON Schema 校验 + 解析 AI 提取结果。
// 产品事实 = AI 从图片提取 + 人工确认后，用于引用模板后覆盖填写店小秘表单的数据。

import { readFile, writeFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { jsonrepair } from "jsonrepair";
import {
  PRODUCT_FACT_FILE,
  PRODUCT_FACT_SCHEMA_FILE,
  DIANXIAOMI_TEMPLATE_PRODUCT_ID
} from "./config.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
let schemaCache = null;
let compiledCache = null;

async function loadSchema() {
  if (schemaCache) return schemaCache;
  const raw = await readFile(PRODUCT_FACT_SCHEMA_FILE, "utf8");
  schemaCache = JSON.parse(raw);
  compiledCache = ajv.compile(schemaCache);
  return schemaCache;
}

export class ProductFactService {
  constructor(opts = {}) {
    this.file = opts.file ?? PRODUCT_FACT_FILE;
    this.templateId = opts.templateId ?? DIANXIAOMI_TEMPLATE_PRODUCT_ID;
  }

  // 默认空事实模板（首次无文件时返回，不写库、不校验）
  _empty() {
    const now = new Date().toISOString();
    return {
      schemaVersion: "1.0",
      productId: this.templateId,
      title: { zh: "", en: "" },
      category: "",
      keyAttributes: [],
      variants: { dimensions: [], skus: [] },
      images: { main: [], marketing: [] },
      unit: "",
      originalBox: null,
      weight: null,
      dimensionsCm: { length: null, width: null, height: null },
      description: { pc: "", mobile: "" },
      hsCode: "",
      compliance: { euResponsible: "", trResponsible: "", manufacturer: "" },
      sourceUrl: this.templateId,
      meta: { source: "ai_extracted", confirmed: false, createdAt: now, updatedAt: now, note: "" }
    };
  }

  async ensureFile() {
    try {
      await readFile(this.file, "utf8");
    } catch {
      await writeFile(this.file, JSON.stringify(this._empty(), null, 2), "utf8");
    }
  }

  // 读取当前产品事实（文件不存在返回空模板）
  async load() {
    await this.ensureFile();
    const raw = await readFile(this.file, "utf8");
    if (!raw.trim()) return this._empty();
    try {
      return JSON.parse(raw);
    } catch {
      // 容忍异常 JSON（如 AI 输出残留），用 jsonrepair 修复
      return JSON.parse(jsonrepair(raw));
    }
  }

  // 校验（不写库）。返回 { valid, errors, schema }
  async validate(facts) {
    await loadSchema();
    const ok = compiledCache(facts);
    return { valid: ok, errors: compiledCache.errors ?? [], schema: schemaCache };
  }

  // 保存（写入前校验）。source 标记来源；confirmed 默认 true（人工确认后保存）
  async save(facts, { source = "human_edited" } = {}) {
    const parsed = typeof facts === "string" ? JSON.parse(jsonrepair(facts)) : facts;
    const now = new Date().toISOString();
    const merged = {
      ...parsed,
      meta: {
        ...(parsed.meta || {}),
        source,
        confirmed: parsed.meta?.confirmed ?? true,
        updatedAt: now
      }
    };
    if (!merged.meta.createdAt) merged.meta.createdAt = now;
    if (!merged.schemaVersion) merged.schemaVersion = "1.0";
    if (!merged.productId) merged.productId = this.templateId;

    const { valid, errors } = await this.validate(merged);
    if (!valid) {
      const err = new Error(
        "产品事实校验失败: " + errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")
      );
      err.code = "PRODUCT_FACT_INVALID";
      err.errors = errors;
      throw err;
    }
    await writeFile(this.file, JSON.stringify(merged, null, 2), "utf8");
    return merged;
  }

  // 从 AI 提取的 markdown/JSON 字符串解析为事实草稿（不写库、不校验）
  parseAi(raw) {
    let s = typeof raw === "string" ? raw : JSON.stringify(raw);
    const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (m) s = m[1];
    return JSON.parse(jsonrepair(s));
  }
}

export default ProductFactService;
