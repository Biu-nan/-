# 阶段 1 提交清单｜PHASE1_COMMIT_MANIFEST

- 生成时间：2026-10-30 13:52
- 分支：`feature/ykb-v1-phase1-identity-state`
- HEAD：`8970876e55d1e371d51c37b0249d6c37d8d4d132`（= 基线，零提交）
- **本文件只是提交方案，未执行任何 `git add` / `git commit` / `git checkout`**

---

## 0. 一句话

**应提交 33 个文件（7 核心 + 5 看板配套 + 21 测试文档），应排除 2 个外部改动文件 + 32 个临时文件。**

⚠️ **提交前必须先解决一个阻塞项**：`scripts/` 整目录被 `.gitignore` 第 46 行忽略，导致 3 个阶段 1 验收脚本无法入库。见 §3。

---

## 1. 提交白名单（33 文件）

### A 类｜阶段 1 核心模块（7）

| # | 路径 | 状态 | 行数 |
|---|---|---|---|
| 1 | `dist/src/product-identity-service.js` | 新增 | 477 |
| 2 | `dist/src/listing-template-snapshot-service.js` | 新增 | 200 |
| 3 | `dist/src/image-isolation-guard.js` | 新增 | 82 |
| 4 | `dist/src/selection-board-service.js` | 新增 | 956 |
| 5 | `dist/src/server.js` | 修改 +343/−4 | — |
| 6 | `dist/src/image-files.js` | 修改 +6 | — |
| 7 | `config/attention-layer-alias.json` | 新增 | 170 |

### B 类｜选品看板配套（5，须与 A 同提交）

| # | 路径 | 状态 |
|---|---|---|
| 8 | `dist/src/config.js` | 修改 +10 |
| 9 | `public/selection-board.js` | 新增 933 |
| 10 | `public/app.js` | 修改 +17/−2 |
| 11 | `public/index.html` | 修改 +122/−2 |
| 12 | `public/styles.css` | 修改 +413 |

> **为什么不能分开提交**：三状态 UI（B）与 `selection-board-service.js` 2.0（A）强绑定；只提交 A 会让前端调用不存在的字段，只提交 B 会 import 不存在的模块。

### C 类｜测试与文档（21）

| # | 路径 | 状态 |
|---|---|---|
| 13 | `scripts/verify-phase1-identity-state.mjs` | 新增 514 ⚠️ 被忽略 |
| 14 | `scripts/audit-product-identity.mjs` | 新增 ⚠️ 被忽略 |
| 15 | `scripts/build-provisional-identity.mjs` | 新增 ⚠️ 被忽略 |
| 16 | `docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md` | 新增 259 |
| 17–33 | `docs/phase1/*.md`（17 份） | 新增 |

`docs/phase1/` 17 份清单：

```
ATTENTION_LAYER_ALIAS_MAP.md
BASELINE_REGRESSION_COMPARISON.md
EXTERNAL_CHANGES_PROTECTION.md
FINAL_GIT_STATUS.md
GIT_DIFF_SUMMARY.md
IMAGE_SOURCE_URL_FIX_REPORT.md
PHASE1_COMMIT_MANIFEST.md
PHASE1_FINAL_ACCEPTANCE_REPORT.md
PHASE1_IMPLEMENTATION_REPORT.md
PRODUCT_IDENTITY_MAPPING_DESIGN.md
PRODUCT_IDENTITY_RECONCILIATION_REPORT.md
ROLLBACK_PLAN.md
ROLLBACK_VERIFICATION_REPORT.md
STATE_SPLIT_MIGRATION_MAP.md
STORE_MASTER_MAPPING.md
TEMPLATE_LOCAL_SNAPSHOT_DESIGN.md
TEST_REPORT.md
```

---

## 2. 排除清单

### 2.1 外部改动（必须排除，见 `EXTERNAL_CHANGES_PROTECTION.md`）

