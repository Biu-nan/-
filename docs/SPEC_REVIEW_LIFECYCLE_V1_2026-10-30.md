# YKB-OS 商品生命周期说明书 V1.0 · 只读架构审查

- 审查对象：`D:\ecom-translator\input\YKB-OS_Product_Lifecycle_Spec_V1.0_DRAFT_20261030.md`
- 审查方式：只读。未修改任何代码、数据、生产规则；未执行数据库迁移。
- 审查时间：2026-10-30
- 审查范围：`F:\yikuaborder-deploy`（运行态代码 `dist/` + 数据根）
- 对应说明书 §12 B06「当前一跨项目的数据库和既有产品模块盘点」

---

## 0. 一句话结论

**说明书本身可以当设计基线用，但它假设的"待建数据库"和现实差距很大：一跨现在没有 products 表，只有目录约定 + 7 套 JSON 状态机 + 1 个单品类 SQLite。**

更要紧的是 —— **说明书担心的是"纳物历史文件之间有词汇冲突"，而一跨自己已经产生了 4 套互相不认的生命周期词汇**。如果直接把说明书搬成一跨的字段，冲突会从"历史文件"搬进"生产库"。

建议的落地顺序不是"建 16 张表"，而是先做 **产品身份统一 + 5 维度字段拆分**，其余全部向后兼容包一层。

---

## 1. 现状数据层实况（FACT）

| 项 | 实况 | 证据 |
|---|---|---|
| 关系型数据库 | **全系统只有 1 个业务 SQLite**，且只服务"包包挂件"单一品类 | `data/charm-listing-workspace.sqlite`，7 张表 |
| 该库表 | `charm_products`(3) / `charm_listing_jobs`(3) / `charm_listing_drafts`(2) / `charm_approvals`(1) / `charm_publish_attempts`(1) / `charm_events`(10) / `charm_learning_candidates`(0) | 同上 |
| 产品主档 | 目录式：`已完成产品/<中文目录名>/product-profile.json` | `schemaVersion/productId/identity/lifecycle/nextAction/artifacts/archive` |
| 刊登卡 | JSON 数组，13 字段，**已接近 `store_listings`** | `listing-cards.json`（3 条） |
| SKU 映射 | JSON 数组，15 字段，**已接近 `product_skus`** | `listing-sku-mappings.json`（6 条） |
| 指标事实 | 幂等 append-only JSONL，键 `source\|storeId\|caliber\|subject\|window\|statDate` | `scripts/metrics-store.mjs` + `config/metrics-schema.json`（23 口径 / 6 指标 / 5 禁令） |
| 分层 | `config/product-stratification.json`：5 域 / 7 层 / 7 风险 / 15 派生字段 | 474 件商品已跑过 |
| 店铺主数据 | **只有 2 个店**：`02b6af05 洛慈三店`、`d7449032 Phase1A Test Store` | `store-profiles.json` |

### 1.1 产品身份有 4 种，互不关联

| 形态 | 示例 | 出现在 |
|---|---|---|
| 目录名（中文） | `已完成产品/仿真食物挂件/` | 文件系统 |
| UUID | `48ddea32-fd87-4a3a-a171-d15ded4a435d` | `product-profile.json.productId` |
| UUID（另一套） | `f11e0555-c9b2-434b-a6d2-595e275e629c` | `listing-cards.product_id` |
| 自增/短 ID | `sb_mvuc1itt_41c760` | 今日新增的 `selection-board` |

`listing-cards.product_id` 与 `product-profile.json.productId` **实测零交集**：`已完成产品/` 下 149 份 `product-profile.json` 的 `productId` 集合，与 `listing-cards.json` 的 2 个 `product_id` 取交集为空。两套 ID 空间互不认，这是 spec §8 要求的 `products.product_id` 无法直接落地的主因。

---

## 2. 能力矩阵（spec §8 的 16 个实体）

判定口径：**已有**＝可用且语义匹配；**部分已有**＝有载体但缺关键字段/缺约束；**缺失**＝无载体；**无法确认**＝需要外部证据。

