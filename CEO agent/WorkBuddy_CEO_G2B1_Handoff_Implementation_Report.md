# WorkBuddy 接力｜CEO Agent v1.0 G2-B1 实施报告

日期：2026-11-05（Asia/Shanghai）
阶段：G2-B1（首次真实经营数据接入）
状态：**隔离开发完成，全部真实门禁保持关闭；未接入真实数据、未部署、未合并、未推送。**

本轮由 WorkBuddy 从 ChatGPT Work 手中接力。开工第一件事是只读核验交接基线，确认可安全接续后才动代码。**本报告中的测试数字全部为本轮实跑结果，未引用 G2-B0 报告的历史成绩。** 上一阶段记录的新增专项 34/34 与回归 68/68，本轮在独立工作区重新跑过，作为基线复现，不是继承的结论。

---

## 1. 交接基线是否完整

**结论：交接内容完整可用，但存在 4 处需要显式记录的缺口，均已定位，未做任何猜测性重建。**

| 交接项 | 核验结果 |
|---|---|
| 交接目录 6 份重点文档 | 6/6 存在且可读（最小变更范围 51,184 B、G0/G1 报告 32,065 B、收尾报告 31,592 B、G2-A 报告 23,894 B、G2-B0 报告 24,386 B、G2-B0 证据包 146 份清单文件） |
| 源码审阅包 source-review.zip | 存在于 `CEO_Agent_V1.0_G2B0_Evidence/`，仅用于核验，未解压覆盖任何工作区 |
| G2-B0 增量补丁 SHA-256 | 交付值 `7305210e…a9c886` 与磁盘文件实测一致 |
| G2-A 冻结点 | `db002b0eaaa106fd2d7df76d42a723f2840a2d6d`，是 G2B1 分支的基线提交 |
| G2-B0 改动是否已提交 | **否。** 19 个路径全部为未提交状态（13 新增 + 6 修改），这是本轮最大的接续风险 |
| 交接工作区完整性 | 开工时与收工时各校验一次，19/19 文件 SHA-256 完全一致，HEAD 仍为 `db002b0`，未被本轮改动 |

### 1.1 记录在案的缺口（未自行补造）

| 编号 | 缺口 | 实际处理 |
|---|---|---|
| G-B1-01 | **仓库中不存在 `AGENTS.md`**（`find` 全仓 maxdepth 3 搜索结果为空） | 记录为缺口。适用规则改由交接文档与既有 `docs/superpowers/plans/` 推定，未虚构项目规则文件 |
| G-B1-02 | `dist/test/ceo-task-read-model.test.js` 第 13 行硬编码相对路径 `.superpowers/sdd/ceo-g2a-20261105`，且用 `mkdtemp` 在该目录下建子目录；新工作区没有该目录 → `mkdtemp` ENOENT | 首轮回归因此出现 **16 项假失败**。补建该草稿目录（不属源码、不属交付物）后回归 **68/68**。未修改测试源码 |
| D-B1-01 | G2-B0 报告声明运行 Node v24.14.1，本机为 **v22.22.2** | `runtimeHash` 内含 `process.version`，因此与 G2-B0 的哈希不可直接比较。本轮所有哈希均为 v22.22.2 下自洽结果 |
| D-B1-02 | `.worktrees/ceo-g2b1-20261105/node_modules` 不存在 | 复用主目录已安装依赖（Node 向上解析）。**未做独立干净安装验证**，正式集成前必须补齐 |

---

## 2. 当前实际 Git 状态

