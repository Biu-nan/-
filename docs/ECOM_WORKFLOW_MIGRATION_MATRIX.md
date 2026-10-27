# ecom-translator 上架 workflow 清单 ＋ 迁移判定矩阵

> 2026-10-26。依据：实读 `D:\ecom-translator`（Python 编排 + Node 内核）与 `F:\yikuaborder-deploy\dist\src`（一跨现状）。
> 定位：这是**梳理与判定**，不是实施方案。配套已有文档：
> `docs/MIGRATION_ECOM_TRANSLATOR.md`（v0.1 架构草案）、`docs/CONTRACT_MAP_ecom.md`（字段映射）、
> `docs/ECOM_DIANXIAOMI_LISTING.md`（上架两段机制）、`docs/PRODUCT_LISTING_WORKFLOW.md`（一跨单品实测）。

---

## 〇、结论先行

1. **ecom 的"上架"不是一键发布，而是 5 段文件契约流水线**：`IMAGE_IMPORT/IMAGE_PIPELINE → LISTING(4 阶段) → 解析层 → ERP_PLAN → ERP_DRAFT(草稿)`。段与段之间只靠 `<产品目录>/xxx.json|md` 交接，任意一段可单独重跑。
2. **一跨已经有其中 3 段**：LISTING 4 阶段（`tools/seo_core_kernel.mjs` + `automation-service` 的 research 步）、店小秘写入层（`dianxiaomi-adapter.js` 4248 行，比 ecom 的 932 行 executor 更成熟，多了采集箱/批量/颜色图/包装尺寸）、以及部分幂等与自愈。
3. **一跨真正缺的是中间两层**：
   - **解析层**（`04_LISTING_CONTENT.md` → `listing_fields.json`，含标题 5 级降级与描述区间判定）
   - **计划层**（`erp/field_plan.json`，13 个一级 key + 9 道资料门禁 + `input_fingerprint`）
   结果是：一跨现在把 `facts` 对象**直接怼进浏览器**，没有"先出计划、过不了门禁不许开浏览器"这一步；标题质量也没有任何机器判定。
4. **迁移优先级**：解析层 > 计划层 > SKU 表装载/变体命名 > 失败三分类。店小秘浏览器层**不迁**（一跨更强，迁了是降级）；OCR/擦字/翻译**不迁**（Python 栈无可替代，见 MIGRATION 文档）。
5. **一个前置依赖必须先解**：迁计划层之前必须先统一一跨的 facts 契约——现在 `variants` 有 3 份定义（`schemas/product-fact.schema.json` / `listing-knowledge.js:56-62` / `dianxiaomi-facts.js:18`），每次运行稳定产出 9 条 `SCHEMA_INVALID`。在这样的流沙上建 `field_plan`，等于把"多份真相"再复制一层。

---

## 一、五段全链路（含产物与门禁）

```
[1] IMAGE_IMPORT        input/ 原图 → output/<产品>/       （不翻译时的旁路，自动前置）
[1'] IMAGE_PIPELINE     OCR→翻译→擦字→回写 → output/*_en.jpg + product_info.json
                              ↓  契约：product_info.json（必需）+ 图片命名槽位
[2] LISTING             ChatGPT 网页 4 阶段（同会话串行）
    ├ ① PRODUCT_FACTS   指纹 "# 产品图片事实提取"        → 01_PRODUCT_FACTS.md
    ├ ② MARKET_RESEARCH 指纹 "请基于本对话中已经上传的产品实拍图完成联网市场调研" → 02_MARKET_RESEARCH.md
    ├ ③ SEO_KEYWORDS    指纹 "Google Ads SEO Keyword Research Prompt"  → 03_SEO_KEYWORDS.md
    └ ④ LISTING_CONTENT 指纹 "AliExpress Listing Commercial Delivery Prompt" → 04_LISTING_CONTENT.md
                              ↓  会话内传递（只有 03→04 显式注入 {{SEO_KEYWORD_REPORT}}）
[3] 解析层（listing_contract）  04 → listing_fields.json
    { title, title_length, description_lines[], description_images[], problems[], warnings[] }
                              ↓  坏解析 → problems 非空 → ok=false → 不进 ERP
[4] ERP_PLAN            erp_planner.build_plan()  → erp/field_plan.json (PLAN_VERSION=7)
    status ∈ {PLANNED, REVIEW}；REVIEW 带 blockers，不允开浏览器
                              ↓  只 PLANNED 才下发
[5] ERP_DRAFT           node dianxiaomi_draft_executor.mjs --plan --commit
    25 步逐字段填写 + 写后回读三态 → 保存 → 回查「待发布列表」→ draft_execution_audit.json
    status ∈ {DRAFT_VERIFIED, DRAFT_REVIEW, SAVE_UNKNOWN, SAVE_UNVERIFIED, FILLED_NOT_SAVED}
```

