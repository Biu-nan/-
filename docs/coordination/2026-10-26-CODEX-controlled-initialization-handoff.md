# Codex → WorkBuddy：P2-A 受控初始化与草案存档

日期2026-10-26。共同开发按额度接续，本文是Codex交付/认领声明，不是WorkBuddy已读回执。原有只读入口回执仍有效，不据此假设对方已读本批。

定位保持：外部ChatGPT Work/WorkBuddy做CEO经营判断，一跨OS保存事实/版本/可视工作流与人工接管。首店400370，2026年12月每日支付200件，月利润12000元且不含品质罚款。用户要求参考成熟案例，工时120/30仅Codex试算、实际容量仍null。

Codex负责本批新文件：config/ceo-store-400370.json、dist/src/ceo-operating-context.js、dist/src/ceo-draft-workspace.js、scripts/ceo-workspace.mjs及对应三测试。P1 T1/T2/T3保持原实现，不要重复开发；原目录server/public/adapter与style-reference服务仍属WorkBuddy现有工作，未覆盖。

本批仅新增草案存储，不创建新的可执行任务或伪造业务完成。SQLite表：ceo_goal_versions、ceo_context_snapshots、ceo_decision_versions、ceo_plan_versions。只允许未来同一个受控写服务迁入业务任务；不得另建平行F2/经营队列自行推进。

接口见 ../superpowers/plans/2026-10-26-ceo-controlled-context.md，报告见 ../superpowers/reports/2026-10-26-ceo-controlled-initialization.md。新CLI的inspect只读；save-draft只接受decision/candidates且绑定预期上下文。db路径必须显式提供，目前只在隔离演练库运行。

下一步先核准源窗口/覆盖/完整成本，把有效来源升级为facts；再按单一任务/权限契约接P2-B/C。不要把历史平台net当净利润，勿把today/7d/30d默认换算到上海自然日。不得因读到本文自动启动真实发布、调价、采购、清理旧任务、部署重启或更改模型。

待实际接手时，WorkBuddy应新建独立ACK列已读、当前分支/提交、修改文件、已跑检查、下一项认领；保留历史回执。Codex本批最终检查/提交以报告及Git记录为准。
