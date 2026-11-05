# CEO v1.0｜G0/G1 收尾核验与 G2 准入报告

日期：2026-11-05（Asia/Shanghai）  
对象：`feature/ceo-g0-g1-20261105` 的已交付隔离候选；基于主系统 `052abd71301f0409ad6295fea78f24bb83bc35f3`。  
结论：维持 M01/M02 **有条件隔离验收**；D1 部分确认，真实接线仍阻塞；本报告不批准生产合并、部署或进入 G2 集成。

## 1. 六个问题的直接回答

| 问题 | 收尾核验结果 |
|---|---|
| D1 哪些已确认？ | 3000 当前代码根、HEAD、五份实供前端资源、PID 与 watchdog 父进程链，以及业务数据根已交叉核实；3173 当前无监听 |
| D1 哪些仍未确认？ | 当前正式 CEO Taskboard 路径、3173 当前启动所有者、正式库与日志的唯一写入者仍为 **UNVERIFIED**；历史候选不升格为正式库 |
| metrics-schema.json 变化及来源？ | 1.0.0→1.1.0，23→33 个口径；原 23 项及原计算规则不变。新增 10 个 market.* 与 IXSPY P1 交付记录和相邻文件时间线对应；具体写入者/命令/PID及其授权仍 **UNVERIFIED** |
| M01/M02 能否隔离验收？ | 已交付内容未漂移，关键安全边界与原证据一致；64 路径均可映射到 M01/M02 或必要复用依赖。可以维持条件性候选验收，不能视为完整生产、登录、前端或持久化反馈验收 |
| 26 项失败有无新增？ | 在同一组合基线与相同测试入口范围内，**没有新增失败**：26 项文件/名称、规范化错误内容全部匹配；原测试报告条目无删除，新增 55 项。不是只对数量或名字作判断；也不等于全系统零回归 |
| G2 是否就绪？ | 真实集成未就绪。数据绑定、日志所有权、口径版本核准等仍阻塞相应接线；若后续另行批准，M03/M04/M05/M06 等的纯合成开发可独立开展。本轮未启动这些开发 |

本轮为收尾事实核验，不重做岗位讨论、全项目审计或改造设计。生产数据库未打开，没有迁移或建立替代正式库；没有改动生产数据、配置、身份或服务。新增写入仅为本目录的报告、证据和合成验证辅助文件，以及合成临时目录。没有修复产品代码。

## 2. 任务 A：D1 事实核验

### 2.1 当前 Runtime、资源和启动链

| 核验对象 | 事实 / 状态 | 交叉证据与边界 |
|---|---|---|
| 3000 当前服务 | **CONFIRMED**：`0.0.0.0:3000`，PID 18656 | 本轮监听元数据与只读 `/api/version` 相同 |
| 代码包 | **CONFIRMED**：`F:/yikuaborder-deploy`，分支 `feature/ykb-v1-phase1-identity-state`，完整 HEAD `052abd71301f0409ad6295fea78f24bb83bc35f3` | Git、版本响应、已审阅且哈希未变的版本接口源码相互一致；该 HEAD 本身不代表所有未提交配置也被冻结 |
| 数据根 | **CONFIRMED**：version 响应的 projectRoot/userDataDir 均为主目录 | 与 config.js 的 cwd、USER_DATA_DIR 解析及 data 路径一致；没有读取完整进程环境或凭证 |
| 实供前端版本 | **CONFIRMED**：index.html、ceo-command-center.js、ceo-tasks.js、app.js、styles.css 的 HTTP 字节哈希全部等于主目录文件 | 仅证明这五份资源；不等于真人浏览器和所有前端行为已验收 |
| 3000 直接启动者 | **CONFIRMED**：PID 17160 的主目录 watchdog.js → PID 18656；其父 PID 16664 为 cmd.exe | 主目录 start-workbench.vbs 指向同一 watchdog，构成配置与进程对应；最初由哪次登录/人工动作触发该 cmd.exe 仍未证明 |
| Runtime 时间 | 版本接口 startedAt 为 `2026-10-31T01:24:13.295Z`；OS 进程创建时间为 `01:21:56.123970Z` | 两者是不同时间点，不把应用完成初始化时间当成 OS 创建时间 |
| Node 版本 | 关联可执行文件 `F:/软件/node.exe` 的磁盘 ProductVersion 为 24.14.1；G1 测试 Node 为 v24.14.1 | 生产接口未暴露进程内 process.version，未附加调试器；“已加载进程内版本”精确证明仍 **UNVERIFIED**，不能单凭磁盘版本推定加载历史 |
| 3173 | **CONFIRMED**：本轮无监听；**UNVERIFIED**：当前应由谁启动、绑定哪个正式库 | 没有启动、停止或替换任何实例；有界匹配未发现对应计划任务或 Windows 服务，不据此宣称不存在其他启动机制 |

