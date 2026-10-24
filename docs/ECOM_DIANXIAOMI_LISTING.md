# ecom-translator 如何实现店小秘上架（机制文档）

> 依据：`erp_operations_runner.py`（92KB）、`tools/dianxiaomi_draft_executor.mjs`（92KB）、
> `tools/dianxiaomi_draft_kernel.mjs`（8KB）、`src/erp_planner.py`、`erp_operation_center.py`、
> `DIANXIAOMI_INTEGRATION_PLAN.md`、`docs/operating-point.md`。
> 结论先行：**它不是"一键发布"，而是"把 Listing 成稿变成店小秘待发布草稿，并回读证明草稿真的存在"。**

---

## 一、全链路（五段中的后两段）

```
04_LISTING_CONTENT.md ─┐
product_info.json      ├─→ ERP_PLAN ─→ output/<产品>/erp/field_plan.json (PLAN_VERSION=7)
listing_handoff.json   │            └→ operation_selection.json（店铺/模板/备货/变体组）
SKU 表(xlsx)           │
店铺/模板/履约配置 ─────┘
                                     ↓
                        ERP_DRAFT ─→ node tools/dianxiaomi_draft_executor.mjs
                                     --plan field_plan.json --out erp/live_draft_run --commit
                                     ↓
                        CDP(127.0.0.1:9223) → 店小秘创建页 → 逐字段填写+回读
                                     → 点「保存」→ verifyDraft 回读「待发布列表」
                                     ↓
                        draft_execution_audit.json（DRAFT_VERIFIED / DRAFT_REVIEW / SAVE_UNKNOWN）
```

- 阶段常量在 `erp_operations_runner.py:257-265`：
  `full = (IMAGE_PIPELINE, LISTING, ERP_PLAN, ERP_DRAFT)`；`erp_draft = (ERP_PLAN, ERP_DRAFT)`；
  `full_original = (LISTING, ERP_PLAN, ERP_DRAFT)`。
- `resolve_stages()`（`:269-282`）有一条关键规则：**含 LISTING 但不含 IMAGE_PIPELINE → 自动前置 IMAGE_IMPORT**（这就是"不翻译直接上架"的总开关）。

---

## 二、ERP_PLAN：先出"可执行计划"，过不了门禁不许进浏览器

`src/erp_planner.py` 的 `build_plan()`（`:1178`）产出 `output/<产品>/erp/field_plan.json`（`PLAN_VERSION = 7`，`:20`）：

| 部分 | 内容 |
|---|---|
| `field_plan[]` | 每个字段一条：`label / canonical / action / value / source / reason` |
| `status` | `PLANNED` 才允许进 ERP_DRAFT；否则带 `blockers` 跳过 |
| `blockers[]` | 资料门禁：缺主图、缺买家描述、SKU 无法命名/重名、库存过滤后无变体等 |
| `sku_plan` | `rows / write_rows / encoding_rule / naming_rule / inventory_rule / stock_filter` |
| `title_gate` | 标题长度是否在区间（**不合规不进 blockers**，只触发一次 Listing 重跑，见 O-074） |
| `input_fingerprint` | 计划输入哈希（title+profile+sku_rows+facts+field_plan），用于幂等/复用判定 |
| `description_plan` | PC/无线描述、描述图清单 |

字段动作只有三档（`:1223-1268` 附近）：
- `FILL`：有来源、有依据，要填；
- `PRESERVE_OR_VERIFY`：页面已有值或经营配置，填后要核验；
- `MISSING_SOURCE`：缺资料 → 进 `blockers`，**不编造**。

> 计划是"事实与页面之间的翻译层"：Listing 给营销文案，`product_info.json` 给带证据的规格，`operation_selection` 给店铺/模板/履约，SKU 表给价格库存。四者不混。

---

## 三、ERP_DRAFT：串行执行，逐产品保存

`erp_operations_runner.py` 的 `_erp_draft()`（`:880`）：

1. **逐产品串行**（`:896`），暂停只在产品边界生效；
2. 读 `field_plan.json`，`status != PLANNED` → `SKIPPED` + 记录 `blockers`（`:912-922`）；
3. **草稿复用**（`:937-940`）：`plan_input_fingerprint` 相同且 prior 状态是 `DRAFT_VERIFIED/DRAFT_REVIEW` 且有 `draft_id` → 不重复建，直接归档；
4. **更新已有草稿**（`:974-980`）：有 `edit_url` 时追加 `--edit-url`，**不会创建第二条**；
5. 调执行器：
   ```bash
   node tools/dianxiaomi_draft_executor.mjs --plan field_plan.json --out erp/live_draft_run --commit
   ```
6. 执行器写 `draft_execution_audit.json`，runner 据 `status` 决定归档 / 留待补 / 记 ATRTENTION。

---

## 四、执行器内部：10 个步骤 + 每步"写后回读"

`tools/dianxiaomi_draft_executor.mjs` 的文件头（第 2 行）写死了边界：
> *"It can only save or update drafts; it has no publish action."*

审计对象（`:774`）：
```js
{ schema_version: 2, mode: commit ? 'SAVE_DRAFT' : 'FILL_VERIFY',
  draft_only: true,
  operation: editMode ? 'UPDATE_EXISTING_DRAFT' : 'CREATE_DRAFT',
  steps: [], attention: [] }
```

非编辑模式下的固定步骤（`:792-922`）：

