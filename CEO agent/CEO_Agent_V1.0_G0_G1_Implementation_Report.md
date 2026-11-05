# CEO Agent v1.0 G0/G1 实施报告

日期：2026-11-05（Asia/Shanghai）  
状态：独立 Worktree 中的 M01/M02 隔离候选实现已交付；G0/D1 尚有证据缺口；停止等待 Human 验收，不自动进入 G2。

## 1. 当前目标、授权与验收结论

本轮仅执行已批准最小路线中的 G0 基线确认，以及不依赖正式数据库的 G1 M01、M02 开发和合成数据测试。没有重新设计 CEO 岗位，没有扩大到 M03—M08，也没有重做已有充分证据的历史检查。此前审计及方案是设计输入，本报告中的测试成绩均来自本轮实际执行。

Human 最新指示明确：正式 CEO Taskboard 路径未确认时，仅阻塞相关接线；其他独立隔离开发继续。依此实施，没有把历史候选库指定为正式库，也没有创建空库替代。

| 本轮验收项 | 结论 | 证据与限制 |
|---|---|---|
| 1. D1 基线明确且可复现 | 部分完成 | 3000 代码、资源、启动链已核验；3173 当前正式绑定及日志独占写入者未确认；另发现主目录配置漂移 |
| 2. M01 专项及相关回归 | 隔离范围通过 | 新增专项、实际子进程启动、单实例、只读健康检查及相关回归通过；未操作正式实例 |
| 3. M02 越权拒绝 | 隔离范围通过 | 越权、伪造身份、跨店、重复请求及主服务写路由拒绝测试通过；真实凭证迁移未进行 |
| 4. 旧 CEO 只读兼容 | 隔离已验证；生产未激活 | 保留 Context Snapshot、最多三项优先事项；拒绝正式任务创建与执行；旧 Taskboard 的惰性写入型读取不会伪装成纯读 |
| 5. Human 原功能 | 已覆盖的合成场景通过 | 原手工任务审批→启动→上报→验证，以及主服务本地状态接口通过；不等于全部 UI、登录及真实 Workflow 回归通过 |
| 6. 生产状态、配置、数据未改 | 本轮未实施生产写入；整体无变化不能确认 | 3000 PID 未变、3173 无监听，12/13 个保护文件哈希不变；metrics-schema.json 出现来源未确认的变化，未覆盖或回退 |
| 7. 文件、影响、回滚明确 | 已交付 | 64 路径清单、完整补丁、逐轮差异、命令、日志、退出码及回滚说明 |
| 8. 测试成绩真实区分 | 已满足 | 专项 55/55、相关 142/142、可靠性 45/45；全量 446/472，26 项失败保留；不沿用历史 73/73、25/25 |

因此，本轮可以验收“隔离候选实现及证据交付”，不能据此批准正式接线、部署或认定 G2 准入已完成。

## 2. 工程基线与可复现标识

| 项目 | 实测结果 |
|---|---|
| 当前 3000 服务代码包 | `F:/yikuaborder-deploy` |
| 当前服务分支 / Git HEAD | `feature/ykb-v1-phase1-identity-state` / `052abd71301f0409ad6295fea78f24bb83bc35f3` |
| 服务身份 | PID `18656`；启动时间 `2026-10-31T01:24:13.295Z`；监听 `0.0.0.0:3000` |
| 启动所有权 | `start-workbench.vbs` → 主目录 `watchdog.js`（PID 17160）→ `dist/src/server.js`（PID 18656）；watchdog 父进程为 cmd.exe（PID 16664） |
| 实际前端资源 | 经 HTTP 获取 index.html、ceo-command-center.js、ceo-tasks.js、app.js、styles.css；五份 SHA-256 均与主目录文件一致 |
| 3173 | 开始及结束观测均无监听；没有发现足以证明当前正式绑定的更新记录 |
| 原 CEO Worktree | `F:/yikuaborder-deploy/.worktrees/ceo-read-brief`；HEAD `fed03d366b14a7dfa75686086a0554002a148e61` |
| 其他基线 | reliability Worktree HEAD `35291d8...`；`F:/yikuaborder-run` HEAD `8970876e55d1e371d51c37b0249d6c37d8d4d132`，未改动其代码 |
| 本轮独立 Worktree | `F:/yikuaborder-deploy/.worktrees/ceo-g0-g1-20261105` |
| 本轮分支 | `feature/ceo-g0-g1-20261105`，基于主目录 HEAD；修改尚未提交，使用完整补丁和逐文件哈希冻结候选内容 |
| 测试 Node | `v24.14.1`，仅说明本轮测试使用的运行时，不推定其他进程的 Node 版本 |