现有前端 `public/ceo-command-center.js` 将本机 CEO 界面挂到 `http://<当前主机>:3173/api/ceo/`；这是端口级入口，不包含数据库权威指定。3000 现有 server.js 没有直接挂载原 CEO Taskboard 服务；原 CEO CLI `serve` 以显式 `--db` 创建工作区。因此不能从“3000 运行正常”反推出 CEO SQLite 正式库路径。

本轮只请求已确认无副作用的版本接口及静态资源，未调用可能初始化状态的 `/api/status`、Taskboard 读写接口或真实 Workflow。

证据：[runtime-processes.json](G0_G1_Closure_Evidence/runtime-processes.json)、[runtime-version-assets.json](G0_G1_Closure_Evidence/runtime-version-assets.json)、[startup-owners.json](G0_G1_Closure_Evidence/startup-owners.json)、[前端绑定](G0_G1_Closure_Evidence/frontend-3173-binding.stdout.txt)。

### 2.2 正式 CEO Taskboard：继续 UNVERIFIED

本轮重新对齐现有启动引用、原 CLI 参数、历史运行记录；没有按文件名选择 SQLite，也没有枚举或打开业务数据库来猜正式身份。

最后一份可交叉核验的启动脚本，位于原 CEO Worktree：

`.superpowers/sdd/2026-10-28-ceo-evidence-check/restart-service.ps1`

该脚本与同目录 runtime-before.json、runtime-after.json 一致指向：

`F:/yikuaborder-deploy/.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-27-ceo-shared-task-loop/manual-loop-preview.sqlite`

**已证明的是历史使用关系，未证明的是现在的正式指定。** 当前 3173 无监听，启动配置引用没有提供更新的明确权威绑定；Human 也已明确不确认该历史库。本轮保持 `formalTaskboardPath=UNVERIFIED`，对应接线为 BLOCKED，不创建空库、不迁移、不根据既有 taskId 推定内容仍有效。

证据：[有界启动引用](G0_G1_Closure_Evidence/bounded-startup-db-references.txt)、[历史运行记录](G0_G1_Closure_Evidence/historical-runtime-records.json)、原 [g0-runtime.json](CEO_Agent_V1.0_G0_G1_Evidence/g0-runtime.json)。历史记录中的路径和表哈希是证据，不是启动指令。

### 2.3 日志写入所有权

| 目录/日志 | 已确认调用关系 | 尚未确认 |
|---|---|---|
| `F:/yikuaborder-deploy/data/event_log.jsonl`、action_log.jsonl、snapshots.jsonl、reviews.jsonl 等 | 当前 3000 实例构造 HiddenDataLoopService；config.js 将它们解析到 userDataDir/data；appendEvent/appendActionLog 等经 enqueueFileWrite 追加 | 不能据代码调用链证明“最后一条由该 PID 写入”，也不能证明它是唯一写入者 |
| 现有 json-write-queue.js | 串行队列是模块内 Map，可协调同进程操作 | 不是跨进程锁；正式目录唯一写入所有者为 **UNVERIFIED** |
| 3173 历史库/相关 CEO 操作记录 | 历史 CLI 可据 --db 访问工作区 | 当前服务不存在，当前正式写入者、备份/恢复责任为 **UNVERIFIED** |
| 候选租约/测试日志 | 只在新 Worktree 和合成目录内验证；原日志保护样本前后哈希一致 | 不据合成租约推出生产日志所有权已建立 |

本轮没有使用“读取业务接口”来探测写入者，也没有触发日志初始化。业务保护样本仅以只读字节校验；未输出其业务内容。正式日志/反馈接线继续阻塞，其他只读调查和纯合成开发不受此项阻塞。

