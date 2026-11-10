# PLM 采购 · Phase 1 · 五维数据模型 + 采集方案（草稿待审）

> 状态：**草稿，待 Lance 审**。仍「升级现有 Agent」假设。**未改 build-ops-db、未建表**。
> 前置事实（已核实 ops.db 现状）：
> - `dim_item` 已有 **652/652** 条 `first_up_shelf`（上架日期，取自 items-raw `firstUpShelfTime`，范围 2026-03-20~10-26），另有 `item_status`(1/2)、`distribute_channel`、`first_seen_date/last_seen_date`。
> - `fact_sku_snapshot` 有 实仓/占用/在途/7d/30d/累计。
> - `fact_item_traffic` 有 曝光/访客/加购/收藏/买家。
> - **缺**：点击/曝光点击率、仓储渠道(自营/官方/JIT)、ETA/供应商。
>
> ⇒ 结论：**上架日期无需新采集，Phase 1 可直接建模**；有效可售日靠日累积；点击/渠道/ETA 仍要补数据源。

---

## 1. 五维数据模型（一维一表，禁止混用）

现有 `dim_item` = 维1 产品主档（复用）。其余四维各建一表；**影子/正式用 `is_shadow` 同表双行分离**，正式行必须 `promoted_at` 非空（人批后才写）。

```sql
-- 维2 平台刊登状态（未开始/发布中/已发布/暂停/下架）
CREATE TABLE IF NOT EXISTS fact_listing_status (
  store_id     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  status_code  TEXT NOT NULL,          -- 原始码（item_status 1/2，语义待确认见 §9）
  status_name  TEXT,                   -- 映射后英文枚举
  observed_at  TEXT NOT NULL,          -- 观测时刻（不覆盖历史，留痕）
  evidence_json TEXT,                  -- {source, raw}
  is_shadow    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (store_id, item_id, observed_at, is_shadow)
);

-- 维3 商品生命周期（E/G/C/D/UNRESOLVED）
CREATE TABLE IF NOT EXISTS fact_lifecycle (
  store_id     TEXT NOT NULL,
  item_id      TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('E','G','C','D','UNRESOLVED')),
  effective_sellable_days INTEGER,     -- 有效可售日（算法见 §4）
  cumulative_sales        INTEGER,     -- 累计销量（毕业条件 ≥10）
  recent7d_trend          REAL,        -- 近7日趋势指标
  entered_at      TEXT,                -- 进入该状态的时间
  transition_from TEXT,                -- 从哪个状态转来（审计）
  evidence_json   TEXT,                -- 判定证据：阈值/窗口/冲突项
  computed_at     TEXT NOT NULL,
  is_shadow       INTEGER NOT NULL DEFAULT 1,
  promoted_at     TEXT,                -- 非空=正式生效
  PRIMARY KEY (store_id, item_id, is_shadow)
);

-- 维4 经营诊断（6 码，解释原因，不替代生命周期）
CREATE TABLE IF NOT EXISTS fact_diagnosis (
  store_id   TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  code       TEXT NOT NULL CHECK (code IN
    ('TRAFFIC_WEAK','CTR_WEAK','CVR_WEAK','SUPPLY_BLOCKED','DEMAND_WEAK','DATA_UNRELIABLE')),
  metrics_json  TEXT,                  -- 触发该码的指标快照（曝光/点击率/转化…）
  evidence_json TEXT,
  computed_at   TEXT NOT NULL,
  is_shadow     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (store_id, item_id, code, is_shadow)
);

-- 维5 库存执行策略（生命周期推导，不直接来自销量）
CREATE TABLE IF NOT EXISTS fact_inventory_strategy (
  store_id      TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  strategy      TEXT NOT NULL CHECK (strategy IN
    ('STOCK','LIGHT_STOCK','ORDER','ORDER_WATCH','HOLD')),  -- HOLD=D沉睡不主动补
  target_days   INTEGER,               -- 目标覆盖天数（官方仓25/自营另定）
  derived_state TEXT,                  -- 由哪个生命周期状态推导
  computed_at   TEXT NOT NULL,
  is_shadow     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (store_id, item_id, is_shadow)
);
```

**禁止混用（硬约束）**：
- `fact_lifecycle.state` **不得**由 `fact_sku_snapshot.recent30d_sales` 直接推导（销量只是输入之一）。
- 资金层级/S&A 等级**不放进本模型**（属另一维度，另表）。
- 任何「正式」行（`is_shadow=0`）缺失 `promoted_at` 视为非法，读方应拒绝。

---

## 2. 影子 vs 正式（图底线①）

- 计算只写 `is_shadow=1`（影子）。
- 正式（`is_shadow=0`）只由**人工批准**后 promote：`INSERT ... SELECT` + `promoted_at=now()`。
- 所有下游采购决策**只读正式行**；影子只用于「对照 / 试算 / 人审」。
- 不互相覆盖：影子重算只 `REPLACE` 影子行，绝不碰正式行。

