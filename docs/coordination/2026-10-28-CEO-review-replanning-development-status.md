# 复盘关联接续计划：开发交接

2026-10-28，承接CEO/OS L7。源码位于 `.worktrees/ceo-read-brief`，分支 `upgrade/ceo-read-brief-20261026`，本轮基点1abdc9a。请勿重建第二任务库或另写接续引擎。

## 本轮交付

- GET `/api/ceo/replanning-brief` 与CLI `replanning`读取同一复盘、当前4项真实工作、版本/变化和工作包指纹。
- POST `/api/ceo/replans` 与CLI `replan`仅agent提交：必须关联已存档真实复盘，并对每项工作明确REPLAN/WAIT/DEFER/OBSERVE及理由；REPLAN候选沿用原ID，不允许复制旧工作为新ID。
- 原saveDraft事务内写 `ceo_plan_review_links`，继续原计划表、决定校验、容量、导入及审批。计划存档不修改任务；DONE观察，执行中/待核验/UNKNOWN等待，不重复执行。
- 已核验同上下文前置可作为外部依赖，定义原dependsOn保留；未核验或旧上下文前置阻塞。原接口没有增加请求方注入该名单的能力。
- 相同请求先比完整哈希并重放原回执，来源失效仍可恢复；新请求提交时通过事务内文件指纹及最新复盘/任务版本核验，冲突回滚所有新计划/关联/入口记录。
- 原指挥台增加“CEO接续工作包”和存档计划的复盘理由。摘要明确“存档时未导入、未排程”，当前执行状态看原任务。没有模型假生成决定。

## 实际验收

132/132专项测试通过；独立评审2项Important已完成失败回归后修复。主页面、API、CLI都为NEEDS_REVIEW/canSubmit=false：正式库仍无首份真实复盘，不能假填测试记录。4项经营任务/总7任务，原3计划、22事件及9张原表的行内容哈希全部不变；新增关联表空。

3个明确显示文件更新且有原件备份，3173从PID5608重启到PID15876，沿用原DB/凭证；WorkBuddy主指挥台3000PID19536保留。界面新卡能打开原活动任务，仍为待核验v5。没有执行店铺动作或代经营者存档。

## CEO如何接续

在原隔离目录调用：

```text
node scripts/ceo-task-loop.mjs replanning --base-url http://127.0.0.1:3173 --token-file <原已授权agent凭证文件>
node scripts/ceo-task-loop.mjs replan --base-url http://127.0.0.1:3173 --token-file <原已授权agent凭证文件> --input <接续请求JSON>
```

读 `prompts/CEO_REPLANNING_CONTRACT_v1.md` 的字段与边界。经营者先写真实复盘，然后点刷新；CEO从新工作包形成有依据决定并提交，不可仅替换新指纹重试旧判断。决定过期须重评，缺费用/支付等证据仍不计算利润或目标达成。

## Backlog及回滚

本轮Minor：经营者保存复盘后接续卡不会自动刷新，需手动点刷新。原daily-review保存期间换日提示问题仍属此前Backlog，本轮不扩展。新机会任务身份继续走原初始计划流程，新接续入口只重排已有工作。

本机测试日志、9表一致备份、显示文件原件及哈希在 `.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-28-ceo-review-replanning/`。回滚单独revert本次源码、恢复原显示文件并重启3173；兼容的新增表保留，不用旧DB覆盖后续业务数据。隔离目录是运行源码位置，不能删除。源码未推送GitHub，业务材料不上传；本地交接文件不表示已唤醒或收到WorkBuddy/CEO新回执。

源码已本地提交 `bf245be`（18个指定文件，351行新增/20行删除），基点 `1abdc9a`；已跟踪工作区干净，7个旧未跟踪测试目录保留。截图：`C:/Users/User/.codex/visualizations/2026/10/23/01a16668-0f0f-70e1-a471-164573fda6ac/ceo-review-replanning-20261028.png`。原入口指南已追加新命令，但没有代经营者存档或向CEO会话投递指令。

复跑命令：

```text
node --test dist/test/ceo-review-replanning.test.js dist/test/ceo-replanning-ui.test.js dist/test/ceo-daily-review.test.js dist/test/ceo-daily-review-ui.test.js dist/test/ceo-operating-brief.test.js dist/test/ceo-operating-brief-ui.test.js dist/test/ceo-task-http.test.js dist/test/ceo-task-cli.test.js dist/test/ceo-task-workspace.test.js dist/test/ceo-conversation-entry.test.js dist/test/ceo-draft-workspace.test.js dist/test/ceo-daily-plan.test.js
```