| # | 步骤 | 关键实现 |
|---|---|---|
| 1 | 店铺 | `#rc_select_0` + `chooseVerified` |
| 2 | 引用模板 | 点「引用产品」→「引用产品模板」→ `choosePrefixRow`（前缀匹配）+ `assertTemplateTookEffect` |
| 3 | 备货类型 | `#rc_select_1` |
| 4 | 材质 | 页面枚举匹配；枚举里没有 → 选最近事实并写 `attention` |
| 5 | 主图 | `resolveMainImages` → 统一缩放到方形（等比+白底补边）→ 逐张 `filechooser` 上传（最多 6） |
| 6 | 营销图 | `pickMarketingImages` 产出 white/scene 两张 |
| 7 | 变种颜色 | `variantGroupScope` 限定属性组，按 SKU 行数勾选 |
| 8 | SKU 自定义名称 | 按 SKU 表逐行填，行数不一致直接抛错 |
| 9 | 包装重量/尺寸 | `variationWeight/Length/Width/Height` 逐行 `fillVerified` |
| 10 | **保存草稿** | 点「保存」→ 查 toast 失败文案 → `verifyDraft(context, title)` |

**写后回读原语**（`:357-411`）：
- `commit({write, read, wanted, compare})` → `VERIFIED / MISMATCH / UNREADABLE`；
- `fillVerified` / `chooseVerified` 包装它；`assertVerified` 在 MISMATCH 时抛错，`UNREADABLE` 可降级为 `attention`。
- 设计原则（`:406`）：*"沉默的『可能没生效』正是本层要消灭的东西"*。

---

## 五、保存后的"存在性证明"：verifyDraft

点保存后不做"没报错就算成功"，而是 `verifyDraft(context, title)`（`:623`）：
1. 打开店小秘**待发布列表**；
2. 按标题搜索；
3. 找到 → 记录 `draft_id / edit_url / keys`；
4. 查不到 → 抛 `SAVE_UNKNOWN`（或 `SAVE_UNVERIFIED`，搜索框都没出现），并**明确禁止重试创建**（`:922`）。

最终状态（`:923`）：
- `DRAFT_VERIFIED`：保存 + 回读通过，无 attention；
- `DRAFT_REVIEW`：保存 + 回读通过，但有 attention（如材质枚举降级、图片退化）；
- `FILLED_NOT_SAVED`：只填不存（无 `--commit`）；
- `ERROR`：步骤失败，附页面首 400 字。

---

## 六、安全设计：为什么它"只能存草稿"

| 机制 | 证据 |
|---|---|
| 执行器无发布分支 | 文件头第 2 行声明；`parseArgs` 拒绝未知参数（`--publish` 会被拒） |
| 审计硬编码 `draft_only: true` | `:774` |
| 提交门禁 `no-publish-action` | `_verify/check_no_publish_action.py`：把「发布」写成点击目标即失败，但放行「待发布列表」这类读语义；**每次提交都跑**（`docs/operating-point.md:35`） |
| `draft_only` 用 `StrictBool` | `src/contracts.py:151-154`，防 `'true'/'1'` 宽松转换 |
| 删除/归档硬校验 | `src/task_cleanup.py:127-163` 7 条；`erp_operations_runner.py:475-478` 无 draft_id 禁止归档 |
| 爆炸半径 | 仅草稿；无改价/改库存/删除线上数据 |

---

## 七、幂等、恢复与审计

| 机制 | 落点 |
|---|---|
| 计划指纹 | `input_fingerprint`（title+profile+sku+facts+field_plan） |
| 草稿引用持久化 | `erp/live_draft_run/verified_draft.json`（draft_id/edit_url） |
| 重试不重复建 | 有 `edit_url` → `--edit-url` 更新；`SAVE_UNKNOWN` → 禁止重试创建 |
| 批次台账 | `batch_state.json` / `draft_execution_audit.json` / `listing_chat_audit.json` |
| 非阻断问题留痕 | `audit.attention[]`（不阻断上架，但必须写进审计） |

---

## 八、已知脆弱点（诚实清单）

1. **硬编码控件序号**：`#rc_select_0`（店铺）、`#rc_select_1`（备货）——店小秘表单序号一变即错位。
2. **中文文案点击**：「引用产品」「引用产品模板」「保存」；失败归类也靠中文子串。
3. **保存按钮用 `filter({hasText:'保存'}).first()`**：若页面上「保存并发布」排在前面，存在误点风险（发布参数已移除，但选择器未精确到草稿动作）。
4. **模板前缀匹配**：`templatePrefix` 只剥 `- 星造` 后缀；模板改名即失配（失配会 `assertTemplateTookEffect` 记 attention）。
5. **主图/营销图依赖文件名约定**（`主图_07`/`主图_03`），不完全是语义选择。
6. **包装缺省值**：缺包装数据时会填默认 `100g + 12×10×10cm` 并写 attention——不是事实，需人工核对。

---

## 九、对「移植到一跨而境」的直接启示

一跨而境已有 `dist/src/dianxiaomi-adapter.js`（半托管 Choice，`applyProductTemplate`/`fillFromFacts`/`clickSaveAndNext`）。ecom-translator 这套的价值不在"再写一遍填表"，而在**三个可移植的机制**：

1. **计划与执行分离**：`field_plan.json`（PLANNED + blockers）作为唯一执行输入，执行器不即兴决定填什么；
2. **保存后回读待发布列表**（`verifyDraft`）——一跨目前保存后主要靠页面回读，缺"列表级存在性证明"；
3. **`attention` 非阻断留痕**：区分"失败"与"可能没生效"，避免静默通过。

最小移植路径：连接器把 `04_LISTING_CONTENT.md + product_info.json` 交接进一跨产品目录（已完成），
店小秘执行继续用一跨自己的适配器，**只把 2、3 两条机制补进去**即可，不必搬整个 Python 执行链。