| # | 实体 | 判定 | 现实载体 | 关键缺口 |
|---|---|---|---|---|
| 1 | `products` | ❌ 缺失 | 3 种碎片（见 1.1） | 无统一主键、无一处存全 §2.1 十字段 |
| 2 | `product_images` | 🟡 部分 | 目录 `产品图/`、`风格参考图/`；看板 `images[]`/`styleRefs[]` | 无 `image_type`（主图/附图）、无 `sort_order`、无 `availability_status` |
| 3 | `product_skus` | 🟡 部分 | `listing-sku-mappings.json`（15 字段，含 platform_sku_id / seller_sku_code / color / size） | 只有 6 条测试数据；无 `canonical_sku` 与 `source_sku` 双轨 |
| 4 | `product_store_plans` | ❌ 缺失 | — | 只有"实际刊登"没有"计划店铺"；spec §3.1 计划/实际分离无法落地 |
| 5 | `listing_templates` | ❓ 无法确认 | 模板在**店小秘平台侧**（`applyProductTemplate()` 破坏性覆盖） | 本地无 template_id / version / rules_ref；**平台侧拿不到版本号** |
| 6 | `listing_assets` | 🟡 部分 | `当前产品/output/` + `progress-manifest.json` | 无 `qc_status` 结构化记录 |
| 7 | `store_listings` | 🟡 部分 | `listing-cards.json`（13 字段，含 listing_url / platform_product_id / listing_status） | 缺 `planned_status` / `failure_reason` / `last_synced_at` / `evidence_ref`；是 JSON 数组非表 |
| 8 | `daily_metrics` | ✅ 已有 | `metrics-store.mjs` + 23 口径字典 + 5 条禁令硬拦截 + 日切窗口守卫 | 字段名用 `caliber`，spec 用 `metric_code`；需登记为同一概念 |
| 9 | `lifecycle_records` | ❌ 缺失 | — | 无 `calculated` / `effective` 两阶段；无 `UNRESOLVED` |
| 10 | `classification_records` | 🟡 部分 | `product-stratification.json` 7 层 + 7 风险 + 15 派生字段 | 层与风险未拆成 spec 的 4 个独立字段；层序＝关注优先级而非价值分层 |
| 11 | `rule_registry` | ❌ 缺失 | 规则散落 3 处：`metrics-schema.json`、`product-stratification.json`、代码常量 | 无 `rule_version` / `status` / `approved_by` / `effective_from` |
| 12 | `lifecycle_evidence` | 🟡 部分 | `data/metrics/facts/<source>/<date>.jsonl` 原始事实 + `raw/` 快照 | 无 SKU 级 evidence 组装；无 `effective_sellable_days` |
| 13 | `agent_tasks` | 🟡 部分 | **7 套并行状态机**（见 4.1） | 只有 charm 那套有事件流 + checkpoint + 幂等键 |
| 14 | `approval_tasks` | 🟡 部分 | `charm_approvals.token`（唯一带令牌的审批） | `REVIEW_REQUIRED` 是空壳审核（`draftFromFacts()` 本地拼接 0 次 AI） |
| 15 | `collection_runs` | 🟡 部分 | `data/metrics/raw/<source>/<date>/` 有快照 | 无 run 级记录（started/completed/result/evidence_ref） |
| 16 | `audit_logs` | 🟡 部分 | `event_log.jsonl` / `action_log.jsonl` / `image-generation-log.jsonl` | 三处分散，无统一 actor/before/after |

**统计：已有 1 / 部分已有 8 / 缺失 6 / 无法确认 1。**

> 结论：spec §10 阶段 1「领域模型与数据契约」不是从零设计，而是**把已有 9 个载体归并 + 补 6 个缺失**。归并的工作量远大于新建，且更容易出错（历史数据双写）。

---

## 3. 核心发现：一跨自己已经有 4 套生命周期词汇

这是本轮审查最重要的发现，说明书没有预见（它只把冲突归因于纳物历史文件）。

| 来源 | 词汇 | 实际语义 | 问题 |
|---|---|---|---|
| `product-profile.json` → `lifecycle.currentStage` | `COMPLETED` / `archived` | **其实是开发进度**，不是商品生命周期 | 字段名 `lifecycle` 与语义不符，正是 §1.2 批判的混用 |
| `listing-cards.json` → `listing_lifecycle` | `observing` | 商品生命周期（疑似对应 `NEW_OBSERVATION`） | 英文小写自定义词，与 spec 规范 ID 不一致；全库仅 1 个值 |
| `config/product-stratification.json` → `layers` | `S / A / B / M / N / C1 / C2` | **关注优先级**分层（memory 已明确"S 层 4 件扛 31.7% 销量"） | `M/N/C` 与 spec 的 `MATURE/NEW_OBSERVATION/LONG_TAIL` 同名不同义 |
| `selection-board`（今日新增）→ `status` | `PICKED/READY/LISTING/LISTING_DONE/SAVED_DXM/ON_HOLD/DROPPED` | 开发进度 + 店小秘保存状态混在一个字段 | **违反 spec §1.1 禁令**，见 §4.2 |

