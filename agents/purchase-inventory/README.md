# purchase-inventory · 采购库存 Agent

回答一个问题：**现在该不该补货、补多少件。**

契约（唯一依据）：[`contract.md`](./contract.md)。本 README 只讲现状、结构、怎么验。

---

## 0. 当前状态（先看这个）

| 部分 | 状态 |
|---|---|
| 契约 `contract.md` | ✅ 已定稿 v0.1 |
| 权限上限 `config/limits.json` | ✅ 已定稿 |
| 提示词 `prompts/01–03` | ✅ 已定稿 |
| 用例 `evals/cases.json` | ✅ 11 条（含 6 条陷阱），**11/11 通过** |
| 实现代码 `src/` | ✅ **已实现**（decide / audit / boundary / reason / limits / engine / workflow / cli） |
| Workflow 验收 `evals/verify-workflow.mjs` | ✅ **11/11 通过** |
| 真实平台采集接线 | ❌ 未接（等 C2），当前走 `--snapshot` 注入 |

**能跑，但还没有真实数据源。** 现在给它一个采集快照，它能算出补货建议并走完整条协同链路；不给快照就什么都算不出来——不会假装有数据。

已验证（`--evals`）：11 条全过。另外做了 6 种**变异测试**，故意把关键保护改坏，确认用例真的抓得住：

| 变异 | 是否被抓 |
|---|---|
| 覆盖基数偷用 `inventory.sellable` | ✅ 覆盖天数从 5 天变 10683 天，被判 FAIL |
| 关掉日切窗口拦截 | ✅ |
| 取消历史天数门槛 | ✅ 新品被误判成 OVERSTOCK（280 天） |
| 关掉金额红线 | ✅ |
| 超限静默截断成 500 | ✅ |
| Gate 改成超时放行 | ✅ |
| 续批时不再复核产物 | ✅ 篡改用例转红 |
| 允许重复批复 | ✅ |
| 没人批也往下走 | ✅ 连带 6 项转红 |
| 产物不落盘、只编哈希 | ✅ 连带 7 项转红 |

> 第一版 `trap-sellable-inflation` 用例其实是**假通过**：它只验证了"显式声明使用会被拒"，没验证"计算根本不会碰 sellable"。变异测试把它暴露出来，已拆成 `trap-sellable-present-not-used`（压计算）+ `guard-sellable-attempt`（压拒绝）两条。

为什么先写契约不先写代码：这个 Agent 最容易出的错不是算错，而是**口径拿错**（用平台可售额度当物理库存，差 170 倍）和**越界**（在没有成本口径的情况下算钱）。这两类错误靠代码审查很难拦住，靠契约里的 fail-closed 条款能拦住。

---

## 1. 它到底在算什么

```
物理可用 = 实仓(actual) − 占用(occupied) + 在途(transit)
日均销速 = 近 N 天 sales.qty.total ÷ N
覆盖天数 = 物理可用 ÷ 日均销速
建议补货 = 日均销速 × (补货周期 + 安全天数) − 物理可用
```

默认 N=14、补货周期=25 天、安全天数=10 天、最少起补 20 件/规格。
**改 `config/limits.json` 和契约 §3 的参数表就是改行为，不存在藏在代码里的魔法数。**

---

## 2. 目录结构

```
agents/purchase-inventory/
  contract.md                 唯一依据：口径、公式、判定顺序、权限上限、失败模式
  config/limits.json          机器可读的权限上限（数量/金额/副作用/Gate/时间窗）
  prompts/
    01_anomaly_review.md      出结论前先拦一次：日切、口径缺失、历史太短
    02_reason_writer.md       把数字翻成一句人能直接做决定的话
    03_boundary_check.md      发出去前查六条红线（金额/可售口径/量纲/数量/越权/Gate）
  evals/cases.json            11 条验收用例（6 条陷阱）
  evals/verify-workflow.mjs   11 项 Workflow 验收（事件链、续批、篡改、链完整性）
  src/
    decide.js                 确定性判定引擎（判定顺序短路）
    audit.js                  inventory.audit，P0 纯读聚合 + 回读哈希校验
    boundary.js               六条红线的代码实现
    reason.js                 理由模板（确定性，不调模型）
    limits.js                 上限加载与拆单
    engine.js                 单次评估编排（判定→拆单→组装→过红线）
    workflow.js               库存与采购 Workflow：事件流 + HUMAN_GATE + 独立核验
    cli.js                    入口 + 用例执行器
```

