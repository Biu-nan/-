# 首店 CEO 简报、决策校验与今日草案 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Steps use checkbox (`- [ ]`) syntax. Codex 优先实施、WorkBuddy 据实际交接接续；本文不授权启动并行修改。

**Goal:** 为纳物-箱包全托1店提供真实只读简报，并让外部 CEO 的决定能被校验和拆成容量内的今日草案。

**Architecture:** 增加三个独立可检验边界：现有 OS 状态的只读适配、外部 CEO 决策的结构/证据校验、确定性的草案排程。复用现有接口、Node 和 AJV，不增加模型服务、数据库或执行器；经营执行与 UI 写入归后续 P2。

**Tech Stack:** 现有 Node ESM、fetch、AJV、node:test。

**Spec:** [首轮契约](../specs/2026-10-26-ceo-first-loop-contract.md)、[详细闭环](../specs/2026-10-26-ceo-os-operating-loop-design.md)。

## Global Constraints

- 当前 T1–T3 执行状态见末尾记录；P0.3 单入口通过依据 WorkBuddy 独立回执及原始输出复核，不能仅凭本计划认为已验证。
- 目标已明确为 2026 年 12 月每日支付商品至少 200 件，12 月经营净利润至少 CNY 12000（扣经营成本但不含品质罚款）。当前仍缺可核验完整成本和源日界线，不能因目标已确认就计算虚假的达标结论。
- 保留原 server/public/适配器六个 WorkBuddy 改动；本批不修改它们。
- 不调用真实发布、调价、报名、采购接口，不查询另一个 Supabase 项目，不改现有 commerce-os 配置。
- 不把订单数直接当支付件数，平台 net 不当目标利润；品质罚款单列，证明已扣后才按同归属期加回；缺事实不填 0。
- 每轮本地处理至多 60 秒、至多 20 个候选任务；外部 CEO 单次结构化决定，OS 本身零模型调用。不声称此边界限制了宿主产品全部调用。
- 测试数据必须隔离；不引入新的 Node 依赖。只有纳入准确白名单的新增脚本才能提交私有仓库。

## Review Focus

1. 200 HTTP 带损坏源：T1 返回 degraded，不宣称业务健康。
2. 假装平台 net 是月利润：T2 的证据口径反例必须拒绝达标结论。
3. 相同商品名属于不同店铺：T2 按 storeRef/对象引用校验，不按名称匹配。
4. 没有人力容量却输出承诺：T3 输出 UNCOMMITTED，不能偷偷给四小时默认值。
5. 重排导致未完成任务消失或换 ID：T3 保留候选 taskId，并对每项记录选中、延期或受阻原因。

## 共享数据契约

所有类型为 JSON 值；运行时由 schema/校验实现约束，不能以注释代替检查。