另外 `product-stratification.json` 的 7 层里，`S/A/B` 与纳物安全库存 V1.0 的 `S/A/B` 同形但**不同义**（前者是关注优先级，后者是销量等级 + 备货天数），构成 spec 未登记的**第 9 条冲突**（建议编号 `LIFE-C09`）。

### 3.1 建议：不要重命名，用别名表

`product-stratification.json` 已服务 474 件真实商品的分类结果。**重命名层 ID 会破坏既有结果与脚本**。建议：

- 保留现有层 ID 不动；
- 新增 `lifecycle_aliases` 映射段：`{ source_version, legacy_code, canonical_id, confidence }`；
- `canonical_id` 用 spec §4.2 的语义 ID；
- 映射拿不准的（`N`/`E`/`M`/`R`）一律写 `UNRESOLVED_RULE`，不猜。

---

## 4. 与说明书的 7 处设计冲突 / 缺口

### 4.1 spec 假设"单一任务系统"，现实是 7 套状态机

现有：`run-state.json`（主上品）、`data/batch-listing-state.json`、`data/collect-batch-state.json`、`charm_listing_jobs`（SQLite）、`data-collection-tasks.json`、`daily-waiting-items.json`，加今日新增的 `商品队列/选品看板/board.json`。

spec §8 只给了一个 `agent_tasks`。**7 套合一是有价值的目标，但不能作为阶段 2 的前置条件** —— 那会把"做产品工作台"变成"重构所有执行链路"。建议：先建 `agent_tasks` 作为**只读投影层**（把 7 套的当前状态聚合进来，不改变写入方），等 F3 统一 Gate 定下来再收敛写入。

### 4.2 今日上线的选品看板已构成架构债（自报）

`selection-board` 用**单一 `status` 字段**同时表达"开发进度"和"店小秘已保存"。spec §1.1 明确禁止这种设计。

好消息：看板当前 **0 条数据**，改造零迁移成本。建议改为：

```
product_development_stage: PICKED → READY → LISTING → LISTING_DONE   (开发进度)
store_listings[]:          { store_id, actual_status, ... }          (逐店刊登，引用 listing-cards)
```

`SAVED_DXM` 不再是开发阶段，而是 `store_listings` 里某店铺的 `actual_status = DRAFTING`。这个改动必须在看板有真实数据前完成。

### 4.3 `listing_templates` 在平台侧，spec 的版本快照物理上拿不到

spec §2.1 要求"任务记录保存模板版本快照，避免模板后续修改导致历史 Listing 无法复现"。

现实：模板是**店小秘平台对象**，`applyProductTemplate()` 是破坏性整体覆盖，平台不返回模板版本号。**只能存"我们调用时的模板快照副本"**（把模板字段抓下来存本地），不能存"平台侧的版本指针"。

这是实施 blocker（建议登记 `B09`），需要在 spec 里改写为"本地模板快照"，否则实施者会去平台找不存在的版本号。

### 4.4 只有 lifecycle 有影子机制，分级没有

spec §7.1 给生命周期做了 `calculated` / `effective` 两阶段 + `UNRESOLVED`。但 §5.3 的 `sales_performance_grade` / `funding_tier` / `inventory_strategy` **没有同样的两阶段机制**。

后果：分级会直接生效，而分级驱动备货天数（S=3天、A=2天），比生命周期更贴近钱。这是不对称的——建议三类分级字段同样加 `calculated_* / effective_*`。

### 4.5 `style_reference_url` 是 URL 还是本地副本，spec 自相矛盾

§2.1 字段表写 `style_reference_url: URL 可选`；同节"图片处理规则 5"写"风格参考图单独存储，不参与产品事实提取"。

一跨现状是**下载到本地**（`当前产品/风格参考图/`，且 `MAX_STYLE_REFERENCE_IMAGES=3`，有物理隔离要求——因为混进 `产品图/` 会被 `scanProductImages` 当源图，导致货不对版）。需要明确：URL 只是输入来源，**必须落本地副本**，否则无法保证隔离。建议字段改为 `style_reference_source_urls[] + local_copies[]`。

