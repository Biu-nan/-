# 一跨 AI·OPC 经营 OS · 工作台档案

> 更新时间：2026-11-10（Asia/Shanghai）｜ 演进阶段：需求盘点（方案 A 已选定，进入落地前置收口）
> 本文件是「工作台搭建档案」，**不是开发授权、不是实施记录、不修改任何现有代码或协同文档**。
> 权威顺序：`docs/coordination/2026-10-25-confirmed-product-positioning.md`（定位）→ `docs/superpowers/specs/2026-10-26-ceo-os-operating-loop-design.md`（闭环与 B0–B15 验收）→ `yikuaborder_OPC_ultimate_blueprint_V1.0_RC1.md`（2026-10-29 Human 签署冻结的 V1.0 ultimate-goal baseline）→ `docs/SYSTEM_FRAMEWORK_v1.0.md`（L2/L3 技术规范，其 §0.4 为最高约束）。

> **当前备份位置**：`F:/yikuaborder-backups/2026-11-10_0735/` — 2026-11-10 白名单备份，**1205 文件 / 37,709,369 字节，逐文件 SHA-256 1205/1205 全匹配（0 不一致）**。清单 `manifest.csv`（SHA-256 `13B2120B…B7B`），回执 `BACKUP_RECEIPT.md`。范围：`CEO agent/` 全目录、`config/` 全目录、两份新建文档、今日日志、2 个已修改的 `nawu-fetch` 文件；**不含** `.git/`、`node_modules/`、`dist/`、`public/`、`data/` 与根目录运行态 JSON。备份在项目外，未做 git 写操作。

## 1. 使用场景

- 解决什么问题：把「用户 → CEO Agent（对话入口）→ 一跨 OS（可视化工作流 / 执行 / 人工接管）」的经营闭环跑通，实现目标 → 阶段 → 今日任务 → 执行结果 → 效果复盘的追溯。
- 给谁用：经营者（Lance / Human）为最终决策人；CEO Agent 负责判断与组织；一跨 OS 负责记录、执行与接管。
- 触发频率：日（今日安排 / 日终核对）、周（复盘）、月（结构盘点）、事件（活动规则变化 / 任务失败 / 审批到达 / 供给异常）。具体频率与免打扰策略尚未初始化。
- 首期范围：单店（环境 ID 400370）、一类经营目标、一个真实活动或普通经营周期。目标为 2026-12 每日支付商品 ≥200 件、月经营净利润 ≥¥12000（件数≠订单数；平台 net≠净利润）。

## 2. 页面清单

| 名称 | 类型 | 入口 | 用途 | 状态 |
|---|---|---|---|---|
| 系统总账面板 | 页面 | 今日驾驶舱首屏 / `GET /api/system/state` | 只读聚合 WorkUnit / Gate / 异常 / 陈旧源 | F1 已交付（19/19 + 面板 10/10） |
| 今日驾驶舱 | 页面 | `localhost:3000/#今日驾驶舱` | 已有任务与审批演练位置 | 已有，非统一写任务引擎 |
| 经营总览 / 日历 / 今日执行 / 待你决定 / 决策与复盘 | 页面（五视角） | 蓝图 §11 定义 | 目标差距、活动硬截止、任务证据、审批、复盘 | 设计建议，未审定 |
| Taskboard | 页面 | 图 v0.2 目标形态 | 周期性任务中枢与执行反馈 | UNKNOWN，无已验证实现 |
| CEO Agent 对话入口 | Agent | 本机 CEO 会话（Codex/local，01a17fa5…） | 诊断 / 取舍 / 编排 / 跟进 / 复盘 | 单入口只读读取通过；自动唤起 / 写入 / 审批 / 执行未验收 |
| 8 个专业 Agent + Agent Doc | Agent | 图 v0.2 目标形态 | 商品 / 流量 / 库存 / 运营 / 财务 / 客服 / 数据分析等 | 与蓝图 §14「首期一个 CEO，不先建部门 Agent」冲突；建议先做能力注册表 |

> 平台环境假设：本项目自建 Node 22 ESM + Express + SQLite + WorkBuddy 桌面 + 本地 Chrome CDP :9223，**不是 Coze / Dify / 飞书**。图中未标注平台，此处按项目事实假设；涉及外部平台按钮名、字段名、接口名一律「需以平台文档与实际代码核实」。

## 3. 数据源清单

