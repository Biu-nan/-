# 方案 A（最小闭环型）· 落地前置清单与开发计划草案

> 日期：2026-11-10（Asia/Shanghai）｜ 状态：**DRAFT / 待 Human 审定，不构成开工授权**
> 本文件基于 2026-11-10 的**只读巡检**（Glob/Grep/Git status/文档阅读）编制，未修改任何代码、配置、运行态数据或 `docs/coordination/` 下 Codex 维护的文档。
> 关联档案：`docs/WORKBENCH_ARCHIVE_yikua-os.md`。权威顺序见该档案抬头。

---

## 0. 结论与状态勘误

**核心判断**：方案 A 离落地的第一障碍**不是"还缺多少代码"，而是"已有成果全部停在隔离候选、未绑定、未核准、未授权"**。

上一轮答复依据 10-25/10-26 的定位、蓝图与闭环稿，判断"处于方案阶段、底座只有 F1 只读总账"。**该判断需修正**：

| 项 | 上一轮判断 | 11-10 巡检后的事实 |
|---|---|---|
| 设计基线 | 10-25 定位为最高权威 | 2026-11-05 用户已确认《CEO Agent V1.0 正式设计基线》（`CEO agent/CEO_Agent_V1.0_Baseline_Audit_20261105.md`），明确「统一 CEO 核心 + WorkBuddy 入口 + 本地 Runtime + 一跨 OS 承载 Workflow/Taskboard/审批/运营轨迹」，上线验证为 **影子 → 受控 → 正式**，每次转换需真实证据与 Human 验收 |
| 工程进度 | F1 只读总账已交付，其余为草案 | G0/G1 隔离候选已交付并有条件验收（专项 55/55、相关 142/142、可靠性 45/45；全量 446/472，26 项历史失败保留）；G2-B4 隔离对话路由 173/173、4 次真实 HTTP、最新批次 14/17 PARTIAL |
| 主目录状态 | 未核实 | 主目录**没有** `config/capabilities.json`、`dist/src/capability-registry.js`；候选里的 `config/ceo-capabilities.v1.json` + `ceo-governance.js` 只存在于 `.worktrees/ceo-g0-g1-20261105` 等隔离树 |
| G1 安全 | 10-29 审批单五项未批准 → 视为当前阻塞 | 10-29 审批单是历史时点；11-05 已有 `CEO_Agent_V1.0_G0_G1_Implementation_Report.md` 与 `G0_G1_Closure_And_G2_Readiness_Report.md`。**但两者结论同为"未合并、未部署、等待 Human 下一阶段授权"** → 阻塞性质从"未批准"变为"未验收/未授权"，仍需动作 |
| 协同入口 | 10-26 标"方案阶段，不据旧任务授权新增开发" | `docs/coordination/README.md` 仍停在 10-26 表述，与实际 G2 进度存在**状态漂移**；该文档由 Codex 维护，本计划不修改它，改用独立文档收口 |

**当前档位**：影子档的隔离验证基本完成，**尚未进入「受控」档**。

---

## 1. 「落地」的可验证定义

不写成"代码开发完成"。方案 A 落地 = 同时满足：

1. 一条**真实垂直闭环**在 Human 批准的范围内跑通：目标 → 阶段 → 今日任务 → 动作前检查 → 执行 → 回读 → **待核验** → 完成 → 日终复盘。
2. **对话与网页同源**：同一对象 ID / 版本 / 状态 / 证据链（B5）。
3. **离线可接续**：无用户消息时由已验证的唤起通道推进，或明确标注"仅可接续经营"而非主动经营（B0 / B14）。
4. **P3+ 全部人批**：发布、改价、采购、删除不被自动化绕过；Gate 超时只 `stall`。
5. 有**不依赖实现者假设**的独立交叉验收证据（B 组 MVP 子集）。
6. 完成不等于经营改善：执行完成与经营效果分两个状态面记录（B13）。

---

## 2. 当前事实基线（巡检证据）