| 项目 | 实际值 |
|---|---|
| 主工作区分支 | `feature/ykb-v1-phase1-identity-state`（**本轮未对其执行任何 git 写操作**） |
| 主工作区 HEAD | 开工时 `052abd7`；收工时 `e19e704`（变化原因见 2.1，非本轮操作所致） |
| 交接工作区 | `F:/yikuaborder-deploy/.worktrees/ceo-g2a-20261105`，分支 `feature/ceo-g2a-20261105`，HEAD `db002b0`，19 个文件仍未提交 |
| **本轮工作区** | `F:/yikuaborder-deploy/.worktrees/ceo-g2b1-20261105`（新建） |
| **本轮分支** | `feature/ceo-g2b1-20261105`（从 `db002b0` 新建，隔离） |
| **本轮提交** | `61fd2ad987d60d98e5a1082f768a628ab4b38b47`（单一检查点，**未推送、未合并**） |
| 提交内容 | 41 个路径：新增 35，修改 6 |
| 未提交残留 | 仅 `.superpowers/`（测试草稿目录，非交付物） |
| 工具链 | Node v22.22.2 / Git 2.55.0.windows.3 / npm 10.9.7 |

### 2.1 需要 Human 知晓的环境事件（本轮未执行，但确实发生了）

收工复核时发现主工作区 HEAD 从 `052abd7` 变为 `e19e704`：

- 提交信息：`[Checkout-checkpoint] from feature/ykb-v1-phase1-identity-state to master (15:07:01)`
- 作者：`Workbench <workbench@local>`，时间 2026-11-05 15:07:58
- 规模：**7,592 个路径**，其中包含 `CEO agent/` 交接资料 398 份、以及 `.chrome-cdp-9223/` 浏览器配置目录下的文件（含一个 4 MB 二进制与 91,586 行的规则数据）
- 分支**并未真正切换**，仍在 `feature/ykb-v1-phase1-identity-state`

这是本机宿主工具的自动检查点行为（仓库历史上存在同类提交 `46324d2`），**不是本轮执行的任何命令产生的**：本轮自始至终只在 `.worktrees/ceo-g2b1-20261105` 内执行 git 操作，从未对主工作区执行 `commit`/`checkout`/`reset`。

判断与建议（交由 Human 决定，本轮不处理）：

1. 该提交把浏览器配置目录与大量未跟踪产物纳入了版本库，若不需要，建议后续用独立提交移出，而不是 `reset`（`reset` 会连同 398 份交接资料一起丢）
2. 原先未提交的主目录改动因此被"固化"进 `e19e704`，接续时应以该提交为新起点比对
3. 它与本轮分支、与 G2-A 交接工作区均无交集，不影响本轮结论

**为什么先建新分支而不是直接在 G2-A 工作区继续：** G2-B0 的 19 个路径尚未提交，直接在原工作区开工会让"哪些字节属于 G2-B0、哪些属于 G2-B1"永久不可分。做法是：先按 SHA-256 备份 19 个文件 → 新建分支 → 拷入并逐文件校验 → 确认 19/19 字节一致后才开始开发。这样既没有 reset/clean/覆盖，也没有重放旧补丁，且原工作区一个字节都没动。

---

## 3. 已复用与新增能力

### 3.1 复用的既有能力（未重写、未建第二套）

- G1：fixture 根门禁（`.ceo-isolated-fixture.json` 标记）、principal/操作授权、隔离目录约束
- G2-A：`buildCeoVnextContext`、`buildCeoShadowReport`、M04 Taskboard 只读快照、M05 Workflow 状态投影、追加式轨迹
- G2-B0：合成支付域、支付闭环（analyze/correct）、完整报告归档（两阶段 COMPLETE 语义）、版本解析器、人工纠错与版本保留
- 既有 HTTP 契约 `/api/ceo/payment-readiness`、`/api/ceo/payment-reports/:id`、`/api/ceo/payment-corrections`

### 3.2 新增能力（对应任务 A–G）

