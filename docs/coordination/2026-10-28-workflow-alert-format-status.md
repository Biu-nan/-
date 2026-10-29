# 任务提醒格式调整交接

用户批准优化顶部错误提醒。本轮仅前端显示：所属流程、记录时间（Asia/Shanghai）、阶段、当前状态、中文原因和建议；技术详情默认折叠、ANSI控制符去除，轮询保持用户展开状态。前往上品工作区/查看运行详情都只是界面操作，不执行恢复或重试。

历史失败不再自动展开运行浮窗遮挡工作台，顶部提醒仍保留。原导航冲突没有被修复或清除。原run-state仍FAILED/running=false，原始内容哈希前后不变；后端未重启。

源码隔离目录 `F:/yikuaborder-deploy/.worktrees/workflow-alert-format`，基点f171fc2（主界面当前版）。CEO分支app/index/styles较旧，未覆盖回退其版本。原生worktree工具无法识别源仓库，使用已忽略目录的Git隔离副本。

变更显示资产：public/app.js、public/index.html、新public/workflow-alert.js和workflow-alert.css。原2文件逐字节备份，复制前以基点内容校验（仅忽略CRLF/LF差别），所有其他协作改动保留。证据与原件在该目录 `.superpowers/sdd/2026-10-28-workflow-alert-format/`。

验收：5/5测试通过，两个脚本语法检查通过；独立只读评审无Critical/Important。原页面中文提醒、折叠技术详情、轮询保持、业务场景→上品入口已实际核对。

```text
node --test dist/test/workflow-alert.test.js
node --check public/workflow-alert.js
node --check public/app.js
```

回滚：恢复runtime-backup中的原app.js/index.html，旧入口不再引用两新文件，可保留新文件。不要重置run-state或业务数据库。源码本地保存，本次不推GitHub；未触发店铺操作，也没有声称WorkBuddy已经读到此记录。

Backlog：原导航冲突根因排查；极少见未知流程/阶段原型键的映射兜底（constructor/toString）。未声称全项目回归或屏幕阅读器专项完成。

源码已本地提交43a52d4（7个指定文件，121行新增/9行删除），隔离工作区干净，保留用于回滚。截图：`C:/Users/User/.codex/visualizations/2026/10/23/01a16668-0f0f-70e1-a471-164573fda6ac/workflow-alert-format-20261028.png`。