### 4.6 §2.2 埋了一个未裁决项在括号里

> "计划店铺信息按当前业务要求已填写，**或明确允许先制作 Listing、后补计划店铺（该业务策略需要在实施前由产品负责人确认）**"

这是阻塞性决策，不应藏在门禁条目里。建议升级为独立裁决项（下表 Q1）。

### 4.7 `PAUSED` / `DELISTED` 与"沉睡"语义接近，容易二次混用

§3.2 平台刊登实际状态里有 `PAUSED` / `DELISTED`，§4.2 商品生命周期有 `DORMANT`（沉睡）。前者是**平台侧操作状态**，后者是**销售表现推断**。实施时极易把"平台下架"当成"沉睡"，或反之。建议在字段注释里显式声明二者正交，且不允许互相推导。

---

## 5. 待裁决清单（我无权替 Lance 决定）

### 5.1 说明书已登记的 8 条（必须拍板才能进生产）

| ID | 内容 | 阻塞什么 | 我的建议（仅供参考） |
|---|---|---|---|
| LIFE-C01 | N→G 近 7 日销量阈值 **7 还是 8** | 新品自动毕业 | 取 **8**（更保守，宁可晚一天毕业） |
| LIFE-C02 | C/D 分流边界（旧版 C≥5 D≤5 重叠；C7 用 C≥6 D≤5） | 临界 SKU 自动分流 | 5 件**隔离**为 `UNRESOLVED_RULE`，不做自动分流 |
| LIFE-C03 | `E` 语义冲突（C7=新品观察 vs 安全库存=淘汰观察） | 所有 E 映射 | 强制 `source_version` 三元组，不许单字母入库 |
| LIFE-C04 | N 与 E 的新旧关系 | 迁移 | 保留别名，不合并 |
| LIFE-C05 | M/R 是否首期启用 | 完整状态机 | **首期不启用**，只留字段与历史映射 |
| LIFE-C06 | 有效可售日口径（时区/断货/下架/暂停） | 21 日新品观察期 | 需先定义，否则整个 NEW_OBSERVATION 不可算 |
| LIFE-C07 | 零基线趋势（前 7 日 0、近 7 日有量） | 趋势系数 | 返回 `UNRESOLVED`，不判无穷大 |
| LIFE-C08 | 生命周期与采购等级混用 | 新库字段拆分 | 拆字段，历史值原样保留 |

### 5.2 本轮新增，需 Lance 拍板

| ID | 问题 | 为什么阻塞 |
|---|---|---|
| Q1 | **允许"先做 Listing、后补计划店铺"吗？** | 决定 `product_store_plans` 是否可空、决定看板能否不等店铺就推送上品 |
| Q2 | **首店 400370（纳物-箱包全托1店）的 store_id 是哪条？** | `store-profiles.json` 里**找不到这个店**。没有 store_id，`store_listings` 无法建，逐店刊登状态无从记录 |
| Q3 | **选品看板现在的 7 态 status 是否同意拆成"开发阶段 + 逐店刊登"？** | 现在 0 数据，改造成本为 0；有数据后再改要迁移 |
| Q4 | **`product_id` 统一用哪一套？** | 4 种标识并存（见 1.1）。必须定一个"发射点"，其余全部映射 |
| Q5 | **474 件已分层商品，是否接受"层 ID 不改、只加别名表"？** | 若要求重命名以对齐 spec，需重跑全量分层并承担结果漂移 |

---

## 6. 迁移风险与回滚

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **双写污染** | 新建 products 表后，上品流程仍写 `product-profile.json` | 单一写入引擎先定（F3 Gate 未定前不双写）。过渡期 products 表只做**只读投影** |
| **目录改名破坏引用** | 统一 product_id 时改 `已完成产品/<中文名>/` | 目录名是外部引用（备份、脚本、`verify-product-layout.mjs`）。**不改名**，只加映射 |
| **分层结果漂移** | 重命名层 ID | 不改名（见 Q5） |
| **指标口径重复造词** | spec 的 `metric_code` 与现有 `caliber` 并存 | 登记为同一概念，禁止新增第二套；`metrics-schema.json` 保持唯一权威 |
| **店小秘模板版本假设** | 实施者按 spec 去平台取模板版本号 | 改写为本地快照（见 4.3） |
| **日切窗口数据错记** | 在北京 15:00–17:00 跑采集 | 现有 `platformDaycutWindow()` 守卫必须复用，不得绕过 |