| 任务 | 新增 | 关键设计 |
|---|---|---|
| **A 店铺映射** | `ceo-store-mapping.js`、`config/ceo-store-mapping.v1.json` | 把真实平台店铺绑定到**已冻结的 CEO 店铺域**，因此不需要迁移身份、不需要第二套系统。状态是**计算出来的**，注册表里写 `VERIFIED` 会被判为 `DECLARED_STATUS_IS_NOT_AUTHORITY` 直接拒绝；改店铺域被判为身份迁移拒绝 |
| **B 真实数据契约** | `ceo-paid-order-contract.js`、`config/ceo-paid-orders.real-contract.v1.json` | 列名归导出方所有，运行时**不猜列位、不猜列名**；PII 列直接拒绝；闭期按**时区业务日**判定；金额走定点十进制、拒绝精度丢失；契约默认 `DRAFT_PENDING_HUMAN_APPROVAL` |
| **C 受控真实适配器** | `ceo-paid-order-core.js`（抽取共享核心）、`ceo-real-export-adapter.js`、真实策略草案 | 合成与真实**共用同一套算术与缺口规则**，不会两套逻辑漂移；真实路径需四条链同时成立：契约已核准 × 策略已核准 × 店铺映射已核验 × 审核人已授权。测试专用契约只能在带标记的隔离根内运行 |
| **D 可信核验 + Context** | `ceo-real-data-verification.js` | 15 项命名检查清单 + 内容哈希回执；区分「失败」与「未评估」，避免一处失败把所有下游检查一起标红 |
| **E/F 影子诊断 + 归档纠错** | 支付闭环参数化（宿主注入 domain builder 与 scope 标签） | 真实路径**复用同一套**归档、轨迹、人工纠错，无旁路 |
| **G 驾驶舱与入口** | `ceo-cockpit-projection.js`、`config/ceo-g2b1-connection-contract.v1.json`、2 份 JSON Schema | 只读投影：`actions=[]`、`formalTaskWrites=0`、`workflowExecutions=0`、`authority=NONE`、`productionWiringEnabled=false`；未通过核验时投影为 `BLOCKED` 且所有数值为 `null` |

### 3.3 一处需要 Human 知晓的共享模块改动

`ceo-vnext-context.js` 原先硬性只接受 `SYNTHETIC_ONLY` 策略，真实路径永远进不去。本轮改为接受两种模式：

- `SYNTHETIC_ONLY`：**原规则原样保留**（审核人与来源必须 `fixture-*`）
- `REAL_APPROVED`：禁止任何 `fixture-` 标记，且必须带**绑定策略字节的核准信封**

放宽只发生在"显式核准的真实策略"这一侧，合成侧的收紧规则没动。回归 68/68 证明旧路径行为未变。

---

## 4. 变更文件与 Git diff

- 完整增量补丁：`CEO_Agent_V1.0_G2B1_Evidence/diff/g2b1-from-g2a-checkpoint.diff`
- SHA-256：`db7f78e4765875c597bcace149add787319a8467e2b9d6c7fc3f97cc4497d1ea`
- 范围：`db002b0..61fd2ad`，41 文件，+2,793/−9
- 逐文件摘要与哈希：`CEO_Agent_V1.0_G2B1_Evidence/changed-files.json`

| 目录 | 文件数 | 内容 |
|---|---:|---|
| `dist/src` | 13 | 8 新增（映射/契约/核心/真实适配器/核验/驾驶舱 + 被替换的支付域）+ 5 修改（支付闭环、版本解析、Context、报告、轨迹） |
| `dist/test` | 14 | 7 个新测试文件 + 3 个新夹具 + 4 个继承的 G2-B0 测试 |
| `config` | 8 | 4 个新增（映射注册表、真实契约、真实策略、G2-B1 连接契约与包清单） |
| `schemas` | 5 | 2 新增 + 3 继承的兼容扩展 |
| `docs` | 1 | 继承的 G2-B0 计划 |

语法检查：27 个改动 JS 文件 `node --check` **27/27 通过**。

---

## 5. 实际测试结果与退出码

全部在 `F:/yikuaborder-deploy/.worktrees/ceo-g2b1-20261105` 执行，`--test-concurrency=1`，日志在 `CEO_Agent_V1.0_G2B1_Evidence/logs/`。

