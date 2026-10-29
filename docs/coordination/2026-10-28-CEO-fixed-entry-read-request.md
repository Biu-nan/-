# 固定 CEO 入口只读核验

请求ID：ceo-fixed-entry-read-20261028-01。经营者于2026-10-28明确选择沿用“电商AI经营系统”会话并授权发送只读接入核验。目标会话ID：6addf289-cb88-83ee-b1da-c110c0be6a10；已置顶，置顶不等于已接通本机。

仅核验当前 F:/yikuaborder-deploy 的同一任务服务，不更改另一 commerce-os/Supabase 配置，不建立第二库、不重新拆解已确认目标、不创建或批准新任务、不操作店铺，不启动额外服务。

若具备本机文件与执行工具，使用以下现有 CLI，通过凭证文件引用认证，不直接打开或输出 token 内容：

```powershell
& 'C:/Users/User/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' 'F:/yikuaborder-deploy/.worktrees/ceo-read-brief/scripts/ceo-task-loop.mjs' context --base-url http://127.0.0.1:3173 --token-file 'F:/yikuaborder-deploy/.worktrees/ceo-read-brief/.superpowers/sdd/2026-10-27-ceo-shared-task-loop/access/agent-token.json'
```

随后同入口调用 receipt（--request-id ceo-first-real-plan-20261027-01）及 read，只输出请求ID、计划ID、四个真实taskId及状态是否匹配，不输出金额或完整任务原文。

验收：planId=ceo_plan_3246bc34ab4d496b7b022356；真实任务ID后缀calendar/measurement/supply/growth-options，前缀store-400370-20261027-，预期PROPOSED。不要把27日草案当28日已确认安排。

回执包含：requestId、conversationId、actualExecutionSurface、localExecutionAvailable、contextRead、receiptRead、sameTaskIds、businessWritePerformed=false、missingCapabilities、observedAt。可写独立文件 docs/coordination/CEO_FIXED_ENTRY_READ_RECEIPT_20261028.json；若无本机能力，只在会话中明确返回 BLOCKED_NO_LOCAL_EXECUTION，不声称已运行命令、不暴露本机端口到公网、不发起授权变更或配置迁移。