| 核查项 | 结果 | 证据 |
|---|---|---|
| 主目录能力注册表 | ❌ 不存在 `config/capabilities.json`、`dist/src/capability-registry.js` | Glob `config/*`（7 个 json，无 capabilities）；Glob `dist/src/{capability-registry,system-state,gate*,workunit*}.js` 仅命中 `system-state.js` |
| 统一 Gate | ❌ 无独立模块；`defaultIfIgnored:"stall"` 仅出现在 `system-state.js` 展示层；`storyboard-gate-service.js` 是分镜业务门禁 | Grep |
| 「待核验」状态 | ⚠️ `PENDING_VERIFICATION` 命中 `product-identity-service.js` / `server.js`，但语义为**店铺身份核验**（`STORE_VERIFICATION`），**不是 WorkUnit 执行态** | Grep；框架 §0.6 已登记 7 态缺「待核验」 |
| CDP 锁（上品写链） | ❌ 主目录 `dist/src` 对 `withCdpLock` / `cdpLockFile` / `buildProductionListingWorkerHost` **零匹配** | Grep；与项目记忆中「B1 修复在 worktree 未合并、R-02 19 入口无锁、REAL 保持禁用」一致 |
| 验收脚本 | ⚠️ `scripts/*.mjs` 当前仅 3 个（identity 相关）；F1 的 `verify-system-state.mjs` / `verify-ledger-ui.mjs` 未见于主目录 scripts | Glob；11-05 tracked tree 曾重建（`d60538c`），需复核是否属重建范围 |
| Git 基线 | 分支 `feature/ykb-v1-phase1-identity-state`；HEAD `d60538c` "rebuild: reconstruct the tracked tree…"，tag `sanitized-20261105` | `git status --short` / `git log -1`（只读） |
| 未跟踪资产 | ~70 个 `CEO agent/*` 报告与证据目录、`config/ops-stores.json`、`docs/WORKBENCH_ARCHIVE_yikua-os.md`；`nawu-fetch` 2 个已修改文件 | `git status --short` |
| 指标字典 | `config/metrics-schema.json` 1.0.0 → 1.1.0，23 → 33 口径，新增 10 个 `market.*`；原 23 项定义未改；具体写入者 UNVERIFIED | `G0_G1_Closure_And_G2_Readiness_Report.md` §3 |
| 运行服务 | 11-05 时点：3000 = PID 18656 / `0.0.0.0:3000` / watchdog 启动；3173 无监听 | `CEO_Agent_V1.0_G0_G1_Implementation_Report.md` §2（**历史时点，本轮未重新探测**） |
| G2-B4 状态 | 隔离对话路由接通，`authority=NONE`、`productionWiringEnabled=false`、`formalContextStatus=NOT_ELIGIBLE`；Human UNAPPROVED；店铺身份 UNVERIFIED；最新批次 14/17 PARTIAL，3 项库存 `FIELD_MISS`，金额 `UNVERIFIED_PERIOD` | `CEO_G2B4_Integration_And_Approval_Readiness_Report.md` |
| 全量测试 | 472 总计 / 446 通过 / **26 项历史失败**；其中 2 项 CEO draft CLI 契约不一致（inspect 期望 capacity=null 实际 300；save-draft 返回 INVALID_DECISION、退出码 1） | G0/G1 收尾报告 §5 |

> 口径实证（11-09 单品诊断）：`sales.qty.pay` ≠ `sales.qty.physical` ≠ `sales.suborder`，三者相差 2.8–11 倍；`sales.amount.net` ≠ 净利润；平台 PST 与北京业务日界不同。混用必错。

---

## 3. 五组必要动作（按依赖顺序）

### 第 0 组 · 状态收口与授权（阻断性；不做完不能动主目录代码）

