# Git Diff 摘要｜GIT_DIFF_SUMMARY

- 分支：`feature/ykb-v1-phase1-identity-state`（从 `upgrade/reliability-20261024` @ `8970876` 拉出）
- 状态：**未提交、未合并**。工作区改动保留，等待经营者审核后由人工决定提交与合并。
- 采集时间：2026-10-30

---

## 0. 必须先说明的一件事：工作区包含两批改动

`git status` 相对 HEAD 包含了**两批**相互叠加的改动：

| 批次 | 内容 | 时间 |
|---|---|---|
| A | 选品看板初始实现（新增选品看板页面 + 后端 service + 13 条路由） | 2026-10-30 上午 |
| B | **阶段 1：身份与状态模型改造**（本报告对象） | 2026-10-30 下午 |

B 覆写了 A 的 `selection-board-service.js`（schema 1.0 → 2.0），因此**无法用 git 把两批拆成两个提交**。本摘要按文件给出「本轮改了什么」，不做提交层面的假装分割。

创建分支前的现场快照（10 项改动）与建分支后完全一致，**未覆盖任何已有工作**。

---

## 1. `git diff --stat`（实测，相对 HEAD）

```
 dist/src/config.js             |  10 +
 dist/src/image-files.js        |   6 +
 dist/src/server.js             | 343 +++++++++++++++++++++++++++++++++-
 public/app.js                  |  15 +-
 public/draft-executor-panel.js |   2 +
 public/index.html              | 122 +++++++++++-
 public/styles.css              | 413 +++++++++++++++++++++++++++++++++++++++++
 7 files changed, 902 insertions(+), 9 deletions(-)
```

> `public/draft-executor-panel.js`（+2）是**改造前就存在的未提交改动**（blockers 显示），非本轮产出。

---

## 2. 新增文件（未跟踪）

| 文件 | 行数 | 归属 | 职责 |
|---|---|---|---|
| `dist/src/product-identity-service.js` | 372 | B | UUID 注册 / 历史映射 / store 叠加层 / 幂等键 |
| `dist/src/selection-board-service.js` | 956 | A→B 重写 | 三状态拆分 + 图片 URL 修复 + 推送幂等 |
| `dist/src/listing-template-snapshot-service.js` | 200 | B | 本地模板快照 |
| `dist/src/image-isolation-guard.js` | 82 | B | 图片隔离审计（只读） |
| `config/attention-layer-alias.json` | 170 | B | 474 分层语义映射 |
| `scripts/verify-phase1-identity-state.mjs` | 514 | B | 14 条验收测试 |
| `docs/phase1/*.md` | 1118 | B | 本批 9 份交付文档 |
| `docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md` | 259 | A 前置 | 只读架构审查报告 |
| `public/selection-board.js` | ~900 | A→B | 看板前端（含三状态 UI） |

---

## 3. 逐文件改动说明（本轮 B）

### 3.1 `dist/src/server.js`（+343）

| 改动 | 行数量级 | 说明 |
|---|---|---|
| import 新增 4 个模块 | ~4 | identity / template-snapshot / isolation-guard / 状态常量 |
| 服务实例化 | 3 | `identityService` / `templateSnapshotService` |
| 启动加载 + 400370 幂等登记 | ~18 | 失败只 warn，不阻塞启动 |
| `/api/selection-board/statuses` 改造 | ~10 | 返回三套状态 + 旧七态映射 |
| `PATCH .../store-listings` | ~10 | 逐店刊登写入 |
| identity 路由块（12 条） | ~120 | 产品 / 映射 / dry-run / 店铺 / 门禁 / 模板 / 隔离审计 |

### 3.2 `dist/src/image-files.js`（+6）

`scanProductImages` 增加 `STYLE_REF_NAME_PATTERN` 守卫：命名含 `style-ref` / `风格参考` 的文件一律跳过。**不改变任何既有产品图行为**（正常命名不匹配该模式）。

### 3.3 `dist/src/config.js`（+10，含批次 A）

四个选品看板目录常量（`SELECTION_BOARD_DIR/FILE/IMAGES_DIR/STYLE_DIR`）。批次 A 产出，本轮未再改。

### 3.4 `public/index.html`（+122）