- `GoalDraft`：`{schema:"ceo-goal/v1",goalId,version,storeRef,period:{fromDate,toDate,timeZone},targets:[{targetId,value,caliber,unit,window,metricStatus}],deadline,capacityMinutes,bufferMinutes}`。storeRef 为 `{platform:"aliexpress-choice",environmentId:"400370"}`；period 为 2026-12-01/2026-12-31、Asia/Shanghai。targets 为 daily-paid-items=200 件/DAY 与 monthly-operating-profit-ex-quality-penalty=12000 CNY/MONTH；首项候选 caliber=sales.qty.total，第二项新利润口径尚未注册则 caliber=null。metricStatus 表示数据契约是否核验，不表示用户目标是否确认；未知 capacityMinutes/deadline 用 null，行动期限不擅自等同月末。
- `FactRef`：`{factId,version,storeRef,caliber,unit,value,period:{start,end},observedAt,quality,coverage:{ratio,complete,costsReconciled?,qualityPenaltiesExcluded?}}`。quality 为 USABLE/INCOMPLETE，版本与引用必须吻合。
- `DecisionDraft`：`{schema:"ceo-decision/v1",decisionId,status:"DRAFT",goalId,goalVersion,storeRef,policyVersion,options:[{actionId,description}],chosenActionId,evidenceRefs:[{factId,version}],affectsTargets:[targetId],claims:[Claim],assumptions,stopConditions,reviewAt,conclusion}`；conclusion 为 CONDITIONAL/NO_ACTION/RECOMMENDATION/INSUFFICIENT_EVIDENCE。NO_ACTION 时 chosenActionId=null，其余必须引用一个真实 option。
- `Claim`：`{claimId,targetId,actionId?,claimType:"TARGET_ASSESSMENT"|"ACTION_BASIS",verdict:"SUPPORTED"|"INSUFFICIENT_EVIDENCE"|"PENDING_OBSERVATION",caliber,unit,period,evidenceBindings:[{factId,version,role:"PRIMARY_METRIC"|"COST_COMPONENT"|"QUALITY_PENALTY"|"CONTEXT"}]}`。ACTION_BASIS 必须有 actionId 并匹配 chosenActionId；两个目标各有 TARGET_ASSESSMENT。主指标匹配声明口径/单位/期间；目标评估另匹配目标已核验口径。PENDING_OBSERVATION 仅用于尚未到期的目标评估，不替代成本或行动依据。目标 caliber=null 或成本未核实仍需补证，不能把 CONTEXT 当主指标。
- `CandidateTask`：`{taskId,actionId,title,acceptance,storeRef,mode:"INVESTIGATION"|"ACTION",priorityClass,estimatedMinutes,deadline,dependsOn,requiresEvidence:[{factId,version}]}`；priorityClass 为 HARD/GOAL/OPTIONAL，deadline 必须含时区或为 null，estimatedMinutes 为正整数。必须绑定 chosenActionId；不匹配则保留在 blocked 并说明未选中。
- T2/T3 首次实现补充：FactRef.coverage 固定为 `{ratio,complete,costsReconciled?,qualityPenaltiesExcluded?}`；SUPPORTED claim 必须含明确 period，防止将日数据用作整月证据。CandidateTask 另需非空 `title` 与 `acceptance`，用于向人说明具体任务及验收。SUPPORTED/VALIDATED 均不表示目标已达成；当前接口信任调用者提供的权威 goal/facts，身份与来源认证由 P2 接入层落实。
- 独立审查后的明确边界：目标未到观察期用 PENDING_OBSERVATION，只允许 TARGET_ASSESSMENT，且需按目标/声明窗口核对尚未到期；不与行动缺证据混同。若要据充分依据形成准备行动，必须有 actionId=chosenActionId 的 SUPPORTED ACTION_BASIS 及主证据，目标口径已核验；否则仍受阻。候选自身 requiresEvidence 也检查未来采集时间。dependsOn 为不超过20个唯一ID的集合，重复边拒绝，紧迫性通过反向拓扑传播并检查预算，避免指数递归。
- 校验结果不授予执行权限；DRAFT 不能因结构合格自动变成可执行授权。

## Task T1：本机只读经营简报适配

**Files:**
- Create: `dist/src/ceo-read-brief.js`
- Create: `scripts/ceo-read-brief.mjs`
- Test: `dist/test/ceo-read-brief.test.js`

**Interfaces:**
- `readCeoBrief({baseUrl="http://127.0.0.1:3000",fetchImpl=globalThis.fetch,now=new Date()}) -> Promise<CeoBrief>`。
- `CeoBrief`：`{schema:"ceo-brief/v1",observedAt,sourceGeneratedAt,readOnly:true,connection:"VERIFIED",dataHealth:"OK"|"DEGRADED",sources,summary,units,gates,caveats}`。保留来源时间与数据不足说明；不得把系统更新时间标为平台采集时间。summary 是原投影统计，明确加 `summaryIsSourceProjection:true`；units 保留原 state，并增 `rawState`、`businessStatus`、`verification:"UNVERIFIED"`。原 state=DONE 的 businessStatus 一律 PENDING_VERIFICATION，特别是 daily_waiting/resolved 只能表示人工步骤已报告；本只读接口缺少动作级证据，不推导核验完成。
- CLI：`node scripts/ceo-read-brief.mjs --base-url http://127.0.0.1:3000`，stdout 一份 JSON；失败写 stderr 脱敏错误并 exit 1。