| 运行 | 内容 | 结果 | 退出码 |
|---|---|---:|---:|
| `g2b1-special` | 本轮 7 个新增测试文件 | **61 / 61 通过**，0 跳过 | 0 |
| `g2b0-regression` | G2-B0 4 个测试文件（基线复现） | **34 / 34 通过** | 0 |
| `g2a-regression-serial` | G2-A 相关 7 个测试文件 | **68 / 68 通过** | 0 |
| `full-suite` | `dist/test/*.test.js` 全量 | 635 项：**609 通过 / 26 失败** | 1 |
| `historical-failure-baseline` | 同 7 个历史失败文件，在纯净 `db002b0` 上跑 | 54 项：28 通过 / **26 失败** | 1 |
| `historical-failure-same-subset` | 同 7 个文件，在 G2-B1 分支上跑 | 54 项：28 通过 / **26 失败** | 1 |
| `demo` | 测试专用样例生成 | 通过 | 0 |

### 5.1 本轮新增测试覆盖什么

61 项覆盖：注册表自批拒绝、身份迁移拒绝、审批字节绑定、过期窗口、越权审核人、泄露 PII 列、未映射列、非闭期、缺时区、币种漂移、部分覆盖、伪造合成标记、空导出即真零、金额精度、重复与冲突、默认关闭（契约/策略/映射三层）、隔离根约束、路径穿越、金额定点、核验清单语义、回执确定性、端到端真实闭环、纠错版本保留、HTTP 拒绝面、只读投影与 schema 校验。

### 5.2 一次需要如实记录的失败

`g2a-regression` 首次以默认并行度运行时出现 1 项 **文件级 60 秒超时**（`ceo-task-read-model.test.js`），报 64 项/63 通过/1 取消/退出码 1。逐文件单独运行 **68/68 全通过**，串行运行 **68/68 全通过**。判定为并行争用下的夹具耗时抖动，非代码回归；保留原始失败日志不删除。已进 Backlog（B-01）。

---

## 6. 新增失败与历史失败的区分

**结论：本轮零新增失败。**

历史 26 项失败涉及 7 个文件，全部位于既有 Listing / 自动化 / 工作台 CLI 领域，与本轮 `ceo-*` 支付模块无交集：

`automation-service-listing`、`p0-protocol-service`、`basic-feature-smoke`、`prompt-files`、`chatgpt-wait`、`ceo-workspace-cli`、`daily-operation-service`

判定方法不是"看名字像不像"，而是在**不含本轮改动的纯净基线 `db002b0`** 上重跑同样 7 个文件：基线 54 项/28 通过/26 失败，G2-B1 分支 54 项/28 通过/26 失败，且失败用例名集合 `diff` 为空（`IDENTICAL_FAILURE_SET`）。两份日志均已归档。

因此：26 项失败是接力前既有的历史问题，本轮未修复也未扩大；**不声称它们已解决，也不声称全量无新增**。

---

## 7. 真实数据核准进展

**结论：一条真实数据都没有读入，一个真实事实都没有被标为 VERIFIED。这是刻意的结果，不是未完成。**

| 门禁 | 当前状态 | 依据 |
|---|---|---|
| 纳物一店平台店铺 ID | **UNVERIFIED** | 注册表中 `platformShopId: null` |
| 店铺映射权威记录 | **UNVERIFIED** | `authorityRecordId: null`，`approvedBy: null` |
| 映射审核人登记表 | **空** | `authorityReviewers: []`，因此在结构上不可能有人核准映射 |
| 真实支付来源与列定义 | **UNVERIFIED（DRAFT）** | 契约 `status: DRAFT_PENDING_HUMAN_APPROVAL`，来源方尚未确认列名 |
| 真实来源策略 | **UNVERIFIED（DRAFT）** | 策略 `status: DRAFT_PENDING_HUMAN_APPROVAL`，审核人列表为空 |
| 期间 / IANA 时区 / 币种 / 覆盖 | 仅契约规定，**未获源方确认** | 契约写明规则，但没有真实导出可核对 |
| 正式 Taskboard 指定 | **UNVERIFIED** | 本轮沿用未配置降级，未打开任何真实库 |
| 正式日志唯一写入者 | **UNVERIFIED** | 未创建生产写入者 |

已产出的是**可执行的核验机制**：给出真实导出后，15 项检查会逐项告诉你哪一环没过，并给出内容哈希回执供事后复算。用当前"草案 + 空注册表"跑一次，回执稳定输出 6 项明确失败：

