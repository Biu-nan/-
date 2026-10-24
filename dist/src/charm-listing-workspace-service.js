import { randomUUID, createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HIDDEN_DATA_DIR } from "./config.js";

const JOB_STATUS = new Set([
  "DRAFT", "NEEDS_INPUT", "READY", "WAITING_AI", "WAITING_IMAGES",
  "REVIEW_REQUIRED", "APPROVED", "PUBLISHING", "VERIFYING", "LIVE",
  "DRIFT", "FAILED", "PAUSED"
]);

const CATEGORY_PROFILES = [
  { key: "plush", label: "毛绒挂件", requiredFacts: ["material", "packageContents", "attachmentType"], imagePlan: ["hero", "on_bag", "detail", "size", "variants", "package"] },
  { key: "metal", label: "金属挂件", requiredFacts: ["material", "packageContents", "attachmentType"], imagePlan: ["hero", "on_bag", "hardware", "detail", "size", "package"] },
  { key: "acrylic", label: "亚克力挂件", requiredFacts: ["material", "packageContents", "attachmentType"], imagePlan: ["hero", "on_bag", "print_detail", "hardware", "variants", "package"] },
  { key: "beaded", label: "串珠挂件", requiredFacts: ["material", "packageContents", "attachmentType"], imagePlan: ["hero", "on_bag", "bead_detail", "hardware", "size", "package"] }
];

const FIELD_ALIASES = {
  productName: ["productName", "product_name", "产品名称", "商品名称"],
  subtype: ["subtype", "type", "子类型", "挂件类型"],
  material: ["material", "材质"],
  packageContents: ["packageContents", "package_contents", "包装内容", "发货内容"],
  attachmentType: ["attachmentType", "attachment_type", "挂扣类型", "挂件扣"],
  colors: ["colors", "color", "颜色"],
  dimensions: ["dimensions", "size", "尺寸"],
  variants: ["variants", "sku", "款式", "规格"],
  brand: ["brand", "品牌"],
  motif: ["motif", "theme", "主题", "造型"],
  cost: ["cost", "成本"],
  price: ["price", "售价"]
};

