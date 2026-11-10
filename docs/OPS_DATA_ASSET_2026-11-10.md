# 运营数据资产全景与增收分析库

> 建立于 2026-11-10。目的：围绕「2026-12 日均 500 件（`sales.qty.total`，含货通）/ 月净利 ≥¥12,000（约束）」这一个目标，
> 把需要的运营数据**先列全、再落库、再定抓法**，避免「想到什么抓什么」。
>
> 口径来源：`docs/TARGET_DECISION_2026-11-10.md`（2026-11-10 中午 Human 裁决，**日均 500 件已覆盖原定的 200 件/天**）。
>
> 库：`data/metrics/ops.db`（SQLite，数据不入库）｜构建器：`scripts/build-ops-db.mjs`｜巡检器：`scripts/ops-daily-check.mjs`｜口径权威：`config/metrics-schema.json`

---

## 0. 结论先行（六个必须先接受的事实）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **最大短板是「没有时间序列」** | `fact_store_daily` 只有 4 个日期（10-25、11-10 跳空），漏斗只有 11-08/11-09 两天。快照能说「现在怎样」，说不了「在变好还是变坏」 |
| 2 | **增收缺口 5.57 倍，单店单杠杆不可能达成** | 400370 目标 15,000 件/月，近 30 日 2,693 件 → 缺 12,307 件（+457%）。单杠杆需曝光 243 万（现 43.7 万）或转化率 18.27%（现 3.28%） |
| 3 | **SKU 级毛利已打通，但成本只覆盖 24.5%** | 4,592 SKU 中 1,124 个能匹配成本（high 档 506）。**可信成本子集仅 201 SKU 有动销，30d 毛利 ¥13,900 / 收入 ¥29,560 = 47.0%** |
| 4 | **`sellableQuantity` 绝对不能当库存** | 全店可售额度 226,783 vs 实仓 1,774 = **127.8 倍**。按它算库存会得出「几乎不用补货」的错结论 |
| 5 | **两套平台口径差 3.0%，必须声明用哪套** | 400370：销售管理 `sales.query` 30d = 2,773 件（11-10）；生意参谋漏斗 30d = 2,693 件（11-09）。差 80 件 |
| 6 | **库存字段有三种语义，混用会误报断货** | `real=null`(387 非本仓) / `real=0 且额度>0`(12 由平台额度兜底) / `real>0`(真实仓存)。实测只有 **1 个真断货**，而非 25 个 |

---

## 1. 增收目标的因果结构（数据是按这个树摆的）

```
月供货件数（= 主指标 sales.qty.total）
├─ 流量侧  曝光量 ──→ 访客数 ──→ 商品访客
│                    ↑ CTR（曝光访客率）
├─ 转化侧  加购人数 ──→ 支付买家 ──→ 支付件数
│           ↑ 加购率              ↑ 支付转化率、客单件数
├─ 供给侧  在售商品数 × 动销率 × 断码/断货
└─ 价格侧  供货价（全托管下这才是你的收入单价）× 件数 = 供货收入
     └─ 减 采购成本 / 实罚 / 退货 → 毛利
```

**关键认知（全托管模式）**：卖家把货以 `supplyPrice` 卖给平台，平台定价销售、负责流量与履约。
所以 **营收 ≠ GMV，营收 = 供货价 × 件数**；前台售价（`fixedPrice` / `promotionPrice`）是平台的价格，不是你的收入。
这也是 `config/ops-stores.json` 把 `sales.qty.total`（支付件数）定为北极星、而不是 GMV 的原因。

---

## 2. 数据清单：每一项「有用数据」的定位

### 2.1 已入库（可直接分析）

