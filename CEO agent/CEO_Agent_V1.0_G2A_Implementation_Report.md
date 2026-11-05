# CEO Agent v1.0｜G2-A 隔离实施报告

日期：2026-11-05（Asia/Shanghai）  
状态：M03–M06 纯隔离候选已交付，停止等待 Human 验收；未进入 G2-B/G3。

## 1. 当前目标与实际结论

本轮在已批准设计与 G2-A 授权范围内，完成版本化认知与结构化分析、Taskboard 离线纯读、Workflow 状态/拟调用、影子轨迹与 Human 反馈。全部以合成数据验证；没有重新设计岗位、重做 D1 调查、选择正式数据库或擅自采用某版正式口径。

**本轮新增专项 68/68、可靠性回归 45/45 通过；全量 540 项中 514 通过、26 失败。26 项与 G1 基线的名称、文件及规范化错误诊断全部一致，没有新增失败。** 全量套件并未全绿，原失败没有被删除或豁免。

当前交付是确定性接口、受控本机 HTTP 组合入口和测试证据。分析候选仍由现有 Work/Human 提供，服务校验并约束其事实与建议；没有新建模型供应商、Agent 框架或自动经营循环。认知包绑定版本/内容摘要，不把模型文字或注册口径直接升级为有效事实。

## 2. 独立工程基线和保护

| 项目 | 本轮结果 |
|---|---|
| 新工作区 | `F:/yikuaborder-deploy/.worktrees/ceo-g2a-20261105` |
| 分支 | `feature/ceo-g2a-20261105` |
| 原主系统基线 | `052abd71301f0409ad6295fea78f24bb83bc35f3` |
| 新树的 G1 冻结提交 | `90ea256c6e1a246610fd324d21d73fe88a9c7f34`；只在新树创建的本地基线提交，未合并或推送 |
| G2-A 增量 | 27 个新增路径，现有 G1 产品文件修改 0；G2-A 改动尚未提交 |
| 原 G1 树 | 64/64 个已交付候选文件哈希保持原样；未迁移其未提交修改或改动其索引 |
| 保护样本 | 主目录既有修改、配置和日志等 13/13 样本相对阶段开始哈希不变；不据样本推断全生产目录无人变化 |
| 测试隔离 | 合成临时根 `F:/tmp/ceog2a-20261105-isolated`；Node 文件写/SQLite 路径/网络门禁沿用 G1 方法 |

原生 Worktree 工具无法在其工具主机识别该 Windows 仓库，故使用本地 Git 创建新树。仅把已交付补丁对应的 64 个精确 G1 文件复制到新树；Git apply 发生的 CRLF 转换经字节比对发现后，只在新树恢复原精确字节，再形成本地 G1 冻结提交。原 G1 和主目录均未覆盖。

测试复用主目录已安装的 Node 包，由祖先目录解析；未安装、升级或修改生产 node_modules。独立干净安装及传递依赖字节验证仍是正式集成前条件，不能将本候选称为已验证的自包含部署包。

证据：[baseline.json](CEO_Agent_V1.0_G2A_Evidence/baseline.json)、[保护与语法检查](CEO_Agent_V1.0_G2A_Evidence/protection-and-syntax.json)、[逐文件清单](CEO_Agent_V1.0_G2A_Evidence/changed-files.json)。

## 3. M03：认知与经营分析

### 3.1 实际能力

新增 `ceo-vnext-context.js`、`ceo-vnext-analysis.js`、版本化认知 JSON/核心提示词、合成来源政策以及 Context/Report 契约。