---

## 3. 三条最容易被忽略的约束

1. **不许用 `inventory.sellable`**。实测 213,682 vs 实仓 1,264，拿它算覆盖天数会得出"够卖几十年"，然后整店断货。
2. **不许输出金额**。`config/metrics-schema.json` 33 个口径里没有任何成本/COGS 口径（C3 未完成）。出现金额字段即整批作废。
3. **`DEAD_STOCK` 只能标"待查"**。累计卖过 174 件、近 30 天零销，这形状通常是断货/断码/降权，不是长尾。判成清仓会把能卖的品清掉。

---

## 4. 怎么跑

```bash
# 全量用例（11 条，含 6 条陷阱）—— 退出码 0 才算过
node agents/purchase-inventory/src/cli.js --evals

# 单条输入试跑
node agents/purchase-inventory/src/cli.js --input <case.json>

# 库存核对 + 回读校验（P0，纯读）
node agents/purchase-inventory/src/cli.js --snapshot <snapshot.json> --store 400370 --as-of 2026-11-10T12:00:00+08:00
```

快照格式：

```json
{ "storeId": "400370", "asOf": "2026-11-10T12:00:00+08:00",
  "collectedAt": "2026-11-10T11:58:00+08:00",
  "calibers": { "inventory.actual": 120, "inventory.occupied": 20,
                "inventory.transit": 0, "sales.qty.total": 280 } }
```

验收口径**不是"跑出结果了"**，而是：

| 检查 | 通过标准 |
|---|---|
| 11 条用例 | 全过，且**变异测试能被抓到**（见 §0 表） |
| `trap-sellable-present-not-used` | sellable 存在但覆盖天数仍是 5 天，不是 10683 天 |
| `reject-day-cut-window` | 16:05 输入被拒，不产出任何结论 |
| `reject-money-output` | 整批丢弃（`wholeBatchDiscarded=true`），不是只删违规那条 |
| `trap-dead-stock` | 理由含"人工核查"，不含"清仓/下架/降价" |
| `--snapshot` 回读 | `verify.verdict === "VERIFIED"`；回读值变了必须 REJECTED |
| 复算 | 同 `asOf` 同输入跑两次，输出逐字节相同 |

---

## 5. Workflow：一次完整跑通长什么样

```bash
# 跑到 Gate 停下等人（默认行为，不会自己放行）
node agents/purchase-inventory/src/cli.js --workflow --snapshot _verify/snap.json

# 事后回到同一条 run 上批复（进程可以重启，进度不丢）
node agents/purchase-inventory/src/cli.js --resume <runId> --decision approve
```

事件链固定为：

```
INTENT → DELEGATED → ACCEPTED → DELIVERED → VERIFIED → HUMAN_GATE → HUMAN_DECISION
```

预检不过则停在 `BLOCKED`（不出产物）；交付物对不上则停在 `REJECTED`（不问人）。

三条不可让步的规则，都有对应的验收项：

| 规则 | 为什么 | 验收项 |
|---|---|---|
| 产物必须落盘，核验方从磁盘按哈希回读 | 拿内存对象比内存对象 = 没核验 | 「交付物落盘且哈希与事件一致」 |
| 核验在开闸之前 | 不能让人批准一份还没验过的东西 | 「VERIFIED 出现在 HUMAN_GATE 之前」 |
| 等待期间产物被改 → 拒绝记录批复 | 让人批一份被动过的东西，比直接拒绝更糟 | 「等待期篡改 → ARTIFACTS_CHANGED」 |

`defaultIfIgnored` 全链路只有 `stall` 一个值。没人批就一直等，不超时放行、不猜。

---

## 6. 与 C 线的关系

C3（核准 COGS）没做完之前，本 Agent **在结构上就不具备算钱的能力**。
这不是"暂时不算"，是 `config/limits.json` 里 `money.outputAllowed=false` + `blockedUntil: "C3_COGS_APPROVED"` 写死了。

所以：本 Agent 能回答"补多少件"，不能回答"补这些要花多少钱、赚不赚"。后者要等 C3。