| 表 | 行数 | 粒度 | 覆盖 | 来源 | 能回答什么 |
|---|---:|---|---|---|---|
| `fact_store_funnel` | 24 | 店 × 周期 | 3 店 × 4 周期 × 2 天 | 生意参谋 store-overview（`mtop.aliexpress.dps.query`） | 增收漏斗全链路 + 环比 |
| `fact_store_country` | 240 | 店 × 周期 × 国家 | TOP10 完整漏斗 + 21 国访客占比 | 同上 countryTable | 哪个国家在涨/在跌，该投哪 |
| `fact_store_daily` | 938 | 店 × 口径 × 窗口 | 4 日期 | 销售管理 / 财务 / 店小秘 / 市场 | 官方口径销量、资金、目录、市场 |
| `fact_item_snapshot` | 968 | 店 × 商品 × 日 | 3 店（400370 全量 474） | `sales.query` 翻页 | 商品级销量/库存四态/平台预测/备货建议 |
| `fact_sku_snapshot` | 4,592 | 店 × 商品 × SKU × 日 | 同上 | 同上 `skuList` | 规格级供货价、售价、库存、可售天数 |
| `dim_sku_cost_bridge` | 1,445 | 平台 skuId | 3 店 | `商品级实收_<date>.csv` | **平台 skuId ↔ 店小秘编码 ↔ 采购成本**（唯一的桥） |
| `fact_cost` | 1,468 | 店小秘 skuCode | 全量 | 店小秘入库流水 | 成本原值 + 可信度分档 |
| `fact_item_profit` | 505 | 店 × 商品 | 3 店 × 90 天 | 商品主数据 | 品质分/DSR/SNAD/罚金/90天实收/毛利估算 |
| `fact_market` | 857 | 市场 × 指标 × 主体 | 3 日 | 极鲸云 ixspy | 类目/榜单/关键词竞争 |
| `dim_item` / `dim_sku` | 968 / 4,592 | 商品 / 规格 | — | 同上 | 类目、上架时间、分销渠道、规格属性 |

### 2.2 视图（把运营问句固化，避免每次手写 SQL）

| 视图 | 用途 | 关键红线 |
|---|---|---|
| `v_revenue_gap` | 目标 vs 现状 vs 缺多少 + 三条单杠杆目标值 | 取每店**最新一次**漏斗，不跨日混用 |
| `v_restock_need` | 每个商品的可售天数、补货紧急度 | 只用 `real - locked`，**不碰 `sellable_qty`** |
| `v_sku_margin` | SKU 级供货毛利 | 成本经桥 JOIN，未匹配则为 NULL |
| `v_margin_risk` | 负毛利/薄毛利清单 | 带 `cost_suspect` / `margin_usable` 门，弱成本不下结论 |
| `v_item_margin` | 商品级 90d 毛利（估算口径） | `est*` 是估算，非审计 |
| `v_data_coverage` | 每表行数 + 日期跨度 | 每日巡检第一眼 |

### 2.3 有用但还缺的（按增收贡献排序）

| 优先级 | 数据 | 为什么必须 | 现状 | 抓取路径 |
|---|---|---|---|---|
| **P0** | **每日快照（时间序列）** | 没有趋势就没有「异常检测」和「环比归因」，所有阈值判断退化成人拍脑袋 | 只有稀疏 2-4 天 | 见 §5 日更方案 |
| **P0** | **商品级流量漏斗** | 现在只能看店铺整体漏斗，说不出「哪个商品在掉」 | 缺（仅 10-25 有 4 个商品样本） | 生意参谋 `/m_apps/one-stop-service-sycm/product-rank`，按 itemId 取 曝光/访客/支付/加购 |
| P1 | SKU 级成本补齐 | 成本覆盖 24.5%，毛利结论只对 201 个有动销的可信 SKU 成立 | 部分 | 店小秘 `choiceProduct.pageList` 的 `variationList`（含编码）↔ 入库流水重新建桥 |
| P1 | 佣金/履约费/头程 | 现在只有「供货毛利」，不是净利；`sales.amount.net` 是平台扣费后收入，仍非利润 | 缺 | 财务 `/m_apps/fund/onestop` 的费用明细接口（`queryorderoverview` 已有拆项：待结算/放款前退款/已放款） |
| P1 | 退款率 / 纠纷率 | 直接影响净利，且是平台考核项 | 缺 | `/m_apps/quality-order/refund`（已有 `probe-order-list.mjs` 可改） |
| P2 | 调价历史 | 判断「降价有没有换来量」 | 缺 | `/m_apps/price-adjustment-management/adjustmentPrice` |
| P2 | 流量智投/活动效果 | 付费流量的 ROI | 缺 | `/m_apps/Invitation-supply-price/one-stop-Invitation` |
| P2 | 库龄/周转 | 滞销占资、DEAD_STOCK 判定精度 | 部分（`fact_cost` 有入库时间） | 店小秘出入库流水（已有） |

---

## 3. 抓取路径矩阵（每项数据从哪来、用什么、多久一次）

