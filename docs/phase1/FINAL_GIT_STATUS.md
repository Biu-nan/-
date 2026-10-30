# 最终 Git 状态｜FINAL_GIT_STATUS

- 采集时间：2026-10-30 13:50
- 分支：`feature/ykb-v1-phase1-identity-state`
- HEAD：`8970876e55d1e371d51c37b0249d6c37d8d4d132`（**= 基线 commit，零提交**）
- 对比基准：`upgrade/reliability-20261024` @ `8970876`

---

## 1. 完整 `git status --porcelain`

```
 M dist/src/config.js
 M dist/src/image-files.js
 M dist/src/server.js
 M nawu-fetch/lib/dxm-c6r.cjs
 M public/app.js
 M public/draft-executor-panel.js
 M public/index.html
 M public/styles.css
?? _verify/
?? config/attention-layer-alias.json
?? dist/src/image-isolation-guard.js
?? dist/src/listing-template-snapshot-service.js
?? dist/src/product-identity-service.js
?? dist/src/selection-board-service.js
?? docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md
?? docs/phase1/
?? public/selection-board.js
```

| 类别 | 条目数 | 展开后文件数 |
|---|---|---|
| 已修改（` M`） | 8 | 8 |
| 未跟踪（`??`） | 9 | 32（`_verify/` 12 + `docs/phase1/` 14 + 6 个单文件） |
| **合计** | **17 条目** | **40 文件** |

---

## 2. 五类分类

### A 类｜阶段 1 正式改造（代码）— 7 文件

| 文件 | 状态 | 行数 | 职责 |
|---|---|---|---|
| `dist/src/product-identity-service.js` | 新增 | 477 | UUID 注册 / 历史映射 / store 叠加层 / 幂等键 / 跨模块守卫 |
| `dist/src/listing-template-snapshot-service.js` | 新增 | 200 | 本地模板快照，拒绝伪造平台版本 |
| `dist/src/image-isolation-guard.js` | 新增 | 82 | 图片隔离内容哈希审计（只读） |
| `config/attention-layer-alias.json` | 新增 | 170 | 474 分层 `ATTENTION_PRIORITY` 语义映射 |
| `dist/src/server.js` | 修改 | +343/−4 | 12 条 identity 路由 + 1 条 store-listings 路由 + 启动登记 400370 + 三状态常量 |
| `dist/src/image-files.js` | 修改 | +6 | `scanProductImages` 风格图命名守卫 |
| `dist/src/selection-board-service.js` | 新增 | 956 | 三状态拆分 + 图片 URL 修复 + 推送幂等（**含批次 A**） |

> `selection-board-service.js` 是批次 A（选品看板初始实现）与批次 B（阶段 1 改造）的**融合体**，无法拆分。这是 R-B 回滚不可行的技术原因，经营者已接受。

### B 类｜批次 A 选品看板配套（阶段 1 依赖其状态结构）

| 文件 | 状态 | 说明 |
|---|---|---|
| `dist/src/config.js` | 修改 +10 | 4 个看板目录常量 |
| `public/selection-board.js` | 新增 933 | 看板前端（含三状态 UI） |
| `public/app.js` | 修改 +17/−2 | `viewWorkspace` / `commerceTopbarCopy` / `window.__ykSwitchView` |
| `public/index.html` | 修改 +122/−2 | 看板 section + 入口卡片 + 指标卡语义分组 + 版本号 |
| `public/styles.css` | 修改 +413 | 看板样式 + 三状态块 + 窄容器降级 |

> **建议与 A 类同一提交**：三状态 UI 与 service 2.0 强绑定，分开提交会出现「界面能点但接口不认」的中间态。

### C 类｜阶段 1 测试与文档 — 18 文件

