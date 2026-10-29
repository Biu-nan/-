# CEO 本机证据核对与验收限制

目标：继续原 CEO 经营闭环，避免只凭文件引用和摘要字符串就将真实经营任务标记完成。业务目标仍是首店 400370 在 2026 年 12 月每日支付商品件数至少 200、月经营净利润至少 12,000 元（品质罚款单列），常规容量 240 分钟/日。

## 本轮实现

- `GET /api/ceo/tasks/:id/evidence-check`，现有 owner/agent 鉴权，只读取回执中登记的原件，返回摘要与读取状态，不返回文件内容。
- 本机 CEO 命令 `evidence --base-url http://127.0.0.1:3173 --token-file <existing-token-file> --task-id <task-id>`。凭证不放 URL 或文档。
- 只支持主项目 `data` 下首店目录；拒绝外链、跨店、路径跳转和目录链接。8 份以内、单份 10 MiB、合计 32 MiB，流式有限读取，失败关闭句柄。
- 真实经营任务正向验收需带 `evidenceCheckId`；原 SQLite 命令事务在幂等重放之后重新核对，原件变化、缺失或检查标识失配时回滚，不新增操作回执或事件。负向退回补证可继续使用。
- 摘要一致只代表文件与回执一致；仍要求经营者明确选择业务验收结论。通过后仍是 `HUMAN_ATTESTED`，经营效果保持 `PENDING_OBSERVATION`。
- 原可信 workspace API 与 DEMO 演练兼容。HTTP 身份和 checker 来自服务端，不接受请求体注入。结果未知处理机制不变。

## 验证记录

- 新增读取器、接口、命令和 DOM 测试均有失败后通过记录。最终影响集 141/141 通过；全部 CEO 测试 247/249，两项旧 `ceo-workspace-cli.test.js` 假设目标 v1/人力未确认，已用 bf245be 原测试及未变更依赖复现，登记 Backlog，本轮未放松生产验证。
- 真实日历调查任务 v5 保持 `PENDING_VERIFICATION`；本轮只读检查 4 份原件均 MATCH，回执资料缺口依然存在，不进行真实验收或复盘写入。
- 一次独立最终审查发现两个 Important，均经过负例失败后修复通过：父目录限定首店范围，BigInt dev/ino 将文件句柄与核准路径对象在读前、读后绑定，拒绝身份变化。保留一项 Minor：CLI `command` 的四个新错误码会被归为 SERVICE_UNAVAILABLE；浏览器已有具体提示，后续完善 CLI 错误映射。确定性竞态模型已验证，未声称做过系统级 Windows junction 竞态压力实验。
- 仅安装主项目 `public/ceo-tasks.js` 与新增 `public/ceo-evidence-check.js`；只重启 3173，进程 15876 → 42456，保留相同主项目 root、原 DB 和凭证。主上架进程在协同开发中由 19536 变为 29968，本轮未停止它。
- 更新后原 CEO 命令实测返回 MATCH、4 份原件、HUMAN_REQUIRED；原指挥台 `http://localhost:3000/#` 已显示核对入口与四项一致结果，验收结论选择保持空白。未点击业务验收、审批、领作或复盘提交。
- 前后 10 张原库表逐行指纹一致：7 个任务、22 条事件、15 个操作、3 个计划、0 份真实复盘、0 个复盘接续关联。没有 schema 迁移。
- 主项目 app.js、styles.css、workflow-alert.js/css 指纹未变；index.html 和 run-state.json 在协同进程中变化（页面可见 Listing 正在运行），已保留，没有以旧副本覆盖。不能宣称所有主项目文件或运行状态完全未变化。

可复查命令（在开发工作区，使用现有 Node 运行时）：

```powershell
node --test dist/test/ceo-task-evidence.test.js dist/test/ceo-task-workspace.test.js dist/test/ceo-task-http.test.js dist/test/ceo-task-cli.test.js dist/test/ceo-evidence-check-ui.test.js
node --test dist/test/ceo-*.test.js
node --check dist/src/ceo-task-evidence.js
node --check public/ceo-evidence-check.js
git diff --check
```

第二条全量命令会暴露上述两项已确认的旧夹具失败，不代表全量通过。最终影响集完整日志、全量日志和数据库指纹在本轮忽略的 ledger 目录。

## 协同边界

WorkBuddy 不需重复开发原件核对、正向验收限制或新建任务库。此文档只是本地同步记录，尚未收到 WorkBuddy 阅读回执。后续业务重点仍是补当前活动 SKU 级实际价格、库存和费用口径，再由经营者判断原调查任务是否满足验收并记录真实日终复盘。

## 回滚

- 开发基线 `bf245be`，工作区 `F:/yikuaborder-deploy/.worktrees/ceo-read-brief`，分支 `upgrade/ceo-read-brief-20261026`。
- 本轮仅本地提交，不声称已推送 GitHub。保留全部旧工作区和业务证据。
- 本轮源码本地提交 `648c735`；后续说明记录提交不改变运行代码。因全量仍有两项旧测试失败，保留当前分支，不执行合并或推送。
- 原运行库 SQLite 一致性备份、静态文件原字节备份及前后指纹保存在本工作区 `.superpowers/sdd/2026-10-28-ceo-evidence-check/`。这是忽略的本机回滚资料，不提交凭证/数据库。
- 回滚界面可还原备份的 `public/ceo-tasks.js` 并停止引用新模块；后端可在单独旧代码副本运行相同主项目 root、原数据库和原凭证。不要为回滚代码覆盖真实库或删除新产生的业务记录。

## Backlog

1. 当前活动 SKU 价格、库存、完整费用与正式支付/利润口径待核，不能宣称目标达成。
2. 原 Listing ChatGPT 导航冲突根因另行修复；本轮不改变上架服务。
3. 两项旧 CLI 测试夹具跟随配置更新；上轮接续卡片保存复盘后需刷新、异常流程映射键防御等旧 Minor 仍保留。
4. 本轮 CLI 核验错误码映射 Minor。

## 本轮工程取舍

沿用既有 L6–L7/P2 设计和当前隔离分支，不新建框架；成本是仍依赖既有人工作业边界。直接 workspace 调用沿用可信身份注入，HTTP 对真实任务强制检查，DEMO 保留且不计经营进度；可信调用者须继续遵守该边界。用户要求保留回滚机会，因此保留本机忽略的备份目录，成本为少量磁盘空间。真实业务验收仍由经营者负责；源码与部署、基线复现由本执行者核验，历史临时目录不纳入提交。