证据：[调用位置](G0_G1_Closure_Evidence/log-write-references.stdout.txt)、[队列实现](G0_G1_Closure_Evidence/json-write-queue.js.source.txt)、[收尾保护快照](G0_G1_Closure_Evidence/protection-end.json)。

## 3. 任务 B：metrics-schema.json 异常变化

### 3.1 已证实的变化

文件：`F:/yikuaborder-deploy/config/metrics-schema.json`，仍为主目录未提交修改。本轮不覆盖、不回退、不暂存、不提交或合并该文件。

| 项目 | 原 G0 磁盘快照 | 本轮及原交付结束快照 |
|---|---|---|
| SHA-256 | `f3fbfb1454a934cbfc8b155b3513f5c64d5ec62470bd9391b018846986f68efc` | `933d63c4e5f1c3223aacb60708a6a2ce2302a385f425c3ca10a0ab3692b905ed` |
| version / updatedAt | 1.0.0 / 2026-10-25 | 1.1.0 / 2026-11-05 |
| calibers 数 | 23 | 33 |
| 原口径删除/修改 | — | 删除 0，原 23 项定义修改 0 |
| 原其他规则 | — | note、windows、timezone、freshness、metrics、forbidden 均语义相同；另有格式化变化 |

Git HEAD blob 的哈希为 `fd324de17c5ed8f17c89f0fbb28e7465808e65c720d7a06ca730daafd8515b0d`；转换为原工作区 CRLF 后恰好得到 G0 的 f3fb... 哈希。这是换行差异，不能当成第三次未知改动。

新增 10 个口径为：

- product_rank：`market.rank.sales7d@product_rank`、`market.rank.total_sales@product_rank`、`market.rank.price@product_rank`。
- category_research：`market.category.sales_1m@category_research`、`market.category.products@category_research`、`market.category.supply_demand_1m@category_research`、`market.category.top100_price@category_research`。
- keyword_rank：`market.keyword.searches@keyword_rank`、`market.keyword.competitive@keyword_rank`、`market.keyword.cvr@keyword_rank`。

已枚举的相关 Worktree 中，只有主目录文件与新版哈希一致；CEO 候选仍保留原 G0 字典哈希，未自动吸收主目录改动。其他树仅比较这一目标文件的状态/哈希，没有展开完整审计。

### 3.2 来源归属：交付记录对应，具体写入者未查明

可用记录组成以下时间线（本地 Asia/Shanghai；文件时间不是作者证明）：

| 时间 | 记录 | 能证明什么 |
|---|---|---|
| 10-27 的既有 Git 提交 | `04ca7772a7c75ff997c1c1e786c52c76743a78a8` 包含旧文件 | 当前 1.1.0 修改没有对应新提交，Git 无法给出此次未提交写入者 |
| 11-05 09:57:16 | IXSPY_P0_VALIDATION 文档 mtime | 相关交付链在文件修改前已存在；不证明授权及其所有业务结论 |
| 11-05 10:01:33.412 | metrics-schema.json mtime | 当前磁盘元数据记录的最后修改时间 |
| 11-05 10:02—10:04 | ingest-ixspy-raw、market-scan-plan、verify-market-scan 等文件时间 | 与新增口径消费链相邻；所读脚本消费注册表，未发现它们写该字典 |
| 11-05 10:05:04.923 | `docs/IXSPY_P1_CLOSEOUT_2026-11-05.md` | 文档明确把“version 1.1.0、33 个口径、新增 10 个 market.*”列为其交付物，与实际差异一致 |
| 本轮收尾观察区间 | 前后两次文件哈希、mtime 未变 | 未观察到本轮期间继续修改该文件；不能证明其他工具没有并行任务 |

**确认结论**：变更内容和 IXSPY P1 交付记录的归属关系有交叉支持；是共享主目录中的他项交付与 CEO 冻结点重叠，应保留现场。

**UNVERIFIED**：哪位操作者/哪个进程/哪条命令实际写入、该他项工作的 Human 授权、供应商对新指标语义的官方确认。没有可用的逐次文件写入审计记录来完成精确归因；没有读 shell 历史、凭证、全量进程环境或未授权业务接口来扩大调查。返回的 Codex 历史中未发现对应 IXSPY 标题的活跃任务，不足以排除 WorkBuddy 等其他工具，也不能凭此判定具体作者。