function now() { return new Date().toISOString(); }
function parse(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function cleanText(value) { return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim(); }
function firstValue(record, aliases) {
  for (const key of aliases) if (record[key] != null && cleanText(record[key])) return cleanText(record[key]);
  return "";
}
function normalizeSubtype(value) {
  const text = cleanText(value).toLowerCase();
  if (/plush|毛绒|公仔/.test(text)) return "plush";
  if (/metal|alloy|合金|金属/.test(text)) return "metal";
  if (/acrylic|亚克力/.test(text)) return "acrylic";
  if (/bead|串珠|珠/.test(text)) return "beaded";
  return "metal";
}
function createId(prefix) { return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 18)}`; }
function stringHash(value) { return createHash("sha256").update(value).digest("hex").slice(0, 32); }
function profileFor(subtype) { return CATEGORY_PROFILES.find((profile) => profile.key === subtype) ?? CATEGORY_PROFILES[1]; }
function hasRisk(facts) {
  const source = [facts.brand, facts.motif, facts.productName, facts.ipRisk].filter(Boolean).join(" ").toLowerCase();
  return /disney|sanrio|pokemon|pokémon|marvel|louis vuitton|chanel|gucci|hello kitty|版权|侵权|仿/.test(source);
}

export class CharmListingWorkspaceService {
  constructor({ dbPath = path.join(HIDDEN_DATA_DIR, "charm-listing-workspace.sqlite") } = {}) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async ready() {
    if (this.db) return;
    await mkdir(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS charm_products (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, subtype TEXT NOT NULL, facts_json TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS charm_listing_jobs (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, status TEXT NOT NULL, current_stage TEXT NOT NULL,
        checkpoint_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES charm_products(id)
      );
      CREATE TABLE IF NOT EXISTS charm_listing_drafts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, version INTEGER NOT NULL, content_json TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(job_id, version), FOREIGN KEY(job_id) REFERENCES charm_listing_jobs(id)
      );
      CREATE TABLE IF NOT EXISTS charm_approvals (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, draft_version INTEGER NOT NULL, token TEXT NOT NULL,
        approved_by TEXT NOT NULL, status TEXT NOT NULL, approved_at TEXT NOT NULL,
        UNIQUE(job_id, draft_version), FOREIGN KEY(job_id) REFERENCES charm_listing_jobs(id)
      );
      CREATE TABLE IF NOT EXISTS charm_publish_attempts (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
        receipt_json TEXT NOT NULL, started_at TEXT NOT NULL, confirmed_at TEXT,
        FOREIGN KEY(job_id) REFERENCES charm_listing_jobs(id)
      );
      CREATE TABLE IF NOT EXISTS charm_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS charm_learning_candidates (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, kind TEXT NOT NULL, payload_json TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }

  async close() { this.db?.close(); this.db = null; }
  async profiles() { await this.ready(); return CATEGORY_PROFILES; }

  normalizeInput(input = {}) {
    const values = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([key, aliases]) => [key, firstValue(input, aliases)]));
    const subtype = normalizeSubtype(values.subtype);
    return {
      productName: values.productName || "未命名包包挂件",
      subtype,
      material: values.material,
      packageContents: values.packageContents,
      attachmentType: values.attachmentType,
      colors: values.colors,
      dimensions: values.dimensions,
      variants: values.variants,
      brand: values.brand || "NONE",
      motif: values.motif,
      cost: values.cost,
      price: values.price,
      ipRisk: cleanText(input.ipRisk ?? input["IP风险"]),
      evidence: Array.isArray(input.evidence) ? input.evidence : [],
      source: cleanText(input.source) || "manual"
    };
  }

  validation(facts) {
    const profile = profileFor(facts.subtype);
    const missing = profile.requiredFacts.filter((key) => !cleanText(facts[key]));
    const risk = hasRisk(facts);
    return { profile, missing, risk, executable: missing.length === 0 && !risk };
  }

  async log(jobId, type, payload = {}) {
    await this.ready();
    this.db.prepare("INSERT INTO charm_events (job_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)")
      .run(jobId, type, JSON.stringify(payload), now());
  }

  async createProducts(inputs) {
    await this.ready();
    const created = [];
    for (const rawInput of inputs) {
      const facts = this.normalizeInput(rawInput);
      const check = this.validation(facts);
      const createdAt = now();
      const productId = createId("charm_product");
      const jobId = createId("charm_job");
      const status = check.executable ? "READY" : "NEEDS_INPUT";
      const checkpoint = { validation: { missing: check.missing, risk: check.risk }, adapter: { chatgpt: "pending", imageFactory: "pending", dianxiaomi: "pending" } };
      this.db.prepare("INSERT INTO charm_products (id, name, subtype, facts_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(productId, facts.productName, facts.subtype, JSON.stringify(facts), status, createdAt, createdAt);
      this.db.prepare("INSERT INTO charm_listing_jobs (id, product_id, status, current_stage, checkpoint_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(jobId, productId, status, check.executable ? "FACTS_READY" : "FACTS_CHECK", JSON.stringify(checkpoint), createdAt, createdAt);
      await this.log(jobId, "job_created", { productId, status, missing: check.missing, risk: check.risk });
      created.push(await this.job(jobId));
    }
    return created;
  }

  async updateFacts(productId, patch) {
    await this.ready();
    const row = this.db.prepare("SELECT * FROM charm_products WHERE id = ?").get(productId);
    if (!row) throw new Error("商品不存在");
    const facts = { ...parse(row.facts_json, {}), ...this.normalizeInput({ ...parse(row.facts_json, {}), ...patch }) };
    const check = this.validation(facts);
    const status = check.executable ? "READY" : "NEEDS_INPUT";
    this.db.prepare("UPDATE charm_products SET name = ?, subtype = ?, facts_json = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(facts.productName, facts.subtype, JSON.stringify(facts), status, now(), productId);
    const jobs = this.db.prepare("SELECT id FROM charm_listing_jobs WHERE product_id = ? AND status NOT IN ('LIVE', 'PUBLISHING', 'VERIFYING')").all(productId);
    for (const job of jobs) {
      this.db.prepare("UPDATE charm_listing_jobs SET status = ?, current_stage = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?")
        .run(status, check.executable ? "FACTS_READY" : "FACTS_CHECK", JSON.stringify({ validation: { missing: check.missing, risk: check.risk } }), now(), job.id);
      await this.log(job.id, "facts_updated", { missing: check.missing, risk: check.risk });
    }
    return this.product(productId);
  }

  draftFromFacts(facts, profile) {
    const words = [facts.material, facts.motif, profile.label, facts.attachmentType].filter(Boolean);
    const title = [...new Set(words.join(" ").split(/\s+/))].join(" ").slice(0, 128);
    return {
      source: "chatgpt_browser_queue",
      titleCandidates: [title || `${profile.label} Bag Charm`, `${facts.motif || "Fashion"} Bag Charm ${facts.attachmentType || "Pendant"}`.trim()],
      selectedTitle: title || `${profile.label} Bag Charm`,
      attributes: { material: facts.material, colors: facts.colors, attachmentType: facts.attachmentType, dimensions: facts.dimensions, brand: facts.brand },
      sku: facts.variants || "待补充SKU",
      description: `Bag charm listing draft. Package includes: ${facts.packageContents || "待确认"}.`,
      imagePlan: profile.imagePlan,
      identityLock: { material: facts.material, colors: facts.colors, motif: facts.motif, attachmentType: facts.attachmentType },
      validation: { factSourceOnly: true, generatedAt: now() }
    };
  }

  async run(jobId) {
    await this.ready();
    const loaded = await this.job(jobId);
    if (!loaded) throw new Error("任务不存在");
    if (!JOB_STATUS.has(loaded.status)) throw new Error("任务状态非法");
    const check = this.validation(loaded.product.facts);
    if (!check.executable) {
      this.db.prepare("UPDATE charm_listing_jobs SET status = 'NEEDS_INPUT', current_stage = 'FACTS_CHECK', checkpoint_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify({ validation: { missing: check.missing, risk: check.risk } }), now(), jobId);
      await this.log(jobId, "run_blocked", { missing: check.missing, risk: check.risk });
      return this.job(jobId);
    }
    const draft = this.draftFromFacts(loaded.product.facts, check.profile);
    const version = (this.db.prepare("SELECT MAX(version) AS version FROM charm_listing_drafts WHERE job_id = ?").get(jobId)?.version ?? 0) + 1;
    this.db.prepare("INSERT INTO charm_listing_drafts (id, job_id, version, content_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(createId("charm_draft"), jobId, version, JSON.stringify(draft), now());
    this.db.prepare("UPDATE charm_listing_jobs SET status = 'REVIEW_REQUIRED', current_stage = 'FINAL_REVIEW', checkpoint_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ validation: { missing: [], risk: false }, adapter: { chatgpt: "queued", imageFactory: "queued", dianxiaomi: "blocked_until_approval" }, draftVersion: version }), now(), jobId);
    await this.log(jobId, "draft_prepared", { version, adapter: "chatgpt_browser_queue" });
    return this.job(jobId);
  }

  async approve(jobId, approvedBy = "operator") {
    await this.ready();
    const job = await this.job(jobId);
    if (!job) throw new Error("任务不存在");
    if (job.status !== "REVIEW_REQUIRED") throw new Error("当前任务不在最终审核阶段");
    if (!job.draft) throw new Error("没有可审核的Listing草稿");
    const token = stringHash(`${jobId}:${job.draft.version}:${now()}:${randomUUID()}`);
    this.db.prepare("INSERT OR REPLACE INTO charm_approvals (id, job_id, draft_version, token, approved_by, status, approved_at) VALUES (?, ?, ?, ?, ?, 'approved', ?)")
      .run(createId("charm_approval"), jobId, job.draft.version, token, cleanText(approvedBy) || "operator", now());
    this.db.prepare("UPDATE charm_listing_jobs SET status = 'APPROVED', current_stage = 'PUBLISH_READY', updated_at = ? WHERE id = ?").run(now(), jobId);
    await this.log(jobId, "approved", { draftVersion: job.draft.version, approvedBy });
    return this.job(jobId);
  }

  async requestPublish(jobId, approvalToken) {
    await this.ready();
    const job = await this.job(jobId);
    if (!job) throw new Error("任务不存在");
    if (job.status === "PUBLISHING" || job.status === "VERIFYING") return job;
    if (job.status !== "APPROVED") throw new Error("发布前必须完成人工审核");
    const approval = this.db.prepare("SELECT * FROM charm_approvals WHERE job_id = ? AND status = 'approved' ORDER BY approved_at DESC LIMIT 1").get(jobId);
    if (!approval || approval.token !== approvalToken) throw new Error("审批令牌无效或已失效");
    const key = stringHash(`${jobId}:${approval.draft_version}`);
    const existing = this.db.prepare("SELECT * FROM charm_publish_attempts WHERE idempotency_key = ?").get(key);
    if (!existing) {
      this.db.prepare("INSERT INTO charm_publish_attempts (id, job_id, idempotency_key, status, receipt_json, started_at) VALUES (?, ?, ?, 'PENDING_OPERATOR', ?, ?)")
        .run(createId("charm_publish"), jobId, key, JSON.stringify({ adapter: "dianxiaomi", action: "awaiting_operator_trigger", fields: job.draft.content }), now());
      await this.log(jobId, "publish_requested", { idempotencyKey: key });
    }
    this.db.prepare("UPDATE charm_listing_jobs SET status = 'PUBLISHING', current_stage = 'DIANXIAOMI_READY', updated_at = ? WHERE id = ?").run(now(), jobId);
    return this.job(jobId);
  }

  async recordPublishReceipt(jobId, receipt = {}) {
    await this.ready();
    const attempt = this.db.prepare("SELECT * FROM charm_publish_attempts WHERE job_id = ? ORDER BY started_at DESC LIMIT 1").get(jobId);
    if (!attempt) throw new Error("没有待核对的发布记录");
    const normalized = { ...parse(attempt.receipt_json, {}), ...receipt, recordedAt: now() };
    const status = receipt.externalProductId ? "VERIFYING" : "DRIFT";
    this.db.prepare("UPDATE charm_publish_attempts SET status = ?, receipt_json = ?, confirmed_at = ? WHERE id = ?")
      .run(status, JSON.stringify(normalized), now(), attempt.id);
    this.db.prepare("UPDATE charm_listing_jobs SET status = ?, current_stage = ?, updated_at = ? WHERE id = ?")
      .run(status, status === "VERIFYING" ? "RECONCILIATION" : "PUBLISH_DRIFT", now(), jobId);
    await this.log(jobId, "publish_receipt_recorded", { status, externalProductId: receipt.externalProductId ?? null });
    return this.job(jobId);
  }

  async listJobs() {
    await this.ready();
    const rows = this.db.prepare("SELECT id FROM charm_listing_jobs ORDER BY updated_at DESC").all();
    return Promise.all(rows.map((row) => this.job(row.id)));
  }

  async product(productId) {
    await this.ready();
    const row = this.db.prepare("SELECT * FROM charm_products WHERE id = ?").get(productId);
    return row ? { id: row.id, name: row.name, subtype: row.subtype, status: row.status, facts: parse(row.facts_json, {}), createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  async job(jobId) {
    await this.ready();
    const row = this.db.prepare("SELECT * FROM charm_listing_jobs WHERE id = ?").get(jobId);
    if (!row) return null;
    const product = await this.product(row.product_id);
    const draftRow = this.db.prepare("SELECT * FROM charm_listing_drafts WHERE job_id = ? ORDER BY version DESC LIMIT 1").get(jobId);
    const approval = this.db.prepare("SELECT * FROM charm_approvals WHERE job_id = ? ORDER BY approved_at DESC LIMIT 1").get(jobId);
    const attempt = this.db.prepare("SELECT * FROM charm_publish_attempts WHERE job_id = ? ORDER BY started_at DESC LIMIT 1").get(jobId);
    const events = this.db.prepare("SELECT type, payload_json, created_at FROM charm_events WHERE job_id = ? ORDER BY id DESC LIMIT 20").all(jobId)
      .map((event) => ({ type: event.type, payload: parse(event.payload_json, {}), createdAt: event.created_at }));
    return {
      id: row.id, status: row.status, currentStage: row.current_stage, checkpoint: parse(row.checkpoint_json, {}),
      createdAt: row.created_at, updatedAt: row.updated_at, product,
      draft: draftRow ? { version: draftRow.version, content: parse(draftRow.content_json, {}), createdAt: draftRow.created_at } : null,
      approval: approval ? { token: approval.token, approvedBy: approval.approved_by, approvedAt: approval.approved_at, draftVersion: approval.draft_version } : null,
      publishAttempt: attempt ? { id: attempt.id, status: attempt.status, idempotencyKey: attempt.idempotency_key, receipt: parse(attempt.receipt_json, {}), startedAt: attempt.started_at, confirmedAt: attempt.confirmed_at } : null,
      events
    };
  }
}