- `buildCeoVnextContext({storeId,dictionaryBytes,knowledgePack,facts,evidence,approvals,period,now})` 构建不可变且由模块登记的 Context；复制或伪造同形 JSON 不会成为可信 Context。
- 输入事实包含 factId/version、店铺、caliber/value/unit、金额 currency、期间/时区、eventBasis、capturedAt/validUntil、coverage、来源 path/sha256/sourceId。可信宿主提供原件内容与审批；审批绑定 factId/version、`sha256(JSON.stringify(fact))`、核准人及核准时间。原始序列化变化会保守失配，不能让模型自签 VERIFIED。
- 核验来源摘要、合成来源/审核人白名单、完整覆盖、单位/币种、事件口径、期间一致及已结束期间、抓取时间、新鲜度和重复冲突。只有满足政策的事实为 VERIFIED；其他显式为 UNVERIFIED/CONFLICT/STALE/MISSING，输出有效值为 null；真实零保留 0。
- 核心认知包 1.0.0 固定影子边界、三项优先事项及事实/假设/建议规则；支持 FACT/RULE/HYPOTHESIS/PROPOSAL/EXPERIENCE 分类和版本摘要。没有把未经核准的真实公司事实写入认知包。
- `buildCeoShadowReport({context,taskSnapshot,workflowState,draft,now})` 将 FACT、HYPOTHESIS、RECOMMENDATION 分开。FACT 文本和 assertions 从有效数值生成，不接受“引用零销量却声称 999”的自由文本；来源不足或利润/ROI 缺口为 CANNOT_DETERMINE。
- 最多三项优先事项；计划候选只生成 proposalRef/PROPOSED，不分配正式 taskId、不调用旧 saveDraft/import、不写 Taskboard。已有任务引用必须匹配快照中的 taskId/version。
- 无有效事实时仅允许调查建议。利润/ROI 目前保持不可判断；本轮未补出真实成本、罚款或汇率事实，也未实现复杂经营预测。

来源政策只开启合成 fixture-export；事件口径只明确允许本轮演练的 `sales.qty.total=paid`、`sales.amount.gmv=shipment`。其他口径即使存在于字典，缺少来源政策仍降级。扩充来源和经营域需要后续核准。

### 3.2 两版精确字典

主目录 metrics-schema.json 保留原样。仅冻结以下精确测试输入：

| 测试输入 | SHA-256 |
|---|---|
| 1.0.0，G0 原工作区字节 | `f3fbfb1454a934cbfc8b155b3513f5c64d5ec62470bd9391b018846986f68efc` |
| 1.1.0，既有收尾证据字节 | `933d63c4e5f1c3223aacb60708a6a2ce2302a385f425c3ca10a0ab3692b905ed` |

两份均位于新树 `dist/test/fixtures/ceo-g2a`，交付证据也保留原字节。兼容测试验证原口径可用性保持、Context ID 随字典变化而变化；相同证据的重复加载不因加载时钟单独改变 ID。没有指定哪版为正式经营字典。

## 4. M04：Taskboard 只读适配

`readCeoTaskSnapshot({dbPath,fixtureRoot,offlineSnapshot:true,storeId,now})`：

1. 必须是显式合成目录及其中的离线副本，校验标记、路径和符号链接；没有数据库默认值。
2. 缺库、损坏、缺表、WAL/-shm/-journal 或未知状态明确失败；不创建、初始化、迁移或恢复。
3. 以 SQLite `readOnly:true` 打开，query_only、trusted_schema 约束和单次读取事务得到 tasks/events。
4. 验证任务行/正文 ID 与版本、内容哈希、完整事件版本链、最终状态/attempt/更新时间及同店绑定；返回字段白名单和内容绑定的 snapshotId。
5. 合成同 schema 任务由原 CeoTaskWorkspace 建立，适配器读取其已有任务和事件；没有建立第二套生产任务系统。

**边界**：本实现只接受宿主持有并阻止其他写入的合成离线副本。读取前后检查不能消除路径/活动数据库模式切换的所有竞态，所以不宣称支持真实活跃 SQLite 或 WAL 零侧写。WAL 库即使侧文件缺失也在打开前拒绝，不用 immutable 假装安全。G2-B 应由原库所有者输出一致快照；在证明活动库安全前继续拒绝直接接线。

专项验证包括缺库不创建、读取不初始化、目录/DB 哈希不变、跨店、事件链/内容/版本失配、WAL/回滚日志、路径约束及原领域兼容。Windows 正被占用的 SHM 无法读取时仅比较元数据；可读离线文件逐字节比对。详见 [M04 摘要](CEO_Agent_V1.0_G2A_Evidence/m04-summary.md)。

## 5. M05：Workflow 能力与状态

