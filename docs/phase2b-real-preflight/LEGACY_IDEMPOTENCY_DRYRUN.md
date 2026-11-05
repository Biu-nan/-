# 阶段2B 历史幂等键盘点与迁移 Dry-Run（只读）

> 关联：REAL_EXECUTION_PREFLIGHT.md 任务1
> 模式：只读检查；**禁止真实迁移、禁止修改任何历史任务**。

---

## 1. 幂等键定义（基于 `f16d9fd` 代码核对）

| 版本 | 公式 | 出处 | 任务记录特征 |
|------|------|------|--------------|
| 旧 · 三要素 | `sha256(productId \| workflowType \| contextVersion)` 取前 24 位 | `217b545` / `12f1e80` 的 `ProductTaskService.idempotencyKey`（3 参数） | 任务对象**无 `runMode` 字段** |
| 新 · 四要素 | `sha256(productId \| workflowType \| contextVersion \| executionMode)` 取前 24 位 | `f16d9fd` 同方法（4 参数，默认 `REAL`） | 任务对象**含 `runMode` 字段**（值 `DRY_RUN` / `REAL`） |

> 为什么要四要素（WS-CRIT-1 任务4）：旧三要素下，一次 DRY_RUN 成功后占死该产品该版本的闸门，`existingReplay` 会命中它 → **真实任务永远排不上队**。带 `executionMode` 后 DRY_RUN 与 REAL 键不同，互不阻塞。

**识别方法**：本审计以任务 JSON 是否含 `runMode` 字段区分新旧键（字段存在 = 新四要素；缺失 = 旧三要素）。代码侧已用 `git show` 核对两版公式，确认无误。

---

## 2. 统计结果

### 2.1 任务仓库位置与数量

| 仓库 | 路径 | 是否存在 | 任务数 |
|------|------|----------|--------|
| 生产侧 | `data/workbench/tasks.json` | ❌ 不存在 | **0** |
| Worktree A | `.worktrees/phase2-product-workbench/data/workbench/tasks.json`（@ `f16d9fd`） | ✅ | 2 |
| Worktree B | `F:/yikuaborder-phase2b-wt/data/workbench/tasks.json`（@ `f16d9fd`） | ✅ | 2 |
| **合计历史任务** | — | — | **4** |

> 关键事实：**生产数据侧没有任何产品任务记录**。历史 4 条全部是阶段2B 开发/联调期间在 worktree 中产生的 **E2E 测试产物**，不在生产 `data/` 中。

### 2.2 旧三要素 vs 新四要素

| 类别 | 数量 | 任务 |
|------|------|------|
| 旧三要素（无 `runMode`） | **2** | `d18c4046…`（A）、`bf8f26fe…`（A） |
| 新四要素（含 `runMode`） | **2** | `19f77037…`（B, DRY_RUN）、`0fccc604…`（B, REAL） |

### 2.3 活动 / 失败 / 已完成 任务

| 状态 | 数量 | 任务 | 备注 |
|------|------|------|------|
| RUNNING（活动） | 1 | `d18c4046…` | **孤儿**：`startedAt=07:40` 后无 `finishedAt`，承载它的服务已退出 |
| WAITING_EXECUTOR（活动/排队） | 1 | `0fccc604…` | REAL 闸门任务，开发期正确地停在等待；但真实执行器上线后会**被误接管** |
| SUCCEEDED（已完成） | 2 | `bf8f26fe…`（DRY_RUN）、`19f77037…`（DRY_RUN） | 均为干跑成功 |
| FAILED（失败） | 0 | — | — |
| CANCELLED（取消） | 0 | — | — |

---

## 3. 迁移 Dry-Run（按新 REAL / DRY_RUN 规则推演，**仅推演不落地**）

新代码 `createTask`：`runMode = input.executionMode === "DRY_RUN" ? "DRY_RUN" : "REAL"`，并以此四要素重算键。旧任务缺 `runMode`，推演如下：

| 任务 | 旧键 | 推断 runMode | 新四要素键（推演） | 旧键是否仍匹配新键 |
|------|------|--------------|--------------------|--------------------|
| `bf8f26fe…`（4a6a2a37, 版本 4b7c…） | `1b66a6543dbe4e245187ff83` | DRY_RUN（结果内 `executionMode:DRY_RUN`） | `sha256(4a6a2a37\|LISTING_PREPARATION\|4b7c…\|DRY_RUN)` | ❌ 不匹配（要素不同） |
| `d18c4046…`（ac4cb41b, 版本 3414…） | `603049a3fa4a326fbaa2d1b6` | 未知（RUNNING 孤儿，无结果） | 须先结算再定 | — |

**推演结论**：
- 旧三要素键**不会**等于新四要素键 → 旧任务不会错误地阻塞新的 DRY_RUN 或 REAL 任务（这正是四要素修复的目的，结果符合预期）。
- 若决定迁移旧任务，有两条路子：
  - (a) **仅补 `runMode` 字段、保留旧键**：简单，但旧键与代码新计算键不一致（不影响阻断，仅记录可追溯性略降）。
  - (b) **重算为新四要素键并更新 `idempotencyKey`**：键与代码一致，但会改变该记录的查找键，须同步更新所有引用。
  - 两条路都可，但**优先级低于「先结算孤儿」**。

---

## 4. 键冲突 / 重复映射 / 孤立任务

- **键冲突**：无。4 条任务 `idempotencyKey` 互不相同（`603049a3…` / `1b66a654…` / `f732af10…` / `88b4aba2…`）。
- **重复映射（同产品同版本）**：Worktree B 中 `19f77037…` 与 `0fccc604…` 同属 `productId=371b3a67…`、`contextVersion=08a1b3…`，但 `runMode` 分别为 DRY_RUN / REAL → **设计预期（双闸门分离），非冲突**。
- **孤立任务**：
  - `d18c4046…`：RUNNING 孤儿（服务退出未结算）。**首次真实执行前必须结算**（置 `FAILED` 或 `CANCELLED` 并补 `finishedAt`/`events`）。
  - `0fccc604…`：WAITING_EXECUTOR 的 REAL 任务。若直接在原 worktree 启用真实执行器，它会被立即接管执行 → **首次真实执行前须显式取消或确认其意图**，避免误跑一个 E2E 测试任务。

---

## 5. 预计需要迁移的数量与影响范围

| 范围 | 需迁移任务数 | 影响 |
|------|--------------|------|
| 生产 `data/workbench/tasks.json` | **0**（文件不存在） | 无影响；首次真实执行将从**空任务库**起步 |
| Worktree A（旧三要素 2 条） | 2（建议**重置**而非迁移） | 仅当复用该 worktree 时相关；属测试产物 |
| Worktree B（新四要素 2 条） | 0 键结构迁移；但须处置 `0fccc604` | 同上 |
| **整体建议** | — | **首次真实执行应基于干净任务库**：不要将 worktree 的 E2E 测试 `tasks.json` / `runs/` 带入生产；若复用某 worktree，先清空 `data/workbench/tasks.json` 与 `data/workbench/runs/`。 |

---

## 6. 红线遵守

- ✅ 仅读取 `git show` 历史代码与 worktree 中既有 `tasks.json`，**未修改任何任务记录**。
- ✅ **未执行任何数据库/文件迁移写操作**。
- ✅ 生产 `data/` 零改动（本报告为新增文档）。