本轮没有证据证明“其他任务现在仍在写该文件”；发现的是已经发生的共享基线重叠。文件已保留，不争抢、不回退，不用“来源大致对应”代替精确归因。

证据：[语义差异](G0_G1_Closure_Evidence/metrics-semantic-delta.json)、[完整 Git 差异](G0_G1_Closure_Evidence/metrics-git-diff.stdout.txt)、[时间及相关文件哈希](G0_G1_Closure_Evidence/metrics-related-records.json)、[各树比较](G0_G1_Closure_Evidence/metrics-worktree-comparison.json)、[IXSPY 交付记录副本](G0_G1_Closure_Evidence/IXSPY_P1_CLOSEOUT_2026-11-05.md.source.txt)、[归因判断](G0_G1_Closure_Evidence/metrics-provenance-assessment.json)。该文档中的后续建议不是本轮授权，本轮未执行其抓取、写 facts、计划或自动化动作。

### 3.3 对指标、事实和 CEO 决策的影响

1. **原有计算规则没有直接变化。** 原 23 个口径及阈值、窗口、新鲜度规则均相同；字典本身没有修改经营数值。不能因此声称所有下游结果均不受影响。
2. **注册表的允许集合扩大了。** scripts/metrics-store.mjs 的 appendFacts 会检查口径是否注册；新版允许这 10 个键通过该检查。它还缓存 loadSchema 结果，旧进程与新进程可能使用不同字典；当前各消费进程实际已加载版本仍 UNVERIFIED。不能仅看磁盘版本或 Git HEAD 宣布口径一致。
3. **CEO Context 身份会变化。** 既有 loadCeoOperatingContext 对整份字典字节计算 dictionaryHash，并纳入 contextId；即使只新增无关口径或改变格式，旧 expectedContextId 也可能失效。现有保存边界会拒绝旧 Context，不应绕过校验沿用旧批准或任务草案。
4. **注册不等于业务事实核准。** 新定义中的榜期增量、总销量窗口、转化率单位等来自相关交付的实测/推断，且其文档仍列供应商语义待确认。不能直接把市场销量当自店销量、展示价当供货价、相对指数当利润或市场容量的确定上限。市场与自店对标还需要同口径/时间窗/币种/店铺映射。
5. **当前 CEO 读取链不会自动接收 IXSPY。** 既有候选读入路径固定为 facts/aliexpress，观察记录仍 PENDING_VERIFICATION、facts 为空；现有 recompute-metrics 也显式区分 dianxiaomi 和 aliexpress。未发现该注册表变更自动将 market facts 注入现有 CEO 已核准事实的连接。未来 M03/M04 若扩大来源，必须重新核准，不能沿字典注册自动放行。

为覆盖本次新确认的风险，仅新增并运行 **3 项合成验证，3/3 通过，退出码 0**：保留旧定义与计算规则；字典更新改变 Context ID 但不改变/核准合成观察；注册 market 口径仍不使 IXSPY 合成记录进入当前 CEO 读取器。未使用真实业务事实，未调用生产服务做测试。

证据：[合成验证代码](G0_G1_Closure_Evidence/dictionary-impact.test.mjs)、[原始结果](G0_G1_Closure_Evidence/dictionary-impact.stdout.log)、[命令与退出码](G0_G1_Closure_Evidence/dictionary-impact.result.json)。可复核命令为 `python "F:/yikuaborder-deploy/CEO agent/G0_G1_Closure_Evidence/run-dictionary-impact.py"`，该辅助脚本使用 G1 既有写入/网络门禁及合成目录，独立保存复验结果。

## 4. 任务 C：候选范围、依赖和验收证据

### 4.1 候选完整性和 64 路径范围

保留工作树：`F:/yikuaborder-deploy/.worktrees/ceo-g0-g1-20261105`。候选尚未提交，没有合并、推送或部署。当前完整差异 SHA-256 仍为：

`5c6b18b37439d087970928fe95f26a08288e54ec822dafe6dabb174ca045ef18`

本轮重新核对：**64/64 文件等于原交付哈希；155/155 原证据文件符合交付清单哈希；当前 git diff 与原完整补丁字节相同；git diff --check 退出码 0。**