- [x] 写失败测试：`uses_only_GET_system_state` 断言只调用 `/api/system/state`、method=GET、设 8 秒 timeout；`rejects_non_loopback_base` 对公网、URL 凭证和意外路径拒绝；`rejects_bad_schema_and_non_200` 不返回成功简报；`preserves_unhealthy_sources` 保留 source 错误且 dataHealth=DEGRADED；`does_not_claim_metrics_freshness` 不根据 generatedAt 推断平台事实新鲜；`resolved_is_not_verified_business_completion` 对 sourceId=daily_waiting、state=DONE 保留原态但 businessStatus=PENDING_VERIFICATION，禁止把原 DONE 数计为核验完成数量。
- [x] 运行 `node --test dist/test/ceo-read-brief.test.js`，确认因模块/行为缺失而失败，记录输出。
- [x] 实现上述函数，只接受 http 的 127.0.0.1/localhost 和明确端口；使用 WHATWG URL 校验，固定路由，不跟随重定向。HTTP/格式错误使用稳定代码 CONNECTION_FAILED/INVALID_RESPONSE/INVALID_BASE_URL，不回显凭证或完整异常栈。
- [x] 实现 CLI guard：import 时无调用副作用；执行时输出简报，参数错误明确退出。测试 fake fetch，不依赖真实平台。
- [x] 复跑上述测试，通过后可对本机接口只读调用一次。记录“工程命令通过”与“目标经营会话实际调用”两种证据；后者无回执保持未验证。
- [x] 只暂存本任务三个准确文件，私有分支提交；更新接续记录。不得把其他 scripts/ 一并纳入。

## Task T2：外部 CEO 决策契约与经营反例

**Files:**
- Create: `schemas/ceo-decision.schema.json`
- Create: `dist/src/ceo-decision-contract.js`
- Create: `prompts/CEO_DECISION_CONTRACT_v1.md`
- Create: `dist/test/fixtures/ceo-decision-cases.json`
- Test: `dist/test/ceo-decision-contract.test.js`

**Interfaces:**
- `validateCeoDecision(decision,{goal,facts,now=new Date()}) -> {ok:boolean,readiness:"VALIDATED"|"NEEDS_EVIDENCE"|"NEEDS_CONFIRMATION"|"INVALID",errors:[{code,path}]}`。
- 外部 CEO 按共享 DecisionDraft 返回单份结构化决定；本模块校验，不生成假模型答案。
- ready 语义仅为输入完整。缺用户目标定义返回 NEEDS_CONFIRMATION；目标已确认但源口径/成本未核验或事实不可用返回 NEEDS_EVIDENCE；结构、引用或范围不合法为 INVALID。所有返回仍是 DRAFT。

- [x] 建立五类案例及关键事实变化反例：容量竞争、活动降价、转化下降、到货与断货、不行动。至少覆盖 storeRef 不匹配、事实版本过期、未知 factId、缺成本却断言利润足够、把件当单、截止无时区、无意义重复选项。
- [x] 写测试断言上述非法引用分别返回 STORE_MISMATCH/STALE_FACT/UNKNOWN_FACT；PRIMARY_METRIC 绑定平台 net 到已核验利润目标或把订单绑定件数目标，返回 CALIBER_MISMATCH；同一事实作为 CONTEXT 可保留但不能证明达标；缺目标定义为 NEEDS_CONFIRMATION、缺成本数据为 NEEDS_EVIDENCE；观察期信息不足可返回合法 INSUFFICIENT_EVIDENCE，不迫使生成行动。事实版本以调用者提供的当前权威 facts 集合为准，不从旧聊天提取；真实调用者信任边界由 P2 定义。
- [x] 运行 `node --test dist/test/ceo-decision-contract.test.js`，确认正确失败。
- [x] 实现 schema 与校验函数；fact/goal 引用必须按 ID 和版本匹配，不以中文名称匹配；不执行 options 中的命令。reviewAt 与 deadline 显式校验 ISO 时间偏移。
- [x] 编写外部 CEO 约定：两目标共同约束、证据/假设区分、停止条件、一次请求、无事实不凑结论。提示版本固定 `ceo-policy/v1`，但提示不作为授权控制。
- [x] 复跑测试并逐项对照反例，由独立审查核对输入边界；记录只能证明结构/边界，不能证明真实模型具备经营判断力。由接手开发者或用户保留业务判定异议，不用模型自打分代替验收。
- [x] 只提交本任务准确文件；保留后续真实 CEO 输出的独立评估事项。

## Task T3：容量内的今日草案

**Files:**
- Create: `dist/src/ceo-daily-plan.js`
- Test: `dist/test/ceo-daily-plan.test.js`
- Create: `scripts/ceo-draft-plan.mjs`，薄命令适配：`--input <JSON 文件>`，仅输出草案；忽略输入伪造的 now，以宿主时间校验过期。
- Test: `dist/test/ceo-draft-cli.test.js`
- Create: `docs/superpowers/examples/ceo-first-loop-draft-input.json`，按真实目标提供无事实、未承诺的初始化示例；不是实际经营决定或执行结果。
- Modify: `docs/coordination/CODEX_STATUS.md`，追加实际交接结果。