**统一入口**：稳卖浏览器 `127.0.0.1:3980` → `openEnv(envId)` → 拿 CDP 端口 → Playwright `connectOverCDP`。
店铺 envId / channelId 见 `config/ops-stores.json`（400370:2358891、416488:2443536、461693:2690629、461692:2686609）。

| 数据 | 接口 / 页面 | 脚本 | 频率 | 现状 |
|---|---|---|---|---|
| 店铺漏斗（曝光→支付） | `mtop.aliexpress.dps.query` via `/m_apps/one-stop-service-sycm/store-overview` | `fetch-store-overview.mjs` | 每日 | ✅ 2 天 |
| 国家漏斗 | 同上 `countryTable` | 同上 | 每日 | ✅ 2 天 |
| 商品/SKU 全量（销量+库存+预测+供货价） | `mtop.global.merchant.sales.query`（翻页） | `fetch-ae-items.mjs` | 每日 | ✅ 400370 全量 474/474；另 2 店各 10 |
| 店铺级销量/目录/断码断货 | `sales.query` / `sales.summary` | `fetch-ae-metrics.mjs` | 每日（避开北京 15:00-17:00 日切） | ✅ 4 店 |
| 资金（成交/待结算/净收入） | `mtop.ae.merchant.fund.accounting.*` via `/m_apps/fund/onestop` | `fetch-ae-metrics.mjs` / `fetch-funds-detail.mjs` | 每日 | ✅ |
| 逐日销售趋势 | `mtop.global.merchant.shop.channel.sales.trend` | `fetch-ae-daily.mjs` | 每日 | ⚠️ **mtop 直调被拒（缺卖家会话头），待转 UI 驱动** |
| 商品品质/DSR/SNAD | `/ait/cn_ams/item_qlt_insp_choice_merchant_score/home` | `fetch-quality-score.mjs` | 每周 | ✅ |
| 罚款/违规 | `/m_apps/violation/violist`、`breach-contracts` | `fetch-breach-contracts.mjs` | 每周 | ✅ |
| 采购成本 | 店小秘入库流水 `entryAndExitRecordList` | `build-cost-table.py` | 每周 | ✅ 1,468 SKU |
| 成本↔平台SKU 桥 | 成品 CSV `商品级实收_<date>.csv` | （人工/半自动产出） | 每周 | ⚠️ **依赖外部 CSV，非自动化闭环** |
| 商品主数据（实收+品质+罚金） | 上面三者合并 | `build-product-master.mjs` | 每周 | ✅ |
| 类目/榜单/关键词 | 极鲸云 ixspy MCP | `fetch-ixspy-market.mjs` | 每周 | ✅ 3 期 |
| 店小秘刊登漏斗 | `getOfflineCounts.json`（draft/waitPublish/publishFail） | `fetch-dxm-metrics.mjs` | 每日 | ✅ 1 期 |

### 3.1 抓取三条硬约束（踩过的坑，不要再踩）

1. **日切窗口**：平台 "PST" 实为 PDT(UTC-7)，日切 = UTC 07:00/08:00 = **北京 15:00–17:00**。窗口内「店铺数据」页会短暂归零（实测 pv 3,194 → 4）。采集器必须 `SKIPPED_PLATFORM_DAYCUT` 跳过，不写库。
2. **CDP 下禁 `browser.close()`**：会关掉用户正在用的 Chrome。抓完 `process.exit()`，自己开的稳卖环境用 `closeEnv`。
3. **mtop 响应会被缓存**：每次抓取先 `Network.setCacheDisabled(true)`，否则静默拿到上次数据 —— 比报错更危险。

---

## 4. 增收缺口：15,000 件/月，缺 5.57 倍

**目标口径（TARGET_DECISION 裁决）**：日均 500 件 × 30 = **15,000 件/月**，`sales.qty.total`（含货通）。
基线（10-19~10-25）日均 73.14 件 → 目标 **6.84 倍**；按 11-09 的近 30 日数据日均 89.8 件 → 需 **5.57 倍**。

**现状（400370，as_of 2026-11-09，生意参谋近 30 日）**

| 环节 | 数值 | 比率 |
|---|---:|---|
| 搜索曝光量 | 437,126 | — |
| 店铺访客数 | 57,817 | 曝光→访客 **13.23%** |
| 商品加购人数 | 9,119 | 访客→加购 **15.77%** |
| 支付买家数 | 1,898 | 访客→买家 **3.28%** |
| 支付件数 | 2,693 | 客单件数 **1.419** |

**只动一个杠杆时的目标值（其余链路效率不变）**