| 类别 | 数量 | 与批准范围关系 |
|---|---:|---|
| 原 CEO 提交精确复用 | 32 | 必要领域模块、既有 CLI、契约、页面、测试依赖；不是本轮开发了 M03—M08 |
| 复用后增加隔离边界 | 8 | ceo-task-http、两个 CLI、四份测试及一个 fixture；核对原提交差异后，测试断言未削弱，仅显式声明合成根/手工兼容边界 |
| 本轮新增/主系统候选修改 | 24 | 六个安全/Runtime/兼容模块、config/server/watchdog、权限配置与 schema、精确 CLI 跟踪规则及 12 份专项测试 |
| 合计 | 64 | 均在独立树内；没有包含主目录 metrics-schema.json、外部采集脚本或其他阶段整合 |

逐路径判定见 [64-path-scope-review.json](G0_G1_Closure_Evidence/64-path-scope-review.json)，复用修改差异见 [modified-reuse.diff](G0_G1_Closure_Evidence/modified-reuse.diff)，完整性见 [candidate-integrity.json](G0_G1_Closure_Evidence/candidate-integrity.json)。原完整补丁保留于 [final-complete.diff](CEO_Agent_V1.0_G0_G1_Evidence/final-complete.diff)。

### 4.2 未追踪依赖与发布限制

静态检查从 25 个变更生产 JS/MJS 入口追踪到 87 个模块、176 条本地引用：没有缺文件、没有逃出候选目录的相对 import、没有引用到未列入 Git 的本地源文件。补查 8 个旧服务静态资源及 4 个动态配置/示例/契约路径均存在并列入 Git。检查未执行这些模块的业务初始化，也不是对所有可选执行器的数据路径做全量审计。

**新增披露的复现条件**：候选没有自己的 node_modules；Node 向祖先目录解析到 `F:/yikuaborder-deploy/node_modules`。7 个直接外部依赖的版本与候选未修改的 package-lock 一致：ajv-formats 3.0.1、ajv 8.20.0、express 4.22.2、jsonrepair 3.14.0、multer 2.1.1、playwright-core 1.60.0、xlsx 0.18.5。没有发现新增未声明包，但这些安装文件并未纳入候选补丁，未验证干净安装及全部传递依赖字节。

这不证明生产数据被使用，也不是隔离代码范围越权；它说明已有成绩基于“合成数据隔离＋复用已有依赖安装”，**不是完全自包含的发布包**。后续集成前需要在独立环境按 lockfile 安装并检查，不能在生产 node_modules 上安装、升级或清理。本轮没有安装或修改依赖。

另有 131 个未跟踪的证据/测试残留路径，其中 45 个位于 `.superpowers/test-data`，包括早期合成文件及租约；均不在产品补丁，静态导入不依赖它们。没有发现这两个已知目录外的额外未跟踪路径。未读取其中凭证文件内容，也未清理现场。后续打包必须采用白名单，不能 git add -A 或复制整个工作树将合成身份/测试残留带入。

Runtime Manifest 当前主要覆盖代码/前端/契约/策略；业务字典等数据配置以 Context 哈希约束。主机 Node 二进制、实际 node_modules 字节、watchdog/CLI 启动脚本并非全部由主服务健康指纹覆盖。工程冻结仍需补丁、依赖锁和配置快照共同描述，不能只凭一个健康指纹声称全发布包已冻结。

证据：[静态依赖](G0_G1_Closure_Evidence/dependency-closure.json)、[包来源](G0_G1_Closure_Evidence/package-provenance.json)、[动态依赖](G0_G1_Closure_Evidence/dynamic-dependency-check.json)、[未跟踪路径分类](G0_G1_Closure_Evidence/untracked-review.json)。

### 4.3 M01/M02 的条件性验收判断

| 验收点 | 可接受的已有证据 | 不包含的能力 |
|---|---|---|
| M01 版本/健康 | 版本指纹、字节变化拒绝、只读健康检查；正式绑定未确认时 unready | 正式库连通性和生产发布包完整性 |
| M01 启停 | 合成真实子进程竞争租约、第二实例拒绝、身份检查、安全停止、受限租约恢复 | 不探测/控制正式实例，不证明正式 watchdog 自动恢复链已可用 |
| M02 身份与操作 | 受信宿主签发 principal；旧 CEO/影子权限分离；伪造、越权、跨店、重复请求拒绝；100 多主 API 可变路由在处理器前拒绝 Agent | 没有迁移真实登录或凭证，不证明 OS 级安全隔离或整个外部执行系统完整治理 |
| 旧 CEO | 只读 Snapshot、最多三项优先事项；拒绝业务写入；有惰性写入的旧读取保持 READ_MODEL_UNCONFIGURED | 不代表完整正式 Taskboard 纯读适配已完成 |
| Human | 合成手工 Taskboard 闭环、反馈及有限本地主服务接口兼容 | 不包含全部真人 UI、正式登录、真实 Workflow；候选仍拒绝真实执行桥 |
| 重复请求 | 同进程重复/冲突与容量限制测试；旧领域持久化场景有合成证据 | 新网关去重表仅内存，真实反馈跨重启去重尚需实现和验收 |

