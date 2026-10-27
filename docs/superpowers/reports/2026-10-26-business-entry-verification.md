# 经营对话端只读调用验证记录

2026-10-26，Asia/Shanghai。最新结论：**WorkBuddy 本地对话→CLI→OS 的只读读取验证通过**。入口通过不代表自动唤醒、其他对话端、业务写入或经营改善已经完成。

## 15:20 独立执行与原始输出核对

用户在 WorkBuddy 实际发送请求后，对方使用自身执行工具运行 T1。已收到 `WORKBUDDY_BRIEF_RECEIPT_2026-10-26.json`，请求 ID 与投递一致，执行时间北京时间 15:18:31，exitCode=0，schema=ceo-brief/v1，readOnly=true。

Codex 检查回执必要字段，并读取对方落盘的原始 stdout，复算 SHA-256：`9aa42f3f1aa2c077cb209707bdebf6b8f70d06e709495aa4a6a00b4f898e053c`，7732 字节，匹配回执。原始输出的 schema、时间、健康状态、7 来源/5 单元及全部 UNVERIFIED 标签逐项一致。WorkBuddy 另做直接 GET 的原始响应哈希 `b9e243f875a18869badd8175b378d28999994a40c66b760bb2f2ca8b78e6eddd` 也经 Codex 复算匹配，来源/单元/Gate 数一致。

本次显示 7/7 来源读取成功，5 个活跃单元、2 个 Gate、DEGRADED；不把来源可读当业务健康或平台数据新鲜。DONE=0，本次实调未覆盖 DONE 分支，该分支已有 T1 专项测试证据，不能记成本轮实际展示通过。

回执存在两处文档瑕疵：顶层 schema 重复键，Node JSON.parse 按后一个 ceo-brief/v1 解析；一条时间差叙述将大小关系写反，实际 sourceGeneratedAt 比 observedAt 晚 131ms。两者不影响原始 stdout 哈希及时间核对。保留 WorkBuddy 原文件，不代其改回执；后续回执应使用唯一 receiptSchema 与 resultSchema 字段。

原始输出保存在被忽略的本地运行目录，不提交源码仓库。本轮只核验现有入口、写协调/验收文档，没有改产品代码、安装软件或重启服务。Workbench 自报新增 8 个原目录改动的归属已读；新增样式能力未因此被认定备份完毕或代码审查通过。

## 已通过与未通过

- 通过：用户在 WorkBuddy 本地对话发起后，WorkBuddy 独立使用本机工具读取当前 OS 简报；Codex 对真实输出复算一致。满足 P0.3“至少一个目标经营入口实际读取”的范围。
- 未通过：ChatGPT Work 另一入口、自动唤醒/定时、跨入口写状态、审批/执行接续、经营数据新鲜度、目标达成。P0.4 的 P2 施工单仍待补齐。
- 通信现状：本轮需要用户一次发消息唤醒 WorkBuddy；本地队列本身没有自动消费。没有创建自动化任务，也不伪造 WorkBuddy 身份更新 .agent 槽位；原槽位若仍显示 ready，以本请求独立回执和 Codex 核对记录判定本次读取完成。

以下为投递阶段历史记录，不再表示当前未收到回执。

## 本轮实际完成

- 读取 WorkBuddy 新回执 WORKBUDDY_ACK_2026-10-26.md：对方已同步业务主线、开发边界及 F2 停止推进；没有 T1 简报实际调用证据。
- 当前 WorkBuddy commerce-os 连接器配置为 disabled=true，目标仍是另一 E 盘项目；本轮未更改。
- 用 computer-use/sky 实际读取到 WorkBuddy 的 yikuaborder-deploy 空间和已有会话；一次点击先被自动审批额度限制阻止。提示恢复时间到达后按原工具重试，窗口可读，但未确认成功切换到目标会话或发送消息。
- 形成具体核验请求 ceo-entry-read-20261026-1510，要求 WorkBuddy 用自己的工具独立读取，提供时间、schema、输出摘要和自己的新回执；不允许复制 Codex 旧输出。
- 检查旧协作槽位为 ready、未认领，且原同步任务已有独立 ACK；经现有 POST /api/agent/intake-task 投递一次。HTTP 200/imported=true，队列和 STATE 回读一致，旧任务仍在队列中；投递前状态/队列另存本地诊断目录。
- 已回应 WorkBuddy 关于待核验、四种受阻原因、空闲运行器与 READY 任务、老数据及通知的问题。只写响应文档，不顺带修改业务状态映射或清理历史数据。

## 验收边界

核验请求、队列投递、Workbench 窗口存在或“已读方案”均不是业务入口执行通过。只有 WorkBuddy 实际取得本次简报、提供同请求 ID 与新时间的独立回执，并核对输出，才可将本地经营入口读取标为通过。

预计回执：`docs/coordination/WORKBUDDY_BRIEF_RECEIPT_2026-10-26.json`。由 WorkBuddy 自己创建；Codex 不代写 VERIFIED、actor=workbuddy 或伪造执行证据。目标对话端通过后也不能据此宣称无人值守启动、发布/采购执行或经营目标达成。

## 投递时需要的最小接续（已由用户完成）

用户在 WorkBuddy 现有会话发送：

> 请处理 F:/yikuaborder-deploy/.agent/WORKBUDDY_QUEUE.md 中任务 ceo-entry-read-20261026-1510，按请求文档完成只读核验并写独立回执。

用户已完成上述发送，WorkBuddy 随后完成调用。自动队列唤醒仍属于后续未验证能力。本轮没有创建定时任务、安装 CLI、读取或修改另一 Supabase 项目，也没有改产品代码。

## 范围、验证与待办

修改范围：Codex 维护的协调/核验文档，及通过既有接口产生的本地任务队列与槽位。验证方式为 POST 返回与文件回读，不是产品测试；本轮未运行代码回归。

原目录已有 8 个未提交代码文件，本轮不覆盖；模型适配、假 Gate 与陈旧历史事项列 Backlog。若收到真实回执，再核对同请求 ID、实际时间、成功状态、输出哈希及 UNVERIFIED 标签，不能仅以用户“已发送”当执行完成。