阶段常量：`erp_operations_runner.py:257-265`；`resolve_stages():269-282` 有一条总开关——
**含 `LISTING` 但不含 `IMAGE_PIPELINE` → 自动前置 `IMAGE_IMPORT`**（"不翻译直接上架"不需要新代码）。

---

## 二、逐段契约明细

### S1 · IMAGE_IMPORT / IMAGE_PIPELINE

| 项 | 内容 |
|---|---|
| 输入 | `input/<产品>/*.jpg|png|webp` |
| 输出 | `output/<产品>/*_en.jpg` + 最小 `product_info.json` |
| 关键规则 | 图片命名带槽位语义：`主图_NN` / `SKU 属性图_NN` / `描述图_NN`；同槽位形态优先级 `translated → original → review`（`assets_contract.py:75,112-116`） |
| 迁移判定 | **不迁**。OCR/LaMa/PaddleOCR 无 Node 等价栈；且一跨走的是「AI 生成 10 图」路线，语义不同 |

### S2 · LISTING（4 阶段）

| 项 | 内容 |
|---|---|
| 会话策略 | 每产品**新建独立标签页 + 临时聊天**（`?temporary-chat=true`），完事必关；绝不复用可见页面（`seo_core_kernel.mjs:254-264,788-791`） |
| 幂等 | 4 个**指纹字面量**写在每阶段 prompt 第一行，重跑时靠它判断"这步问过没有"（`contracts/ui/chatgpt.json:79-85`，注释明令不可改） |
| 图片 | 硬上限 5（代码）→ 配置 4 → 起跑再夹一次；选图按**用途优先级**（主图/规格/细节/变体/场景），不是文件名 |
| 硬护栏 | 阶段①若回复表明"看不到图片"→ **立即中止整条链**（`CHATGPT_IMAGES_NOT_ACCESSIBLE`），因为后续三步会全变编造 |
| 超时 | 单阶段 22min、正文稳定 6s 才收、3min 无进展判 stall、CDP 重试 4 次（全部在 `chatgpt.json:67-78`，不散落代码） |
| 自愈 | 内核可自愈 3 类错误 2 轮；临时聊天**禁 reload**，只原地按 Esc + 续跑话术 |
| 产物 | `01/02/03/04 *.md` + `listing_chat_audit.json`（每阶段落一次，**先写 RUNNING 再写终态**，否则超时 kill 会永远 RUNNING） |
| 迁移判定 | **已基本在一跨内**（`tools/seo_core_kernel.mjs` 237 行，3 阶段）。**缺口**：①独立 kernel 少了 `02 research` 阶段（主工作台 `automation-service` 有 `ensureResearch`，两套不一致）②无"图片不可读即中止"护栏 ③无审计先行 RUNNING 语义 |

### S3 · 解析层（`listing_contract.py`，407 行）—— 最被低估的一段