原 CEO Worktree 不是正在提供 3000 资源的代码包。其 CEO 领域模块、CLI 和测试与主系统共用现有 Node/Express/Taskboard 模块；本轮从其明确提交中复用 40 份跟踪文件，在主系统基线的独立 Worktree 内组合验证，没有把旧 Worktree 的脏文件、数据库或凭证复制过来。Runtime Manifest 同时绑定主服务、直接依赖的 `listing-agent/src`、包清单、前端、契约和治理策略字节，避免只标记 Git HEAD 却漏掉实际依赖版本。

原生 Worktree 工具两次不能在所在工具主机识别 Windows 仓库；确认本地 Git 仓库后，使用本地 `git worktree add` 创建隔离分支。没有重置原目录、迁移未提交修改或合并生产分支。

完整基线证据：[g0-before.json](CEO_Agent_V1.0_G0_G1_Evidence/g0-before.json)、[g0-runtime.json](CEO_Agent_V1.0_G0_G1_Evidence/g0-runtime.json)、[final-verification.json](CEO_Agent_V1.0_G0_G1_Evidence/final-verification.json)、[最终监听记录](CEO_Agent_V1.0_G0_G1_Evidence/final-listeners.json)。

### 2.1 正式 Taskboard 路径：未确认，限定阻塞

在现有启动脚本、代码中的环境引用、历史运行记录及有界的自启动/服务引用中核验：最后一份可交叉验证的 3173 重启脚本为原 CEO Worktree 下 `.superpowers/sdd/2026-10-28-ceo-evidence-check/restart-service.ps1`；其 `runtime-before.json`、`runtime-after.json` 与脚本共同指向：

`F:/yikuaborder-deploy/.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-27-ceo-shared-task-loop/manual-loop-preview.sqlite`

这只证明一次历史使用关系。Human 已明确暂不确认该库为正式库；当前无 3173 监听，未找到更新且明确的正式指定。**该路径没有被接入候选服务，没有被打开用于开发测试，没有复制、修改或创建替代正式库。** 没有读取完整进程环境或秘密配置内容来补足证据。

阻塞项仅为：正式 Taskboard 连接、正式读取适配器激活、正式反馈存储接线、依赖该绑定的 ready 状态。候选主服务明确返回 `BINDING_UNCONFIRMED`，不会用空数据或新空库冒充健康。后续由 Human 指定当前正式库及其启动所有者；本轮不重复询问、不扩大调查。

### 2.2 日志、数据目录与既有修改保护

当前 3000 应用通过现有辅助模块写入主目录下 `data` 的 JSONL 文件；没有核实跨进程独占写入锁。原 CEO 历史 SQLite 的当前写入者、归档及备份所有权仍未确认。因此本轮没有接入任何正式日志/业务写入路径，合成日志与租约仅落在测试目录。

原主目录已有未提交修改：`nawu-fetch/lib/dxm-c6r.cjs`、`nawu-fetch/lib/nawu-inventory.cjs`、`public/draft-executor-panel.js`，三份前后哈希均一致；既有未跟踪文件保留。原 CEO 与 run 目录跟踪差异前后相同。

保护抽样共 13 个文件，其中 12 个前后相同。唯一差异为主目录 `config/metrics-schema.json`：

- 开始 SHA-256：`f3fbfb1454a934cbfc8b155b3513f5c64d5ec62470bd9391b018846986f68efc`
- 结束 SHA-256：`933d63c4e5f1c3223aacb60708a6a2ce2302a385f425c3ca10a0ab3692b905ed`

本轮没有向该路径写入的操作，隔离测试写入门禁也不允许写到主目录；变化来源仍待确认，不能据此断言来源，也不能声称整个生产目录全程字节未变。已保留当前文件，不覆盖、不回退；G2 前需核对该变化并重新冻结基线。保护抽样也不能证明未抽样的所有生产文件均未变化。

## 3. 实际变更与影响范围

