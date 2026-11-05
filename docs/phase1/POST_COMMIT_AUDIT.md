# 提交后只读审计｜POST_COMMIT_AUDIT

- 审计对象：commit `052abd71301f0409ad6295fea78f24bb83bc35f3`
- 审计时间：2026-10-30 14:20
- 审计方式：**只读**。未执行 reset / revert / checkout / add / commit，未修改任何已存在文件。
- 唯一写操作：创建本报告 `docs/phase1/POST_COMMIT_AUDIT.md`。

---

## 0. 结论

| # | 检查项 | 结果 |
|---|---|---|
| 1 | git show / diff-tree 取实际清单 | ✅ 两命令输出完全一致 |
| 2 | 实际文件数 vs 34 白名单 | ✅ **34 = 34**，路径完全一致 |
| 3 | 9M+25A 与 7M+27A 差异 | ⚠️ **我此前的统计写错了，实际是 7 M + 27 A**（见 §3） |
| 4 | 无外部文件混入 | ✅ 5 类排除项全部 0 次 |
| 5 | HEAD = 052abd7 | ✅ 一致 |
| 6 | 工作区外部修改保留 | ✅ 两文件哈希与提交前逐字节一致 |
| 7 | 无新提交 / 合并 / 部署 | ✅ parent 仅 1 个、无 upstream、未推送 |

**提交内容本身没有任何问题**；错的是我上一轮的「9 M + 25 A」统计描述。

---

## 1. 实际提交文件清单（两命令交叉验证）

### 1.1 `git show --name-status 052abd7`

```
commit 052abd71301f0409ad6295fea78f24bb83bc35f3
parent 8970876e55d1e371d51c37b0249d6c37d8d4d132
subject feat(identity): Phase1 统一 Product 身份与三套状态拆分

M	.gitignore
A	config/attention-layer-alias.json
M	dist/src/config.js
M	dist/src/image-files.js
A	dist/src/image-isolation-guard.js
A	dist/src/listing-template-snapshot-service.js
A	dist/src/product-identity-service.js
A	dist/src/selection-board-service.js
M	dist/src/server.js
A	docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md
A	docs/phase1/ATTENTION_LAYER_ALIAS_MAP.md
A	docs/phase1/BASELINE_REGRESSION_COMPARISON.md
A	docs/phase1/EXTERNAL_CHANGES_PROTECTION.md
A	docs/phase1/FINAL_GIT_STATUS.md
A	docs/phase1/GIT_DIFF_SUMMARY.md
A	docs/phase1/IMAGE_SOURCE_URL_FIX_REPORT.md
A	docs/phase1/PHASE1_COMMIT_MANIFEST.md
A	docs/phase1/PHASE1_FINAL_ACCEPTANCE_REPORT.md
A	docs/phase1/PHASE1_IMPLEMENTATION_REPORT.md
A	docs/phase1/PRODUCT_IDENTITY_MAPPING_DESIGN.md
A	docs/phase1/PRODUCT_IDENTITY_RECONCILIATION_REPORT.md
A	docs/phase1/ROLLBACK_PLAN.md
A	docs/phase1/ROLLBACK_VERIFICATION_REPORT.md
A	docs/phase1/STATE_SPLIT_MIGRATION_MAP.md
A	docs/phase1/STORE_MASTER_MAPPING.md
A	docs/phase1/TEMPLATE_LOCAL_SNAPSHOT_DESIGN.md
A	docs/phase1/TEST_REPORT.md
M	public/app.js
M	public/index.html
A	public/selection-board.js
M	public/styles.css
A	scripts/audit-product-identity.mjs
A	scripts/build-provisional-identity.mjs
A	scripts/verify-phase1-identity-state.mjs
```

### 1.2 `git diff-tree --no-commit-id --name-status -r 052abd7`

输出与上表**逐行一致**（已 `diff` 比对，无差异）。

底层统计：

```
27 A
 7 M
```

### 1.3 提交统计

| 项 | 值 |
|---|---|
| 文件数 | **34** |
| 插入行 | 8,556 |
| 删除行 | 10 |
| 父提交 | `8970876e55d1e371d51c37b0249d6c37d8d4d132`（唯一 parent，非合并提交） |

