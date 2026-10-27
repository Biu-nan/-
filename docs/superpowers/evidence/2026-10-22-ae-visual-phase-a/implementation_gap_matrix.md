# A1 方案与现有实现差异表
日期：2026-10-22；性质：只读核对，非修复完成报告。
基线：[执行路线图](../../roadmaps/2026-10-22-ae-visual-agent-roadmap.md)。
本轮没有运行旧CLI、网页生图链路或修改产品代码。

| 项目 | 已锁定要求 | 现有证据 | 判断与后续处理 |
|---|---|---|---|
| 任务入口 | 本地界面一键启动、Work优先原生执行 | model.js使用ChatGptAdapter驱动网页对话 | 接入不等价；优先验证官方本地runtime候选 |
| 图片计划 | 默认10个动态槽位 | loadSlots实测8槽位：P1–P6/MK1/MK2 | 配置及验证契约需要调整，不能沿用旧默认验收 |
| 当前SKU素材 | 真实图可读、避免重复和丢失 | 实测9图被按文件名截取为8图，其中仅7份不同图像内容 | 截取前需去重/选择规则，输入指纹与保留依据需补齐 |
| 结构化事实 | ProductIdentity及证据等级 | 默认仅查product-facts.json/product-profile.json；当前SKU事实来源被识别为none | 需要输入适配；不能把资料“未找到”误作没有产品资料 |
| 自然语言资料 | 事实与市场内容隔离 | 实测前5份资料混入市场报告、SEO和Listing成稿 | 这些文本不能全部作为商品事实；需显式来源/证据分类 |
| 市场参考 | AliExpress主导，跨平台辅助、可追溯 | 有style-research模块；旧文档主要双源AliExpress/Amazon | 可复用候选，来源覆盖与事实引用需验证 |
| 风格选择 | 3候选并自动选1 | 已有风格聚类与--auto入口 | 可复用候选；必须检查恰好3候选、评分依据与旧缓存有效性 |
| 身份锁 | 版本化ProductIdentity | 旧链路有本地视觉skuLockText | 概念可复用，不能把一段文本等同完整身份/证据契约 |
| QC范围 | Q1–Q7及独立检查 | qc.js有尺寸和视觉检查；runner.js:589附近降级只查sku/shot/text | 降级可直接把未检查项置PASS，阻塞直接复用质量门禁 |
| 恢复 | 输入/配置指纹匹配才复用 | runner加载previous；state.js主要检查schemaVersion；相关文件未找到hash/fingerprint字段 | 当前证据不足以保证新版输入不混用旧产物；需补指纹测试 |
| 输出与版本 | input/runs/RUN/evidence/design/output/rejected/reports | 旧README及实现使用design/images与run-state.json | 需要明确适配或迁移，不覆盖旧记录 |
| 状态 | CREATED/RUNNING/QC/COMPLETED/PARTIAL/BLOCKED/FAILED | newState实测初始值running；旧README为completed/partial/escalated | 状态映射需要正式规格固定 |
| 重试 | 首次+最多2次修复，必要时1次安全降级 | runner上限maxAttemptsPerSlot=3 | 次数部分相符，安全降级是否独立计数仍需验证 |
| 精确尺寸 | 平台配置驱动、保留原件再导出 | exact_size.py存在，但原位保存JPEG | 可借鉴算法，不能原样用于“保留原件”；需在副本上验证 |
| 成本 | 实际原生额度/额外费用可核查 | newState记录modelCalls/imageGenerations等计数 | 次数可复用，实际费用/额度证据未建立 |
| 评估 | T01–T10/QCT-01–12/AC-01–10 | evals/cases.json有21个旧用例描述 | 有用例不等于已运行，不等于覆盖新契约 |

## 本轮实际离线检查
见offline_checks.json；6项断言执行成功：
1. 默认8槽位事实；
2. 当前SKU截图及警告可复现；
3. 旧尺寸读取器读到1254×1254；
4. 旧尺寸判定器拒绝低于自定1536×1536的候选；
5. 不存在文件被拒绝；
6. 通用状态构造器能在内存中接收10个槽位。

这些是复用调查结果，不是新Agent验收通过，也没有运行全部21条旧用例。

## 复用结论
可优先复用的候选：图片信息读取、基础尺寸判定、输入遍历、状态原子写入机制、部分规划与报告结构。
必须先改约束再复用：素材去重/来源分级、10槽位、输入版本恢复、输出版本、完整QC和后端接入。
不纳入此次范围：Amazon A+、上线经营统计、多SKU并发、自动上架。