---

## 3. 上架日期（已具备，无需新采集）

- 源：`items-raw.json` 的 `firstUpShelfTime`（epoch ms）→ build-ops-db 已写入 `dim_item.first_up_shelf`（652/652）。
- 用法：`effective_sellable_days` 的时间基准 + E 期「21 个有效可售日」的起点。
- ⚠️ `item_status`（1/2）语义未确认（是「上架/下架」还是「在售/暂停」？）——见 §9-Q1。

---

## 4. 有效可售日算法

**v1（bootstrap，今日即可算，confidence=low）**
```
有效可售日 ≈ DATEDIFF(today, first_up_shelf)   -- 自然日，假设期间持续可售
```
> 仅当缺日快照时的上界估计；标记 `confidence=low`，不用于正式决策。

**v2（首个日累积周期后，accuracy 高）**
```
有效可售日 = COUNT(DISTINCT captured_date)
              WHERE store_id=.. AND item_id=..
                AND real_inv > 0            -- 当日真实可售
                AND captured_date >= first_up_shelf
```
> 依赖「每日快照累积」（调度器装上后自动长数据）。**这就是为什么先把日更调度器跑起来**。

---

## 5. 五维分离的展示层（只读，不产生新事实）

```sql
CREATE VIEW IF NOT EXISTS v_item_5dims AS
SELECT i.store_id, i.item_id, i.title, i.first_up_shelf,          -- 维1
       ls.status_name,                                             -- 维2
       lc.state, lc.effective_sellable_days,                       -- 维3
       (SELECT group_concat(code,',') FROM fact_diagnosis d
          WHERE d.item_id=i.item_id AND d.is_shadow=0) AS diag_codes, -- 维4
       st.strategy, st.target_days                                  -- 维5
FROM dim_item i
LEFT JOIN fact_listing_status ls ON ls.item_id=i.item_id AND ls.is_shadow=0
LEFT JOIN fact_lifecycle      lc ON lc.item_id=i.item_id AND lc.is_shadow=0
LEFT JOIN fact_inventory_strategy st ON st.item_id=i.item_id AND st.is_shadow=0;
```
> 视图只「拼展示」，不写回任何维；各维仍各自独立演进。

---

## 6. 与现有 Agent 的接口（不破坏现有 11/11 用例）

- **Phase 1 不动 `decide.js` 契约**：现有 `engine.runOne` 仍吃 5 口径；新增的 `fact_lifecycle` 作为**上游策略输入**，Phase 2 才接入权重。
- 过渡期：`fact_lifecycle` 影子跑，产出「若按生命周期该给什么策略」的对照表；采购仍走现有净需求器。
- 正式接入点（Phase 4）：net demand 的 `target_days` 由 `fact_inventory_strategy.target_days` 提供（E≤10 / G拉满 / C加权 / D=0）。

---

## 7. 仍缺的数据源（决定 Phase 3/4 能否开工）

| 缺项 | 用于 | 建议来源 |
|---|---|---|
| 点击 / 曝光点击率 | 诊断 B CTR_WEAK | 平台「数据纵横」逐日导出 → `import-platform-export.mjs` 扩口径 `item.clicks` |
| 仓储渠道(自营/官方/JIT) | 净需求分渠道 | **ERP 导出**（哪些 SKU 走官方仓/JIT）；或平台"仓发/JIT"标签 |
| ETA / 供应商 | L3 验证 + 在途可信 | ERP 采购单 |
| `item_status` 语义 | 维2 刊登状态 | 你确认 1/2 含义 |

---

## 8. Phase 1 验收（可自动判）

1. 四张 `fact_*` 表建成，`is_shadow` 默认 1；**正式行 0 条**（未 promote）。
2. `v_item_5dims` 能 JOIN 出 `first_up_shelf`（652 条中非空应 ≈652）。
3. 有效可售日 v1 对 652 个 item 全部可算（自然日），标 confidence=low。
4. 现有 `purchase-inventory --evals` 仍 **11/11**、`verify-workflow` 仍 **11/11**（零回归）。
5. 影子重算两次，正式行字节不变（不误覆盖）。

---

## 9. 待确认（定了我就把 DDL 以 `CREATE TABLE IF NOT EXISTS` 增量加进 build-ops-db）

- **Q1**：`item_status` 的 1 / 2 分别代表什么（上架/下架？在售/暂停？）
- **Q2**：有效可售日 v1（自然日上界）是否可接受作为影子输入，直到日累积够数？
- **Q3**：是否允许我把 §1 的 4 张表以**增量 DDL** 加进 `build-ops-db.mjs`（只建空表+视图，不写任何正式数据）？
- **Q4**：Phase 3 的「点击」用平台逐日导出补，可以吗（走 `import-platform-export` 扩口径）？
