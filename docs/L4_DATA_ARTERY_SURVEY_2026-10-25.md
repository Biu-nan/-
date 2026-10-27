# L4 数据动脉实地勘测报告

> 勘测时间：2026-10-25 14:45–15:00 CST
> 方法：只读。店小秘走 CDP 9223（已有登录态），速卖通后台走稳卖本地 API（已有店铺环境）
> 探针脚本：`scripts/probe-dxm-*.mjs`、`scripts/probe-aliexpress-*.mjs`
> **登录态已存在，无需人工登录。** 本节纠正此前"需要登录实测"的错误判断。

---

## 0. 结论先行

1. **数据源全部现成，不需要 Lance 提供任何账号或链接。** 店小秘已在 9223 登录，稳卖 3980 在线且 5 个店铺环境可开。
2. **销量/流量/结算三层数据全部拿齐，且都是真实值**（非占位、非推算）。
3. **发现一个致命口径陷阱**：同一店铺同期销量，销售管理页 2,302 件 vs 店铺数据页 64 件，**相差 36 倍**。平台自己在页面上写了警告。不锁定口径，任何经营分析都是错的。
4. 店小秘确认**不持有销量**：`choiceProduct` 126 个字段里零销量指标。

---

## 1. 店小秘（CDP 9223）

### 1.1 已登录页面（实测 6 个标签）
| 页面 | URL |
|---|---|
| 商品管理 | `/web/dxmCommodityProduct/index` |
| 仓库清单 | `/web/warehouse/warehouseProduct` |
| 出入记录 | `/web/privateWarehouse/entryAndExitRecordList` |
| 速卖通全托管产品编辑 | `/web/smtChoice/edit?id=...` |
| 产品管理（draft） | `/web/smtChoice/draft` |

### 1.2 关键只读接口（已实测返回）
| 接口 | 返回 | 用途 |
|---|---|---|
| `GET /api/choiceProduct/getOfflineCounts.json` | `{draftNum:210, waitPublish:38, publishFail:9, publishing:0, publishingTiming:0}` | **刊登状态漏斗，含 9 个发布失败** |
| `GET /api/dxmCommodityProduct/index.json` | `commodityProductNum:1944`，分页含商品明细 | 商品主数据总量 |
| `POST /api/choiceProduct/pageList.json` | 186 条在线商品，**126 字段** | 在售商品主数据 |
| `POST /api/warehouseProduct/pageList.json` | 空（totalSize 0） | **Choice 半托管不自管库存，此处天然为空** |
| `POST /api/dxmWarehoseInout/warehoseInoutPageList.json` | 出入库流水 | 库龄/周转辅助 |

### 1.3 `choiceProduct` 字段实况（126 个）
**有**：`productId / productStatus / dxmState / dxmOfflineState / subject / hsCode / packageWeight,Length,Width,Height / variationList / sourceUrl(1688链接) / auditFailureType,Reason / onlineTime / gmtCreate,Modified / categoryNameZh,En / platformProductId`

**没有**（确认过全字段名）：任何 `sold / sales / order / gmv / pv / uv / view / click / rate / review` 字段。

> **FACT：店小秘是执行系统（内容+状态），不是经营系统（销量+利润）。这与行业"ERP 管执行、BI 管决策"的判断完全一致。**
> 副产品：`hsCode`、`packageWeight`、包装尺寸在库里就有——**之前判定"缺失只能问人"的商业字段，有一部分其实店小秘已存**，只是 1944 个商品里多数 `weight:0.0` 未填。

---

## 2. 稳卖浏览器（本地 API 127.0.0.1:3980）

### 2.1 接口能力（实测）
`/queryEnv` `/openEnv` `/closeEnv` `/deleteEnv` 可用；`openEnv` 返回 `pid + cdpPort`（实测 10279），可直连 CDP。
> 坑：`openEnv` 后 CDP 端口需 **等待就绪**（实测首次连接会 ECONNREFUSED，需重试 2s×N）。

### 2.2 店铺清单（5 个，config.json 只记了 2 个）
| envId | 名称 | 平台 |
|---|---|---|
| 461693 | 梵奢缇-全托 1 店 | 速卖通卖家中心 |
| 461692 | 梵奢缇- pop1 店 | 速卖通卖家中心 |
| 416488 | 纳物-箱包全托2店 | 速卖通卖家中心 | channelId 2443536 |
| 400370 | 纳物-箱包全托1店 | 全球速卖通 | channelId 2358891 |
| 375548 | 自营店铺2（工具店） | 速卖通卖家中心 |