- 清单包括 `system.state.read` 合成验证项，以及 `listing.create` 未核准副作用项；清单外 ID 明确拒绝，没有把所有现有 Workflow 自动视为已验收。
- 清单携带 workflowId/version、handlerRef、effects、requiredCapability/Inputs、timeout、approvalRequired 和验证状态。
- `readCeoWorkflowState` 接收宿主合成快照，区分可用性、执行状态、未知/冲突/缺失/过期及版本不符的禁用原因。SYNTHETIC_VERIFIED 只代表合成验证，不代表真实 Workflow 已获授权。
- `planCeoWorkflowInvocation` 仅返回 UNEXECUTED、dispatched=false 的拟调用，重新核对包装时间和源快照时间，防止缓存跨过有效期；它不持有或调用 handler。
- 调用分析中注入的执行器 spy 次数为 0；新组合服务没有导入真实执行桥、浏览器或派发器。真实能力可用性仍待 G2-B 只读核实。

没有启动真实 Workflow、浏览器、ERP、采集、发布或恢复流程。

## 6. M06：影子轨迹与 Human 干预

`createCeoShadowTrace({filePath,fixtureRoot,governance,now})` 提供 `append({principal,event})` 和 `read({principal,storeId})`。

- 固定事件类型：ANALYSIS、HUMAN_FEEDBACK、HUMAN_CORRECTION、HUMAN_PAUSE、HUMAN_RESUME；不接受任意路径、角色、业务任务/执行事件正文。字段长度和凭证特征校验防止误写敏感文本。
- 追加前用既有 G1 governance 校验能力、店铺、真实签发 principal 和 policyVersion；权限校验在创建锁或日志前完成。Human 类事件只有 human.review 能力可提交，模型不能通过角色字段获得权限。
- 事件关联 analysisId/contextId/snapshotId/sourceHash/policyVersion/proposalRef；Human 反馈及纠错必须关联已有分析并保持这些绑定。纠错追加新记录，原记录不变。
- 文件上独占锁协调多个入口/进程；在锁内重建去重视图并追加、fsync。eventId、analysisId、feedbackId 重放内容一致返回已有记录，改变内容拒绝；重启从原日志恢复去重。
- 记录含 sequence、actorId、recordedAt、内容/前序/当前哈希；损坏、尾部截断、写入失败或锁异常不伪装成已保存，不覆盖历史。
- 暂停后新分析记录拒绝，允许 Human 反馈与恢复；它不停止任何正式业务 Workflow。纯计算可能已完成但未被日志接纳，不返回归档成功。

**明确限制**：当前持久化的是关联轨迹和有界决策摘要。HTTP 响应使用 `traceArchived=true`、`fullReportArchived=false`，不声称完整报告已归档。完整 Context/报告原件的只增产物存储与原日志所有者接线属于 G2-B 前置工作。

同一 analysisId 以新投递 ID E2 重试时返回已提交 E1；E1 才是 canonical eventId，服务返回 E1。未提交 E2 不会单独持久保留为别名。锁超时两秒、不自动抢占残留锁，日志上限 16 MiB；外部有权限者删除/重写文件的防护锚点不在本适配器能力内。自身追加链不会覆盖旧记录，不能宣称防止任意宿主篡改。

这些文件是合成测试适配，不是第二套正式日志数据库。未来仍由现有一跨 OS 日志的唯一所有者追加；3173 不自行抢占正式日志。

## 7. 真实隔离 HTTP 组合接口

`startCeoG2aService` 必须显式合成根、完整宿主依赖和 G1 governance，仅绑定 `127.0.0.1` 动态端口；指定正式/固定端口会拒绝，没有修改 3000/3173 服务。

| 接口 | 能力 / 行为 |
|---|---|
| GET `/api/ceo/vnext/context` | read；只由宿主输入构建 Context |
| GET `/api/ceo/vnext/tasks` | read；调用只读适配器，不接受正文中的库路径 |
| GET `/api/ceo/vnext/workflows` | read；宿主状态，禁止跨店返回 |
| POST `/api/ceo/vnext/shadow-analysis` | analyze；只接受 requestId/expectedContextId/draft；拒绝正文伪造 Context；日志追加成功后才返回轨迹归档标识 |
| GET `/api/ceo-shadow/events` | read；缺日志不创建 |
| POST `/api/ceo-shadow/events` | human.review；仅 Human 反馈/纠错/暂停/恢复类型 |

未知路由、正式 import/任务命令、角色伪造及旧 CEO 发起分析均拒绝。旧 CEO 保留 read，影子身份为 read/analyze，Human 反馈权限独立；原 G1 权限配置未扩展。

组合测试使用实际合成 SQLite 只读适配、实际 Workflow 状态投影和实际轨迹文件，验证报告计划候选不改变 DB 字节、正式任务创建/Workflow 调用为 0。另以**注入写入失败**验证不会返回成功归档，并拒绝宿主意外返回跨店快照。没有通过真实写操作测试生产边界。