```
REAL_CONTRACT_NOT_APPROVED
REAL_POLICY_NOT_APPROVED
STORE_MAPPING_UNVERIFIED
STORE_SCOPE_UNRESOLVED
REAL_APPROVAL_REVIEWER_UNAUTHORIZED
PREREQUISITE_FAILED
```

### 7.1 要放行真实数据，还缺什么（全部需要 Human / 源所有者给出）

1. 源所有者出具的**闭期、去标识**订单支付导出（本运行时不得自行生成）
2. 源方确认的**列名与列语义**（当前列名是建议值，不是事实）
3. **店铺映射权威记录**：平台店铺 ID、环境 ID、别名、记录编号、核准人、有效期
4. 把该核准人登记进 `authorityReviewers`（当前为空，这是硬门禁）
5. 契约与策略的**核准信封**（绑定契约字节、快照、期间、映射哈希）
6. 保留与恢复责任说明

---

## 8. CEO 经营影子分析是否可执行

**分两种回答，不能混同：**

**在隔离夹具上：可以，已端到端跑通。** 使用明确标记为 TEST-ONLY 的契约/策略/映射/导出，完整链路为：受信身份 → 核验 15 项 → Context → 影子诊断 → 完整归档 PREPARED → 轨迹追加 → 回读核验 → COMPLETE。产出 `支付订单数 2 单 / 支付件数 3 件 / 支付原始金额 188.30 CNY`，三项事实均为 VERIFIED，建议最多 3 条且均带依据与验收条件，`formalTaskWrites=0`、`workflowExecutions=0`，合成 Taskboard 数据库字节前后一致。在此基础上：同 requestId 重试回放原报告（不会用新导出覆盖旧报告）、Human 纠错生成第 2 版且旧版完整保留、两条轨迹齐全。

**在真实经营数据上：不可以，被第 7 节的 6 项阻塞。** 现在跑真实数据只会在第一道门就返回 `REAL_CONTRACT_NOT_APPROVED`。这是设计意图：宁可拒绝，也不产生一份"看起来像真实经营结论"的报告。

样例产物（全部标注测试专用，非真实经营结论）：
`demo-output/verified-test-only-summary.json`、`verified-test-only-cockpit.json`、`workbuddy-entry.json`、`shipped-drafts-rejection.json`、`shipped-drafts-blocked-cockpit.json`

---

## 9. 未解决阻塞与下一步计划

### 9.1 阻塞（按能否自行解决分类）

**必须 Human / 所有者决策，本轮无法绕过：**

| 阻塞 | 需要的权威输入 |
|---|---|
| 真实店铺映射 | 平台店铺 ID、环境 ID、权威记录、核准人、有效期 |
| 真实支付导出 | 源所有者闭期去标识导出 + 列定义确认 |
| 契约与策略核准 | 绑定字节的核准信封 + 有权限的审核人 |
| 正式 Taskboard 指定 | 当前存储所有者的版本化指定与只读快照 |
| 正式日志/报告产物所有者 | 唯一追加者、认证接口、幂等域、保留与恢复策略 |
| WorkBuddy 生产接线 | 批准宿主端、认证迁移、权限范围 |

**本轮可自行推进（已进 Backlog）：**

| 编号 | 事项 | 说明 |
|---|---|---|
| B-01 | 回归并行度稳定性 | 默认并行下 `ceo-task-read-model` 触发文件级 60s 超时；建议固化串行或提高文件级超时 |
| B-02 | `ajv` 隐性依赖 | schema 契约测试使用 ajv 8.20.0，来自主目录 node_modules，未在 package.json 声明；干净安装前需显式声明 |
| B-03 | 测试夹具目录自愈 | `ceo-task-read-model.test.js` 依赖预先存在的草稿目录；建议测试内 `mkdir -p` 自建 |
| B-04 | 独立干净安装验证 | 本轮复用主目录依赖，未证明 lockfile 可独立复现 |
| B-05 | Windows 目录 fsync | 归档在 Windows 跳过目录 fsync，掉电原子性未验证 |

### 9.2 建议的下一步顺序