| 项 | 内容 |
|---|---|
| 做什么 | 把 `04_LISTING_CONTENT.md` 自由文本**解析成结构化字段**，产出 `listing_fields.json` |
| 标题提取 | 5 级降级：护栏 `<<<FINAL_TITLE_START>>>` → 5 条正则 → 标签行下一行 → 长度 126–128 取最后一个 → 「核算字符数：N」回看 4 行锚点打分 → 兜底取最长英文 |
| 描述区间 | 起点 5 条措辞 + 1 条**内容特征**（五点恒以 ✅ 开头）；措辞型起点必须**紧邻**首个 ✅（间距 ≤12 行，否则会命中 395 行外的同名小节） |
| 失配行为 | **故意返回空**。注释写明：早期兜底把整份工作文档（研究笔记、事实评分、内部警告）塞进了商品描述框 |
| 判死 vs 提示 | 提不到标题 / 定位不到区间 / 区间为空 → `ok=false`（阻断）；标题长度越界、无描述图 → 只 `warning` |
| 缓存自愈 | 读到 `listing_fields.json` 标题含 `<<<` 或为空且 04 存在 → 回源重解析并刷新（否则"解析器每升级一次就留一批永久卡住的产物"） |
| 迁移判定 | **A 类，优先级最高**。纯正则 + 无外部依赖，有离线测试（`tests/test_listing_titles.py`、`_verify/check_listing_contract.py`）可直接对照。一跨现在完全没有这一层 |

### S4 · ERP_PLAN（`erp_planner.py` 98KB）

| 项 | 内容 |
|---|---|
| 定位 | docstring 原文：`Build an evidence-backed Dianxiaomi draft plan without touching the browser.` —— **离线出计划，不开浏览器** |
| 产物 | `erp/field_plan.json`（13 个一级 key）：`product / inputs / input_fingerprint / field_plan[] / sku_plan / description_plan / title_gate / status / blockers / limitations / operation_selection` |
| 字段动作 7 档 | `FILL` / `FILL_WITH_REVIEW` / `PRESERVE_OR_VERIFY` / `MISSING_SOURCE` / `SKIP` / `REVIEW` / `DISCOVER_ON_PAGE` |
| 核心创新 | `sku_plan.rows`（商家表原始行，可审计）与 `sku_plan.write_rows`（实际写入值）**分开存**——原值永不被覆盖 |
| 幂等 | `input_fingerprint = sha256(inputs+title+profile+sku_rows+write_rows+facts+field_plan+description_plan)`；指纹相同直接复用计划，不进浏览器 |
| 确定性 | 无网络、无 LLM、词典内嵌、pydantic 旁挂自检（失败只进 `limitations` 不拦写盘）。给定同样输入，`field_plan.json` 是确定的 |
| 关键取舍 | **只有"根本没素材/无法命名"才阻断**；标题长度、材质缺失、主图偏少一律降级为 review/attention |
| 迁移判定 | **A/B 混合，第二优先**。骨架（key 结构、action 七档、指纹、门禁分级）可原样搬；`_package_spec`（+20g 包装、20×15×12 箱规）、`WDZAI` 编码前缀、`杭州JIT库存=50`、颜色/主题词典（600+ 条）**必须按一跨品类重定** |

九道门禁（迁的时候要逐个决定要不要）：

| Gate | 判据 | 一跨是否已有等价物 |
|---|---|---|
| G1 资料包结构 | `product.folder` 含路径分隔符即抛 | ❌ |
| G2 上游 Listing 阶段 | `listing_generation.json` 是 ERROR/TIMEOUT **且**复算 04 不 ok | 🟡 有 run-state，但无"复算"判据 |
| G3 SKU 表可用 | 缺列/双币种歧义/行重复 | ❌ 一跨无 SKU 表装载 |
| G4 主图 | `usable < 1` 阻断；`MAIN_IMAGE_MIN=6` 只分级告警 | 🟡 有产品图校验，无三档分级 |
| G5 买家描述 | `description_plan.lines` 为空 | ❌ |
| G6 变体可命名 | 任一行落到 `Variant N` | ❌ |
| G7 同包重名 | 消歧后仍重名 | ❌ |
| G8 变体全筛光 | 门槛过滤后为空 | ❌ |
| G9 标题长度 | 126–128，**不进 blockers**，只触发 1 次 Listing 重跑 | ❌ 这是最典型的缺口 |

