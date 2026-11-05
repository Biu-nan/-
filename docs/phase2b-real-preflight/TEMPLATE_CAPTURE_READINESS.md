# 阶段2B 模板准入与捕获就绪（TEMPLATE_CAPTURE_READINESS）

> 关联：REAL_EXECUTION_PREFLIGHT.md 任务4
> 结论：一跨侧捕获机制完备但**当前 0 条 CAPTURED 快照**；真实模板来源是**店小秘平台侧产品模板**（服务端，按名称引用，无 ID/版本）；**须经营者确认模板并授权捕获**方可真实执行。

---

## 1. 一跨侧捕获机制（已核实源码 `dist/src/listing-template-snapshot-service.js`）

- **服务类**：`ListingTemplateSnapshotService`，快照库 `data/identity/template-snapshots.json`。
- **捕获接口（HTTP）**：`POST /api/identity/template-snapshots`（另有 `GET /api/identity/template-snapshots` 列表、`GET /api/identity/template-snapshots/require?ref=` 校验；工作台侧 `POST /api/workbench/products/:id/template`）。
- **关键字段**：
  - `template_ref` = 店小秘模板**名称**（平台无稳定 ID）。
  - `platform_template_version`：**强制唯一合法值 `NOT_AVAILABLE_FROM_PLATFORM`**；传入任何具体版本号 → 直接抛错（**代码级禁止伪造平台版本**）。
  - `content` / `content_file_ref`：规则正文/本地副本；**有内容才 `CAPTURED`，无内容则 `MANUAL_CAPTURE_REQUIRED`**（绝不静默用默认模板）。
  - `capture_method`：`MANUAL_INPUT` / `LOCAL_FILE` / `CONFIG_EXPORT` / `AGENT_READ`。
  - `local_snapshot_version` = `LOCAL-YYYYMMDD-N`（一跨本地版本，与平台版本是两套空间）。
- **准入闸门**：`requireUsableSnapshot(templateRef)` — 无 CAPTURED 快照 → 返回 `BLOCKED_TEMPLATE`，**不允许静默使用默认模板**。
- **失效识别**：`markStale()` — 模板变更内容 → 置 `STALE`，不悄悄沿用旧规则。

> 结论：**「模板正文来源」平台不提供**，因此一跨只能保存「我们实际读到的那份规则副本」；若拿不到内容，状态就是 `MANUAL_CAPTURE_REQUIRED`，必须人工提供。

---

## 2. 真实模板来源（依据 ecom-translator 已验证路径）

`D:/ecom-translator` 的店小秘上品页 `https://www.dianxiaomi.com/web/smtChoice/add`（标题「店小秘--添加速卖通全托管产品」）实测结构：
- 顶部工具条：`一键翻译 · 存为模板 · 引用产品 · 保存 · 发布`
- 模板选择入口是 **`---请选择引用模板---` 下拉**，出现在 **货品信息** 与 **包装及物流** 两个区块。
- 即：**店小秘模板 = 平台侧「货品信息模板 / 包装物流模板」**，按名称引用；可用「存为模板」把当前配置另存为模板。

**已验证的模板“生效校验”逻辑（ecom 执行器）**：
- `templatePrefix()` 去店铺后缀（如 `-星造`）；
- `choosePrefixRow()` 按模板名前缀在弹窗里选行（避免点到表头“引用模块”导致模板实际未生效）；
- `assertTemplateTookEffect()` **校验模板确实生效**（产品分类被带出、变体区渲染），否则报错不继续。

**schema 捕获（ecom 内核）**：`dianxiaomi_draft_kernel.mjs --mode schema` 打开创建页，只读抓取表单结构 → `page_schema.json` + `fingerprint(sha256)` + `field_count`（**只读，不写不发布**）。这可作为「模板应用后的页面 schema」证据，对应一跨 `capture_method=AGENT_READ`。

---

## 3. 当前状态与缺口

| 项 | 现状 |
|----|------|
| 一跨模板快照库（主树 `data/identity/template-snapshots.json`） | **0 条** |
| 一跨模板快照库（worktree B `data/identity/template-snapshots.json`） | **不存在 / 0 条** |
| 真实模板清单 | **未取到权威全量清单**：模板下拉为自定义组件+portal，本轮纯 DOM 读取不可靠（点开但选项在 portal 未捕获）；**不臆造清单**。 |
| 已知模板名（仅示例，非权威） | `箱包配件-包饰(-星造)`、`箱包配件-Choice半托管模板`、`肩带-皮质-5以上`（来自 ecom 代码/历史，需页面核对） |

---

## 4. 真实执行前的模板准入要求（必须由经营者完成）

1. **确认目标模板名**：在所跑店铺的 `smtChoice/add` 页面「---请选择引用模板---」下拉中，确认目标产品类目对应的**准确模板名**（含店铺后缀，如 `-星造`）。
2. **提供模板内容或授权 schema 捕获**（二选一，均合规）：
   - (A) `MANUAL_INPUT / LOCAL_FILE / CONFIG_EXPORT`：经营者提供该模板的规则正文/字段清单/导出文件 → 调 `POST /api/identity/template-snapshots` 写入 `content` → 状态 `CAPTURED`。
   - (B) `AGENT_READ`：授权运行 `dianxiaomi_draft_kernel --mode schema`（只读）抓取应用后的 `page_schema.json`，作为 `content` 写入 → `CAPTURED`。
3. **校验生效**：用 `assertTemplateTookEffect` 同口径确认「应用后产品分类/变体区被带出」；一跨侧用 `GET /api/identity/template-snapshots/require?ref=<模板名>` 必须返回 `ok:true`（否则 `BLOCKED_TEMPLATE`）。
4. **版本如实**：`platform_template_version` 恒为 `NOT_AVAILABLE_FROM_PLATFORM`，**不得填任何具体版本**。

> **若不提供真实模板内容/不授权 schema 捕获，则不得进行真实 Listing**——一跨不会伪造平台模板版本，也不会静默套默认模板。

---

## 5. 未做
未捕获任何模板、未写任何快照、未应用任何模板到草稿、未伪造版本；仅只读探测页面结构（点开下拉后 Esc 关闭，未点“引用”）。
