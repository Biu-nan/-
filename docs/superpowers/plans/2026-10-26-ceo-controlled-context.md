# CEO 受控初始化与草案存档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, one fresh final reviewer. Steps use checkbox syntax. 不启动并行实现，不覆盖WorkBuddy代码。

**Goal:** 宿主控制首店目标/事实版本，保存可恢复且不会重复建单的每日草案。

**Architecture:** 只读本地事实→固定目标/来源摘要→同库新增草案表。Agent只提供decision/candidates；无平台执行。

**Tech Stack:** 既有Node ESM、node:sqlite、crypto、node:test；无新依赖。

**Spec:** ../specs/2026-10-26-ceo-controlled-context-design.md 和首店v0.2契约。

## Global Constraints

- 复用现有隔离分支，基线ee00e6d；原目录8文件及style-reference服务不改。
- 真实容量null，提议120/30仅试算。缺窗口/覆盖率不产可用facts，不由net算利润。
- dbPath显式绝对路径；本轮实际演示使用隔离数据库，不打开生产库。
- 77项P1基线通过；完整回归24项旧失败已知，保持名单无新增，不自动合并部署。

## Review Focus

- 符号链接/路径越界与输入超限不得绕过固定本地数据边界（任务1测试）。
- 变更事实/字典不能复用旧contextId；同版冲突不能静默选新（任务1测试）。
- 同decisionId新内容、同goal版本新内容与并发保存不能覆盖旧记录（任务2测试）。
- 事务中后段错误不能留下半套目标/决定/计划（任务2测试）。
- CLI的调用者提供goal/facts/now或过期context不能伪造宿主数据（任务2测试）。

## Task 1：受控上下文

Files: Create config/ceo-store-400370.json, dist/src/ceo-operating-context.js, dist/test/ceo-operating-context.test.js。

Interface: loadCeoOperatingContext({projectRoot,now=new Date()}) -> Promise<{schema,contextId,loadedAt,goal,facts,observations,sourceManifest,gaps,resourceProposal}>。异常code为INVALID_CONFIG/INVALID_SOURCE/SOURCE_LIMIT/UNSAFE_SOURCE。

- [x] 写临时项目测试：已确认目标；真实容量null/提议独立；空目录缺项；两店过滤；缺窗口不提升；可追溯hash/行；重复读取稳定；文件/字典改变ID；版本冲突；无效行失败；软链越界失败；文件超限失败。
- [x] node --test dist/test/ceo-operating-context.test.js，Expected: 新模块缺失失败。
- [x] 最小实现，源记录永远只作为observations，并为缺项明确gaps。
- [x] 同命令，Expected: 全部通过；定点提交上述文件。

## Task 2：原子草案存档与CLI

Files: Create dist/src/ceo-draft-workspace.js, scripts/ceo-workspace.mjs, dist/test/ceo-draft-workspace.test.js, dist/test/ceo-workspace-cli.test.js。

Interface: new CeoDraftWorkspace({dbPath}); ready(); close(); saveDraft({context,decision,candidates,expectedContextId,now=new Date()}) -> {schema:'ceo-draft-receipt/v1',contextId,planId,status:'DRAFT',commitment,created:boolean,plan}; getPlan(planId) -> record|null。无任务执行方法。

- [x] 临时SQLite测试：保存后关闭重开内容一致；重复请求1份；源context变化冲突；同goal同版异内容拒绝；同decisionID异内容拒绝；注入数据库触发器使最后写失败后各表无新增；旧charm表不动；缺容量不选任务；非法决定不保存。
- [x] CLI子进程测试：inspect只读不建库；save-draft受控输入且持久化；额外goal/facts/now拒绝；旧context拒绝；import无副作用/错误不泄露。
- [x] node --test dist/test/ceo-draft-workspace.test.js dist/test/ceo-workspace-cli.test.js，Expected: 新模块/命令缺失失败。
- [x] 实现事务与稳定回执，重用P1校验器/草案函数，不复制新排程器。SQLite全序列事务、UNIQUE键；statement失败ROLLBACK。
- [x] 同命令加任务1及P1全套专项，Expected: 全通过。可靠性45项通过；完整回归与旧24名单一致。源代码语法检查。
- [x] 独立审查一次，Important/Critical一次RED→GREEN修复，Minor登记；代码提交、私有备份读回；报告与WorkBuddy交接同步主目录。

## 执行记录

2026-10-26：基线P1 77/77。用户要求参照成熟案例，已查官方Asana/Shopify，只将具体工时标成自提试算参数。实现两任务由Codex负责。

2026-10-26完成记录：新增30项，含原CEO148项通过；可靠性45/45；完整316/292/24同名旧失败。独立审查1Important已两反例RED→GREEN修复，1Minor深层JSON归类待优化，未二审。首店真实本地演练17观测/0可用facts，UNCOMMITTED/0已排定/3延期，重复保存created=false。私有交付最终提交与读回以本地交付回执为准，不以计划勾选推定远端成功。