1. Human 给出**店铺映射权威记录**并把核准人登记进注册表 → 这一步不依赖任何导出文件，是解锁后续的前提
2. 源所有者交付**一份闭期去标识导出** + 列定义确认 → 只有拿到它，契约才能从 DRAFT 走到 APPROVED
3. 跑一次 `verifyCeoRealPaidInput`，用真实回执替代当前 6 项失败清单；**回执先给 Human 看，再谈生成报告**
4. 回执通过后再跑影子诊断，归档仍走隔离适配器；正式归档仍等日志所有者核准
5. WorkBuddy / 驾驶舱接线始终保持 `productionWiringEnabled=false`，直到身份迁移单独获批

---

## 10. 回滚与风险控制

### 10.1 本轮实际未触碰的东西

未修改生产服务、未修改正式数据库、未迁移正式身份、未读取任何 Secret、未执行采购/发布/调价/广告 Workflow、未创建正式任务、未打开真实 Taskboard、未推送、未合并、未部署。G2-A 交接工作区的 19 个未提交文件在收工时复核为 **19/19 哈希一致**、HEAD 仍为 `db002b0`。

主工作区方面：本轮未对其执行任何 git 写操作，但其 HEAD 因宿主自动检查点从 `052abd7` 变为 `e19e704`（见 2.1），需 Human 自行决定如何处理该提交。

### 10.2 回滚方式

| 场景 | 做法 |
|---|---|
| 回退本轮全部改动 | `git reset --hard db002b0`（**仅在确认 61fd2ad 无需保留后执行**），或 `git revert 61fd2ad` 保留历史 |
| 只回退版本绑定 | `config/ceo-g2b1-package.v1.json` 移走后，解析器自动回落到 `ceo-g2b0-package.v1.json` |
| 回退真实路径 | 删 `config/ceo-paid-orders.real-*.json` 与 `ceo-store-mapping.v1.json`，真实适配器会因缺配置直接拒绝 |
| 保留证据后再回退 | 先备份 `CEO_Agent_V1.0_G2B1_Evidence/`（含 41 文件补丁 `db7f78e4…`） |

### 10.3 残余风险（如实列出）

1. **真实数据仍为零** —— 本阶段价值在于"门禁建好且确实关闭"，不在于已有真实经营洞察
2. **Node 版本偏离** —— v22.22.2 与交接记录的 v24.14.1 不同，哈希不可跨版本比较
3. **依赖未独立复现** —— 干净环境安装未验证，正式集成前必须补齐
4. **两个测试层脆弱点** —— 并行度抖动（B-01）、草稿目录依赖（B-03）
5. **Windows 耐久性** —— 目录 fsync 跳过，掉电原子性未证明
6. **店铺域绑定假设** —— 本轮把"真实店铺 → CEO 域 400370"的绑定交给映射记录裁定；若 Human 要求真实店铺使用独立域，那是身份迁移，需要单独批准，不在本轮范围

---

## 附：证据索引

`F:/yikuaborder-deploy/CEO agent/CEO_Agent_V1.0_G2B1_Evidence/`

| 文件 | 内容 |
|---|---|
| `baseline-verification.json` | 交接基线事实、工具链、缺口与偏离记录 |
| `changed-files.json` | 41 个变更文件的类型/行数/SHA-256 |
| `test-result-index.json` | 8 次真实运行的命令、数量、退出码、日志路径、异常说明 |
| `diff/g2b1-from-g2a-checkpoint.diff` | 完整增量补丁（`db7f78e4…`） |
| `logs/` | 12 份原始日志（含 1 份并行抖动失败日志与 2 份历史失败基线对比日志） |
| `demo-output/` | 5 份测试专用样例（核验回执、驾驶舱、WorkBuddy 入口、拒绝样例） |
| `environment-events.json` | 记录宿主自动检查点提交 `e19e704` 的事实与建议（非本轮执行） |
| `evidence-manifest.json` | 22 份证据文件及其哈希 |

本轮到此停止：**不进入真实接线、不进入生产部署、不申请任何正式授权。** 下一步取决于第 9 节第 1 步的店铺映射权威记录。