| # | 必要动作 | 解决什么问题 | 最小产出与证据 | 当前状态 |
|---|---|---|---|---|
| A1 | 建立**单一当前状态真相**：盘点所有 worktree / 分支 / 未跟踪资产 / 已交付候选，标明哪份是权威 | 协同 README 停在 10-26「方案阶段」，实际已到 G2-B4 → 双开发者按不同版本各干各的、据旧任务开工、重复开发、第三套平行真相 | 一份独立状态盘点（**不改** README / CODEX_STATUS / delivery-receipt / evidence-index，它们由 Codex 维护）；逐树 HEAD + 关键文件 hash | ❌ 未做 |
| A2 | Human 验收 G0/G1 隔离候选，并**明确批准 G2 准入与后续范围** | 所有成果停在未提交 worktree，主目录一行未变；G1 收尾报告 §6.1 明确「Human 下一阶段授权 = 当前未批准」 | 验收回执：接受/退回 64 路径候选、精确 hash、批准的文件边界与下一步 | ❌ 未批准 |
| A3 | 白名单备份与冻结点重建 | git 里 75 条未跟踪顶层条目展开后为 1192 个文件；字典 1.1.0 未提交、多树未合并；11-05 已有一次 tracked tree 重建 → 证据丢失风险 | 白名单清单 + 逐文件 SHA-256 + 回读一致；**禁 `git add .`** | ✅ **2026-11-10 已完成**：`F:/yikuaborder-backups/2026-11-10_0735/`，1205 文件 / 37,709,369 字节，**1205/1205 哈希匹配**；`manifest.csv` + `BACKUP_RECEIPT.md`。git 写操作、合并、服务启停仍未授权 |

### 第 1 组 · 绑定权威（不是开发，是「指定唯一」；B5/B7 的物理前提）

| # | 必要动作 | 解决什么问题 | 当前状态 |
|---|---|---|---|
| B1 | 指定**正式 CEO Taskboard** 的准确路径、启动配置、服务所有者、唯一写入者、备份恢复责任 | 3173 无监听；`formalTaskboardPath=UNVERIFIED`；历史候选库不得升格为正式库，也不得建空库冒充健康 → 对话与网页看不到同一份状态（B5 不通过） | UNVERIFIED |
| B2 | 冻结并核准 `metrics-schema.json` 的**精确版本**（1.1.0 / 33 口径）与来源授权 | 字典字节进 `contextId` 哈希，版本一变旧 Context 与旧批准失效；注册 ≠ 业务事实核准；旧进程可能缓存旧字典 | 待 Human 决定 |
| B3 | 指定正式日志 / 反馈的唯一写入者，把网关去重从**进程内存**改为持久化并验证重启/并发 | 重启后重复请求可能重放、人工反馈丢失（B7 不通过）；`json-write-queue.js` 是模块内 Map，不是跨进程锁 | 未接线 |
| B4 | 完成 G2-B4 §7 的 **6 项 Human 审批**：店铺权威 shopId 与所有者证明、来源契约（字段/单位/期间/时区/覆盖/新鲜度）、核准人权威、正式 WorkBuddy 入口身份、既有存储所有者、部署范围 | 最新批次 14/17 PARTIAL、3 项库存 FIELD_MISS、金额 UNVERIFIED_PERIOD、`authority=NONE` → 数值不能当有效经营事实，CEO 结论无依据 | 6 项均未批准 |

### 第 2 组 · 主目录三块骨架（真正要写的代码，必须在 A/B 之后）

| # | 必要动作 | 解决什么问题 | 当前状态 |
|---|---|---|---|
| C1 | 把隔离候选的 `config/ceo-capabilities.v1.json` + `ceo-governance.js`（默认拒绝、100+ 可变路由前置鉴权）**收敛合并**到主目录，统一为一套 Capability Registry + `assertAllowed()` fail-closed | 主目录 140 路由裸奔；「注册了就当有」「P5 未验证链路写进可编程清单」「`autoApproveWithin` 草案被当授权」；**且不能另造第二套**（11-05 基线明确"不另建第二套任务/知识/日志系统"） | 主目录无，仅在 worktree |
| C2 | WorkUnit 补一等状态「**待核验**」+ 受阻四因（人/数据/依赖/资源）+ 每次跃迁强制事件流 | 假完成制度化：67 天假 `PUBLISHING`、`READY_FOR_LOGIN` 被映射成假 Gate 挂 19.9h、`state=DONE` 被当核验完成；G2-B4 只在只读投影打了 `businessStatus=PENDING_VERIFICATION` 补丁，总账映射未改 | 框架 §0.6 已登记，未修 |
| C3 | 统一 Gate：P3+ 必挂、`defaultIfIgnored=stall`、聊天与网页同一判定、审批绑定对象/版本/有效期 | 4 处拍板逻辑散落在代码 if 里，答不出「现在在等谁」；超时自动通过风险 | `stall` 仅在展示层 |

