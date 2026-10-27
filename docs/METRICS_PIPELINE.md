# 经营数据管道（S0–S3）

> 建立于 2026-10-25。目标：让系统能回答「店铺现在什么状态」，并保证答案永远可追溯、可重算、不编造。

## 一句话架构

```
店小秘(CDP 9223) ─┐
                  ├─→ facts（原始事实，只追加）─→ 重算层 ─→ 体检报告
速卖通(稳卖 3980)─┘        永不存结论        按当前口径重算
```

## 怎么跑

```bash
# 抓执行侧（店小秘）—— 只读，不写业务数据
node scripts/fetch-dxm-metrics.mjs [--dry-run]

# 抓经营侧（速卖通）—— 经稳卖打开店铺环境，抓完自动关闭
node scripts/fetch-ae-metrics.mjs 400370 [--dry-run] [--keep-open] [--force-window]

# 重算 + 出体检报告（不抓取，只读 facts）
node scripts/recompute-metrics.mjs [YYYY-MM-DD] [--json]
```

产出：
- `data/metrics/facts/<source>/<date>.jsonl` — 规范化事实，只追加，幂等
- `data/metrics/raw/<source>/<date>/*.json` — 原始响应快照，供事后追溯
- `data/metrics/reports/<date>.json` — 体检报告（含 dataQuality 与 actions）

## 三个必须遵守的规则

### 1. 原始事实落库，指标永远重算
`data/metrics/facts` 里只有「浏览量 = 3194」这类事实，**没有「动销率 = 5.7%」**。
指标每次从 facts 重算。这样口径一改（比如动销率换分母），历史全部自动按新口径重出，不会出现「老报表和新报表打架」。

### 2. 抓不到就说不，绝不沿用旧值
取不到就写 `value: null` + `reason`。重算层看到 null 直接输出「不可用」，绝不用上一周期数值填充。
宁可回答「不知道」，也不能给出一个看起来正常的错数。

### 3. 口径必须显式声明
`config/metrics-schema.json` 是唯一权威。任何新指标必须先在里面定义 caliber，代码里禁止临时造词。
篡改口径含义 = 篡改所有历史结论。

## 已踩过的坑（都是真实发生的）

### 坑 1：同店同期销量差 36 倍
平台明示：销售管理的「支付件数」**含货通**，商品分析的「支付件数」**不含货通**。
实测 2,302 件 vs 64 件。财务成交 ÷ 2,302 ≈ 9.7 元/件落在供货价区间，证明 2,302 才是真实件数。
→ 已拆成 `sales.qty.total` / `sales.qty.direct` 两个 caliber，禁止互换。

### 坑 2：金额单位是「分」，不是「元」
`sumPaymentAmount: {cent: 2236585}` → 22,365.85 元。直接当元用会差 100 倍。
→ 代码统一走 `centToYuan()`，并在 meta 记 `unitNote: 'cent/100'`。

### 坑 3：平台日切窗口（北京时间 15:00–17:00）
平台标注的 "PST" 实为 **PDT(UTC-7)**。日切在 PST/PDT 00:00，即 **UTC 07:00 / 08:00 = 北京时间 15:00 / 16:00**。
窗口内「店铺数据」页会短暂归零：实测浏览量从 3,194 掉到 4，而 30 日销量仍是 2,235 —— 两个数物理上矛盾。
→ 已加 `platformDaycutWindow()` 守卫，窗口内直接跳过并记 `SKIPPED_PLATFORM_DAYCUT`，不污染历史。
→ 另加交叉校验：`activeSkus===0 但 30 日销量>0` 判 SUSPECT，`30日销量>1000 但 pv<100` 判量级不符。

### 坑 4：mtop 响应会被浏览器缓存
reload 时若命中缓存则不发请求，探针会静默拿到上一次的数据 —— 比报错更危险。
→ 每次抓取先 `Network.setCacheDisabled(true)`。

### 坑 5：CDP 模式下不能调 browser.close()
`connectOverCDP` 后 `browser.close()` 会关掉用户正在用的 Chrome。
→ 抓取脚本一律 `process.exit()` 结束，自身打开的稳卖环境用 `closeEnv` 关闭。

## 已知限制（明确不做假装）

| 项 | 现状 | 影响 |
|---|---|---|
| 商品级明细翻页 | 只取第 1 页 10 条（total 474），meta 标 `coverage: PARTIAL` | 库存四态是抽样值，不能当全店库存 |
| 店铺流量指标 | 走 DOM 抓取（接口未稳定捕获） | 依赖页面文本结构，平台改版会失效；已有 SUSPECT 自检兜底 |
| `mtop.global.merchant.sales.summary` | 仅在特定交互后请求，已用 DOM 兜底 | 断码/断货数取自页面筛选标签 |
| `window.lib.mtop.request` 直调 | 可调用但 15s 超时（签名不匹配） | 暂不依赖，翻页另寻路径 |
| 采购成本 / 头程 | 无数据源 | `sales.amount.net` 是平台口径净收入，**不是利润** |

## 下一步

1. **商品级全量翻页** —— 打通后库存四态、未来 7/30/60/90 天预测、补货建议才能全量用起来，这是生命周期判定的地基。
2. **多店铺扩展** —— 现在只跑 400370。稳卖有 5 个店，`channelFor()` 需要补齐另外 3 个的 channelId。
3. **接入日扫** —— 日切窗口外（北京时间 17:00 之后）跑一次，工单池从 `actions` 生成。
4. **口径字典补成本** —— 1688 采购价进 `sales.cost.*`，才谈得上真实毛利。