| 单杠杆 | 目标值 | 相对现状 | 现实性 |
|---|---:|---|---|
| 只提曝光 | 2,434,790 次 | 5.57× | 需付费流量，**需真金投放预算** |
| 只提访客 | 322,040 人 | 5.57× | 同上 |
| 只提转化率 | 18.27% | 3.28% → 18.27% | 类目均值 2–5%，**不可能** |
| 只提客单价 | 7.90 件/单 | 1.419 → 7.90 | **不可能** |

### 4.1 关键判断：这个目标**不可能靠单店单杠杆达成**

三店近 30 日合计 **5,947 件**（2,693 + 2,258 + 996），即使三店全部翻倍也只有 11,894 件，仍够不到 15,000。
所以达成路径只能是三条一起上：

1. **多店铺量**：把 416488（转化 4.10%、现状 2,258 件）当第二增长极，而不是只盯 400370。
2. **上新扩品**：`DEAD_STOCK=0` 但 `NOT_WAREHOUSED=387`——大量商品不备货、不动销，动销面只有 32/96 仓存商品。**扩 SKU 数量比提单价更现实**。
3. **付费流量**：曝光需 5.57 倍，纯自然流量做不到，必须动「流量智投 / 平台活动」两个官方入口。

### 4.2 三店横比暴露的真问题

| 店 | 30d 件数 | 曝光 | 转化率 | 判断 |
|---|---:|---:|---:|---|
| 纳物-箱包全托1店 | 2,693 | 437,126 | 3.28% | 流量最大，转化中等 → **提转化优先** |
| 纳物-箱包全托2店 | 2,258 | 295,743 | **4.10%** | 转化最好 → **加流量最划算** |
| 梵奢缇-全托 1 店 | 996 | 204,037 | **2.05%** | 转化最差，曝光不低 → **漏水在转化侧**，不是流量不够 |

---

## 5. 运维思路（SOP）

### 5.1 巡检节奏

| 频率 | 时间 | 动作 | 产出 |
|---|---|---|---|
| **日** | 北京 17:30（日切后） | 跑采集 → 重建库 → 看 4 个视图 | 当日快照 + 异常清单 |
| **日** | 随采集 | 新鲜度门 + 自洽校验（见 5.3） | PASS/FAIL |
| **周** | 周一 | 成本表/商品主数据/市场数据刷新 | 毛利与竞争格局更新 |
| **月** | 月初 | 目标复盘（`v_revenue_gap`）+ 阈值校准 | 目标与阈值调整 |

日更一条命令（建议做成计划任务）：

```bash
node scripts/fetch-store-overview.mjs --env 400370,416488,461693
node scripts/fetch-ae-items.mjs 400370
node scripts/fetch-ae-metrics.mjs 400370
node scripts/build-ops-db.mjs      # 重建分析库
node scripts/ops-daily-check.mjs   # 数据校验 + 告警（exit 1=有P0，exit 2=数据不可信）
```

### 5.2 告警分级（阈值都可溯源到库里的真实分布，不是拍脑袋）

| 级别 | 触发条件 | 数据来源 | 实测命中 | 处置 |
|---|---|---|---|---|
| **P0 断货** | `real_inv>0` 且 `real-locked<=0` 且 7d 销量>0 | `v_restock_need`=STOCKOUT | **1** | 当日补货，否则直接掉排名 |
| **P0 负毛利且走量** | `margin_state=NEGATIVE` 且 30d 销量>0 且 `margin_usable=1` | `v_margin_risk` | 0 | 调供货价或停投 |
| **P1 补货紧急** | 可售天数 < 14 天 | `v_restock_need`=URGENT | **27** | 进补货单（Top: 覆 0.4 天 / 7d 销 50） |
| **P1 转化骤降** | `cyc_pay_conv_rate < -20%` | `fact_store_funnel` | 0 | 查价格/库存/差评 |
| **P1 断码** | `brokenSize / platformItems > 5%` | `fact_store_daily` + schema | 0 | 补规格 |
| **P2 滞销** | 30 日 0 销但实仓 ≥50 | `v_restock_need`=DEAD_STOCK | 0 | 清仓/改图/调价 |
| **P2 品质风险** | `qualityScore` 下降或 `snadRatio > 1` | `v_item_margin` | 见库 | 查退货与差评 |
| **P3 数据异常** | 新鲜度 STALE / 校验 FAIL | `v_data_coverage` | 0 | 先修数据，不解读指标 |