| 路径 | 归属 | 排除理由 |
|---|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | 第三方（13:06:38） | 纳物 C6 修复，不属阶段 1；已备份 |
| `public/draft-executor-panel.js` | 原有未提交（10-29 13:00） | 上架草稿 UI 增强，早于阶段 1；已备份 |

### 2.2 临时 / 探测 / 运行态（不入库）

| 路径 | 文件数 | 说明 |
|---|---|---|
| `_verify/` | 12 | 测试证据（截图、基线输出、审计 JSON），留本地 |
| `.tmp-external-backup/` | 4 | 本报告的外部改动备份，被 `/.tmp-*` 忽略 |
| `.worktrees/phase1-baseline/` | — | 基线 worktree，被 `.gitignore` 第 3 行忽略 |
| `data/identity/*.json` | 4 | 运行态数据，被 `data/` 忽略 |
| 根目录 `_probe_*` / `_smoke_*` / `_check_*` / `_diag_*` 等 | 数十 | 已被 `/_*.mjs` / `/_*.cjs` 忽略 |

---

## 3. ⚠️ 阻塞项：3 个验收脚本无法入库

### 3.1 问题

`.gitignore` 第 46 行：

```
scripts/
```

`git check-ignore` 实测：

```
scripts/verify-phase1-identity-state.mjs  → 被忽略（.gitignore:46:scripts/）
scripts/audit-product-identity.mjs        → 被忽略
scripts/build-provisional-identity.mjs    → 被忽略
```

后果：**三个阶段 1 验收脚本无法进入版本库**。这与「阶段 1 验收门槛包含自动化测试」直接冲突 —— 提交后别人 clone 下来跑不了验收。

### 3.2 为什么不能只加一条 `!`

我在临时仓库实测了两种写法：

| 写法 | `verify-phase1.mjs` 结果 |
|---|---|
| `scripts/` + `!/scripts/verify-phase1.mjs` | **❌ 仍被忽略** |
| `scripts/*` + `!/scripts/verify-phase1.mjs` | **✅ 可入库**（同目录其他文件仍被忽略） |

原因：`scripts/` 忽略的是**目录本身**，Git 不遍历该目录，后续 `!` 例外无法生效；必须改成忽略**目录内所有文件**（`scripts/*`），例外才有效。

### 3.3 推荐方案 A：改 `.gitignore`（需经营者批准）

在 `.gitignore` 第 46 行处做如下修改：

```diff
-scripts/
+# scripts/ 整体忽略（探档脚本居多），但阶段 1 的验收脚本必须入库
+scripts/*
+!/scripts/verify-phase1-identity-state.mjs
+!/scripts/audit-product-identity.mjs
+!/scripts/build-provisional-identity.mjs
```

| 影响面 | 评估 |
|---|---|
| 已跟踪的 22 个 `scripts/` 文件 | 不受影响（已跟踪文件不受 gitignore 约束） |
| 未来 `scripts/` 下新增文件 | 默认仍被忽略，符合原意 |
| 3 个例外文件 | 可正常 `git add` |
| 风险 | 低。规则更细，不放开整目录 |

改完需在 `git add` 前列出 `.gitignore` 作为第 34 个提交文件。

### 3.4 备选方案 B：`git add -f`（不推荐单独用）

```bash
git add -f scripts/verify-phase1-identity-state.mjs
git add -f scripts/audit-product-identity.mjs
git add -f scripts/build-provisional-identity.mjs
```

| 优点 | 缺点 |
|---|---|
| 不用改 `.gitignore` | 文件入库后**对其他人是被忽略的**；clone 后 `git status` 看不到，改动容易丢；未来 `git add .` 不会带上 |

**建议采用方案 A。** 方案 B 只作为「经营者不希望动 .gitignore」时的退路。

---

## 4. 遗漏 / 混入 / 凭证检查结果

### 4.1 是否有阶段 1 文件遗漏