---

## 3. 速卖通全托管后台（以 400370 / Shop1105227604 实测）

### 3.1 完整菜单路由表（`li[name][path]` 可编程读取）
| 菜单 | path |
|---|---|
| 首页 | `/m_apps/newhome/choice` |
| 商品管理 | `/m_apps/home/global` |
| 补货入库 | `/m_apps/ascp/aechoice.purchase_order_list_aechoice` |
| **店铺数据** | `/m_apps/one-stop-service-sycm/store-overview` |
| **商品分析** | `/m_apps/one-stop-service-sycm/product-rank` |
| **销售管理** | `/m_apps/aechoice-Sales-statistics/sub-sales-aeChoice` |
| **财务管理** | `/m_apps/fund/onestop` |
| 税务管理 | `/ait/cn_ams/tax_global_tax_number_manage_choice/taxmanage` |
| 金融服务 | `/m_apps/funds-manage/loan_Supermarket_aechoice` |
| 调价管理 | `/m_apps/price-adjustment-management/adjustmentPrice` |
| 流量智投 | `/m_apps/Invitation-supply-price/one-stop-Invitation` |
| 平台活动 | `/m_apps/Invitation-supply-price/platform-marketing` |
| 新品闪电推 | `/ait/cn_ams/item_operation_system/lightning_promotion` |
| AI商机选品 | `/ait/cn_ams/merchant_full_hosting_operation_s/home` |
| 品质合规 | `/ait/cn_ams/item_qlt_insp_choice_merchant_score/home` |
| 特色货盘 | `/m_apps/palletManage/choice-manage` |
| 纠纷管理 | `/m_apps/quality-order/refund` |
| 我的违规 | `/m_apps/violation/violist` |
| 商品考核 | `/m_apps/product-examine/examine` |

> **`调价管理` 和 `流量智投` 的存在，说明 P3 级动作（改价/投流）有官方入口，不必模拟 UI 硬点。**

### 3.2 真实数据（2026-10-25 抓取）

**店铺数据**（周期 2026-09-24 ~ 2026-10-23 PDT，国家=全部）
| 指标 | 值 |
|---|---|
| 浏览量 | 3,194 |
| 访客数 | 1,893 |
| 支付买家数 | 58 |
| 支付件数 | 64 |
| 支付转化率 | 3.06% |
| 动销商品数 | 27 |

国家分布（前列）：美国 曝光441/浏览275/访客275/支付6；巴西 351/198/198/支付5；日本 231/130/130/支付6；英国 184/115/115/支付10

**商品分析**（近30天，逐 SPU）
| 商品ID | 标题 | 供货价 | 曝光 | 访客 | 支付件 | 买家 | 加购 | 收藏 |
|---|---|---|---|---|---|---|---|---|
| 1005011985916829 | 3D Printer Filament Storage Bag | 3.9~33 | 312 | 196 | 16 | 16 | 46 | 4 |
| 1005012813168695 | 同上（另一变体） | 3.9~56 | 260 | 143 | 6 | 5 | 18 | 1 |
| 1005012624861620 | Cute Mini Retro Television Toy | 19 | 557 | 368 | 6 | 6 | 44 | 34 |
| 1005011974053454 | Extra Large Travel Duffle Bags | 21~23 | 21 | 13 | 4 | 1 | 2 | 0 |

**销售管理**（更新时间 2026-10-24 23:47:21 PST）
| 指标 | 值 |
|---|---|
| 今日销量 | 65 |
| 近7日销量 | 503 |
| 近30日销量 | 2,302 |
| 全部商品 | 474 |
| 已断货 | 0 |
| **已断码** | **18** |
| 售罄预警 | 0 |
| 建议备货 | 0 |
| 滞销预警 | 0 |

逐商品字段（可直接支撑补货与生命周期判定）：
`今日/近7/近30/近1年支付件数`、`实仓库存`、`占用库存`、`在途库存`、`可售库存`、`未来7/30/60/90天销量预测件数`、`补货建议`、`商品状态`、`首次上架时间`

**财务管理**（发货时间口径）
| 指标 | CNY |
|---|---|
| 可用金额 | 11,653.76 |
| 待结算总金额 | 9,975.94 |
| 成交金额（10-01~10-23） | 22,365.85 = 待结算 9,924.18 + 放款前退款 52.33 + 已放款 12,389.34 |
| 净收入（10-01~10-23） | 21,510.48 = 总收入 22,860.36 − 总支出 1,349.88 |
| 累计成交金额 | 113,123.58 |
| 质押金已冻结 | 1,000.00 |

