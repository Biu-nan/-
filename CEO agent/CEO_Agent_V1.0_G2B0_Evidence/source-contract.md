# G2-B0 单域来源与接线契约准备

当前目标：为“纳物一店订单支付表现”冻结可审阅的来源候选与接线缺口；本文件是准备稿，未批准接线或生产采用。

## 结论

**当前状态：UNVERIFIED / BLOCKED FOR ADOPTION。** 现有命名源码和一个已知历史聚合报告能证明实现与产物存在，不能证明真实支付订单数据已接入或已获核准。正式 Taskboard 路径、正式日志唯一写入者及认证采纳 API 沿用此前报告的 UNVERIFIED；没有重新进行数据库历史搜索。

| 候选 | 已确认实现 | 采用边界 |
|---|---|---|
| AE 销售管理 | todaySalesNum / recent7dSalesNum / recent30dSalesNum → sales.qty.total，today/7d/30d；字段单位由字典声明件 | 字典称支付件数，但销售管理汇总不是已核实支付订单导出。支付/发货事件依据仍待源所有者核准 |
| AE 店铺概览 | DOM 支付买家数与 DPS payBuyerCntApp → conv.buyers，单位人；支付转化率为% | 买家≠订单≠件数。DOM 虽解析“支付件数”ov.items，却没有将其落为事实；DPS 分来源求和未证明去重覆盖 |
| AE 资金 | sumPaymentAmount等 cent/100 → CNY | 字典明确是发货时间金额；不能当支付事件订单数或支付件数 |
| 店小秘现有 metrics fetch | 商品库/在线/草稿/待发布/失败数 | 不提供当前域所需的支付订单/件数 |
| AE 商品级 sales.query | 商品销量汇总、库存等 | 仍非已核准支付订单事件导出 |

精确支付订单导出在本次有界核验内 **UNVERIFIED**；没有扩大查找或读取原始订单。

## 时间、店铺、数据核准

- 公共目标配置绑定 aliexpress-choice / environmentId=400370，目标期2026-12-01—12-31、Asia/Shanghai；daily-paid-items为200件/DAY，但 metricStatus=PENDING，不能视为已有支付数据。
- 脚本注释写“纳物-箱包全托1店”，并声明400370→2358891；正式“纳物一店”到环境/平台店铺/channel的 Human 核准映射仍 UNVERIFIED。不能仅从400370推定店铺权威身份。
- 实际分析起止期间待确认。statDate来自宿主本地日期；销售汇总只保存PST字样，DOM顶层window=today与meta.window=platform_default_30d冲突；字典的PDT(UTC-8)和脚本UTC-7/PST声明冲突。本轮不自行修字典或换算聚合。
- 真实数据所有者、核准人、来源ID、正式字典字节哈希均未核准。G2-A政策仍为SYNTHETIC_ONLY，仅fixture-export/fixture-data-owner；不能沿用为真实来源授权。

已知聚合报告只检查metadata：data/metrics/reports/2026-10-25.json，generatedAt=2026-10-25T07:06:36.079Z；AE 17条、DXM 5条，22字段中17正常，5项因SKIPPED_PLATFORM_DAYCUT缺失，verdict=HAS_MISSING。它是历史产物，不证明当前期间或双系统店铺映射。没有读取原始订单导出或输出经营明细。

## 现有日志和 WorkBuddy 边界

主server构造HiddenDataLoopService；config将event_log/action_log指向userDataDir/data；append经模块内Map队列追加。只能确定逻辑调用链，不能证明唯一进程写入。GET /api/events和GET /api/action-log调用的readJsonl会ensureHiddenDataFiles，故本轮未调用。POST /api/action-log是通用action入口，不是已核准的G2影子记录/完整报告采纳协议；所审处理器接受正文type/source/payload，未显示可信principal校验，外围认证仍UNVERIFIED。不能把假设端点当现存集成证据。

秘书UI发送消息和页面/risk上下文，server生成并保存command草稿；agent intake按taskBlock写WorkBuddy/Codex队列。UI建议、模型风险字段、队列目标均不产生权限。G2-A可信宿主governance对签发principal、capability和store校验，但仍为合成候选，未证明WorkBuddy真实身份已迁移。未调用相关接口。

## Human 采纳契约必填项

1. 签署人、签署时间、授权依据、签名/批准产物摘要；单域、结束期间、时区/偏移、支付事件、订单状态、退款取消、计量单位。
2. 正式Taskboard路径/所有者/一致快照导出者；正式日志路径/唯一所有者/认证追加接口/持久去重和并发策略。
3. storeRef与标签、环境、平台shopId/channel核准映射；来源sourceId/path/sha256/version/capturedAt/coverage/freshness与所有者、来源批准。
4. 精确字典字节、来源政策、权限政策、认知包内容/提示词摘要；真实审核人及factId/version/factHash/reviewedAt绑定批准。
5. WorkBuddy/UI仅提出候选；可信宿主验证权限、店铺与批准后才采纳。此准备稿本身不授予任何新权限。

## 验收与影响

本次完成内容：来源/字段/口径差异、历史聚合metadata、日志HTTP与权限边界、采纳契约待填项；每份命名证据的绝对路径、行号、SHA-256与UTC修改时间见同目录source-contract.json。hash仅冻结本次观察字节，不证明作者或授权。

修改/影响范围：仅本目录source-contract.json、source-contract.md；代码修改0，生产调用/写入0，原始订单读取0。验收方式：JSON可解析；复算命名文件SHA-256并核对所列源码行；不得据此自动接线。未运行产品或生产测试。

风险/待确认：真实支付事件来源/期间/时区/店铺/核准人、正式库和日志所有权未确定；现有AE事实没有完整G2-A输入字段及审批，不能直接标VERIFIED。

Backlog：分别授权源所有者提供去标识闭期快照及语义批准；指定正式库导出者/日志所有者与认证边界；政策核准后先在隔离合成环境验收适配器。本轮不展开。
