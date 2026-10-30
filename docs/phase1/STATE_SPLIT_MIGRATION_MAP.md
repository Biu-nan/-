# 状态拆分迁移映射｜STATE_SPLIT_MIGRATION_MAP

- 对应指令：04 §E（输出旧状态 → 新状态映射表，不清楚的标 `UNMAPPED_LEGACY_STATUS`，不猜）
- 实现：`dist/src/selection-board-service.js`（schema 2.0）
- 权威常量：`LEGACY_STATUS_TO_STATE`

---

## 1. 拆分前后的字段对照

| 拆分前（schema 1.0） | 拆分后（schema 2.0） |
|---|---|
| `status` 七态，一个字段表达三件事 | `developmentStage`（11 态，Product 粒度） |
| — | `dianxiaomiSyncStatus`（8 态，Product/Listing 版本粒度） |
| — | `storeListings[]`（每店一条，10 态，Product × Store 粒度） |
| — | `plannedStoreIds[]`（Q1：可空） |
| `status` 仍存在 | **改为派生只读**，由上面两套计算；写入口保留做兼容映射 |

---

## 2. 旧七态 → 新状态映射表（唯一权威）

| 旧 `status` | `developmentStage` | `dianxiaomiSyncStatus` | 说明 |
|---|---|---|---|
| `PICKED` 已选品 | `DATA_ENTRY` | `NOT_STARTED` | 刚录入，资料未齐 |
| `READY` 待上架 | `READY_FOR_LISTING` | `NOT_STARTED` | 素材齐备可启动 Listing。**旧名有歧义**：此时并未上架 |
| `LISTING` Listing 制作中 | `LISTING_IN_PROGRESS` | `NOT_STARTED` | — |
| `LISTING_DONE` Listing 已完成 | `LISTING_READY` | `NOT_STARTED` | 内容与素材过 QC；**不含**店小秘是否保存 |
| `SAVED_DXM` 店小秘已保存 | `LISTING_READY` | **`SYNCED`** | **本次拆分的核心一笔**：旧态把两件事压在一个值里 |
| `ON_HOLD` 暂缓 | `PAUSED` | 保留原值不重置 | 挂起不影响已产生的同步结果 |
| `DROPPED` 已放弃 | `REJECTED` | 保留原值不重置 | 终止不影响已产生的同步结果 |

### 2.1 为什么 `SAVED_DXM` 必须拆

旧语义同时断言了两件互相独立的事：

1. Listing 内容做完了（开发阶段结论）
2. 店小秘里存下来了（同步状态结论）

一旦合并，就无法表达这些真实组合：

- 「Listing 做完了，但还没存店小秘」（`LISTING_READY` + `NOT_STARTED`）
- 「存了店小秘，但后来又改了素材」（`LISTING_IN_PROGRESS` + `SYNCED` ← 需要重新同步）
- 「同步失败，但 Listing 本身没问题」（`LISTING_READY` + `SYNC_FAILED`）

这三种在旧模型里都只能写成 `SAVED_DXM` 或 `LISTING_DONE`，信息直接丢失。

### 2.2 派生方向（新 → 旧）

旧前端读 `status` 时按此规则计算（`deriveLegacyStatus`）：

| 条件 | 派生 `status` |
|---|---|
| `developmentStage = PAUSED` | `ON_HOLD` |
| `developmentStage = REJECTED / ARCHIVED` | `DROPPED` |
| `developmentStage = LISTING_READY / QC_PASSED` 且 `sync = SYNCED` | `SAVED_DXM` |
| `developmentStage = LISTING_READY / QC_PASSED` 且 `sync ≠ SYNCED` | `LISTING_DONE` |
| `developmentStage = LISTING_IN_PROGRESS / QC_PENDING` | `LISTING` |
| `developmentStage = READY_FOR_LISTING` | `READY` |
| 其余（DISCOVERED / DATA_ENTRY / BLOCKED_INPUT） | `PICKED` |