| 数据源 | 类型 | 关键字段 / 载体 | 同步方式与频率 | 备注 |
|---|---|---|---|---|
| 系统状态载体（7 个） | 文件 / SQLite | `run-state.json`、`batch-listing-state`、`collect-batch-state`、`charm_listing_jobs`、`data-collection-tasks`、`daily-waiting-items`、`queue-state` | 只读聚合，15s 独立轮询 | F1 总账已映射；字段以现有代码为准 |
| 经营事实 facts | 文件 / 字典 | `config/metrics-schema.json`、`scripts/fetch-ae-metrics.mjs`、`stratify-products.mjs` | append-only facts，指标每次重算 | 框架 §10 红线：指标永不入库为唯一真相 |
| 商品与目录 | 文件 | `<产品>/{产品图,output,product-facts.json,product-profile.json}` | 按需 | 产品图仅源图、output 仅 AI 产物 |
| 店小秘 / 速卖通 / 稳卖 | 外部系统 | 经 `dianxiaomi-adapter.js`、CDP :9223、稳卖浏览器 API | 定时 / 手动，频率未初始化 | 字段名需实测；存在口径陷阱（支付件数 2302 vs 商品分析 64；`sellableQuantity` 是平台可售额度非物理库存；日切北京 15:00–17:00 归零须跳过） |
| 协同任务队列 | 本地 API | `POST /api/agent/intake-task` | poll-on-user-turn，无 push | 自动额度接续未验证 |

> 字段以现有代码与用户提供的字典为准，本档案不新增或臆造业务字段。缺失数据 → `null + reason` + 显式 `DATA_STALE`，不用上一周期值填充。

## 4. 自动化规则

| 规则 | 触发条件 | 执行逻辑 | 异常兜底 |
|---|---|---|---|
| 经营闭环 L0–L8 | 目标 / 到期 / 事件 | 初始化 → 更新日历与事实 → 判断取舍 → 倒排计划 → 今日任务 → 推进与授权 → 核验执行 → 日终与次日 → 效果复盘 | 闭环稿 §6.3 异常表：结果未知先回读不重试；超时不自动放行；重启先核对不从头重跑 |
| 动作前检查 | 任何能力调用 | 身份 / 店铺范围 / 能力已验证程度 / 输入版本 / 资源占用 / 幂等键 / 有效授权 / 预算 | 任一不满足即拒绝并留审计；聊天与网页同一判定 |
| Gate | P3+ 动作 | 绑定对象 / 动作 / 参数摘要 / 版本 / 有效期；`defaultIfIgnored = stall` | 超时绝不放行；不因版本号未变忽略内容变化 |
| 节拍 + 阈值 | 日 / 周 / 月 / 指标越界 | 生成 WorkUnit 工单 | 日扫紧急工单上限 3 条；同 SKU 同类型 7 天不重复；告警去重 |
| 人工接管 | 用户请求或急停 | 停止派发 → 在安全点结束在途动作 → 交出占用 → 人工留证 → 重读状态再继续 | 急停不撤销已发生的外部效果 |

> MVP 最简流程（先跑通，不铺 8 层）：用户目标 → CEO 判断并建 WorkUnit → Taskboard 今日任务 → 动作前检查 → Gate → Capability 调用 → 执行回读 → **待核验** → 完成 → 日终 Review。P3+ 全部人工，不可逆动作不进 MVP。
> 不引入 Temporal / LangGraph / 多个部门 Agent（闭环稿 §1 明确）。

## 5. 权限说明

- 可查看 / 可编辑：经营者为最终决策人；Codex 与 WorkBuddy 为共同开发者，同一任务只有一个当前修改者。
- 副作用分级（代码强制，不写在提示词里）：P0 纯读 / P1 写本地事实 / P2 生成本地文件 / **P3 改平台草稿需人批** / **P4 改价改库存需人批+上限** / **P5 发布上架必须人点** / **P6 删除清空每次单独确认**。
- 密钥与凭据存放位置：本机 Chrome profile 与现有 CDP 登录态、本机 git 凭据管理器、环境变量／安全配置；**本档案不记录任何密钥值、令牌或金额**。不把现有工作台直接公网暴露。
- 当前授权边界（2026-10-29 签署记录）：仅 G1 只读安全核验与隔离环境准备评估。不得修改应用源码、防火墙、服务配置、数据库、任务状态或 Git 元数据；不得测试／启动／重启服务或发送业务请求。
- 未授权项：`CAPABILITY_REGISTRY_DRAFT.md` 的 `autoApproveWithin`、P5 能力注册、`planned` / `unverified` 能力一律不可自动执行。
- 协同红线：`docs/coordination/` 的 README / CODEX_STATUS / delivery-receipt / evidence-index 由 Codex 维护，不可改；备份须白名单 gitignore + 只 add 列明路径；git 写操作需另行授权。

## 6. 待优化项