### 3.3 mtop 接口清单（结构化取数路径，已捕获）
**销售/库存**：`mtop.global.merchant.sales.query` / `.summary` / `mtop.global.merchant.shop.sales.summary` / `mtop.global.merchant.shop.channel.sales.trend` / `.sales.category` / `.sales.config`
**资金**：`mtop.ae.merchant.fund.accounting.queryfundoverview` / `queryorderoverview` / `querybaseinfo` / `querymerchantaccountinfo` / `querydynamicbaseinfo`
**流量**：`mtop.aliexpress.dps.query`（生意参谋统一入口）
**新鲜度**：`mtop.aliexpress.seller.data.delay.plan` ← **平台官方声明数据延迟，可直接做"数据未更新"判定的权威依据**

---

## 4. ⚠️ 口径陷阱（最高优先级，必须先解决）

平台在销售管理页明确写：

> 「本页面中"支付件数"包含了货通的支付件数，而生意参谋-商品分析页面中的"支付件数"不包含货通数据，请甄别口径差异。」
> 「已断货、已断码数据有 1 小时延迟；售罄预警、备货建议数据有 1 天延迟。」

实测印证：
- 销售管理近30日销量 **2,302 件**
- 店铺数据同期支付件数 **64 件**
- 财务同期成交金额 22,365.85 / 2,302 ≈ **9.7 元/件**，落在供货价区间内 → 2,302 才是真实件数，64 是"非货通"子集

**结论：系统里必须定义两套口径并显式命名，绝不能混用。**
| 口径键 | 含义 | 来源 |
|---|---|---|
| `sales.qty.total` | 含货通，对外口径真实销量 | 销售管理 / `sales.summary` |
| `sales.qty.direct` | 不含货通，仅店铺直发 | 商品分析 / `dps.query` |
| `sales.amount.settle` | 结算口径收入（含退款拆分） | 财务管理 / `queryorderoverview` |

> 这条如果不落进代码，做出来的利润表一定是错的——而这正是行业说"ERP 算不准跨平台利润"的同一个坑。

---

## 5. 顺带发现的两个真实信号

1. **店小秘有 9 个发布失败 + 38 个待发布 + 210 个草稿**——这是现成的、可立即处理的执行侧告警，不需要等新系统。
2. **销售管理页有 18 个已断码**，首页挂「滞销清仓 10」——平台已经给了告警，我们只需要读，不需要自己发明阈值。

---

## 6. 对方案的影响：三处修正

| 原判断（v0.2） | 修正后 |
|---|---|
| "Choice 后台能拆出哪些结算分项现在是 UNKNOWN，必须登录实测" | ✅ **已实测**：结算拆成 待结算/放款前退款/已放款 三段，净收入 = 总收入 − 总支出 |
| "需要 Lance 提供 1688 链接/价格/尺寸" | ⚠️ **部分不必**：店小秘已存 `hsCode`、包装尺寸、`sourceUrl`(1688链接)，只是多数未填值 |
| "L4 等数据源确定再动" | ✅ **数据源已确定**，L4 可以立即开工，前置条件只剩"口径定义" |

---

## 7. 落地路线（修正后）

| 步 | 内容 | 依赖 |
|---|---|---|
| **S0** | 定义口径字典 `data/metrics/schema.json`（三套口径 + 单位 + 统计窗口） | 无 |
| **S1** | 抓取器：`scripts/fetch-dxm-metrics.mjs`（CDP 9223 只读，落 `data/metrics/facts/*.jsonl`） | S0 |
| **S2** | 抓取器：`scripts/fetch-ae-metrics.mjs`（稳卖 openEnv → 销售/财务/流量三页 → 落库） | S0 |
| **S3** | 指标重算层：从 facts 算指标，永不存算好的结论 | S1,S2 |
| **S4** | 诊断环：五层下钻 + 平台自带告警（断码/滞销/断货）接入 | S3 |
| **S5** | 决策环：工单生成（抑制 + 分级 + top-N） | S4 |

**S1/S2 的共同约束**：按 `(skuId, storeId, statDate, statWindow, caliber)` 幂等 upsert；抓不到就写 `null + reason`，绝不沿用昨日值。