---

## 2. 与 34 个白名单的核对

| 项 | 数量 |
|---|---|
| 白名单（33 个阶段 1 文件 + `.gitignore`） | **34** |
| 实际提交 | **34** |
| 集合比对（`diff` 排序后两份清单） | ✅ **0 差异** |

### 2.1 分类构成（实际）

| 类别 | 文件 | 数量 |
|---|---|---|
| **M（修改，7）** | `.gitignore`、`dist/src/config.js`、`dist/src/image-files.js`、`dist/src/server.js`、`public/app.js`、`public/index.html`、`public/styles.css` | 7 |
| **A（新增，27）** | 4 个后端模块 + 1 个配置 + 1 个前端模块 + 3 个脚本 + 18 份文档（1 SPEC_REVIEW + 17 phase1） | 27 |
| **D（删除）** | 无 | 0 |

---

## 3. 「9 M + 25 A」与「7 M + 27 A」的差异解释

### 3.1 事实

`git show` 与 `git diff-tree` 两个独立命令都给出 **7 M + 27 A = 34**。这是权威事实。

我在上一轮汇报（以及工作记忆里）写的是「9 M + 25 A」—— **这是错的**。

### 3.2 错在哪里

提交前工作区共有 **9 个 M 文件**：

```
 M .gitignore
 M dist/src/config.js
 M dist/src/image-files.js
 M dist/src/server.js
 M nawu-fetch/lib/dxm-c6r.cjs          ← 被排除，未提交
 M public/app.js
 M public/draft-executor-panel.js      ← 被排除，未提交
 M public/index.html
 M public/styles.css
```

其中 `nawu-fetch/lib/dxm-c6r.cjs` 和 `public/draft-executor-panel.js` 按经营者指令**明确排除**，不进入提交。

我的错误是：**把「工作区 9 个 M」直接当成了「提交 9 个 M」**，忘了减掉被排除的 2 个。

然后为了凑总数 34，又倒推出 `34 − 9 = 25` 个 A。

两个错误互相抵消，**总数 34 依然正确**，所以「暂存文件数 = 34」这道检查没能拦住这个错误。

### 3.3 正确算法

```
白名单 33 个阶段 1 文件
  ├─ 6 个是「已存在被修改」：dist/src/config.js, image-files.js, server.js,
  │                          public/app.js, index.html, styles.css
  └─ 27 个是「新增」：4 后端 + 1 配置 + 1 前端 + 3 脚本 + 18 文档

再加 .gitignore（修改）
= 34 个文件

M = 6 + 1 = 7
A = 27
D = 0
7 + 27 = 34 ✓
```

### 3.4 这个错误暴露的问题

| 问题 | 说明 |
|---|---|
| 总数对 ≠ 分解对 | 「34 = 34」通过了，但 9+25 也等于 34，所以数量检查失效 |
| 我用了工作区统计代替提交统计 | 工作区 `git status` 的 9 M 与提交的 7 M 是两个不同口径 |
| 影响范围 | **仅影响我的口头汇报与工作记忆**，不影响提交内容、文件清单、路径正确性 |
| 教训 | 分类计数必须**从 `git show --name-status` 的原始输出程序化统计**，不能靠心算或从工作区状态推 |

### 3.5 已修正

工作记忆 `MEMORY.md` 与 `.workbuddy/memory/2026-10-30.md` 中的「9 M + 25 A」表述，以本报告 §1.3 / §2.1 的 **7 M + 27 A** 为准。

---

## 4. 混入检查

对 `git diff-tree` 的完整 34 行文件清单做精确子串匹配：

| 需要排除的对象 | 出现次数 |
|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | **0** |
| `public/draft-executor-panel.js` | **0** |
| `_verify/` | **0** |
| `data/` | **0** |
| `worktrees/` | **0** |

**结论：无任何外部或临时文件混入。**

补充交叉验证：提交后 `git status --porcelain` 仍显示这两个外部文件为 `M`（未提交状态），说明它们确实留在工作区而非提交里。

---

## 5. HEAD 确认