- [ ] 蓝图 v0.1 / 闭环稿 v0.1 标「待审定」；`SYSTEM_FRAMEWORK_v1.0.md` §0.4 明确 F1–F5 顺序已被取代、不构成开工依据 → 需先出共同开发计划并经 Human 审定。
- [ ] 三个框架缺口（框架 §7）：无统一 WorkUnit、无 Capability Registry、无统一 Gate。数据层不是缺口。
- [ ] 七态差异（框架 §0.6）：现有 7 态缺一等状态「待核验」，受阻只表达「等人」；闭环稿要求含人/数据/依赖/资源四因。`dist/src/system-state.js` 映射继承该简化，修法须在开发计划内排期。
- [ ] 入口自动唤起 / 双入口身份接续 / 无人值守未验收（闭环稿 §7、验收 B0 / B12 / B14）。两个经营入口只有一个负责当前经营循环。
- [ ] facts 契约 3 份 `variants` 定义导致稳定 9 条 `SCHEMA_INVALID`；迁 ERP_PLAN 前必须先统一。
- [ ] 数据口径：件数≠订单、`sales.amount.net`≠净利润、`conv.rate` 单位%、可售额度≠物理库存；观察窗与样本要求未初始化。
- [ ] 学习进化层（反馈 → 经验 → 更新 Doc / Workflow / 模型）目前为真空；复盘结论入库未建。
- [ ] 8 条 Workflow / 8 个专业 Agent 与已定路线冲突，需先裁决「先能力注册还是先 Agent 化」。
- [ ] **状态漂移**（11-10 巡检）：`docs/coordination/README.md` 仍标 10-26「方案阶段」，实际已有 11-05 CEO V1.0 设计基线、G0/G1 隔离候选与 G2-B4 隔离对话路由；需独立文档收口，不改 Codex 维护文档。
- [ ] **绑定类 UNVERIFIED**：正式 CEO Taskboard 路径与启动所有者、正式日志唯一写入者、`metrics-schema.json` 1.1.0 版本冻结、G2-B4 §7 六项 Human 审批。
- [ ] **主目录三块骨架缺失**：`config/capabilities.json` / `dist/src/capability-registry.js` 不存在；`stall` 仅在 `system-state.js` 展示层；「待核验」尚未成为 WorkUnit 一等态。隔离候选中的 `ceo-capabilities.v1.json` + `ceo-governance.js` 需收敛合并，不得另造第二套。
- [ ] **26 项历史全量失败**（446/472），含 2 项 CEO draft CLI 契约不一致；按使用范围裁决先修或明确延期，不得弱化断言制造全绿。
- [ ] **上品写链未解锁**：主目录 `dist/src` 对 `withCdpLock` / `cdpLockFile` / `buildProductionListingWorkerHost` 零匹配，REAL 禁用（需现地复核）；故方案 A 垂直闭环建议改选只读日诊场景。
- [ ] 完整落地前置清单见 `docs/PLAN_A_LANDING_GATES_2026-11-10.md`（DRAFT，待审定）。

## 7. 变更记录

| 日期 | 变更内容 | 原因 |
|---|---|---|
| 2026-11-10 | 首次建档：依据用户提供的「一跨 AI·OPC 经营 OS v0.2 升级版」架构图，对照项目内定位 / 闭环 / 框架 / 签署记录 / 能力草案，输出 8 层现状映射、四阶段落地路线、MVP 流程与治理红线；未修改任何代码或既有文档 | 用户询问「如何实现图中一跨 OS」；需要可追溯的搭建基线与下一轮迭代锚点 |
| 2026-11-10 | 第二轮：用户选定方案 A（最小闭环型）。完成只读巡检并修正上一轮状态判断（项目已到 G2-B4 隔离候选，非纯文档阶段）；产出 `docs/PLAN_A_LANDING_GATES_2026-11-10.md` 五组必要动作、关键路径、最短可落地集与 UNKNOWN；更新待优化项 | 用户询问「离落地还有哪些必要动作、解决什么问题」；需把「落地」拆成可验收的前置条件 |

---

### 附图层 → 现状映射（速查）

| 图层 | 图 v0.2 | 项目现状 | 判定 |
|---|---|---|---|
| 经营目标层 | Human(Anna) / 年度阶段目标 | 首店 400370、12 月目标、人力 300min/日已确认 | 已有，口径待核准 |
| 交互入口层 | WorkBuddy ↔ CEO Agent | 本机 CEO 会话已建，只读读取通过 | 半通，最大缺口 |
| 经营决策层 | CEO 驾驶舱 6 步 | L0–L8 + C1–C5 已设计，隔离分支有薄 CLI | 设计就绪，未审定 |
| 专业能力层 | 8 Agent + Agent Doc | 14 域 / 140 路由 + 20 条能力草案 | 与蓝图冲突，先注册能力 |
| 业务执行层 | Workflow Hub + Taskboard | LISTING 3 段 + 店小秘写入层 + F1 总账 | 有流程无统一载体 |
| 数据与业务层 | 9 个外部系统 | facts 管道 / 指标字典 / CDP 已跑通 | 相对最成熟 |
| 学习进化层 | 反馈 → 经验 → 更新 | `knowledge_pending_review` 弱 | 真空 |
| 经营结果与价值 | 6 类指标 | 三层效果评价已设计，未验收 | 未验收 |