原交付 55/55 新专项、142/142 相关回归、45/45 可靠性成绩的记录和候选字节均被复核，故未无必要重跑。它们是 **G1 已运行成绩**，不是本次新跑成绩。本次仅运行前述 3 项字典影响验证；不能把 3 项结果加到旧成绩上宣称新一轮全量通过。

没有发现需要撤销 M01/M02 隔离候选接受的新增生产影响证据；上述不足保留为条件和使用门槛。正式部署/集成/身份迁移仍未获准。

## 5. 26 项全量失败的逐项核对

### 5.1 比较基线与结论边界

比较的是同一组合：主系统 HEAD 052abd7 加从 CEO HEAD fed03d3 明确导入的旧模块，在新 Worktree 内、经修正的合成测试门禁下运行。

| 运行 | 入口 | 原记录结果 |
|---|---|---|
| 改造前 baseline-corrected | `node --test dist/test/*.test.js` | 417 总计，390 通过，27 失败，退出码 1 |
| 最终 final-full-confirmed | `cmd /d /c npm test` | 472 总计，446 通过，26 失败，退出码 1 |

package.json 未变且 test 脚本恰好为 `node --test dist/test/*.test.js`，没有 pretest/posttest 差异。报告器条目（含套件）从 449 增至 504，旧条目多重集合删除 0、新增 55；真实测试数增长也是 55。原测试未因范围改变而被静默排除。

逐失败匹配“测试文件身份＋用例名称＋错误诊断”；仅剔除耗时/调用栈调度差异，保留断言、实际/预期值、错误码及资源缺失特征。**26/26 规范化诊断完全相同，新增失败 0**。两项 CEO workspace CLI 的行号因前置合成标记增加一行而从 19/24 移至 20/25；文件和用例身份、断言及诊断未变，行号映射已逐项保存，不能表述为所有行号完全相同。唯一消失的是旧 CLI/page 手工闭环失败，其页面依赖缺失通过精确复用旧页面解决。

这是对本轮批准组合基线的可验证回归结论。首轮审计的 73/73 计算、25/25 静态检查不是这套全量测试基线；现有材料不能证明 Human 曾单独豁免全部 27 项缺陷，也不能把“无新增”解释为“26 项已批准忽略”。这些失败仍未解决；超出测试范围、共享依赖此前未记录的字节以及真实生产运行不存在“零回归”保证。

证据：[逐项诊断](G0_G1_Closure_Evidence/failure-signatures.json)、[测试条目多重集合比较](G0_G1_Closure_Evidence/test-inventory-comparison.json)、[原始测试索引](CEO_Agent_V1.0_G0_G1_Evidence/test-result-index.json)。

### 5.2 完整失败标识

下表每项的诊断均与基线一致；指纹为完整规范化诊断 SHA-256 的前 12 位，完整文本及哈希在 failure-signatures.json 中。此处仅简写文件位置，均位于候选 `dist/test`。