候选代码相对主基线共 **64 个路径**：32 份复用文件与原 CEO 提交完全一致、8 份复用文件按隔离边界修改、24 份新增或主系统修改。不是 64 个新功能。完整路径、来源分类、字节数及哈希见 [changed-files.json](CEO_Agent_V1.0_G0_G1_Evidence/changed-files.json)，复用来源见 [legacy-import-manifest.json](CEO_Agent_V1.0_G0_G1_Evidence/legacy-import-manifest.json)。

| 模块 / 文件（均位于独立 Worktree） | 修改目标与实际行为 | 影响、依赖和回滚 |
|---|---|---|
| M01：ceo-runtime-manifest.js | 必填代码/前端/契约/策略分组；SHA-256 指纹、只读冻结；拒绝危险路径、已知凭证文件名、目录越界及代码数据重叠；运行时复核字节变化 | 依赖既有 Node fs/crypto；健康检查可发现包漂移；回滚只移除候选实现 |
| M01：ceo-runtime-host.js | 原子租约单实例；身份包含 PID、入口、release、instance、startedAt；停止前核验进程与服务身份；无按端口杀进程回退；残留租约恢复需两次确认进程及监听均不存在 | 仅触碰隔离租约；不替代正式进程管理器；未知状态拒绝恢复 |
| M01：ceo-isolated-runtime.js | 真实本机 HTTP 测试入口；合成目录标记、独立监听、无默认数据库；纯读查询与 Human 合成反馈由测试注入 | 不含真实 Workflow、浏览器或外部执行接线；停止只作用于本实例 |
| M01/M02：ceo-main-boundary.js | 主入口及 CLI 的合成目录/路径门禁；cwd、业务根与数据根需一致；主服务 API 在处理器前鉴权；仅从明确的合成身份文件加载 fixture-* 身份 | 不发现或迁移生产凭证；候选主服务不能直接作为正式升级包激活 |
| M01：config.js、server.js | 代码资源与业务数据根分离；主入口初始化前检查隔离根、取得租约；版本与无副作用健康接口；信号停止及自身租约释放 | 原主目录文件未修改；正式绑定缺失时健康不 ready；不得将此分支直接部署 |
| M01：watchdog.js | 候选启动必须显式指定隔离目录及非业务端口；探测 /healthz；不再按端口 taskkill；缺绑定的 503 视为存活；未知/无响应时停止自动终止及恢复流程 | 仅候选副本变化；原生产 watchdog/启动脚本未替换；不声称已完成正式自动恢复 |
| M02：ceo-governance.js、ceo-capabilities.v1.json、ceo-principal.schema.json | 操作级授权、可信宿主注入身份、有效期/撤销、跨店拒绝、请求去重；角色字段不赋权；未知写路由默认拒绝 | 策略与执行器分离；无新 Agent 框架；当前去重表仅进程内存 |
| M02：ceo-task-http.js、ceo-legacy-view.js | 旧 CEO 保留纯读 Snapshot 与最多三项优先事项，不能创建正式任务/命令；存在惰性落库行为的旧读取返回 READ_MODEL_UNCONFIGURED；原手工工作区写闭环只在显式合成数据库目录放行 | 复用原领域与证据模块；正式纯读适配器未接线，不能虚报完整 Taskboard 页面可用 |
| CLI：ceo-task-loop.mjs、ceo-workspace.mjs | 可变操作需要显式合成根；数据库、凭证、输入输出路径限定该根；读命令保留；不加载默认真实身份或创建正式库 | 原 CLI 手工场景在合成数据回归；生产 CLI 授权方式未改变 |
| 复用模块、页面、契约 | 从原 CEO 提交复用上下文、决策、计划、证据、工作区等；补齐原有 ceo-tasks.html 页面依赖 | 未发明第二套任务系统；32 文件逐字节复用，其余修改见补丁 |
| 测试、fixtures、.gitignore | 12 个新增测试文件；原测试仅显式声明合成运行根及手工边界；保留原断言；四个 CLI 脚本单独纳入跟踪 | 不放开整个 scripts 目录；测试辅助设施及逐轮证据位于独立 .superpowers 目录 |

### 3.1 权限与兼容结果