### 5.2.1 库存状态完整分档（防止把「没备货」当「断货」）

| 状态 | 定义 | 实测 | 该不该补货 |
|---|---|---:|---|
| `NOT_WAREHOUSED` | `real_inv IS NULL`，非本仓备货模型 | 387 | 不适用，看其履约方式 |
| `NO_WAREHOUSE_NO_SALES` | 实仓 0 且 7d 0 销 | 20 | 不适用 |
| `SUPPLY_BACKED` | 实仓 0 但平台可售额度 > 0 | 12 | 由平台额度兜底，非本仓断货 |
| `STOCKOUT` | 实仓 > 0 但可用 ≤ 0 且 7d 有销 | **1** | **立即补** |
| `URGENT` | 覆盖 < 14 天 | **27** | 补 |
| `WATCH` | 覆盖 14–30 天 | 9 | 观察 |
| `DEAD_STOCK` | 30d 0 销且实仓 ≥50 | 0 | 清仓（当前无此情况） |
| `IDLE` | 30d 0 销且实仓 <50 | 6 | 观察/清尾 |
| `OK` | 覆盖 ≥30 天 | 32 | — |

> 这一分档的意义：初版视图把 `real_inv=0` 一律判 STOCKOUT，报了 **25 个 P0**，全部是误报。
> 修正后只剩 **1 个真断货**。**误报比漏报更贵**——它会让人不再相信告警。

### 5.3 数据自洽校验（每次建库必跑，FAIL 就停止解读）

| 校验 | 规则 | 当前结果 |
|---|---|---|
| 商品级 vs SKU 级销量加总 | `SUM(item.recent30d) == SUM(sku.recent30d)` | ✅ 4,282 = 4,282 |
| 平台两套口径差异 | `sales.query` 与 `store-overview` 差 < 5% | ✅ 2,773 vs 2,693 = **差 3.0%**（属已知口径差，报告必须声明） |
| 库存字段量级 | `sellable_qty / real_inv` 应 > 3（若接近 1 说明抓错字段） | ✅ 127.8 倍 → 确认 `sellable` 是额度非库存 |
| 成本异常 | `cost_cny > 3 × supply_price` 判 COST_SUSPECT | ⚠️ 4 个 SKU（N 件装，成本为整包价），不下毛利结论 |
| 跨日期去重 | 视图必须只取每店最新快照 | ✅ 已修正（此前 SKU 毛利被重复计算一倍） |
| 日切污染 | 当日 `pv` 不应 < 前期 1/10 | ✅ 已由 `platformDaycutWindow()` 守卫 |

**以上 5 项已固化为可执行巡检器**：`node scripts/ops-daily-check.mjs`

```
【1】数据校验  → PASS/WARN/FAIL，FAIL 时**不输出业务结论**（exit 2）
【2】业务告警  → P0 断货/负毛利、P1 补货紧急/转化骤降/断码、P2 滞销（有 P0 则 exit 1）
【3】覆盖度    → 每表行数与日期跨度
【4】增收缺口  → 目标 vs 现状 vs 三条杠杆目标值
```

### 5.4 口径红线（违反任一条，所有结论作废）

1. **`sales.qty.total`（含货通）≠ `sales.qty.direct`（不含货通）**，实测同店同期 2,302 vs 64，差 36 倍。
2. **`sellableQuantity` 是平台可售额度，不是物理库存**。必须用 `real − locked`。
3. **两套平台口径差 ~3%**：销售管理（2,773）vs 生意参谋（2,693）。环比只能用同一套，禁止混算。
4. **`sales.amount.net` 是平台扣费后收入，不是利润**。利润必须减采购成本、头程、包装、佣金、退款。
5. **`low` 档成本是商品参考价兜底**，不可用于毛利结论。
6. **抓不到就写 NULL + reason**，绝不沿用上一周期数值。
7. **金额单位是「分」**（`sumPaymentAmount.cent` / 100 = 元）。

### 5.5 fail-closed 原则

- 采集失败 → 记 `FETCH_MISS` 哨兵行，**不写 0**（例：461692 pop 模式 8 条 `value=null, reason=FETCH_MISS`）。
- 新鲜度未知 → 标 `UNKNOWN`，**不当实时数据用**。
- 校验 FAIL → **停止业务解读**，先修数据。

---

## 6. 库怎么用