| 检查 | 结果 |
|---|---|
| 我本轮改过的所有文件是否都在白名单里 | ✅ 是（`dist/src` 3 改 + 4 新；`public` 4 改 + 1 新；`config` 1 新；`scripts` 3 新；`docs` 18） |
| `dist/src/*.js` 是否有新增但未列入 | ❌ 无 |
| `public/` 是否有新增但未列入 | ❌ 无（只有 `selection-board.js`） |
| `config/` 是否有新增但未列入 | ❌ 无（只有 `attention-layer-alias.json`） |
| **唯一遗漏风险** | **`scripts/` 3 个被 gitignore**（§3 已给方案） |

### 4.2 是否混入外部文件

| 检查 | 结果 |
|---|---|
| 白名单是否包含 `nawu-fetch/*` | ❌ 否 |
| 白名单是否包含 `draft-executor-panel.js` | ❌ 否 |
| 白名单是否包含任何 `_probe_*` / `_smoke_*` / `_verify/*` | ❌ 否 |
| 白名单是否包含 `data/` 下运行态 | ❌ 否 |
| 白名单是否包含 `.worktrees/` | ❌ 否 |

### 4.3 是否含敏感凭证

| 检查 | 结果 |
|---|---|
| 9 个新增/重点文件凭证扫描（`sk-*` / `Bearer` / `api_key=` / `password=` / `secret=`） | ✅ 0 命中 |
| 6 个修改文件的 diff `+` 行扫描 | ✅ 0 命中 |
| 白名单是否含 `.env` / `*.pem` / `*key*.json` | ❌ 否 |
| `.secretary-llm.json` | 已被 gitignore，不在工作区状态中 |
| `.ecom-connector.json` | 已跟踪，仅 `root` / `consoleUrl`，无凭证 |
| `nawu-fetch/chatgpt-config.json` | 已跟踪，无 token/key/cookie 字段 |

---

## 5. 精确提交命令（**未执行，等批准**）

### 5.1 提交前检查

```bash
cd F:/yikuaborder-deploy

# 1) 确认分支
git rev-parse --abbrev-ref HEAD
# 期望：feature/ykb-v1-phase1-identity-state

# 2) 确认没有暂存内容（应为空）
git diff --cached --name-only

# 3) 确认 HEAD 仍是基线
git rev-parse HEAD
# 期望：8970876e55d1e371d51c37b0249d6c37d8d4d132

# 4) 再跑一次验收
node scripts/verify-phase1-identity-state.mjs
# 期望：14/14 通过
```

### 5.2 方案 A（推荐）：先改 `.gitignore` 解除 3 个脚本的忽略

**Step 1** — 修改 `.gitignore`（把第 46 行 `scripts/` 换成 §3.3 的四行）

**Step 2** — 验证规则生效

```bash
git check-ignore -q scripts/verify-phase1-identity-state.mjs && echo "仍被忽略 ❌" || echo "可入库 ✓"
# 期望：可入库 ✓
```

**Step 3** — 精确 `git add`（逐路径，**禁止 `git add .`**）

```bash
# 核心模块（7）
git add dist/src/product-identity-service.js
git add dist/src/listing-template-snapshot-service.js
git add dist/src/image-isolation-guard.js
git add dist/src/selection-board-service.js
git add dist/src/server.js
git add dist/src/image-files.js
git add config/attention-layer-alias.json

# 看板配套（5）
git add dist/src/config.js
git add public/selection-board.js
git add public/app.js
git add public/index.html
git add public/styles.css

# 测试（3）
git add scripts/verify-phase1-identity-state.mjs
git add scripts/audit-product-identity.mjs
git add scripts/build-provisional-identity.mjs

# 文档（18）
git add docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md
git add docs/phase1

# 规则（1，本次为解除忽略）
git add .gitignore
```

**Step 4** — 暂存后核对（**关键**）

```bash
git diff --cached --name-only | wc -l
# 期望：34（33 白名单 + .gitignore）

git diff --cached --name-only | grep -E "nawu-fetch|draft-executor-panel|_verify|\.tmp-|data/"
# 期望：无输出（说明没混入外部文件）

git status --porcelain | grep -E "^ M"
# 期望：只剩 nawu-fetch/lib/dxm-c6r.cjs 与 public/draft-executor-panel.js
```