## 8. 本轮测试与修复证据

| 检查 | 本轮实际成绩 | 退出码 / 证据 |
|---|---:|---|
| M03–M06、HTTP、JSON 契约共 7 份新增专项测试文件 | 68/68，0 跳过 | 0，final-g2a |
| 可靠性回归 | 45/45，0 跳过 | 0，final-reliability |
| 全量 npm test，含 G1 和既有领域回归 | 540 总计，514 通过，26 失败，0 跳过 | 1，final-full |
| 新增 JS 文件语法检查 | 15/15 | 全部 0 |
| git diff --check | 通过 | 0 |

集合互有交集，不相加为独立通过数。此次实际新增测试为 68，G1 基线 472 加 68 等于 540；原 G1 文件未改，新增失败名称为 0，26/26 错误诊断在规范化工作树路径、耗时及堆栈后相同。没有把历史 73/73、25/25 或 G1 成绩冒充本轮成绩。

测试先行 RED/GREEN 和失败记录完整保留。独立审查发现并修复：FACT 自由文本可夸大数值、事件口径未绑定、继承属性名绕过字典、未来完整期间、Workflow 包装/源时间双重新鲜度，以及归档字段表意过宽。另补 policyVersion 伪造拒绝、跨店 GET 和写失败响应。审查最终无遗留 Critical/Important；详见 [review-findings.md](CEO_Agent_V1.0_G2A_Evidence/review-findings.md)。

初版 mixed-period 测试因 fixture 共用 period 引用而没有真正制造混窗，观察到失败后修正为独立副本；初版把测试文件当 helper 导入造成重复注册，已拆成 fixture helper。中间 32 项 RED 不作为最终独立测试数量。查明并修正了工作树复制换行差异，没有改变原树。全部失败尝试和命令/退出码见 [test-result-index.json](CEO_Agent_V1.0_G2A_Evidence/test-result-index.json)。

### 8.1 剩余 26 项失败

下列是全量套件原有失败，未修复；本轮新调用链未依赖它们。两项旧 draft CLI 仍失败，新分析服务没有调用它们，不能称其已通过。未来若选用相应路径，须先处理。

| # | 失败用例 | 文件位置 |
|---:|---|---|
| 1 | does not hard-stop image generation on storyboard or prompt-pack QC failures | `dist\test\automation-service-listing.test.js:114:5` |
| 2 | sends listing content with a stable backend fingerprint | `dist\test\automation-service-listing.test.js:156:5` |
| 3 | recovers listing content from previously sent Chinese listing prompts | `dist\test\automation-service-listing.test.js:174:5` |
| 4 | exposes all backend prompts in the knowledge prompt library | `dist\test\basic-feature-smoke.test.js:80:5` |
| 5 | exposes a manual reset for insert market radar selection | `dist\test\basic-feature-smoke.test.js:105:5` |
| 6 | keeps ChatGPT tool selection resilient to composer menu role changes | `dist\test\basic-feature-smoke.test.js:156:5` |
| 7 | does not hard-stop listing generation when ChatGPT web search cannot be toggled | `dist\test\basic-feature-smoke.test.js:164:5` |
| 8 | shows the Listing visual workflow v2 stages without replacing legacy controls | `dist\test\basic-feature-smoke.test.js:186:5` |
| 9 | keeps legacy planning completion available for standard Listing | `dist\test\basic-feature-smoke.test.js:208:5` |
| 10 | inspect is read only and produces the host goal with quarantined facts | `dist\test\ceo-workspace-cli.test.js:20:1` |
| 11 | save-draft persists once using the inspected host context | `dist\test\ceo-workspace-cli.test.js:25:1` |
| 12 | uses the native editor insertion path for a long prompt | `dist\test\chatgpt-wait.test.js:6:5` |
| 13 | does not upload the same image twice when ChatGPT resets its file input | `dist\test\chatgpt-wait.test.js:18:5` |
| 14 | recognizes stopped thinking with no assistant output instead of waiting for the global timeout | `dist\test\chatgpt-wait.test.js:53:5` |
| 15 | surfaces write failures instead of swallowing them | `dist\test\daily-operation-service.test.js:146:5` |
| 16 | reads the smt_choice_listing workflow spec | `dist\test\p0-protocol-service.test.js:9:5` |
| 17 | reads the sample task | `dist\test\p0-protocol-service.test.js:15:5` |
| 18 | reads the context pack | `dist\test\p0-protocol-service.test.js:23:5` |
| 19 | reads the agent job | `dist\test\p0-protocol-service.test.js:32:5` |
| 20 | reads the artifact sample | `dist\test\p0-protocol-service.test.js:41:5` |
| 21 | assembles the smt_choice_listing sample chain | `dist\test\p0-protocol-service.test.js:51:5` |
| 22 | reports ready health when all P0 fixtures and the sample chain are available | `dist\test\p0-protocol-service.test.js:68:5` |
| 23 | accepts all ten prompt start and end markers | `dist\test\prompt-files.test.js:15:5` |
| 24 | supports the seven-image luxury insert prompt pack | `dist\test\prompt-files.test.js:30:5` |
| 25 | keeps the strict luxury insert layouts and fixed copy in the template | `dist\test\prompt-files.test.js:40:5` |
| 26 | exposes Listing visual workflow v2 prompt templates through the prompt registry | `dist\test\prompt-files.test.js:68:5` |

