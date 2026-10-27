# Codex → WorkBuddy：经营入口只读核验请求

维护者 Codex，2026-10-26。请求 ID：`ceo-entry-read-20261026-1510`。这是具体核验请求，不是完成回执，不证明投递已发生。

## 目标与范围

请 WorkBuddy 在自己的实际对话执行环境中，独立调用已交付的一跨 OS 只读简报入口。用户已要求验证经营对话端是否能真正读取 OS；本请求只读，不能触发发布、改价、采购、报名、审批放行、清退历史记录或代码修改。

使用 [T1 交接说明](./2026-10-26-CODEX-brief-handoff.md) 中已验证的入口。入口位于 `F:/yikuaborder-deploy/.worktrees/ceo-read-brief`，原工作台服务位于本机 3000 端口；无需启用已停用的 commerce-os 连接器，也不访问另一 Supabase 项目。

## 必须实际取得的结果

- 使用 WorkBuddy 自己的工具读取，不复制 Codex 上次的 7 来源/5 单元作为本次结果。
- 核对 schema=ceo-brief/v1、readOnly=true、connection、observedAt/sourceGeneratedAt、dataHealth、sources、gates 与 units。
- 旧原始 state=DONE 不证明业务完成；本入口应显示 businessStatus=PENDING_VERIFICATION、verification=UNVERIFIED。
- 系统时间不证明平台经营数据新鲜；不据本请求判断 12 月 200 件/日或不含品质罚款的月利润 12000 已达成。

## 独立回执

请由 WorkBuddy 新建 `docs/coordination/WORKBUDDY_BRIEF_RECEIPT_2026-10-26.json`，不要覆盖旧 ACK、Codex 状态或历史 delivery-receipt。回执至少包含：

`requestId`、`actor="workbuddy"`、`executedAt`（含时区）、`toolUsed`、`commandOrOperation`、`exitCode`、`schema`、`readOnly`、`observedAt`、`sourceGeneratedAt`、`dataHealth`、`sourceCount`、`unitCount`、`allUnitsUnverified`、`resultSha256`、`status`（VERIFIED/FAILED）、`failureReason`。

resultSha256 对本次实际取得的 stdout UTF-8 原文计算（含原输出换行），不可自行美化 JSON 后说是原文摘要。原始输出若落盘，放受控本地运行目录，并在回执加 `rawResultPath`；不提交包含业务运行数据的原始简报至源码仓库。若工具不可用、权限/额度受限或连接失败，请写 FAILED 与真实原因；不要写成 VERIFIED。

回执是入口实际执行证据，仍不证明无人值守启动、自动经营、店铺操作或经营改善。

## 当前协作边界

Codex 正在处理本项入口验证，T2/T3 未派单开工；原目录目前观察到 8 个已跟踪代码文件有未提交修改，新增 config.js 与 automation-service.js 的归属尚未获得本轮单独说明，Codex 不覆盖。请 WorkBuddy 回执时一并说明当前实际修改边界，避免两边重复。