**Step 5** — 提交

```bash
git commit -m "feat(identity): Phase1 统一 Product 身份与三套状态拆分

阶段1（YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1）实施 + 三轮验收：

身份层
- 新增 product-identity-service：UUID 唯一注册入口、product_identity_map
  （键 = source_system + source_record_type + 完整相对路径）、store 主数据叠加层、
  幂等键；禁止未经裁决的跨模块自动关联
- config/attention-layer-alias.json：474 件分层只加 ATTENTION_PRIORITY 语义别名，
  原配置与分层结果字节不变（LIFE-C09：B=衰退清仓 ≠ 库存 B=稳定款）

状态拆分
- selection-board schema 2.0：开发阶段(11) / 店小秘同步(8) / 逐店刊登(10)
  三套独立状态；旧七态 status 改为派生只读
- 核心：SAVED_DXM → LISTING_READY + SYNCED；SYNCED 绝不把店铺标为 PUBLISHED

素材与模板
- 修复 images[].sourceUrl 原始 URL 保存链路（原来恒为空）
- STYLE_REFERENCE 独立目录 + 内容哈希级隔离守卫
- 新增 listing-template-snapshot-service：本地快照，platform_template_version
  恒为 NOT_AVAILABLE_FROM_PLATFORM，拒绝伪造平台版本

验收
- scripts/verify-phase1-identity-state.mjs 14/14 通过
- 474 分层文件 sha256 d982c5c4… 与层归属指纹 a76a6476… 均未变
- 20,550 个产品文件今日修改 0
- 详见 docs/phase1/（17 份）

已知限制
- R-B 回滚不可行：selection-board-service.js 1.0 未入库且已被 2.0 覆写
  整体回滚到 8970876 可行（R-A），已获经营者确认
- 44 项 verify-product-layout 失败为历史遗留（LEGACY-001），基线同有"
```

### 5.3 方案 B（备选）：不改 .gitignore

把 Step 1–2 换成：

```bash
git add -f scripts/verify-phase1-identity-state.mjs
git add -f scripts/audit-product-identity.mjs
git add -f scripts/build-provisional-identity.mjs
```

其余 Step 3–5 相同，但 `git add .gitignore` 去掉，`git diff --cached --name-only | wc -l` 期望 **33**。

---

## 6. 提交后验证清单

```bash
# 1) 提交内容与白名单一致
git show --stat --oneline HEAD | head -40

# 2) 外部改动仍在工作区未被提交
git status --porcelain | grep -E "nawu-fetch|draft-executor-panel"
# 期望：仍有 2 行（这两项留待经营者单独决定）

# 3) 从零可跑验收（模拟 clone 后）
node scripts/verify-phase1-identity-state.mjs
# 期望：14/14

# 4) 数据未被提交带入
git ls-files data/ | wc -l
# 期望：0

# 5) 第三方改动可还原
git diff --stat nawu-fetch/lib/dxm-c6r.cjs
# 期望：1 file changed, 29 insertions(+), 1 deletion(-)
```

---

## 7. 本轮未执行的操作

| 禁止项 | 状态 |
|---|---|
| `git add` | ❌ 未执行 |
| `git commit` | ❌ 未执行 |
| `git checkout -- .` | ❌ 未执行 |
| 修改纳物 C6/C7 | ❌ 未执行 |
| 合并主分支 | ❌ 未执行 |
| 部署 | ❌ 未执行 |
| 启动阶段 2 | ❌ 未执行 |
| 修改 `.gitignore` | ❌ 未执行（§3.3 只是建议，等批准） |

**唯一写操作**：在 `.tmp-external-backup/`（已被 gitignore）内创建 4 个备份文件；在 `docs/phase1/` 内写入本轮 3 份报告。
