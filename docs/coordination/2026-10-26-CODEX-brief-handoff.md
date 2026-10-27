# Codex → WorkBuddy：只读简报入口交接

2026-10-26。Codex 维护。本文不是 WorkBuddy 已读或实际调用的回执。

首店与目标：纳物-箱包全托1店（400370），2026 年 12 月每日支付至少 200 件，月经营净利润至少 CNY12000，扣经营成本但不含品质罚款。

本轮 Codex 实施 T1，三个文件：`dist/src/ceo-read-brief.js`、`scripts/ceo-read-brief.mjs`、`dist/test/ceo-read-brief.test.js`，位于 `F:/yikuaborder-deploy/.worktrees/ceo-read-brief`；原目录六个 WorkBuddy 改动保持不动。T2/T3 未认领实施完成，不要据此当成已可执行经营任务。

可在本地经营会话执行：

```powershell
node "F:\yikuaborder-deploy\.worktrees\ceo-read-brief\scripts\ceo-read-brief.mjs"
```

仅 GET 本机工作台，不触发店铺操作。请实际核对返回 schema=ceo-brief/v1、观测时间、dataHealth、待决和 businessStatus/verification；旧 DONE 不代表平台动作已核验。不要根据这份工作台简报推断销售指标新鲜或利润达成。

Codex 工程会话已实测读取；若 WorkBuddy 经营入口实际调用，请由 WorkBuddy 在自己的新回执中记录时间、命令、schema、成功/失败及明确障碍。不覆盖旧 ACK，不把文件存在当成已调用，不把命令输出成功当成无人值守自动启动。

专项 41/41、可靠性 45/45 通过；完整套件同基线 24 项失败，没有新增。详细证据与旧失败名单见 [报告](../superpowers/reports/2026-10-26-ceo-read-brief.md)。当前分支 upgrade/ceo-read-brief-20261026；准确提交以该分支 Git 日志为准。禁止整目录覆盖或将原 commerce-os 的 Supabase 状态与本工作台直接混为一体。