| 身份 | 候选允许 | 候选拒绝 / 尚未接线 |
|---|---|---|
| 旧 CEO legacy | 明确允许的纯读、Context Snapshot、最多三项优先事项 | 正式任务导入、命令、Workflow、浏览器、Listing/草稿执行及有副作用的旧 GET |
| CEO vNext shadow | 纯读与 analyze 操作授权 | 生产写入；影子分析正式业务端点尚未接线，不将授权判定通过等同于分析功能已上线 |
| Human | 影子反馈授权；隔离入口中合成回调只执行一次；原手工 Taskboard 合成闭环；主服务明确列出的本地手工接口 | 主服务不使用宽泛 Human 通行规则；真实执行器即便合成 Human 也拒绝；真实登录/凭证迁移未实施 |

主服务 API 前置门禁对 legacy/shadow 覆盖动态枚举的 100 多个可变路由，并拒绝未知 API、大小写绕过、编码分隔符/点路径、查询参数绕过、URL/载荷店铺不一致、伪造角色及重复请求。此处“全部可达写入口”指本轮候选 HTTP API 清单和已识别 CLI 入口；没有声称重审整个项目所有外部脚本或实施操作系统级强制隔离。文件门禁依赖可信宿主及明确合成目录标记，不能当作抵御拥有本机写权限人员的安全边界。

新网关去重是进程内存、容量耗尽关闭放行，重复/冲突返回 409。原 Taskboard 操作记录的持久化重放场景已在合成库验证，但这不能证明新反馈网关跨进程重启去重。真实反馈写入前必须复用既有持久化操作记录并验证原子性、重启与并发，不另建生产库。

## 4. Git diff 与证据保存

完整补丁：[final-complete.diff](CEO_Agent_V1.0_G0_G1_Evidence/final-complete.diff)。其 SHA-256：

`5c6b18b37439d087970928fe95f26a08288e54ec822dafe6dabb174ca045ef18`

补丁基于 `052abd71301f0409ad6295fea78f24bb83bc35f3`，包含新文件内容，候选分支尚未提交；未合并、未推送。逐轮 `<label>.diff` 对应测试时的修改快照，`<label>.result.json` 包含命令、cwd、耗时、退出码；stdout/stderr 原样保留。逐文件 SHA-256 可定位最终候选内容。`.superpowers` 的测试记录不作为产品代码进入补丁。

证据交付目录为 `F:/yikuaborder-deploy/CEO agent/CEO_Agent_V1.0_G0_G1_Evidence`。仅复制明确列入清单的报告、差异和测试证据，不复制数据库、合成身份文件或真实凭证。全部交付文件哈希见 [evidence-manifest.json](CEO_Agent_V1.0_G0_G1_Evidence/evidence-manifest.json)。

## 5. 本轮测试、失败及修复记录

测试仅使用合成数据；测试进程从允许列表构造环境，不继承 API 秘密变量，npm 配置指向合成空文件。测试辅助门禁限制 Node 文件写入到新 Worktree 和 `F:/tmp/ceog1-20261105-isolated`，限制 SQLite 文件路径及网络目标，禁止访问已知正式业务端口和非本机目标。它是测试防错工具，不能替代操作系统隔离或全量生产状态审计。测试真实子进程的监听端口由测试分配，不启动、停止或替换 3000/3173 正式实例。

### 5.1 最终成绩

| 实际运行 | 结果 | 退出码 | 证据标签 |
|---|---|---:|---|
| 新增专项，12 个测试文件 | 55 / 55 通过，0 跳过 | 0 | final-g1-confirmed |
| 原 Taskboard CLI/HTTP、会话入口、只读 brief、决策、每日计划相关回归 | 142 / 142 通过，0 跳过 | 0 | final-related |
| npm run test:reliability | 45 / 45 通过，0 跳过 | 0 | final-reliability |
| npm test 最终复验 | 472 总计，446 通过，26 失败，0 跳过 | 1 | final-full-confirmed |
| 改动 JS/MJS 文件 node --check | 58 / 58 通过 | 均 0 | final-verification.json |
| git diff --check | 通过 | 0 | final-verification.json |

这些集合有交集，不相加当作独立通过数。全量套件明确未全绿。最终全量失败名称与本轮修正后的基线比较：27 项变为 26 项，没有新增失败名称；原 CLI 页面依赖缺失已通过精确复用旧页面解决。名称相同仅证明本轮观察到相同失败项，不能替代对全部失败根因的完整鉴定。

复现应在保留的新 Worktree 中通过安全记录器执行，不能直接在生产根运行这些测试：