| # | 测试用例 | 位置 | 相同诊断指纹 |
|---:|---|---|---|
| 1 | does not hard-stop image generation on storyboard or prompt-pack QC failures | `automation-service-listing.test.js:114:5` | `82ab3eae2cd6` |
| 2 | sends listing content with a stable backend fingerprint | `automation-service-listing.test.js:156:5` | `82f9b186faa7` |
| 3 | recovers listing content from previously sent Chinese listing prompts | `automation-service-listing.test.js:174:5` | `4d5e8f72987f` |
| 4 | exposes all backend prompts in the knowledge prompt library | `basic-feature-smoke.test.js:80:5` | `2cfde9b32434` |
| 5 | exposes a manual reset for insert market radar selection | `basic-feature-smoke.test.js:105:5` | `590035e1e2ab` |
| 6 | keeps ChatGPT tool selection resilient to composer menu role changes | `basic-feature-smoke.test.js:156:5` | `417a3dc9882c` |
| 7 | does not hard-stop listing generation when ChatGPT web search cannot be toggled | `basic-feature-smoke.test.js:164:5` | `219e29d80957` |
| 8 | shows the Listing visual workflow v2 stages without replacing legacy controls | `basic-feature-smoke.test.js:186:5` | `b2595143552e` |
| 9 | keeps legacy planning completion available for standard Listing | `basic-feature-smoke.test.js:208:5` | `219e29d80957` |
| 10 | inspect is read only and produces the host goal with quarantined facts | `ceo-workspace-cli.test.js:20:1` | `c35d0ddf4e2c` |
| 11 | save-draft persists once using the inspected host context | `ceo-workspace-cli.test.js:25:1` | `e3f79d7f8e9e` |
| 12 | uses the native editor insertion path for a long prompt | `chatgpt-wait.test.js:6:5` | `b955a4f5416a` |
| 13 | does not upload the same image twice when ChatGPT resets its file input | `chatgpt-wait.test.js:18:5` | `fa16ad6d6000` |
| 14 | recognizes stopped thinking with no assistant output instead of waiting for the global timeout | `chatgpt-wait.test.js:53:5` | `cb3531ad53a8` |
| 15 | surfaces write failures instead of swallowing them | `daily-operation-service.test.js:146:5` | `225d98142ed6` |
| 16 | reads the smt_choice_listing workflow spec | `p0-protocol-service.test.js:9:5` | `84502eb311bf` |
| 17 | reads the sample task | `p0-protocol-service.test.js:15:5` | `173c48538667` |
| 18 | reads the context pack | `p0-protocol-service.test.js:23:5` | `295fc4f9df6e` |
| 19 | reads the agent job | `p0-protocol-service.test.js:32:5` | `7d1760086fc2` |
| 20 | reads the artifact sample | `p0-protocol-service.test.js:41:5` | `5ca5d57a6e64` |
| 21 | assembles the smt_choice_listing sample chain | `p0-protocol-service.test.js:51:5` | `84502eb311bf` |
| 22 | reports ready health when all P0 fixtures and the sample chain are available | `p0-protocol-service.test.js:68:5` | `7f9c3a2e99a5` |
| 23 | accepts all ten prompt start and end markers | `prompt-files.test.js:15:5` | `3c3a1d879237` |
| 24 | supports the seven-image luxury insert prompt pack | `prompt-files.test.js:30:5` | `d0a78775f3c9` |
| 25 | keeps the strict luxury insert layouts and fixed copy in the template | `prompt-files.test.js:40:5` | `cd1556f083d6` |
| 26 | exposes Listing visual workflow v2 prompt templates through the prompt registry | `prompt-files.test.js:68:5` | `2474b957b452` |

两项 CEO workspace CLI 的实际问题明确保留：inspect 期待 capacityMinutes=null，实际 300；save-draft 返回 INVALID_DECISION、退出码 1 而非 0。它们不是本轮新增，也不是已经通过；后续若使用该草案 CLI，须先处理其契约/fixture 不一致，不得弱化断言制造全绿。