### 第 3 组 · 垂直闭环本身（场景选择决定工作量）

| # | 必要动作 | 解决什么问题 | 当前状态 |
|---|---|---|---|
| D1 | **解锁上品写链**：合并 2D-B1 的 CDP 锁修复，关闭 R-02（19 入口无锁 / `withCdpLock` 零调用）与 R-03，验证 REAL 可启用 | 主目录零命中锁符号 → 上品闭环根本跑不起来；并发抢 CDP :9223 会产生错店铺写入 | 未合并 / REAL 禁用（**来自项目记忆，需现地复核**） |
| D2 | 统一 facts 契约（`variants` 3 份定义 → 1 份） | 每轮稳定 9 条 `SCHEMA_INVALID`；在此之上建 `field_plan` 等于第四份真相 | 未做（仅走 Listing 时必做） |
| D3 | 业务口径初始化：支付件数/实物只/子单三者分离、`net`≠利润、可售额度≠物理库存、平台 PST 与北京日界、日切 15:00–17:00 归零跳过 | 11-09 已实证三者差 2.8–11 倍；CEO 会用错口径下结论（B11/B13 不通过） | 部分已有字典，未核准 |
| D4 | 验证**自动唤起**与双入口唯一性 | 当前 poll-on-user-turn 不构成主动经营（B0/B14 不通过）；不让另一个模型在 OS 内偷偷代替 CEO | 只读读取通过，自动唤起未验收 |

> ⚠️ **场景选择需重新决策**：上一轮建议 A 场景 = 上品 Listing（最成熟）。基于本次巡检，上品写链需先合并 CDP 锁修复并关闭 R-02/R-03，工作量与风险显著上升。**若目标是尽快跑通闭环，建议改选「每日经营诊断/监控」只读闭环** —— G2-B4 已有采集器、影子报告、CDP 身份隔离与 173/173 验证基础，全程 P0 只读、不触碰 P3+ 写动作，正好符合「影子 → 受控」的第一档。

### 第 4 组 · 验收与发布（不能由实现者自证）

| # | 必要动作 | 解决什么问题 |
|---|---|---|
| E1 | 跑 B 组 MVP 子集并做**独立交叉核对**：B1 目标追溯、B5 双入口同源、B7 重复/重启不重放、B9 越权拒绝、B11 口径单位、B13 效果测量、B14 自动运行 | 量纲事故：实现者与验收脚本犯同一错误（0–100 被除 100），18/18 全绿却没抓到；验收必须由不共享假设的一方复核 |
| E2 | 26 项历史失败按使用范围逐项裁决「先修 / 明确延期」，特别是 2 项 CEO draft CLI 契约不一致 | 不能弱化断言制造全绿；计划使用的路径必须先修 |
| E3 | 在独立环境按 lockfile 干净安装并验证发布包 | 候选无自身 `node_modules`，向祖先解析到主目录 → 不是自包含发布包；现成绩基于"合成数据隔离 + 复用已有依赖" |

---

## 4. 关键路径与最短可落地集

```
A1 状态收口 ─→ A3 备份冻结 ─┬→ A2 Human 验收/授权 ─→ B1/B2/B3/B4 绑定权威
                            │                              ↓
                            │                    C1 能力治理合并到主目录
                            │                              ↓
                            │                    C2 待核验态 + C3 统一 Gate
                            │                              ↓
                            └──────────────→ D3 口径 → D4 唤起 → E1/E2/E3 独立验收
                                                  ↑
                                    D1/D2 仅在上品场景才进入关键路径
```

**若只做 5 件**（最短可落地集）：① A1+A3 状态收口与备份 → ② A2 验收授权 → ③ B1/B3 指定 Taskboard 与日志唯一写入者 → ④ C1/C2/C3 三块骨架落到主目录 → ⑤ 只读日诊闭环跑 E1 的 B1/B5/B7/B9/B11 独立验收。