完整错误和断言见 [final-full.stdout.log](CEO_Agent_V1.0_G2A_Evidence/final-full.stdout.log) 与 [failure-comparison.json](CEO_Agent_V1.0_G2A_Evidence/failure-comparison.json)。本轮无需为清理这些失败扩大到 Listing、提示词或历史全项目修复。

### 8.2 安全复核与复现

测试环境从允许列表构造，不继承 API 秘密；npm 用户/全局配置指向合成空文件。Node 门禁限制写入和 SQLite 路径到新 Worktree/合成目录，禁止非本机网络及已知正式业务端口。仅用于测试防错，不能代替操作系统权限边界。

在新工作区执行以下命令可保存新的复验记录，不能在生产根直接运行套件：

```powershell
Set-Location -LiteralPath 'F:\yikuaborder-deploy\.worktrees\ceo-g2a-20261105'
python '.superpowers/sdd/ceo-g2a-20261105/run.py' review-g2a node --test dist/test/ceo-vnext-context.test.js dist/test/ceo-shadow-analysis.test.js dist/test/ceo-task-read-model.test.js dist/test/ceo-workflow-catalog.test.js dist/test/ceo-shadow-trace.test.js dist/test/ceo-g2a-service.test.js dist/test/ceo-g2a-contracts.test.js
python '.superpowers/sdd/ceo-g2a-20261105/run.py' review-reliability cmd /d /c npm run test:reliability
python '.superpowers/sdd/ceo-g2a-20261105/run.py' review-full cmd /d /c npm test
git diff --check
```

没有访问正式业务库、读取正式凭证或启动真实执行器；本轮生产业务/正式日志写入为 0。依据是未配置的正式接线、测试边界、实际合成库前后摘要与拒绝/调用 spy，加上 13 个保护样本不变；不据此宣称所有生产文件都被全量审计。

自动审批曾拒绝清理六个遗留合成 `m04-fixture-*` 目录，理由 `blocked by policy`。它们留在合成测试根，已记录于 M04 摘要；未以扩大删除范围绕过门禁。不是生产数据，未打入交付补丁。

## 9. 可复用代码及实际变更清单

复用 G1 的 principal/操作授权、隔离根校验、哈希/旧 Context 模块；复用原 CeoTaskWorkspace 和真实同 schema 的任务/事件契约做合成兼容验证。M04 不调用其会初始化的 listTasks/ready 读取生产库；M03 不放宽旧 saveDraft 的事实门禁。没有改写原 Taskboard、Workflow 调度器或 HiddenDataLoopService。

G2-A 共 27 个新增路径：7 个模块、3 份政策/认知配置、1 份核心提示词、5 份 JSON 契约、7 份专项测试、1 个 fixture helper、2 份精确字典输入、1 份执行计划。无原 G1 产品文件修改。