```powershell
Set-Location -LiteralPath 'F:\yikuaborder-deploy\.worktrees\ceo-g0-g1-20261105'
python '.superpowers/sdd/ceo-g0-g1-20261105/run.py' review-g1 node --test dist/test/ceo-cli-safety.test.js dist/test/ceo-governance-bypass.test.js dist/test/ceo-governance.test.js dist/test/ceo-isolation-review.test.js dist/test/ceo-legacy-boundary.test.js dist/test/ceo-legacy-compat.test.js dist/test/ceo-main-boundary.test.js dist/test/ceo-main-entry.test.js dist/test/ceo-runtime-health.test.js dist/test/ceo-runtime-integration.test.js dist/test/ceo-runtime-manifest.test.js dist/test/ceo-watchdog-safety.test.js
python '.superpowers/sdd/ceo-g0-g1-20261105/run.py' review-related node --test dist/test/ceo-task-cli.test.js dist/test/ceo-task-http.test.js dist/test/ceo-conversation-entry.test.js dist/test/ceo-read-brief.test.js dist/test/ceo-decision-contract.test.js dist/test/ceo-daily-plan.test.js
python '.superpowers/sdd/ceo-g0-g1-20261105/run.py' review-reliability cmd /d /c npm run test:reliability
python '.superpowers/sdd/ceo-g0-g1-20261105/run.py' review-full cmd /d /c npm test
git diff --check
```

每条真实执行命令（含 RED 和失败尝试）及退出码统一见 [test-result-index.json](CEO_Agent_V1.0_G0_G1_Evidence/test-result-index.json)。本轮环境为现有依赖安装；没有引入新 Agent 框架或迁移凭证。

### 5.2 测试先行、失败和独立审查

- M01、M02、真实隔离 HTTP 集成、主入口、旧版边界、CLI、看门狗安全和审查修复均保留 RED→GREEN 记录，没有删掉失败记录。
- 初次基线的 SQLite 测试门禁将 undefined options 传入 Node SQLite，导致基础设施错误：417 总计、320 通过、97 失败。用最小合成 SQLite 重现并修正为默认 `{}` 后，基线为 417 总计、390 通过、27 失败。前一结果不能充当产品基线。
- 记录器一度遇到 Windows GBK/Unicode 编码错误，已统一 UTF-8；没有实际运行的命令不计测试成绩。相关上下文见 progress.md。
- 主入口隔离测试发现代码资源误用 cwd、以及取得租约晚于业务初始化的问题；先补失败断言，再修复代码资源根和初始化顺序。
- 独立代码审查发现 API 大小写绕过、cwd/PROJECT_ROOT 越出合成根、Human 放行过宽、URL/载荷店铺目标不一致、Runtime Manifest 漏掉 Listing 直接依赖。均以针对性失败断言核验后修复，最终专项和全量复验覆盖这些改动。见 [review-findings.md](CEO_Agent_V1.0_G0_G1_Evidence/review-findings.md)。
- 并行验证时新增专项曾 54/55，第二实例启动等待 1.5 秒不足。保留该失败；仅把测试等待上限改为 10 秒，仍要求原样断言 `INSTANCE_ALREADY_RUNNING`、退出码 1 和业务状态不变。复验 55/55，最终全量相同代码再跑 472 项。
- 看门狗 RED 阶段对正式端口的错误探测在测试网络门禁处被拒绝，没有实际请求正式业务端口；候选已在探测前要求隔离参数。

### 5.3 剩余全量失败

下列 26 项均在本轮基线已有，未扩展修复范围。包含 2 项 CEO workspace CLI 旧断言/契约问题，不能把它们称为无关或已解决；若 G2 计划使用该 draft CLI，须先处理。其余涉及 Listing、提示词/样例资源、ChatGPT 自动化以及 Windows 文件权限假设。完整错误、行号及断言见 [final-full-confirmed.stdout.log](CEO_Agent_V1.0_G0_G1_Evidence/final-full-confirmed.stdout.log)、[final-failures.json](CEO_Agent_V1.0_G0_G1_Evidence/final-failures.json)。

| # | 失败用例 | 位置 |
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

两项 CEO CLI 失败实际表现：inspect 预期 capacity 为 null，实际为 300；save-draft 返回 INVALID_DECISION、退出码 1（原测试要求 0）。本轮没有弱化这些断言以制造全绿；更深原因及期望契约须在对应使用范围内确认。

