# Codex → WorkBuddy：首店基线核查交接

2026-10-26。承接用户“开始”执行经营数据核准。该文档是Codex交付，不是WorkBuddy已读或认领回执。未启动平台采集或占用共享浏览器。

## 完成范围

固定本地既有原始响应、标准化事实、首店库存及店小秘成本线索，完成窗口/单位/粒度/关联核查。分析报告、金额、编码缺项、完整输入快照与Notebook仅放主目录忽略路径：

`F:/yikuaborder-deploy/data/ceo-audits/2026-10-26-store-400370/`

重点文件：首店经营诊断.md、audit-results.json、cost-gap-candidates.json、cost-reconciliation.json、首店经营数据核准.ipynb、source-manifest.json。不要将这些原始经营资料混入源码提交。

## 已证实的技术问题

1. `fetch-ae-metrics.mjs` 的财务push继承today，但原始fundOverviewData/overviewTitleList明确区分成交的发货时间与净收入的结算时间，并附绝对毫秒范围。后续契约必须保存事件、窗口、原始单位/币种及来源引用，不能让today代替原始范围。
2. `sumTotalUnsettleAmount`是累计范围；`sumUnsettleAmount`才是对应订单范围的待结算金额。二者都可以保留，但不能共享同一个不明确期间字段，不能混用于当期成交金额拆分。
3. 指标字典的PDT/UTC-8与采集器的PST/PDT注释冲突；仅凭标签无法核准日界线。原始绝对时间可保留，禁止擅自把其解释为自然月或上海支付日。
4. 原规范化事实缺显式unit和period。`appendFacts`仅按value/reason去重可能丢掉新的元数据，`saveRaw`同日同名会覆盖，现存raw不必然对应同一笔采集。后续需不可变快照哈希绑定，不改写历史记录为“已核准”。
5. 首店库存是货品/仓库/区域粒度；成本关联只做精确字符串候选，不能把库存出库当支付、库存单价当已售货值、未结采购付款当本期成本。

## 接续与边界

继续使用既有三个taskId：store-400370-paid-caliber、store-400370-cost-reconciliation、store-400370-comparable-baseline。前两项证据部分完成，基线仍受阻；不是已派发或已完成的OS业务任务。

Codex下一项拟负责独立采集契约适配与失败反例；请勿同时改同名隔离文件。WorkBuddy若接续，应先写独立ACK确认当前分支、已读文件、修改范围、实际检查和认领项；不预设对方已接任务。共享浏览器取数需确认当前占用，未接入资源锁前不要双方同时导航。

当前无经营利润核算结果、无支付日基线，不计算目标差距、投入回报或降价空间；成本未知保留null，品质罚款单列且只有已扣证明成立才能加回。工时120/30仍仅试算。P2-B/C任务/权限/执行回执、自动唤醒和经营效果观察未完成。

本轮没有产品代码修改、服务重启、生产库写入或平台操作；不复用历史148/45结果冒充本轮测试。Notebook由Python标准库逐单元实际执行，未安装/启动Jupyter内核；金额与关联断言和输入哈希检查记录在本地报告。
