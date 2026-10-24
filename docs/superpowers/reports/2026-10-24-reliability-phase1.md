# 可靠性升级首批交付报告

日期：2026-10-24。阶段：总体方案W1/W2核心修复，未完成整套9.5分升级。用户已授权分阶段实施。

## 1. 目标和本次完成

- Listing：Schema硬错误、来源待复核、修复不完整均阻止提交。maxAutoFixRounds的0生效，限制为0–3整数。商品事实归一化与AI补全保留原provenance复核要求。
- 视觉QC：首图分项/总分和缩略图验证参与交付；局部本地检查保留未验证，不再虚构其余项通过。
- 候选恢复：candidateFile与交付file分开；候选立即隔离，续跑优先补验，补验通过后移回交付。正常/异常结束均隔离未合格图；路径在读取/上传模型前校验。
- 主状态：同路径串行、独占临时文件、文件同步和替换、最后有效快照；损坏保留原件，有有效快照时恢复，无有效快照显式失败；持久化成功才更新阶段和产物。
- 兼容互斥：启动写入尚未完成时同步预留busy，不提前发布阶段，失败释放，防止两个选品任务同时取得会话。此修复不等于跨进程浏览器租约已完成。
- 增加npm run test:reliability，并忽略新产生的状态快照、损坏原件和临时文件。无新增运行依赖。

## 2. 验证

| 检查 | 结果 |
|---|---|
| 首批安全回归（实际执行npm run test:reliability） | 45通过，0失败：Listing14、QC12、状态15、runner4 |
| 本次新增用例 | 41项，全部通过；另外4项是原有Listing测试 |
| 373dbcb隔离基线：根测试+Listing | 141项，115通过，26失败 |
| 375e894精确已提交代码副本：根测试+Listing | 182项，156通过，26失败 |
| 标准npm test | 已实际运行，仍失败，不能标全绿 |
| 既有manifest和十图框架脚本 | 实际运行，退出码均0 |
| 独立审核 | 首轮3项Important，逐项加失败回归后修复；复核3项均闭合，18/18独立复跑通过 |

基线及升级代码分别在独立目录运行；最后一轮升级代码来自git archive，排除其他会话未提交改动。没有启动真实Chrome、生图、店小秘写入或生产服务。依赖复用本机现有版本，无网络安装。

失败对照：24项旧断言/路径/夹具等失败保持；队列测试的EPERM在基线与升级版都出现，具体用例随运行波动。队列实现未在本批修改，单独复跑也存在这种波动，不能将其误记为业务修复或新增功能回归。

完整验证输出保存在本机visualizations的phase1-isolated-verification目录，不将测试运行态上传仓库。

### 最终完整测试失败用例（逐项保留）

- does not hard-stop image generation on storyboard or prompt-pack QC failures
- sends listing content with a stable backend fingerprint
- recovers listing content from previously sent Chinese listing prompts
- exposes all backend prompts in the knowledge prompt library
- exposes a manual reset for insert market radar selection
- keeps ChatGPT tool selection resilient to composer menu role changes
- does not hard-stop listing generation when ChatGPT web search cannot be toggled
- shows the Listing visual workflow v2 stages without replacing legacy controls
- keeps legacy planning completion available for standard Listing
- uses the native editor insertion path for a long prompt
- does not upload the same image twice when ChatGPT resets its file input
- recognizes stopped thinking with no assistant output instead of waiting for the global timeout
- surfaces write failures instead of swallowing them
- reads the smt_choice_listing workflow spec
- reads the sample task
- reads the context pack
- reads the agent job
- reads the artifact sample
- assembles the smt_choice_listing sample chain
- reports ready health when all P0 fixtures and the sample chain are available
- accepts all ten prompt start and end markers
- supports the seven-image luxury insert prompt pack
- keeps the strict luxury insert layouts and fixed copy in the template
- exposes Listing visual workflow v2 prompt templates through the prompt registry
- persists cancelled tasks and restores an interrupted queue as paused
- abandons a paused current product, preserves its snapshot and clears the workspace

这些失败未被删除、跳过或改写预期。后续W9将按业务规则变动、过期检查、缺失夹具及Windows环境分别处理。

## 3. 修改范围与提交

- 4cb9684：Listing门禁、复核来源与修复上限。
- 9d72005：视觉门禁、候选隔离及恢复。
- 420a452：主状态保存、快照恢复及启动互斥。
- 375e894：检查入口、私有备份回执及执行状态。
- 本报告、忽略规则及最终文档另外提交，不改变上述已验证的运行代码。

范围：listing-agent相关编排、事实归一化、旧视觉qc/runner、StateStore、新JSON存储、回归测试和文档。其他会话对chatgpt-adapter、dianxiaomi-adapter、server及public的未提交改动不纳入本次提交。

## 4. 交付与回滚

私有仓库：https://github.com/Biu-nan/yikuaborder-private-backup 。升级分支：upgrade/reliability-20261024。固定回滚标签pre-upgrade-20261024仍指向373dbcb，备份分支不移动。未推送原公开origin，不合并、不重启生产服务，不迁移真实数据。

部署前应先在独立实例上验证；工作区有并行未提交改动，不应直接用整个工作目录替换生产版本。代码回滚不能撤销外部操作，数据迁移另需一致性备份。

## 5. 已知限制与后续工作

- W1仅闭合本批Listing和视觉路径的已确认问题，尚未统一全部旧店小秘入口的授权/门禁。
- W2本批保护主StateStore，其他JSON、manifest和ecom台账的完整迁移尚未完成。
- 无有效快照且主状态损坏时，服务将显式拒绝加载，需要人工恢复；不会像旧版一样静默清空。首图缺缩略图或QC能力时会待补验，不能计合格。
- 仍需W3身份与对象权限、W4统一Job/输入快照、W5跨进程资源锁、W6完整ecom契约、W7草稿回读与防重复、W8新十图原生验收、W9测试收口及受控试运行。
- 完整测试目前非全绿，尚无真实生产端到端证据，不重新宣称系统已经9.5分。

本次目标、实现、影响范围和验收已记录；Backlog即上述剩余工作包。
