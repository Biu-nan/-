# Codex：共享人工任务闭环接续

日期2026-10-27。Codex本批认领已交付，修改目录 `F:/yikuaborder-deploy/.worktrees/ceo-read-brief`，分支 `upgrade/ceo-read-brief-20261026`，前基线 `90c5502`。完整交付报告在该隔离目录 `docs/superpowers/reports/2026-10-27-ceo-shared-task-loop.md`。

## 当前进度

P2-B/C首个人工调查子集已实现：共享SQLite任务、具体审批、领作/回执、人工核验、四种受阻、版本与操作重放、重启恢复、保留ID的重规划。网页与命令通过同一本机API读写，经营效果与执行状态分开。仅人工调查能力，无店铺执行器。

25项新专项、45项既有可靠性通过。旧CEO148项前后均12项同名失败；全量未全绿，不合并或部署。三项Important已先失败反例后修复：中断绕过未知结果、同ID无法重规划、旧页面覆盖新计划。独立审阅者的网络测试受EACCES限制，主执行者获准本机网络后实际25/25通过；未二审。

新文件：`dist/src/ceo-task-workspace.js`、`dist/src/ceo-task-http.js`、`scripts/ceo-task-loop.mjs`、`public/ceo-tasks.html/.js/.css`、`dist/test/ceo-task-workspace.test.js`、`ceo-task-http.test.js`、`ceo-task-cli.test.js`、`dist/test/fixtures/ceo-task-fixture.js`。注意scripts目录本来被忽略，必须仅按准确文件白名单保存新入口，不能把整个scripts目录入库。

原目录server/public/适配器及生产库未改，3000端口服务未动。用户此前确认的人力配置1/300/60与goal版本2保持有效。演练资料、凭证、数据库、测试日志仅本地忽略，不提交Git。

## 可复验的本机入口

独立预览 `http://127.0.0.1:3173/`，只是本批开发工作页。实际浏览器将演练任务DEMO-02从待核验v4更新为已核验完成v5；CLI需读回同一结果。凭证不在URL、共享文档或源码中。

对话端仅需使用agent令牌文件；不得读取或复用经营者令牌来审批自己的回执：

```powershell
& 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'F:/yikuaborder-deploy/.worktrees/ceo-read-brief/scripts/ceo-task-loop.mjs' read --base-url http://127.0.0.1:3173 --token-file 'F:/yikuaborder-deploy/.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-27-ceo-shared-task-loop/access/agent-token.json'
```

服务若未运行，先确认本批日志和端口，不改其他服务。启动参数需显式给root/db/credentials/port，不能默认迁移生产库。凭证目录与演练库所在位置见本批执行记录，目录必须保持Git忽略；不复制令牌内容进聊天或回执。

## WorkBuddy准确接续任务

只在当前开发窗口接续时，运行上面的只读命令，独立记录退出码、任务ID/状态/版本、实际baseUrl及响应内容哈希到新回执；回执不要含凭证、完整数据库内容或真实财务资料。不重复订单出库/采购成本核验，不改Codex新文件，不启动第二个写入者。

本文件是准备好的共同开发接续资料，不等于已投递、自动唤醒或WorkBuddy已读；当前没有该入口的新独立调用回执。用户此前“已发送”对应旧取证任务，不能用于本批。

## 后续边界与Backlog

真实经营对话写入、主OS导航/路由集成、可信身份部署、真实能力/浏览器租约、未知且已生效结果恢复、自动运行和效果观察尚未验收。页面目标动态化、证据摘要展示、凭证输出目录强制忽略属Deferred Minor。保留原目录WorkBuddy在改文件，按提交集成，不整目录覆盖。

## 可回滚版本

本批16文件提交 `8b80a0c8a865e482dc253f1ef6a5b304f533cc62` 已推送至已核实的GitHub私库 `Biu-nan/yikuaborder-private-backup`、分支 `upgrade/ceo-read-brief-20261026`；远程完整哈希回读一致，16文件内容字节检查一致。没有把数据/凭证/演练库推送，也没有合并部署。真实集成请按此提交范围评估，不覆盖整个原目录。此补充保留于原目录共享交接，隔离分支内交付正文已在该提交中。