| 路径 | 状态 | 说明 |
|---|---|---|
| `scripts/verify-phase1-identity-state.mjs` | 新增 514 | 14 项验收测试 ⚠️ **被 gitignore** |
| `scripts/audit-product-identity.mjs` | 新增 | 只读身份审计 ⚠️ **被 gitignore** |
| `scripts/build-provisional-identity.mjs` | 新增 | provisional 身份建立 ⚠️ **被 gitignore** |
| `docs/phase1/*.md` | 新增 14 份 | 阶段 1 全套交付文档 |
| `docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md` | 新增 259 | 阶段 0 只读架构审查报告（阶段 1 的设计依据） |

**⚠️ 三个脚本被 `.gitignore` 第 46 行 `scripts/` 挡住，无法直接 add** —— 详见 `PHASE1_COMMIT_MANIFEST.md` §3。

### D 类｜第三方 / 外部修改 — 1 文件

| 文件 | 状态 | mtime | 归属 |
|---|---|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | 修改 +29/−1 | **2026-10-30 13:06:38** | **非阶段 1**，纳物 C6 出入记录「仓库位置=全部」修复 |

**不得纳入阶段 1 提交。** 完整备份与 diff 见 `EXTERNAL_CHANGES_PROTECTION.md`。

### E 类｜原有未提交修改 — 1 文件

| 文件 | 状态 | mtime | 归属 |
|---|---|---|---|
| `public/draft-executor-panel.js` | 修改 +2 | **2026-10-29 13:00:04** | 阶段 1 **之前**的遗留改动（blockers 显示） |

**不得纳入阶段 1 提交。** 详见 `EXTERNAL_CHANGES_PROTECTION.md`。

### F 类｜临时 / 探测文件（不入库）

| 路径 | 文件数 | 处置 |
|---|---|---|
| `_verify/` | 12 | **不提交**（测试证据，留本地） |
| `.tmp-external-backup/` | 6 | **不提交**（匹配 `.gitignore` 的 `/.tmp-*`，已被忽略） |
| 根目录 `_probe_*.mjs` / `_smoke_*.mjs` / `_check_*.cjs` 等 | 大量 | 已被 `/_*.mjs` 规则忽略 |
| `.worktrees/phase1-baseline/` | — | 已被 `.gitignore` 第 3 行忽略 |

---

## 3. 汇总表

| 类别 | 文件数 | 是否进入阶段 1 提交 |
|---|---|---|
| A 阶段 1 正式改造 | 7 | ✅ 是 |
| B 批次 A 看板配套 | 5 | ✅ 是（与 A 同提交） |
| C 阶段 1 测试与文档 | 18 | ✅ 是（3 个脚本需先解除忽略） |
| D 第三方修改 | 1 | ❌ 否 |
| E 原有未提交修改 | 1 | ❌ 否 |
| F 临时/探测 | 32+ | ❌ 否 |
| **应提交合计** | **30** | — |
| **应排除合计** | **34+** | — |

---

## 4. 与基线对比的关键事实

| 事实 | 值 |
|---|---|
| HEAD 是否等于基线 commit | **是**（`8970876`，零提交） |
| 阶段 1 是否有任何提交 | 否 |
| 是否有已暂存（staged）改动 | 否（`git diff --cached` 为空） |
| 是否有 stash | 否（本轮未执行 stash） |
| 工作区是否有合并冲突 | 否 |
| 创建分支前的现场快照（10 项）是否被覆盖 | 否，除新增的 `dxm-c6r.cjs` 外完全一致 |

---

## 5. 未执行的操作（遵守本轮禁令）

| 禁止项 | 状态 |
|---|---|
| `git add` | ❌ 未执行 |
| `git commit` | ❌ 未执行 |
| `git checkout -- .` | ❌ 未执行 |
| 修改纳物 C6/C7 | ❌ 未执行（`dxm-c6r.cjs` 的改动不是我做的，也未触碰） |
| 合并主分支 | ❌ 未执行 |
| 部署 | ❌ 未执行 |
| 启动阶段 2 | ❌ 未执行 |

**唯一写操作**：在 `.tmp-external-backup/`（已被 gitignore）内创建了 6 个备份文件。未修改任何受版本控制的文件。