其他失败涉及 Listing 断言、缺少 src/*.ts、P0 样例缺失、ChatGPT 假对象接口、提示词注册/布局及写失败断言。按后续实际调用范围前移所需修复，其他保留 Backlog；本轮未扩大修复。

## 6. G2 阻塞、可独立工作与停止状态

### 6.1 精确到操作的阻塞清单

| 项目 | 状态 | 阻塞哪一步 | 不阻塞什么 |
|---|---|---|---|
| 正式 Taskboard 路径及服务所有者 | UNVERIFIED | 真实库适配器激活、同库 snapshot 与正式影子读取 | 合成 Taskboard 读模型/接口测试 |
| 正式日志唯一写入者及恢复责任 | UNVERIFIED | 正式影子日志、Human 反馈持久化接线 | 合成文件上的幂等/重启/损坏测试 |
| 字典 1.1.0 的冻结与核准 | 待 Human 决定采用哪份精确版本 | 与正式经营 Context 绑定、跨源数据进入决策 | 使用各版本固定副本做兼容验证；具体写入者不明不应阻塞无关纯隔离工作 |
| D3 事实权威性、窗口、有效期和店铺映射 | 未在本轮完成 | 将真实数值接纳为 CEO 有效事实；市场与自店对标 | 合成证据质量与缺口报告 |
| 纯读 Taskboard 适配与新反馈持久去重 | 尚未完成 | 真实查询不得隐式写库；真实反馈不得重启后重放 | 隔离纯读 SQLite、合成轨迹与去重开发 |
| 共享依赖安装的复现条件 | 已披露，独立安装未验证 | 把候选作为可自包含的正式集成包验收 | 现有已冻结证据审阅及纯逻辑开发 |
| 两项 CEO draft CLI / 其他已有失败 | 使用范围相关门槛 | 计划使用的失败路径须先修复或不纳入集成 | 不依赖这些路径的隔离模块；其余不调用能力可明确延期 |
| Human 下一阶段授权 | 当前未批准 | 进入 G2 开发/集成及一切真实身份迁移、部署 | 本报告的只读收尾与验收准备 |

不能把“某人写过配置但精确作者未知”当成停止整个项目的理由；也不能以此绕过正式绑定与口径核准。关闭阻塞应接受可复现的路径/所有者/精确哈希及审批记录，不接受文件名推定或默认健康。

### 6.2 若后续获批，可独立开展的 G2 纯隔离工作

下表是可切分的下一阶段范围建议，不是本轮已经授权或已经实施的工作：

| 模块 | 可独立开展的最小工作 | 独立验收边界 |
|---|---|---|
| M03 证据与分析 | 合成证据包、口径/期间/过期/缺值校验；生成“可判断/不可判断”分析 | 不引用真实经营值，不提升 PENDING 事实，不创建任务 |
| M04 Taskboard 纯读 | 仅对合成 SQLite/内存数据实现 snapshot 接口，验证缺库不创建、读取不初始化 | 不填入推测的正式路径；不导入正式任务 |
| M05 Workflow 状态读取 | 用固定状态快照验证只读接口和 UNKNOWN/在途语义 | 不调用真实执行器、不派发、不恢复任务 |
| M06 影子轨迹与 Human 反馈 | 合成日志上的持久请求去重、冲突、并发、重启、尾损坏、写失败测试 | 不接正式日志；保持影子事件与正式任务写入分开 |
| G2 打包/接口契约 | 在独立目录验证 lockfile 安装、启动白名单、版本/数据字典快照及模块联测 | 不安装或改动主目录依赖，不激活生产登录 |

M07 真人前端与正式影子运行、M08 周复盘、真实 Workflow 调用等按原方案相应关卡另批，不借本次“纯隔离可做”扩大范围。

### 6.3 本轮影响与保护结果

生产服务没有被启动、停止、替换或重新配置。收尾保护样本 13/13 与上一交付结束哈希相同，且本轮前后相同；因此 metrics-schema.json 的此前变化没有在本轮再次发生。候选补丁仍逐字节相同。保护样本不能证明整个生产目录从来无人修改，特别是已记录的 IXSPY 他项交付不能被本轮“未写入”声明覆盖。

本轮无产品代码回滚事项。保留候选 Worktree、未提交改动、未跟踪测试现场和旧证据；不得回退主目录字典或清理其他任务文件。新增报告/证据属于交付物，不改变服务启动链。

本轮到此停止，提交 Human 审阅。不合并、不部署、不迁移真实身份、不创建正式业务任务、不执行真实 Workflow，不自动进入 G2。

## 7. 交付证据索引

- 原隔离实施报告及证据目录保持原样，155 个清单文件哈希已核验。
- 本轮证据位于 `F:/yikuaborder-deploy/CEO agent/G0_G1_Closure_Evidence`：D1 当前事实、配置差异/时间线、64 路径范围及依赖、26 项诊断对照、3 项合成测试和保护快照。
- 本轮证据文件哈希见 [evidence-manifest.json](G0_G1_Closure_Evidence/evidence-manifest.json)，验证方法及查找过程中的非产品错误见 [closure-method.json](G0_G1_Closure_Evidence/closure-method.json)。初次路径查找和 Windows 编码问题已记录并修正，不充当产品测试失败或测试通过。