- 选品看板 section + 入口卡片 + 5 个指标卡（批次 A）
- **本轮**：指标卡 `data-sb-filter` 从旧七态值改为语义分组 key（`data-entry` / `ready` / `listing` / `synced`）
- 静态资源版本号 bump 到 `styles.css?v=20261030-5`、`selection-board.js?v=20261030-3`

### 3.5 `public/selection-board.js`

| 改动 | 说明 |
|---|---|
| `METRIC_FILTERS` + `metricPredicate` | 指标卡按语义分组计数（原来是旧 status 精确匹配） |
| `renderTable` 状态列 | 下拉框绑定 `developmentStage`；新增同步徽章、已发布店数徽章 |
| `setStatus` → 三个函数 | `setDevelopmentStage` / `setSyncStatus` / `setStoreListingStatus` |
| `renderDetail` | 三块状态区（① 开发阶段 pill / ② 同步 pill / ③ 逐店列表 + 添加计划店铺） |
| `syncLabel` / `renderStoreListings` | 新增 |
| 事件委托 | 新增 `[data-sb-dev-stage]` / `[data-sb-sync-status]` / `[data-sb-store-listing]` / `[data-sb-add-store]` |

### 3.6 `public/styles.css`（+413，含批次 A）

- 批次 A：看板整体样式、宽窄容器自适应、入口卡片
- **本轮**：`.board-status-block` / `.board-status-caption` / `.board-sync-chip` / `.board-store-row` / `.board-store-add`

---

## 4. 不在 diff 中的改动（重要）

| 位置 | 为什么不在 diff |
|---|---|
| `data/identity/*.json` | `data/` 在 `.gitignore` 第 7 行。运行态数据，不进版本库 |
| `data/metrics/strata/2026-10-25.json` | 未改动（测试 12 证明哈希不变） |
| `已完成产品/`、`当前产品/` | `.gitignore`；且 20,051 文件今日修改数为 0 |
| `store-profiles.json` | **未改动**。400370 登记在 `data/identity/store-master.json` 叠加层 |
| `config/product-stratification.json` | **未改动**（字节级）。别名映射放在新文件 |
| 纳物 C6/C7 任何文件 | 未接触 |

---

## 5. 建议的提交方式（留给经营者决定）

阶段 1 不动 git 历史。若审核通过，建议：

```bash
# 1) 先确认工作区
git status

# 2) 分两次提交（若希望保留批次边界，需要人工把 selection-board-service.js 拆开；
#    否则按下面一次提交）
git add dist/src/product-identity-service.js \
        dist/src/listing-template-snapshot-service.js \
        dist/src/image-isolation-guard.js \
        dist/src/selection-board-service.js \
        dist/src/server.js dist/src/image-files.js dist/src/config.js \
        config/attention-layer-alias.json \
        public/selection-board.js public/index.html public/styles.css public/app.js \
        scripts/verify-phase1-identity-state.mjs \
        docs/phase1 docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md

git commit -m "feat(identity): Phase1 统一 Product 身份与三套状态拆分

- 新增 product-identity-service：UUID 注册 / 历史映射 / store 叠加层
- selection-board schema 2.0：开发阶段 / 店小秘同步 / 逐店刊登三套独立状态
- 修复 images[].sourceUrl 原始 URL 保存链路
- 新增 template-snapshot / image-isolation-guard
- 474 分层只加 ATTENTION_PRIORITY 别名，原配置与结果未改
- 验收：scripts/verify-phase1-identity-state.mjs 14/14"

# 3) 不要 push、不要 merge 主分支（阶段 1 停止条件）
```

**不要**使用 `git add .` —— 工作区有大量 `_probe_*` / `_verify/` / `.tmp-*` 临时文件。

---

## 6. 审查入口建议

按此顺序看，20 分钟内可完成核心审查：

1. `docs/phase1/PHASE1_IMPLEMENTATION_REPORT.md`（含 3 个 DIFFERENCE_FOUND）
2. `docs/phase1/STATE_SPLIT_MIGRATION_MAP.md`（旧七态 → 新状态映射表）
3. `git diff dist/src/selection-board-service.js`（状态拆分主体）
4. `scripts/verify-phase1-identity-state.mjs` 并实际跑一遍
5. `docs/phase1/TEST_REPORT.md` §6（测试自身修了哪三处，证明不是放宽断言）