| 新增路径 |
|---|
| `config/ceo-data-sources.v1.json` |
| `config/ceo-knowledge.v1.json` |
| `config/ceo-workflow-capabilities.v1.json` |
| `dist/src/ceo-g2a-service.js` |
| `dist/src/ceo-shadow-trace.js` |
| `dist/src/ceo-task-read-model.js` |
| `dist/src/ceo-vnext-analysis.js` |
| `dist/src/ceo-vnext-common.js` |
| `dist/src/ceo-vnext-context.js` |
| `dist/src/ceo-workflow-catalog.js` |
| `dist/test/ceo-g2a-contracts.test.js` |
| `dist/test/ceo-g2a-service.test.js` |
| `dist/test/ceo-shadow-analysis.test.js` |
| `dist/test/ceo-shadow-trace.test.js` |
| `dist/test/ceo-task-read-model.test.js` |
| `dist/test/ceo-vnext-context.test.js` |
| `dist/test/ceo-workflow-catalog.test.js` |
| `dist/test/fixtures/ceo-g2a-fixture.js` |
| `dist/test/fixtures/ceo-g2a/metrics-schema.1.0.0.json` |
| `dist/test/fixtures/ceo-g2a/metrics-schema.1.1.0.json` |
| `docs/superpowers/plans/2026-11-05-ceo-g2a.md` |
| `prompts/ceo-vnext-core.md` |
| `schemas/ceo-shadow-event.schema.json` |
| `schemas/ceo-shadow-report.schema.json` |
| `schemas/ceo-task-snapshot.schema.json` |
| `schemas/ceo-vnext-context.schema.json` |
| `schemas/ceo-workflow-state.schema.json` |

[增量补丁 final-g2a.diff](CEO_Agent_V1.0_G2A_Evidence/final-g2a.diff) 基于本地 G1 冻结提交；SHA-256：

`aad00ae76242e8fe7f0305af58c9810a7c7a0a9691bbb734d17399b5cb8dbdfb`

另交付 [相对原主基线的完整组合补丁](CEO_Agent_V1.0_G2A_Evidence/final-from-main.diff)，包含 G1＋G2-A，供审阅且不意味着批准整包合并。精确文件字节由 changed-files.json 和两份字典副本共同冻结，应用 Git 文本补丁时注意换行设置。

## 10. 正式集成前条件及 G2-B 最小建议

原有阻塞未被本轮绕过，也未重新调查：正式 CEO Taskboard 路径、正式日志唯一写入者、真实数据权威源/审核人、正式字典版本及真实身份迁移仍待 Human 核准。

建议 G2-B 切成以下最小步骤，逐步授权、逐步验收：

1. **冻结精确输入和身份**：确认正式库/日志所有者、数据域、期间口径、核准人、字典哈希与认知包哈希。真实身份迁移单独审批，不把 fixture 身份替换为正式令牌后直接上线。
2. **只接一个经营域的核准只读快照**：原所有者生成一致快照，验证缺库不创建、目录/DB/侧文件字节不变、店铺和版本一致。未证明 WAL 安全前不直接读取活跃库。来源缺口仍显式降级。
3. **只接一个纯 Workflow 状态源**：证明读路径无初始化或隐式恢复；取得状态/版本/时间来源证据。继续不挂执行器，所有拟调用 UNEXECUTED。
4. **由现有日志唯一所有者接纳影子记录**：先核准完整报告/Context 的只增产物落点与引用、真实认证、持久去重和并发策略，验证失败不标已存档、重启不重复、历史不覆盖。不要在 3173 建第二个正式日志写入者或日志库。
5. **限定一条真实只读影子链验收**：核准输入→Context→分析候选→只读任务/Workflow 状态→Human 反馈，验证来源可追溯、最多三项建议、正式任务和真实执行均为 0。经营效果与“轨迹完成”分开验收。

上述均为下一阶段接入与验收建议，本轮没有执行。独立安装/依赖字节、实际前端/会话迁移、完整报告归档及输入核准在接入前补齐；全量 26 项失败中被实际使用的路径必须前移修复，其余保留 Backlog。

## 11. 回滚与停止

本轮无生产变更、数据迁移或真实身份变更需要回滚。拒绝候选时停止自己启动的合成本机实例，保留证据后仅针对新 Worktree/分支处理；不得回退主目录 metrics-schema.json、覆盖原 G1、恢复历史库或按端口终止正式服务。

新增轨迹只能追加，不通过清空日志回滚判断。遗留锁或损坏合成日志保留并显式拒绝，恢复需要宿主确认，不自动抢占。候选和证据在验收期间保留，不自动清理。

本轮停止：未合并、未部署、未接生产数据库、未修改正式身份权限、未执行真实 Workflow；不自动进入 G2-B 或 G3。