## 6. 风险、限制与剩余阻塞

| 问题 | 当前处置 | 是否阻塞 |
|---|---|---|
| 正式 CEO Taskboard 未指定；3173 无当前绑定 | 明确 unready；不打开历史候选库、不创建正式空库 | 阻塞正式接线、真实影子运行；不阻塞独立合成测试 |
| 主配置 metrics-schema.json 漂移 | 保留、不回退；记录双哈希及来源未确认 | 阻塞把 G0 视为完全冻结；G2 前重新核验 |
| 日志及数据库当前唯一写入者未确认 | 不接线；仅在合成目录验证租约/日志 | 阻塞正式反馈及任务存储接线 |
| 网关去重仅进程内 | 重复、冲突、超容量关闭放行；不接真实写入 | 真实反馈前需持久化/并发/重启验收 |
| 原 Taskboard 一些“读”会初始化/持久化 | legacy 默认拒绝并返回未配置读模型 | 完整只读 Taskboard 页面上线前需纯读适配器，不能静默降级为空 |
| 真实登录、身份迁移未验证 | 无真实凭证读取或迁移；候选以 fixture 门禁锁定 | 真实身份接入需另行 Human 审批 |
| 全量 26 项仍失败 | 保存本轮基线对比和原错误；不扩大本轮改造 | 影响计划使用功能的失败必须先解决，其他项由 Human 接受明确延期 |
| 无响应不等于进程已停止 | 候选 watchdog 不自动杀进程；恢复需明确不存在证据 | 正式服务恢复流程尚未审批/接线 |
| 前端真人操作、真实影子运行未完成 | 仅验证服务 HTTP、静态资源、测试中的 DOM/页面协议及手工闭环 | M07/后续准入项；不能声称真实业务端到端验收 |

## 7. 回滚及保留方式

本轮没有正式部署，无生产数据库迁移、生产配置升级或真实身份变更可回滚。生产服务仍由原主目录提供；不要用本候选覆盖原目录。

候选回滚单位为新 Worktree/分支和其合成数据。若需运行后停止，只允许对自己启动且身份匹配的隔离实例执行 graceful stop；不按端口、模糊 PID 或进程名终止服务。正常测试中的自有进程停止及租约释放已验证；残留租约恢复只有在进程和监听均明确不存在时允许，原租约留存为 stale 证据。不能自动恢复未知/正式实例。

验收期间保留 Worktree、全部差异和证据。Human 决定放弃候选后再定向移除该分支/Worktree/明确的合成目录；本轮不执行清理、reset、生产文件回退或数据库恢复。不得回退来源未确认的 metrics-schema.json。正式启动脚本未接入候选，所以回滚不需要修改现有自启动配置。

## 8. 需要 Human 决策及 G2 准入条件

本轮不再重复请求确认。待验收时需要明确：

1. 接受或退回本补丁所列 M01/M02 隔离候选实现；真实身份/凭证迁移须单独审批，当前没有授权。
2. 指定当前正式 CEO Taskboard 的准确路径、实际启动配置、服务和唯一写入者，并确认备份/恢复责任；历史候选路径不自动升格。
3. 核对 metrics-schema.json 的变化来源及意图，保留有效修改，重新形成可复现工程冻结点。
4. 对 26 项已有失败逐项按后续使用范围决定先修复或明确延期；涉及要用的 CEO draft CLI、页面及资源失败不能豁免为已通过。
5. 明确正式日志/反馈落点的唯一所有权，并批准未来只读查询适配器及持久化请求去重的具体范围。

G2 开发准入必须同时具备：本轮差异经 Human 验收；D1 正式数据/日志绑定及配置漂移缺口关闭；受影响功能的测试门槛明确；继续保留独立环境；后续范围获批。若 G2 涉及真实反馈或身份，还必须先获得独立的身份与写入授权，并完成持久化去重和纯读适配器验证。满足工程条件也不自动批准生产部署或真实 Workflow。

## 9. 本期交付与 Backlog

本期可交付范围为：可识别版本及字节指纹、无副作用健康检查、单实例租约/身份核验、安全停止与受限恢复原语、默认拒绝的操作治理、旧 CEO 只读约束、新版影子身份、合成 Human 反馈及兼容回归。它是隔离可审查候选，不能作为首期正式上线包直接启用。