**Interfaces:**
- Consumes: T2 `validateCeoDecision` 与共享数据契约。
- `buildDailyPlan({goal,decision,facts,candidates,now=new Date()}) -> {schema:"ceo-daily-plan/v1",planId,status:"DRAFT",goalId,goalVersion,decisionId,commitment:"UNCOMMITTED"|"WITHIN_CAPACITY",tasks,deferred,blocked,capacity:{availableMinutes,usedMinutes},warnings}`。
- 保留输入 taskId；planId 对相同业务输入/版本与计划日稳定，不随机制造重复计划。所有 candidates 必须且只能出现于 tasks/deferred/blocked 之一。
- 先调用 T2：INVALID/NEEDS_CONFIRMATION 时全部候选 blocked，commitment=UNCOMMITTED；NEEDS_EVIDENCE 时仅 mode=INVESTIGATION 且所需事实可用的候选可进入容量分配，ACTION 一律 blocked。NO_ACTION 时全部候选 blocked，原因 NO_ACTION_SELECTED。每个可排候选必须同店、actionId=chosenActionId、requiresEvidence 中每个当前 fact/version 存在且 USABLE，否则 blocked，代码分别 STORE_MISMATCH/NOT_SELECTED_ACTION/MISSING_REQUIRED_EVIDENCE。

- [x] 写失败测试：240 分钟容量留 60 缓冲，20+40+120 分钟三个任务选中，额外 60 分钟任务延后；容量 null 时 commitment=UNCOMMITTED、不得承诺完成；已过期硬任务进入 blocked、保留原期限；依赖环/重复 taskId 明确报 INVALID_DEPENDENCY/DUPLICATE_TASK；依赖受阻时下游不就绪；相同输入 taskId/planId 稳定。
- [x] 增加目标双约束反例：缺成本/支付件数证据时只保留调查/草案警告，输出中不得出现“目标已达成”；品质罚款不明不能默认加回或用 0 补齐；两店同名商品不可合并。另测未选行动、必需证据缺失、NO_ACTION 仍带候选、INVALID 与 NEEDS_EVIDENCE 分支，断言相应候选不进入 tasks 且保留原 taskId/明确 blocked code。
- [x] 运行 `node --test dist/test/ceo-daily-plan.test.js`，确认正确失败。
- [x] 实现拓扑约束与容量分配：HARD、GOAL、OPTIONAL；同类按有效 deadline、再 taskId 稳定排序；前置未满足不排后置。超过剩余容量保留延期原因；容量未知不注入默认工时。候选超过 20 项拒绝，使用单次 60 秒处理 deadline 防止无限遍历。
- [x] 实现语义输入指纹（排序无关字段先规范化，再哈希）生成稳定草案 ID；不写数据库、不调用执行器或修改旧流程状态。
- [x] 运行三个新测试文件及隔离 `npm.cmd run test:reliability`；初始原目录基线是 45 项可靠性通过，不把隔离 phase2 的 75 项当作本分支事实。
- [x] 独立检查通过后只提交本批文件；保存精确下一步：目标会话只读调用回执、真实参数缺口、P2 的共享写入/授权/核验/持久化施工单。

## 结束条件与后续

本批交付可用只读命令、可检验的决定和日计划草案。它不构成真实业务执行、自动触发或经营改善的完成声明。经营会话实际调用若未发生，明确保留 P0.3 未通过。

P2 再实现共享持久化、审批与真实/人工执行核验；执行前需准确建表/迁移/接口测试计划。自动运行、日终滚动及业务效果分别在 P3/P4 交付，不混入本批扩范围。

## 自检

类型与函数名称在各任务一致；五项 Review Focus 均有对应测试要求。目录与现有项目结构已核对；文件均为拟新增，未声称已经存在或已运行测试。当前施工单不覆盖完整 P2–P4，覆盖边界已写明。

## 2026-10-26 实际交付状态

T1 已实现且 WorkBuddy 经营对话端实际只读调用通过；T2/T3 已在隔离分支实现，77项新增专项、45项可靠性通过，完整回归286项中24项历史失败保持一致。独立审查3项Important已用失败反例→修复→通过处理，1项无效输入ID稳定性Minor留待后续；未二审。真实经营数据、受控来源/权限、持久写状态/执行与P2施工单仍未完成，不能据此宣称经营闭环已上线。