```bash
# 重建（数据源没变时也可安全重跑，幂等）
node scripts/build-ops-db.mjs --rebuild

# 机器可读摘要
node scripts/build-ops-db.mjs --json

# 日巡检（只读；5 项数据校验 + P0/P1/P2 告警 + 覆盖度 + 增收缺口）
node scripts/ops-daily-check.mjs
node scripts/ops-daily-check.mjs --store env:416488   # 只看单店
node scripts/ops-daily-check.mjs --json               # 机器可读
```

```sql
-- 今天该干什么：断货 + 补货紧急
SELECT item_id, title, real_inv, locked_inv, days_of_cover, stock_state
  FROM v_restock_need WHERE stock_state IN ('STOCKOUT','URGENT')
 ORDER BY days_of_cover ASC;

-- 哪些 SKU 在亏钱（只信可信成本）
SELECT dxm_sku_code, supply_price, cost_cny, gross_margin_pct, recent30d_sales, grossprofit30d_cny
  FROM v_margin_risk WHERE margin_usable = 1 AND margin_state IN ('NEGATIVE','THIN')
 ORDER BY grossprofit30d_cny ASC;

-- 哪个国家值得加投
SELECT country, pay_item_qty, pay_conv_rate, cyc_pay_item, search_exp_pv
  FROM fact_store_country
 WHERE store_id='env:400370' AND period_key='Last_30Days'
 ORDER BY cyc_pay_item DESC LIMIT 10;

-- 增收缺口
SELECT * FROM v_revenue_gap;
```

---

## 7. 已知限制（明确不做假装）

| 项 | 现状 | 影响 |
|---|---|---|
| 时间序列 | 最多 4 个日期，且不连续 | **无法做趋势、环比归因、异常检测**。这是当前第一优先要补的 |
| SKU 成本覆盖 | 24.5%（1,124/4,592），可信档仅 201 个有动销 | 毛利结论只对 201 个 SKU 成立 |
| 成本桥 | 依赖外部成品 CSV，非自动闭环 | CSV 不更新，桥就断 |
| 商品级流量 | 缺 | 说不出「哪个商品在掉」 |
| 净利 | 无佣金/头程/退货数据 | 只能出供货毛利，不能核对 ¥12,000 |
| 逐日趋势接口 | mtop 直调被拒 | 需转 UI 驱动（`probe-ae-daily.mjs` 已探明参数） |
| ixspy 覆盖 | 仅箱包类目 3 期 | 其他类目无市场对照 |

---

## 8. 下一步（按 ROI 排序）

1. **打通日更**（P0）：把 §5.1 五条命令做成每日 17:30 计划任务 → 序列从 4 天变 30 天，所有阈值和趋势才有意义。
2. **补商品级流量**（P0）：`product-rank` 页按 itemId 取曝光/访客/加购 → 才能定位「掉量的具体商品」。
3. **目标可达性拆解**（P0）：15,000 件/月 需要三店合力。建议先给 416488（转化 4.10%）单独设目标，它是最便宜的增量。
4. **补净利三件套**（P1）：佣金、头程/入仓费、退款率 → 从供货毛利升级到净利，才谈得上核对 ¥12,000。
5. **成本桥自动化**（P1）：用店小秘 `variationList` 直接建编码↔平台 skuId 映射，摆脱外部 CSV。
6. **修正 N 件装成本口径**（P1）：`WSN52*30` 成本 684 是整包价，4 个 COST_SUSPECT SKU 需按件数归一。

---

## 9. 目标口径红线（防止两套目标并存）

| 说法 | 状态 | 出处 |
|---|---|---|
| 每日 ≥200 件 | ❌ **已作废** | 原 `docs/coordination/CODEX_STATUS.md` 第 61 行 |
| **日均 500 件**（`sales.qty.total` 含货通） | ✅ **现行** | `docs/TARGET_DECISION_2026-11-10.md`，2026-11-10 中午 Human 裁决 |
| 月净利 ≥¥12,000 | ✅ 保留，但**降级为约束** | C4 裁决：销量为主指标；500 件/天达成后 ¥0.80/件即够，大概率自动达成 |
| 「500 单 ≈ 750 件」 | ❌ 已作废 | 按"500 单≈750 件"算出的 3.75× 已废弃，正确为 6.84×（对基线） |

> 任何报告引用目标前，先确认用的是这一张表。**两套目标并存 = 平行真相**，是所有经营结论失真的起点。
