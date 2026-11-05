# 阶段2B 测试产品准入检查（只读）

> 关联：REAL_EXECUTION_PREFLIGHT.md 任务3
> 目标：确认是否存在适合首次受控真实执行的测试产品。
> 结论：**当前无任何产品满足全部 8 项准入标准**。

---

## 1. 准入标准与逐项核对方法

| # | 标准 | 检查方法 |
|---|------|----------|
| 1 | 有独立 `productId` | board 项 `productId` 字段 |
| 2 | 主图 + 附图完整 | board 项 `images[]` 中 `assetType` 含 MAIN 且至少 1 张 ADDITIONAL；或 `产品图/` 目录 ≥2 张 |
| 3 | 产品客观资料可读取 | `objectiveInfo` 非空 / `product-facts.json` 可读 |
| 4 | Listing 模板快照已 CAPTURED | `templateSnapshotId` 命中生产 `data/identity/template-snapshots.json` 且 `status=CAPTURED` |
| 5 | Product Context 正确 | `contextVersion` 与当前 board 项一致、无 `blockingMissing` |
| 6 | 不存在其他活动任务 | 查 `data/workbench/tasks.json` 该 `productId` 无 RUNNING/WAITING_EXECUTOR/QUEUED |
| 7 | 产物目录独立 | 执行落 `data/workbench/runs/<productId>/<taskId>/`（天然隔离） |
| 8 | 不会触发正式发布 | REAL 仅产出草稿/产物；发布为独立人工步骤（架构保证） |

---

## 2. 历史 DRY_RUN 产品（沙箱产物）— 不满足

这些产品是阶段2B 联调时在 `.tmp-wb-sandbox/商品队列/选品看板/board.json` 创建的「示例」数据，**不在生产 board**，且数据残缺：

| 产品 | board | 图像 | 目标信息 | 模板快照 | 判定 |
|------|-------|------|----------|----------|------|
| 帆布多格笔袋（`4a6a2a37…` / `sb_mvuoz6sx_ba9309`） | 沙箱 | **仅 1 张 MAIN，无附图** ❌ | 示例文本 | 沙箱工作区内，生产快照库无 ❌ | ❌ 不满足 |
| E2E 模板产品（`371b3a67…` / `sb_mvuvaby7_39cf75`） | 沙箱/已失 | 沙箱 | — | 生产快照库无 ❌ | ❌ 不满足 |
| （`ac4cb41b…` / `sb_mvunwm49_f8b3c8`） | 沙箱/已失 | — | — | 生产快照库无 ❌ | ❌ 不满足 |

> 它们曾 DRY_RUN 成功，仅证明**管线在沙箱内打通**；但缺附图、目标信息为示例、不在生产 board、模板快照未进入生产快照库 → 不能直接用作首次真实执行对象。

---

## 3. 生产侧现状 — 不满足

| 检查 | 结果 |
|------|------|
| 生产 `商品队列/选品看板/board.json` | `items:[]`（**空**） |
| 生产 `data/identity/template-snapshots.json` | **0 条**（无任何 CAPTURED 快照） |
| 生产 `data/workbench/tasks.json` | 不存在（无活动任务，标准6 天然满足） |

→ 生产侧**没有任何可被真实执行器接管的候选**，且**没有已捕获的模板快照**（标准4 全线不满足）。

---

## 4. 真实候选池（来自 `已完成产品/`，仅维度达标）

对 `已完成产品/` 全量扫描（137 个含 `product-facts.json`，151 个含 `product-profile.json`）：

| 维度组合 | 数量 | 说明 |
|----------|------|------|
| `product-facts.json` + `product-profile.json` + 图片 ≥2 | **119** | 图像/事实/档案维度达标，可作第一步选品池 |
| 同上但图片 =1 | 1（化妆品收纳袋） | 缺附图，不达标 |
| 其余 | 17 | 缺 facts 或 profile |

> 这 119 个满足「标准2/3/7」的素材基础，但仍**未满足标准4（模板快照 CAPTURED）与标准1/5/6 所需的 board 登记与上下文校验**。它们不是「已就绪产品」，而是「待准入的真实产品源」。

---

## 5. 候选准入检查结论

- **当前：0 个产品满足全部 8 项标准。**
- 最近似可用的路径（非现成产品，而是准备动作）：
  1. 从 119 个候选中选 1 个（建议选图像清晰、类目明确、已填 `product-facts.json` 者，如「三泡按压钥匙扣」(7 图) 或任一箱包内胆类）。
  2. 确认/补齐其**主图 + 至少 1 张附图**（标准2）。
  3. 在阶段2B 工作树下**捕获 Listing 模板快照**并写入生产 `data/identity/template-snapshots.json`（`status=CAPTURED`），记录 `templateSnapshotId`（标准4）。
  4. 将其登记进生产 `商品队列/选品看板/board.json`（生成独立 `productId`），字段 `listingTemplateRef` / `templateSnapshotId` / `images` / `objectiveInfo` 完整（标准1/3/5）。
  5. 确认该产品在 `data/workbench/tasks.json` 无活动任务（标准6；当前生产库为空，天然满足）。
  6. 执行时落独立 `runs/<productId>/<taskId>/`（标准7，架构保证）。
  7. REAL 仅产出草稿/产物，不自动发布（标准8，架构保证）。

---

## 6. 红线遵守

- ✅ 仅读取 board / 快照 / `已完成产品/` 元数据与文件清单，**未新增/修改任何产品数据**。
- ✅ 未触发任何执行、未捕获快照、未加入 board（仅给出操作步骤）。
- ✅ 未自动启动任何任务。
