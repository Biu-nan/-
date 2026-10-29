# CEO经营简报开发交接（2026-10-28）

本轮：原一跨指挥台接入只读经营简报；代码位于 `.worktrees/ceo-read-brief`，分支 `upgrade/ceo-read-brief-20261026`。未创建新任务库、未执行店铺操作、未批准或核验经营任务。

## 已交付，协作者不必重复开发

- `GET /api/ceo/operating-brief` 与CLI `brief`，共用原认证和任务库。
- `data/ceo-operating/brief-manifest.json` 引用现有七天计划目录的baseline和advisory文件，核对SHA256/上下文/目标版本，仅输出安全投影。
- 原 `http://localhost:3000/#` CEO面板显示历史观察、商品目标分摊草案、七日日期选择和行动卡，支持打开原任务详情；历史PST观察与上海目标口径仍分列，利润待核。
- 54项相关测试通过；独立评审3项重要问题已修复并覆盖回归。实际界面日期切换和任务跳转已验收。
- 更新前后7条任务完全相同；活动任务仍待核验v5。运行时仅重启3173，继续原DB/凭证；3000未重启。

## 协作约束与后续边界

1. 不要另写一套看板/周计划调度器或创建另一份任务库。要扩展该模块，先读已有spec/plan和本回执。
2. 不要将原任务DONE当作未来日期行动完成，不要把演练完成计为经营成果。
3. 业务来源发生变化会触发哈希失效；须核对新证据后显式更新manifest，不能自动认可变化。
4. 后续业务工作是补齐当前供给、完整费用利润与SKU级活动证据，再形成可审批动作；本次界面上线不授权报名、调价、采购或发布。

## 复核和回滚

测试命令（在代码分支运行）：

```text
node --test dist/test/ceo-operating-brief.test.js dist/test/ceo-operating-brief-ui.test.js dist/test/ceo-task-http.test.js dist/test/ceo-task-cli.test.js dist/test/ceo-task-workspace.test.js dist/test/ceo-conversation-entry.test.js
```

本机证据与原运行文件备份：`.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-28-ceo-operating-brief/`。查看runtime-copy-receipt.json和runtime-verification.json，先校验当前文件仍匹配本次after哈希，再逐一恢复原件。源码回滚基点fcb5ec6或单独revert本次提交；保留SQLite、凭证和业务证据。新模块原先不存在，可在恢复旧入口后保留为未引用文件。新manifest原先不存在时应停用，而非删除原始业务资料。

源码已本地提交 `ff36641`（13个指定文件），可单独revert此提交；保留当前分支和隔离目录，因为3173仍从该目录读取源码。本次源码尚未推送GitHub；业务资料不上传。协作文件仅本地交接，不表示已经唤醒WorkBuddy。