### S5 · ERP_DRAFT

| 项 | 内容 |
|---|---|
| 执行器 | `node dianxiaomi_draft_executor.mjs --plan field_plan.json --out erp/live_draft_run --commit`，25 步 |
| 核心设计 | **写后回读三态**：`VERIFIED` / `MISMATCH`（抛）/ `UNREADABLE`（按字段决定抛或只记 attention）。注释点明根因："写入动作与确认动作被分开写，每次都是个案修复" |
| 幂等四层 | ①计划指纹命中 + `prior.status` 是 DRAFT_VERIFIED 且有 `draft_id` → 直接归档不进浏览器 ②有 `edit_url` → 走更新不新建 ③保存后反查待发布列表拿 `rowid`/`edit_url` 作下一轮锚点 ④`SAVE_UNKNOWN/SAVE_UNVERIFIED` 不自动重试（避免造出第二条） |
| 绝不发布 | 运行时只有"保存"一个写动作；另有静态守卫 `_verify/check_no_publish_action.py` 用 4 条正则扫源码，且**守卫自带正反自检**（4 个应响 + 3 个不该响，撞错方向就以退出码 2 拒绝给结论） |
| 迁移判定 | **不迁**。一跨 `dianxiaomi-adapter.js` 4248 行更完整。但要**借两个原语**：三态回读判定函数（纯函数，已有单测 `tests/test_executor_act_verify.mjs`）、"绝不发布"静态守卫思路 |

---

## 三、一跨现状对照

| 能力 | ecom | 一跨现状 | 差距 |
|---|---|---|---|
| 图片翻译（OCR/擦字） | ✅ Python | ❌ 走 AI 生成 10 图 | 语义不同，不迁 |
| 1688 采集 → 产品包 | ✅ `collector/` | 🟡 `1688_import/` 有素材，无 ingress 流程 | 另立项 |
| Listing 4 阶段 | ✅ 797 行内核 | 🟡 237 行内核（3 阶段）+ 主工作台有 research | **两套不一致** |
| ChatGPT 会话治理 | 临时标签 + 指纹 + 自愈 + 审计 | 🟡 有指纹/续跑，无审计先行/图片护栏 | 中 |
| **04 结构化解析 + 标题门禁** | ✅ 407 行 | ❌ | **关键缺口** |
| **ERP_PLAN（计划层 + 门禁）** | ✅ 98KB | ❌ facts 直接怼浏览器 | **关键缺口** |
| **SKU 表装载 / 变体命名 / 重名门禁** | ✅ | ❌ `variants` 由 AI 或表格临时产出 | 关键缺口 |
| 店小秘写入 | ✅ 25 步 | ✅ 更强（采集箱/批量/颜色图/包装尺寸/新编辑器） | 一跨领先 |
| 写后回读三态 | ✅ 统一原语 | 🟡 有 act-verify，粒度未统一 | 中 |
| 幂等 | 计划指纹 + edit_url + 反查 | 🟡 批量 5min 窗口 + djb2 指纹 | 中 |
| 失败分类 | `RETRYABLE/DATA_GATE/MANUAL` | ❌ 只有 stage/error 字符串 | 关键缺口 |
| 审计台账 | `issue_ledger` + 指纹聚合 | 🟡 run-state / progress-manifest | 中 |
| 定价/利润 | ❌ 只透传供货价 | ❌ 无 | 两侧都缺 |

---

## 四、迁移判定矩阵

### A 类 · 纯逻辑，直接搬（零浏览器依赖，可单测）