**明确不等于落地**：完成 C 组三块骨架只是"框架立起来"；没有 B 组绑定和 E 组验收，仍不能称闭环上线。

---

## 5. 需要 Human 决策

> **变更（2026-11-10 08:42）**：经营目标已由 Human 决定。**12 月日均 500 单**，覆盖原「每日支付商品 ≥200 件」。
> 详见 `docs/TARGET_DECISION_2026-11-10.md`。该变更使本文件 §3 第 3 组中涉及 L3/L4 的按 200 件/天的拆解**失效**，需按新目标重算；其余动作（状态收口、绑定权威、骨架、验收）不受影响。

| # | 决策 | 建议 |
|---|---|---|
| 0 | ~~12 月经营目标~~ | ✅ **已决（2026-11-10）**：日均 500 单，见 `TARGET_DECISION_2026-11-10.md` |
| 1 | 垂直闭环场景：上品 Listing（需先解 CDP 锁）／**每日经营诊断只读闭环**（推荐）／采购补货 | **只读日诊**：P0 只读、不碰 P3+、已有 G2-B4 采集器与影子报告基础 |
| 2 | 是否验收 G0/G1 64 路径候选并批准 G2 准入 | 先验收、再授权，逐文件边界写清 |
| 3 | 正式 Taskboard 路径 / 日志唯一写入者 / 字典 1.1.0 三项权威指定 | 由 Human 指定并留证据，不由助手按文件名推定 |
| 4 | 能力治理：合并隔离候选 vs 在主目录另建一套 | **合并**（11-05 基线禁止第二套系统） |
| 5 | 26 项历史失败中哪些先修、哪些明确延期 | 计划使用的路径先修，其余显式延期并留档 |
| 6 | **「500 单」的口径**：买家去重数 / `sales.suborder` / `sales.qty.pay` | **阻塞验收**。三者在 schema 中不可混用；未定死则 500 单无法验收 |
| 7 | 利润目标是否降级为约束条件 | 建议降级。按实测锚点，500 单达成即自动满足 ¥12,000，两者不等价 |

> **非决策类待办**：需导出一份 11 月全店最近 7 天逐日单量与件量，才能算出真实差距。当前留存基线停在 2026-10-19～10-25（日均 73.14 件），11 月全店日单量为 UNKNOWN。

---

## 6. 红线与边界

- 本清单是**计划草案**，不是开工授权；当前禁止修改应用源码、防火墙、服务配置、数据库、任务状态或 Git 元数据，禁止启动/重启服务或发送业务请求。
- `docs/coordination/` 下 README / CODEX_STATUS / delivery-receipt / evidence-index 由 Codex 维护，**不可改**；本计划用独立文档收口状态。
- P3 改平台草稿、P4 改价改库存、P5 发布上架、P6 删除清空：P3+ 需人批，P5/P6 必须人点；Gate 超时只 `stall`，不自动通过。
- `CAPABILITY_REGISTRY_DRAFT.md` 的 `autoApproveWithin`、P5 注册、`planned`/`unverified` 能力一律不是授权，不可自动执行。
- F1–F5 顺序已被 `SYSTEM_FRAMEWORK_v1.0.md` §0.4 取代，不构成开工依据；验收权威为闭环稿 B0–B15。
- 不引入 Temporal / LangGraph / 多个部门 Agent；OS 内不藏第二个经营决策模型。
- 备份必须白名单 + 逐文件 hash + 回读；禁 `git add .`。

---

## 7. UNKNOWN（不得编造）

- 本轮未重新探测 3000/3173 运行时；11-05 的 PID/监听为历史时点证据。
- CDP 锁 / REAL 状态来自项目记忆（10-30），本轮只做了主目录符号 Grep，**未现地复核 worktree 与运行配置**。
- `CEO agent/` 下 R3_1 / U6 / G2B4_1_1 系列安全与 ACL 报告本轮未逐份阅读，其对 G1 关闭状态的结论未纳入本清单。
- 外部平台字段名、接口名、活动日期与授权额度一律需以实际平台与现有代码核实。
- F1 验收脚本是否随 11-05 tracked tree 重建移除，需复核；本轮只在主目录 `scripts/` 未见其文件。