**回滚方案**：本阶段全部为只读盘点，无写入。后续任何 schema 变更前，先做 `已完成产品/` 全量快照 + `board.json`/`listing-cards.json`/`listing-sku-mappings.json` 备份，并保留"用旧目录结构继续跑上品"的降级路径。

---

## 7. 对「优化选品功能」的具体建议

不要把 spec 当"新建系统"的图纸，而是当**选品看板的字段标准**。按这个顺序做，每步都可独立验收：

### 第 1 步：看板字段对齐 spec §2.1（不建库）

| spec 字段 | 看板现状 | 动作 |
|---|---|---|
| `product_id` | `sb_xxx` | 改为 UUID，另存 `legacy_board_id` 保持兼容 |
| `product_name` | ✅ name | — |
| `main_image_url` + `additional_image_urls` | 一个 `images[]` 混装 | 拆 `mainImage` + `additionalImages[]`，**保留原始 URL**（现在 `sourceUrl` 字段建了但没填，是 bug） |
| `objective_facts` | ✅ objectiveInfo | 改结构化（现在是一坨文本） |
| `style_reference_*` | 本地文件，无 URL | 加 `source_urls[]`，明确"URL 是来源、本地副本是事实" |
| `source_url` | ✅ | — |
| `planned_store_ids` | ❌ | 新增（Q1 决定是否必填） |
| `listing_template_id` | ❌ | 新增（Q3 决定快照方式） |
| `product_notes` | ✅ notes | — |

### 第 2 步：状态拆分（Q3 确认后立即做）

`status` → `product_development_stage`（4 态）+ `storeListings[]`（引用 listing-cards 结构）。看板 0 数据，此刻改零成本。

### 第 3 步：幂等（spec §2.2）

看板目前"推送上品"可无限重复点击。加 `idempotency_key = hash(product_id + input_version)`，参考 `charm_publish_attempts.idempotency_key` 的现成实现。

### 第 4 步：复用而非新建

- 逐店刊登 → **复用 `listing-cards.json`**，补 4 个字段（planned_status / failure_reason / last_synced_at / evidence_ref）
- SKU → **复用 `listing-sku-mappings.json`**，补 canonical_sku 双轨
- 指标 → **复用 `metrics-store.mjs`**，不碰 23 口径字典
- 审批 → **复用 `charm_approvals` 的 token 模式**，不新建第二套

### 明确不做（本轮）

- 不建 16 张表的数据库
- 不重命名 `product-stratification` 层 ID
- 不改 `已完成产品/` 目录命名
- 不动纳物采购系统
- 不启用任何自动分级 / 自动采购 / 自动发布

---

## 8. 首轮交付物覆盖情况（对 spec §13）

| spec 要求文件 | 本报告覆盖 | 说明 |
|---|---|---|
| `CURRENT_ARCHITECTURE.md` | ✅ §1 | 数据层实况 |
| `EXISTING_CAPABILITY_MATRIX.md` | ✅ §2 | 16 实体 4 档判定 |
| `DOMAIN_MODEL_ERD.md` | ❌ 未出 | 需先定 Q4（product_id 统一）才有意义 |
| `LIFECYCLE_STATE_MACHINE.md` | 🟡 §3 | 给出 4 套冲突词汇；状态机图需 Q5 后出 |
| `RULE_CONFLICT_REGISTER.md` | ✅ §3 / §5 | 8 条已有 + 新增 LIFE-C09 + Q1–Q5 |
| `IMPLEMENTATION_GAP_ANALYSIS.md` | ✅ §2 / §4 | — |
| `MIGRATION_AND_ROLLBACK_PLAN.md` | 🟡 §6 | 风险已列；具体迁移脚本待裁决后出 |
| `ACCEPTANCE_TEST_PLAN.md` | ❌ 未出 | 需先有 ERD 与状态机 |

---

## 9. 本次审查未做的事（红线声明）

- 未修改任何代码、配置、生产数据
- 未执行数据库迁移或写入
- 未修改纳物 C6/C7 任何文件
- 未裁决任何历史阈值（全部列出待 Lance 拍板）
- 未把 `UNKNOWN` / 缺失 / 未确认当成 0 或推断补齐