| 能力 | 源 | 落点建议 | 价值 |
|---|---|---|---|
| 04 → 结构化字段解析（标题 5 级降级 + 描述区间） | `listing_contract.py:121-367` | `dist/src/listing-contract.js` | ⭐⭐⭐ 让标题/描述第一次有机器判定 |
| 标题门禁 126–128（不进 blockers，触发 1 次重跑） | `listing_contract.py:49` + `erp_operations_runner.py:747-880` | 同上 + 重跑钩子 | ⭐⭐⭐ |
| 多段回复挑选 `pickReplyText` | `seo_core_kernel.mjs:543-559` | 一跨 kernel | ⭐ |
| 回读三态判定 `sameValue/commitState` | `dianxiaomi_draft_executor.mjs:353-395` | 统一到一跨 act-verify | ⭐⭐ |
| 枚举回读优先级 `pickEnumReadback` | 同上 `:284-286` | 同上 | ⭐ |
| 主图槽位解析 + 三档缺失分级 | `assets_contract.py:49-176` | 一跨图片清单 | ⭐⭐ |
| 库存门槛 + 变体上限（保序择优） | `erp_planner.py:1140-1175` | 新 SKU 模块 | ⭐⭐ |
| 变体命名消歧机制（组内差异符） | `erp_planner.py:870-1002` | 新 SKU 模块 | ⭐⭐ |
| 失败三分类 `RETRYABLE/DATA_GATE/MANUAL` | `erp_operations_runner.py:111-118` | run-state 扩展 | ⭐⭐ |
| 输入指纹幂等 | `erp_planner.py:1419-1422` | 通用 | ⭐⭐ |

### B 类 · 表驱动，结构可搬数据必换

| 能力 | 为什么不能照抄 |
|---|---|
| `erp_profiles.json` 字段骨架 + `classification(A/C)` | 机制（"页面字段清单 + 哪些必须页面读回"）可保留；字段名与店小秘创建页绑定，需按一跨 profile 重录 |
| SKU 列名别名表（15 类） | 换商家表就换这张表 |
| 颜色词典 `_COLOR_MAP`（~60 条）/ 主题词典 `_THEME_MAP`（200+ 条） | 机制是"长度倒序、命中即消费"；内容高度绑定箱包挂件品类 |
| `_package_spec`（+20g / 20×15×12 / 兜底 0.12kg） | 全是店小秘 + 该品类实测结论 |
| 素材材质别名白名单 | 保留机制，替换词表 |

### C 类 · 不迁（迁了是负收益）

| 能力 | 理由 |
|---|---|
| OCR / LaMa / PaddleOCR / Ollama 翻译 | 无 Node 等价栈；且一跨走 AI 生成图，不翻译原图 |
| 店小秘 executor 25 步 | 一跨 `dianxiaomi-adapter.js` 4248 行更成熟（采集箱、批量、颜色图、包装尺寸、新版编辑器、通知弹窗永久压制） |
| `collector/`（AliPrice 采集） | 依赖独立 Chrome profile + 扩展人工安装，属另一条线 |
| monthly_release / learning_dashboard / growth 案例库 | 与一跨 OS 的 Gate/复盘职责重叠，应由 OS 统一，不应复制第二套 |

### D 类 · 两侧都没有，属新增

- **定价/利润模型**：ecom 全仓 grep `毛利率|佣金|汇率|定价系数|profit_margin` 零命中，因为 Choice 半托管商家侧只报供货价。要算利润是**新模块**，不能从现有代码反推。

---

## 五、顺序依赖（不按这个顺序会返工）

```
① 统一 facts 契约（3 份 → 1 份）
      ↓ 否则 field_plan 建在多份真相上
② 迁解析层（04 → listing_fields）+ 标题门禁
      ↓ 否则计划层拿不到可信标题/描述
③ 迁计划层（field_plan + 门禁分级 + 指纹）
      ↓ 否则"资料不齐硬冲浏览器"会继续
④ SKU 表装载 + 变体命名/重名门禁
      ↓ 否则计划里的 sku_plan 是空的
⑤ 失败三分类 + 审计先行
```