| 检查 | 结果 |
|---|---|
| `git rev-parse HEAD` | `052abd71301f0409ad6295fea78f24bb83bc35f3` |
| 期望值 | `052abd71301f0409ad6295fea78f24bb83bc35f3` |
| 一致性 | ✅ **完全一致** |
| 当前分支 | `feature/ykb-v1-phase1-identity-state` |
| HEAD 提交标题 | `feat(identity): Phase1 统一 Product 身份与三套状态拆分` |

---

## 6. 提交后工作区外部修改保留

### 6.1 git status（提交后，3 条目）

```
 M nawu-fetch/lib/dxm-c6r.cjs
 M public/draft-executor-panel.js
?? _verify/
```

### 6.2 哈希逐字节比对

| 文件 | 提交前记录 | 提交后实测 | 一致 |
|---|---|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | `745380ecbe24c5e6519d99c0c09cd9fe8f4a7c865a0a30589d7d2ec8099de6a0` | `745380ecbe24c5e6519d99c0c09cd9fe8f4a7c865a0a30589d7d2ec8099de6a0` | ✅ |
| `public/draft-executor-panel.js` | `98bf76037efa2b76d3c77a2595624a317931e63afff00b802f1c9aa09b19d91b` | `98bf76037efa2b76d3c77a2595624a317931e63afff00b802f1c9aa09b19d91b` | ✅ |

### 6.3 diff 规模未变

```
 nawu-fetch/lib/dxm-c6r.cjs     | 30 +++++++++++++++++++++++++++++-
 public/draft-executor-panel.js |  2 ++
 2 files changed, 31 insertions(+), 1 deletion(-)
```

与提交前记录的「+29/−1」与「+2」完全一致 —— 提交过程**没有触碰**这两个文件。

### 6.4 `_verify/` 仍在

12 个测试证据文件未提交、未删除，仍在工作区。

---

## 7. 无新增提交 / 合并 / 部署

| 检查 | 结果 |
|---|---|
| HEAD 是否仍为 `052abd7` | ✅ 是（没有新提交） |
| parent 数量 | **1**（`8970876`）→ 非合并提交 |
| 分支是否指向 `052abd7` | ✅ `* feature/ykb-v1-phase1-identity-state 052abd7` |
| 是否有 upstream | ❌ 无（`## feature/ykb-v1-phase1-identity-state` 后没有 `...origin/xxx`） |
| 是否推送到远程 | ❌ 未推送（无 upstream） |
| 新建 tag | 未新建（本地 tag 59 个均为历史） |
| 生产部署 | ❌ 未部署（本轮无任何部署动作） |
| master 分支 | 仍在 `8970876`（显示 `[origin/master: ahead 85]` 是 master 自身历史状态，与本提交无关，我未操作 master） |

---

## 8. 用独立 Worktree 恢复阶段 1 检查点的安全操作说明

### 8.1 为什么用 worktree 而不是 checkout

| 方式 | 风险 |
|---|---|
| `git checkout 052abd7` | 会切换当前工作区，**工作区里 `nawu-fetch/lib/dxm-c6r.cjs` 与 `public/draft-executor-panel.js` 的未提交改动可能被带走或冲突** |
| `git reset --hard` | 直接丢改动，不可逆 |
| **`git worktree add`（推荐）** | 新建独立目录挂载指定提交，**当前工作区一字不动**，可随时删除 |

该方法已在 `.worktrees/phase1-baseline`（检出基线 `8970876`）上实测有效，使用的是同一命令模式。

### 8.2 安全操作步骤

**Step 1｜确认当前状态（只读）**

```bash
cd F:/yikuaborder-deploy
git status --porcelain          # 应看到 3 条：2 个 M + _verify/
git rev-parse HEAD              # 应为 052abd71301f0409ad6295fea78f24bb83bc35f3
```

**Step 2｜新建 worktree 挂载阶段 1 提交点（不改动当前工作区）**

```bash
git worktree add .worktrees/phase1-checkpoint 052abd71301f0409ad6295fea78f24bb83bc35f3
```