---

## 3. 迁移执行情况

### 3.1 当前业务数据量：0

`商品队列/选品看板/board.json` 在改造前 `items: []`（测试 04 之前实测，且改造后每次测试都清理）。

**因此没有产生任何迁移数据**（指令 E：「当前业务数据为 0 时，不制造迁移数据」）。

### 3.2 迁移代码仍然保留

`load()` 里 `normalizeItem()` 会在读到 schema 1.0 的 item 时自动迁移：

```js
const mapped = LEGACY_STATUS_TO_STATE[legacy];
developmentStage = mapped.development_stage;
dianxiaomiSyncStatus = mapped.dianxiaomi_sync_status;
```

并保留审计痕迹：

| 字段 | 用途 |
|---|---|
| `legacyStatus` | 原 `status` 原值，永不覆盖 |
| `legacyStatusMigrationNote` | 中文说明这次怎么解释的 |
| `history[]` 的 `type: "development_stage"` 条目 | 逐条留痕 |

未知旧状态（不在映射表里）：落到 `DATA_ENTRY`，并在 `legacyStatusMigrationNote` 写「未知旧状态，已落 DATA_ENTRY 待人工确认」，**不猜语义、不静默丢弃**。

> 注：七态枚举全部可映射，实测 7/7 有明确语义，因此本次**没有出现 `UNMAPPED_LEGACY_STATUS`**。

---

## 4. 三套状态的写入契约

| 写入通道 | 接口 | 影响范围 |
|---|---|---|
| 开发阶段 | `PATCH /api/selection-board/items/:id` `{ developmentStage }` | 只动 `developmentStage` |
| 店小秘同步 | 同上 `{ dianxiaomiSyncStatus }` | 只动 `dianxiaomiSyncStatus` |
| 逐店刊登 | `PATCH /api/selection-board/items/:id/store-listings` `{ storeId, status }` | 只动该 `storeId` 的那一条 |
| 旧接口兼容 | 同上 `{ status }` | 按映射表落两套新字段 |

---

## 5. 跨状态机不变量（代码级保证）

| 不变量 | 保证方式 | 测试 |
|---|---|---|
| `LISTING_READY ≠ SYNCED` | 两者独立字段，无联动代码 | 06 |
| `SYNCED ≠ PUBLISHED` | 写 sync 不触碰 `storeListings` | **07** |
| 改开发阶段不重置同步状态 | `updateItem` 分支互斥 | 06 |
| 改同步状态不重置开发阶段 | 同上 | 06 |
| 店铺 A 失败不影响 B | `upsertStoreListing` 只按 `storeId` 定位单条 | **08** |
| 无计划店铺可做 Listing，不可发布 | `nextActionFor` 给 `plan-store`；发布门禁另由 `canPublishToStore` 拦 | 05 + 06 |

---

## 6. 状态枚举总数

| 状态机 | 数量 | 来源 |
|---|---|---|
| 产品开发阶段 | 11 | 基线 03 §1（7 主路径 + 4 异常/控制） |
| 店小秘同步 | 8 | 基线 03 §2 |
| 逐店刊登 | 10 | 基线 03 §3 |
| 旧七态 | 7 | 保留兼容 |

运行时实测 `GET /api/selection-board/statuses` 返回 11 / 8 / 10 / 7，与基线一致。

---

## 7. 遗留

| 项 | 说明 |
|---|---|
| `DISCOVERED` 与 `DATA_ENTRY` 的区分 | 旧七态无法区分「刚发现」与「正在填资料」，一律映射为 `DATA_ENTRY`。新前端可直接选 `DISCOVERED` |
| `QC_PENDING` / `QC_PASSED` | 旧七态无对应，属新增中间态；旧接口写入不会产生它们 |
| `ARCHIVED` | 旧七态无对应；派生时归入 `DROPPED` |