**①是硬前置**：`docs/PRODUCT_LISTING_WORKFLOW.md` 已实测记录——`variants` 三份定义导致每次稳定 9 条 `SCHEMA_INVALID`，且任一条 `fixable:false` 就把整轮自纠错短路（`autoFixLog` 实测为空）。在这个状态下搬计划层，只会多出第四份定义。

---

## 六、三个切口方案（按 ROI）

| 方案 | 内容 | 改动面 | 收益 | 风险 |
|---|---|---|---|---|
| **P1 只迁解析层**（推荐先做） | `listing-contract.js` + 标题门禁 + 描述区间判定，挂在现有 `04_LISTING_CONTENT.md` 之后 | 1 个新模块 + 2 处调用 | 标题/描述第一次可机器判定；可独立单测对照 ecom 的 407 行 | 低。纯新增，不改现有链路 |
| **P2 迁计划层** | `field_plan.json` 契约 + 门禁分级 + 指纹复用，作为 `dianxiaomi-adapter` 的上游 | 1 新模块 + adapter 入参改造 | 资料不齐时**不开浏览器**；重复跑可复用不重建草稿 | 中。要改 adapter 入参，且必须先做① |
| **P3 全链复制** | 连采集 + 翻译一起搬 | — | 形态最完整 | 高，且 OCR 栈迁不动，会变成半拉子 |

建议：**P1 立即做（1 天内可验证），P2 经过一次 Gate 评审再做**。店小秘那侧完全不动。

---

## 七、风险与红线（迁移时逐条核对）

1. **指纹字面量不可改**——4 条指纹一改，所有在跑批次全部重跑已完成阶段。一跨现有值 `FP_FACT/FP_SEO/FP_LISTING` 与 ecom 一致，但**一跨少了 `FP_RESEARCH`**，加阶段时要补同一字面量。
2. **标题 126–128 是自有 SEO 规范，不是平台强制**。迁进一跨后若进 blockers，会把产品永久卡在 REVIEW（ecom 正因 `erp_operation_center.py:391` 的队列语义才刻意不拦）。**一跨要明确：违规只触发重跑，不阻断上架。**
3. **主图口径在 ecom 内部就不一致**：planner 用 `<1` 阻断、`assets_contract` 用 `MAIN_IMAGE_MIN=6` 分级、`tools/verify_draft_plan.mjs` 按 `<6` 报 BLOCKED。迁移前先定**一个**常量。
4. **`preamble_max_chars=300`**（开场白 vs 正文分界）与 **`description` 区间失配返回空** 这两条都是事故修复，不是可调参数。
5. **错误码字符串是契约**：`CHATGPT_*` / `SAVE_UNKNOWN` / `SAVE_UNVERIFIED` / `REMOTE_DRAFT_NOT_FOUND` 在 Python 侧用 `in str(...)` 匹配，改名会静默失效。跨语言迁移时同样成立。
6. **审计必须先写 RUNNING 再写终态**，早退路径必须回报进度（ecom 有两次真实事故：41→13、68→32、72→3 的静默缩水）。
7. **`persist=False` 语义**：任何"它可用吗"的检查都不得改写被检查的产物。一跨做体检类接口时同样要守。

---

## 八、一页速查（给决策用）

```
迁（A/B）  解析层 / 标题门禁 / 计划层骨架 / SKU 表装载 / 变体命名 / 失败三分类 / 三态回读 / 输入指纹
不迁（C）  OCR 与翻译 / 店小秘 executor / collector / monthly_release 与学习闭环
新增（D）  定价与利润模型（两侧都没有）
硬前置    先统一一跨 facts 的 3 份定义
先做      P1 解析层（纯新增、可单测、当天可验）
后做      P2 计划层（需 Gate 评审，且依赖 P1 与 facts 统一）
```