后续已知范围：正式纯读 Taskboard 接线及证据链、受控 Workflow（本轮完全未执行）、运营轨迹与人工干预、真人前端和真实影子运行、每周复盘能力；按已批准方案相应模块另行审批。其他阶段工作树完整审计、外部执行系统全审计、历史全量回归继续保留 Backlog。没有借此展开无关重构或新框架选型。

## 附录：最终候选文件清单

所有相对路径均相对于 `F:/yikuaborder-deploy/.worktrees/ceo-g0-g1-20261105`，精确字节以 changed-files.json 和完整补丁为准。

| 路径 | 来源/变化类别 |
|---|---|
| `.gitignore` | 本轮新增/主系统修改 |
| `config/ceo-capabilities.v1.json` | 本轮新增/主系统修改 |
| `dist/src/ceo-daily-plan.js` | 原 CEO 精确复用 |
| `dist/src/ceo-daily-review.js` | 原 CEO 精确复用 |
| `dist/src/ceo-decision-contract.js` | 原 CEO 精确复用 |
| `dist/src/ceo-draft-workspace.js` | 原 CEO 精确复用 |
| `dist/src/ceo-governance.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-isolated-runtime.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-legacy-view.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-main-boundary.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-operating-brief.js` | 原 CEO 精确复用 |
| `dist/src/ceo-operating-context.js` | 原 CEO 精确复用 |
| `dist/src/ceo-read-brief.js` | 原 CEO 精确复用 |
| `dist/src/ceo-review-input-guard.js` | 原 CEO 精确复用 |
| `dist/src/ceo-review-replanning.js` | 原 CEO 精确复用 |
| `dist/src/ceo-runtime-host.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-runtime-manifest.js` | 本轮新增/主系统修改 |
| `dist/src/ceo-task-evidence.js` | 原 CEO 精确复用 |
| `dist/src/ceo-task-http.js` | 复用后增加隔离边界 |
| `dist/src/ceo-task-workspace.js` | 原 CEO 精确复用 |
| `dist/src/config.js` | 本轮新增/主系统修改 |
| `dist/src/server.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-cli-safety.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-conversation-entry.test.js` | 复用后增加隔离边界 |
| `dist/test/ceo-daily-plan.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-daily-review-ui.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-daily-review.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-decision-contract.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-draft-cli.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-draft-workspace.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-evidence-check-ui.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-governance-bypass.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-governance.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-isolation-review.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-legacy-boundary.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-legacy-compat.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-main-boundary.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-main-entry.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-operating-brief-ui.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-operating-brief.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-operating-context.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-read-brief.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-replanning-ui.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-review-replanning.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-runtime-health.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-runtime-integration.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-runtime-manifest.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-task-cli.test.js` | 复用后增加隔离边界 |
| `dist/test/ceo-task-evidence.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-task-http.test.js` | 复用后增加隔离边界 |
| `dist/test/ceo-task-workspace.test.js` | 原 CEO 精确复用 |
| `dist/test/ceo-watchdog-safety.test.js` | 本轮新增/主系统修改 |
| `dist/test/ceo-workspace-cli.test.js` | 复用后增加隔离边界 |
| `dist/test/fixtures/ceo-decision-cases.json` | 原 CEO 精确复用 |
| `dist/test/fixtures/ceo-operating-brief-fixture.js` | 原 CEO 精确复用 |
| `dist/test/fixtures/ceo-task-fixture.js` | 复用后增加隔离边界 |
| `public/ceo-tasks.html` | 原 CEO 精确复用 |
| `schemas/ceo-decision.schema.json` | 原 CEO 精确复用 |
| `schemas/ceo-principal.schema.json` | 本轮新增/主系统修改 |
| `scripts/ceo-draft-plan.mjs` | 原 CEO 精确复用 |
| `scripts/ceo-read-brief.mjs` | 原 CEO 精确复用 |
| `scripts/ceo-task-loop.mjs` | 复用后增加隔离边界 |
| `scripts/ceo-workspace.mjs` | 复用后增加隔离边界 |
| `watchdog.js` | 本轮新增/主系统修改 |

本轮在此停止：不合并生产分支、不部署、不改变生产身份权限、不创建正式经营任务、不执行真实业务写操作，等待 Human 验收与下一阶段授权。
