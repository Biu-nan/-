# 模板快照机制映射（TEMPLATE_SNAPSHOT_MAPPING）

> 关联：任务二。区分三层内容，明确哪些可真实读取、哪些必须人工提供。
> 依据：一跨 `dist/src/listing-template-snapshot-service.js`（源码核实）+ 本轮实时模板读取 + ecom `dianxiaomi_draft_kernel.mjs`（schema 捕获）。

---

## 1. 三层内容，必须分开（最容易混淆的点）

| 层 | 是什么 | 能否真实读取 | 一跨字段 | 备注 |
|----|--------|--------------|----------|------|
| **① 平台模板名称** | 店小秘模板的名字（如 `箱包配件-包饰`） | ✅ **可读**（页面「引用产品模板」弹窗 / 配置 label） | `template_ref` / `template_name` | 平台稳定 **ID/版本都没有**，只有名字 |
| **② 页面 Schema** | 应用模板后**表单结构**（字段/必填/枚举/联动） | ✅ **可读**（`dianxiaomi_draft_kernel --mode schema` 只读抓取） | 作为 `content`（AGENT_READ） | 是"表单长什么样"，**不是**模板规则正文 |
| **③ 本地 Listing 规则正文** | 模板"要求/填入什么"的规则或字段清单 | ❌ **平台不提供**，须人工/导出 | `content` / `content_file_ref` | 决定快照是否 `CAPTURED` 的核心 |

> **结论**：①名称可读、②Schema 可抓、③规则正文拿不到（平台不暴露）。因此"完整模板快照"= ①名称 + （②Schema 或 ③规则正文）。

---

## 2. 什么能真实读取 vs 必须人工提供

| 内容 | 可自动读取 | 来源 | capture_method |
|------|-----------|------|----------------|
| 模板名称 | ✅ | 页面弹窗/配置 | （直接写入 template_ref） |
| 引用模块（带哪些字段族） | ✅ | 页面弹窗「引用模块」列 | （辅助证据） |
| 应用后页面结构 Schema | ✅ | kernel `--mode schema` → `page_schema.json`+fingerprint | `AGENT_READ` |
| 模板逐字段规则正文 | ❌ | 平台不提供 | `MANUAL_INPUT` / `LOCAL_FILE` / `CONFIG_EXPORT` |
| 平台模板版本号 | ❌ | 平台不返回 | 恒 `NOT_AVAILABLE_FROM_PLATFORM` |

---

## 3. CAPTURED 的成立条件（源码级，不可放水）

`ListingTemplateSnapshotService.capture(input)`：
- `template_ref` 必填（店小秘模板名）。
- `platform_template_version`：**只接受 `NOT_AVAILABLE_FROM_PLATFORM`**；传任何具体版本 → **抛错**（禁止伪造平台版本）。
- `snapshot_status`：
  - 有 `content` 或 `content_file_ref` → **`CAPTURED`**
  - 无内容 → **`MANUAL_CAPTURE_REQUIRED`**（不静默用默认模板）
- 同模板旧 CAPTURED 快照 → 自动置 `SUPERSEDED`（保留不删）。
- `requireUsableSnapshot(ref)`：无 CAPTURED → `BLOCKED_TEMPLATE`（真实执行必须过此闸门）。
- `markStale()`：模板变更 → `STALE`，不沿用旧规则。

**因此：只有「规则正文（③）或 Schema（②）经过验证并写入 `content`」才允许 CAPTURED。**

---

## 4. 三层到 CAPTURED 的可行组合（真实执行前二选一）

| 方案 | 写什么进 content | method | 可信度 | 需谁做 |
|------|------------------|--------|--------|--------|
| A（推荐，最真实） | 运营提供的模板规则正文/字段清单/导出文件 | `MANUAL_INPUT`/`LOCAL_FILE`/`CONFIG_EXPORT` | 高（运营背书） | 经营者提供 |
| B（可自动，但只是结构） | kernel 抓取的 `page_schema.json`（应用后表单结构+fingerprint） | `AGENT_READ` | 中（结构真实、规则语义需人工解读） | 我可在授权后只读抓取 |

> 无论 A/B，`platform_template_version` 恒 `NOT_AVAILABLE_FROM_PLATFORM`；`template_ref` 用真实模板名（如 `箱包配件-包饰`）。

## 5. 与「模板目录审计」的衔接
- 目录审计（`TEMPLATE_CATALOG_AUDIT.md`）给出「①名称 + 引用模块」；
- 本文件明确「③规则正文须人工/②Schema 可抓」；
- **下一步建议**：经营者选定模板（试点= `箱包配件-包饰`）后，走方案 A（最稳）或授权我走方案 B（`--mode schema` 只读）→ `POST /api/identity/template-snapshots` → 校验 `GET .../require?ref=箱包配件-包饰` 返回 `ok:true`。

## 6. 未做
未写入任何快照、未伪造版本、未应用模板到草稿。
