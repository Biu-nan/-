# Codex → WorkBuddy：T2/T3 决策与每日草案交接

2026-10-26。Codex 维护；不是 WorkBuddy 已读或调用的回执。

T2/T3 已在 `F:/yikuaborder-deploy/.worktrees/ceo-read-brief` 的同一隔离分支完成，修复代码提交 `a19a8a9`。原目录八个代码改动及样式服务保持 WorkBuddy 归属，未拷贝覆盖。请勿重复建设同名决策/排程模块。

外部 CEO 一次输出 ceo-decision/v1 JSON 草案，OS 校验后按输入容量形成 ceo-daily-plan/v1；不调用模型、不派工、不执行候选动作。输出规则见 `prompts/CEO_DECISION_CONTRACT_v1.md` 和 `schemas/ceo-decision.schema.json`。

核心边界：

- facts 的 ID/版本/店铺/口径/单位/窗口与主证据匹配，净收入不等于经营净利润。
- 未来目标待观察用 PENDING_OBSERVATION；已有充分 ACTION_BASIS 要绑定 chosenActionId。缺成本定义或实际行动依据仍补证。
- 候选含标题、验收条件、依赖和所需事实；容量/缓冲不明时不承诺。重复依赖拒绝，有界反向拓扑传播防止指数递归。
- VALIDATED/WITHIN_CAPACITY/DRAFT 均不构成实际执行授权或目标达成。

可调用：

```powershell
node "F:\yikuaborder-deploy\.worktrees\ceo-read-brief\scripts\ceo-draft-plan.mjs" --input "F:\yikuaborder-deploy\.worktrees\ceo-read-brief\docs\superpowers\examples\ceo-first-loop-draft-input.json"
```

该示例目标为用户真实目标，facts 为空、容量及利润数据未确认，3项初始化工作均为调查候选，不是已执行或已排定任务。示例 reviewAt 会正常过期，不应修改宿主时间复活它；实际新决定由外部 CEO 据当前事实形成。

测试夹具内未来完整销量/利润是合成数据，不能用于真实经营汇报。真实 facts/goal 必须由后续 P2 受控来源加载，不能让外部模型自行改 coverage/costsReconciled 等字段来通过校验。

本批77项新增专项、45项可靠性通过；完整286项262通过、同24项旧失败。独立审查3项Important已修复并回归，未二审；1项Minor（INVALID输入重排时草案ID变化）留后续。

下一步待共同明确的具体工作包为 P2 写状态/身份来源/审批/执行证据及回滚施工单，以及实际经营数据、人工容量初始化。本文件不派发 WorkBuddy 自动开工，不更改已有任务授权。