- 目录：`F:/yikuaborder-deploy/.worktrees/phase1-checkpoint`（`.worktrees/` 已在 `.gitignore` 第 3 行，不污染 `git status`）
- 状态：detached HEAD，不影响任何分支

**Step 3｜验证恢复出来的代码完整**

```bash
cd .worktrees/phase1-checkpoint
git rev-parse HEAD                       # 应为 052abd7…
ls dist/src/product-identity-service.js  # 应存在
ls dist/src/selection-board-service.js   # 应存在
ls scripts/verify-phase1-identity-state.mjs  # 应存在（说明 .gitignore 例外已生效）
node scripts/verify-phase1-identity-state.mjs   # 期望 14/14
```

> 注意：`已完成产品/` 等数据目录在 `.gitignore` 内，**不会随 worktree 检出**。因此需要数据目录的脚本（如 `verify-product-layout.mjs`）必须 `cd` 回主工作区再跑，脚本路径指向 worktree。这一点在基线回归对比中已实测确认。

**Step 4｜需要跑服务时（隔离数据 + 独立端口）**

```bash
cd F:/yikuaborder-deploy          # cwd 保持数据根
HOST=127.0.0.1 PORT=3102 \
USER_DATA_DIR="F:/yikuaborder-deploy/.tmp-checkpoint-run" \
node .worktrees/phase1-checkpoint/dist/src/server.js
```

- 用 `USER_DATA_DIR` 指向临时沙盒，**不碰生产 `data/`**
- 用 `PORT=3102` 避开生产 3000
- 验证：`curl -s http://127.0.0.1:3102/api/status` 应 200；`/api/selection-board` 应 200（阶段 1 有看板）

**Step 5｜用完删除（可选）**

```bash
cd F:/yikuaborder-deploy
git worktree remove .worktrees/phase1-checkpoint
git worktree prune
```

### 8.3 从检查点真正回退主工作区（R-C 档，需经营者批准）

**若确认要放弃阶段 1**（以下命令本轮**未执行**，仅作说明）：

```bash
# 1) 先保住两个外部改动（必须，否则会丢）
cp nawu-fetch/lib/dxm-c6r.cjs .tmp-external-backup/
cp public/draft-executor-panel.js .tmp-external-backup/

# 2) 回退到基线（丢弃阶段 1 提交的内容，但提交对象仍在历史里）
git reset --hard 8970876
# 或更安全：git revert --no-commit 052abd7

# 3) 还原外部改动
cp .tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs nawu-fetch/lib/dxm-c6r.cjs
cp .tmp-external-backup/public_draft-executor-panel.js public/draft-executor-panel.js

# 4) 验证哈希回到提交前
sha256sum nawu-fetch/lib/dxm-c6r.cjs public/draft-executor-panel.js
```

**⚠️ 第 1 步不可省**：`git reset --hard` 会清掉工作区未提交改动，包括那份纳物 C6 修复。

### 8.4 严禁的做法

| 禁止 | 原因 |
|---|---|
| `git checkout -- .` | 会丢弃 `nawu-fetch/lib/dxm-c6r.cjs` 的 C6 修复 |
| `git clean -fdx` | 会删除 `.worktrees/`、`_verify/`、`data/` 等全部未跟踪内容 |
| `git reset --hard` 后不回补外部改动 | 丢失 C6 修复 |
| 直接在主工作区 `git checkout 052abd7` | 未提交改动会被带入或冲突破坏 |

---

## 9. 本轮只读声明

| 禁止项 | 状态 |
|---|---|
| `git reset` | ❌ 未执行 |
| `git revert` | ❌ 未执行 |
| `git checkout` | ❌ 未执行 |
| `git add` | ❌ 未执行 |
| `git commit` | ❌ 未执行 |
| 修改任何已存在文件 | ❌ 未执行 |
| 处理纳物 C6/C7 | ❌ 未执行 |

唯一写操作：创建本报告 `docs/phase1/POST_COMMIT_AUDIT.md`。

### 9.1 审计中发现的唯一问题

**我上一轮汇报的「9 M + 25 A」统计错误**（§3）。提交内容完全正确，错误在于描述口径。已在本报告修正为 **7 M + 27 A**，并同步更新工作记忆。
