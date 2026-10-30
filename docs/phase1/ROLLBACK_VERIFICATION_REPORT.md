# 回滚验证报告｜ROLLBACK_VERIFICATION_REPORT

- 验收轮次：阶段 1 最终验收（第三轮）
- 执行日期：2026-10-30
- 基线 commit：`8970876e55d1e371d51c37b0249d6c37d8d4d132`
- 验证脚本/命令：见 §3、§5
- **核心结论**：
  1. `selection-board-service.js` **原始版本从未进入 Git**，无法恢复；
  2. 「只回滚阶段 1、保留选品看板」**不可行**；
  3. 「整体回滚到基线」**已实测可行**（基线服务在隔离沙盒启动成功、新功能 404、既有功能仍在）；
  4. **回滚时必须排除 `nawu-fetch/lib/dxm-c6r.cjs`** —— 那是第三方在 13:06 改的纳物 C6 文件，与阶段 1 无关（见 §6）。

---

## 1. 任务二第 1 步：基线 commit 是否包含原始 `selection-board-service.js`

### 1.1 三种查法，结论一致

```bash
git log --all --oneline -- dist/src/selection-board-service.js
# （无输出）

git rev-list --all --objects | grep -c "selection-board-service"
# 0

ls .worktrees/phase1-baseline/dist/src/selection-board-service.js
# No such file or directory
```

| 查法 | 结果 |
|---|---|
| 任何提交（所有分支）的文件历史 | 0 条 |
| Git 对象库中的 blob 数 | 0 |
| 基线 worktree 实体文件 | 不存在 |

### 1.2 基线 worktree 里缺失的全部阶段 1 文件

| 文件 | 基线是否存在 |
|---|---|
| `dist/src/selection-board-service.js` | ❌ |
| `dist/src/product-identity-service.js` | ❌ |
| `dist/src/listing-template-snapshot-service.js` | ❌ |
| `dist/src/image-isolation-guard.js` | ❌ |
| `config/attention-layer-alias.json` | ❌ |
| `public/selection-board.js` | ❌ |
| `dist/src/server.js` 中的 `selection-board` 字样 | 0 处 |

**结论**：选品看板整套功能（含 service 1.0 单状态版）是 2026-10-30 当天新建且从未提交。Git 里只有「完全没有看板」的版本。

---

## 2. 任务二第 2 步：能否在独立临时目录恢复原始版本

**不能。** 原因链条完整：

| 环节 | 状态 |
|---|---|
| Git 历史 | 无该文件任何版本 |
| 工作区 | 已被 schema 2.0 原地覆写 |
| 备份 | 未做过文件级备份 |
| 编辑器/IDE 历史 | 不在 Git 管理范围，不构成可审计恢复源 |

**影响**：

1. 若经营者决定废弃阶段 1，选品看板功能需**重新开发**（成本≈当天上午工时）；
2. 前端三状态 UI 与 service 2.0 强绑定，**不能只回滚其中一半**（否则状态区全部空显示）；
3. 因此回滚能力只有「全有」或「全无」两态。

---

## 3. 任务二第 3 步：基线版本的依赖、接口与运行能力验证

### 3.1 验证环境

| 项 | 设置 | 目的 |
|---|---|---|
| 代码 | `.worktrees/phase1-baseline/dist/src/server.js` | 基线版本 |
| 数据 | `F:/yikuaborder-deploy/.tmp-rollback-v2`（空目录，经 `USER_DATA_DIR` 注入） | 不碰生产数据 |
| 端口 | `3101` | 避开生产 3000 |
| 模块解析 | `express` / `multer` / `xlsx` 从 `F:/yikuaborder-deploy/node_modules` 逐级向上找到 | 与生产同一份依赖 |
| 相对依赖 | `.worktrees/phase1-baseline/listing-agent/src/agent-client.js` | 已确认存在 |

### 3.2 执行命令

```bash
cd F:/yikuaborder-deploy
HOST=127.0.0.1 PORT=3101 \
USER_DATA_DIR="F:/yikuaborder-deploy/.tmp-rollback-v2" \
node .worktrees/phase1-baseline/dist/src/server.js
```

### 3.3 实测结果

| 检查 | 结果 | 说明 |
|---|---|---|
| 语法检查 `node --check` | ✅ | 前置通过 |
| 进程启动 | ✅ `pid 21584` | 8 秒内可响应 |
| `GET /api/version` | ✅ `codeRoot=F:\yikuaborder-deploy\.worktrees\phase1-baseline`、`userDataDir=…\.tmp-rollback-v2` | 代码与数据正确分离 |
| `GET /api/status` | ✅ **200** | 核心运行态接口正常 |
| `GET /api/selection-board` | ✅ **404** | 基线没有看板（预期） |
| `GET /api/identity/products` | ✅ **404** | 基线没有身份层（预期） |
| `POST /api/import-images` | ✅ **200** | 既有图片导入路由仍在（回滚后旧功能保留） |

### 3.4 这组结果证明了什么

1. 基线代码**能独立运行**，回滚不会起不来；
2. 新功能是**干净消失**（404），不是半残状态；
3. 旧功能（图片导入等）**保留完好**；
4. `USER_DATA_DIR` 可把运行态指向任意目录，**回滚演练不必碰生产数据**。

---

## 4. 任务二第 4 步：阶段 1 完整回滚所需文件及恢复顺序

### 4.1 文件清单（按处置方式分四类）

#### A 类｜修改过的文件 → 回滚 = 从基线恢复

| 文件 | 阶段 1 改动内容 | 恢复命令 |
|---|---|---|
| `dist/src/server.js` | +12 条 identity 路由、+1 条 store-listings 路由、启动登记 400370、三套状态常量 import | `git checkout 8970876 -- dist/src/server.js` |
| `dist/src/image-files.js` | `scanProductImages` 加风格图命名守卫（6 行） | `git checkout 8970876 -- dist/src/image-files.js` |
| `dist/src/config.js` | 4 个选品看板目录常量（批次 A 产出，阶段 1 未再改） | `git checkout 8970876 -- dist/src/config.js` |
| `public/app.js` | `viewWorkspace` / `commerceTopbarCopy` / `__ykSwitchView`（批次 A+B） | `git checkout 8970876 -- public/app.js` |
| `public/index.html` | 看板 section + 入口卡片 + 指标卡 + 版本号（批次 A+B） | `git checkout 8970876 -- public/index.html` |
| `public/styles.css` | 看板样式 + 三状态块（批次 A+B，+413 行） | `git checkout 8970876 -- public/styles.css` |

#### B 类｜新增文件 → 回滚 = 删除

**阶段 1 核心模块（4 个）**

| 文件 | 行数 |
|---|---|
| `dist/src/product-identity-service.js` | 452 |
| `dist/src/listing-template-snapshot-service.js` | 200 |
| `dist/src/image-isolation-guard.js` | 82 |
| `config/attention-layer-alias.json` | 170 |

**选品看板（批次 A，2 个）**

| 文件 | 说明 |
|---|---|
| `dist/src/selection-board-service.js` | schema 2.0，**原始 1.0 已不可恢复** |
| `public/selection-board.js` | 前端，含三状态 UI |

**脚本（3 个）**

| 文件 | 说明 |
|---|---|
| `scripts/verify-phase1-identity-state.mjs` | 14 条验收测试 |
| `scripts/audit-product-identity.mjs` | 只读审计 |
| `scripts/build-provisional-identity.mjs` | provisional 身份建立 |

**文档（16 份）**

| 路径 | 说明 |
|---|---|
| `docs/phase1/`（14 份 .md） | 阶段 1 交付文档 |
| `docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md` | 只读架构审查报告（阶段 0 产出） |

#### C 类｜运行态数据 → 回滚 = 按需删除

| 文件 | 当前内容 | 删除影响 |
|---|---|---|
| `data/identity/products.json` | 163 条规范产品 | 400370 与 163 个 provisional 身份消失 |
| `data/identity/identity-map.json` | 163 条映射 | 同上 |
| `data/identity/store-master.json` | 1 条（400370 待核验） | 需重新登记，会生成**新 UUID** |
| `data/identity/template-snapshots.json` | 0 条 | 无影响 |
| `data/identity.backup-*` | 我在写入前做的备份 | 可保留 |

#### D 类｜**必须排除，不得回滚**（第三方改动）

| 文件 | 修改时间 | 性质 |
|---|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | **2026-10-30 13:06:38** | 纳物 C6 出入记录「仓库位置=全部」修复，+29 行 |
| `public/draft-executor-panel.js` | 早于阶段 1 | blockers 显示补丁（遗留未提交改动） |

**这两个文件不是我改的，也不属于阶段 1。回滚阶段 1 时绝不能碰它们。** 详见 §6。

### 4.2 恢复顺序（有依赖关系，必须按序）

```
① 停服务
    ↓
② 备份（精确文件，不用 stash -u）
    ↓
③ 删除 B 类新增文件（先删，避免旧 server.js 引用不存在的模块）
    ↓
④ 从基线恢复 A 类修改文件（后恢复，保证 import 目标已不存在）
    ↓
⑤ 按需删除 C 类运行态数据
    ↓
⑥ 启动并验证
```

**为什么③必须在④之前**：若先恢复 `server.js` 到基线版，它会尝试 import `./product-identity-service.js` —— 哦不，基线版 server.js 不 import 阶段 1 模块。实际风险在反方向：**若只删模块不恢复 server.js**，当前 server.js 会 import 到不存在的文件 → 启动即崩。

所以正确顺序是「先把引用方恢复成基线版，再删被引用的新模块」：

```
③ 恢复 A 类（server.js 回到不引用新模块的版本）
    ↓
④ 删除 B 类（此时已无人引用）
```

采用后者。

### 4.3 可执行的回滚脚本

```bash
cd F:/yikuaborder-deploy

# ── 0. 确认在正确分支 ──
git rev-parse --abbrev-ref HEAD     # feature/ykb-v1-phase1-identity-state

# ── 1. 停服务 ──
PID=$(netstat -ano | grep ":3000.*LISTENING" | awk '{print $5}' | head -1)
MSYS_NO_PATHCONV=1 taskkill /PID "$PID" /F

# ── 2. 精确备份（只备份要注意的文件，避免 stash 带上第三方改动）──
mkdir -p .rollback-backup-$(date +%Y%m%d-%H%M)
cp dist/src/server.js dist/src/image-files.js dist/src/config.js \
   public/app.js public/index.html public/styles.css \
   .rollback-backup-*/
cp -r data/identity .rollback-backup-*/

# ── 3. 恢复 A 类（引用方回到基线）──
git checkout 8970876 -- dist/src/server.js dist/src/image-files.js
git checkout 8970876 -- dist/src/config.js public/app.js public/index.html public/styles.css

# ── 4. 删除 B 类（此时无人引用）──
rm -f dist/src/product-identity-service.js
rm -f dist/src/listing-template-snapshot-service.js
rm -f dist/src/image-isolation-guard.js
rm -f dist/src/selection-board-service.js
rm -f config/attention-layer-alias.json
rm -f public/selection-board.js
rm -f scripts/verify-phase1-identity-state.mjs
rm -f scripts/audit-product-identity.mjs
rm -f scripts/build-provisional-identity.mjs
rm -rf docs/phase1

# ── 5. 按需删除运行态（想连 400370 一起撤销才做）──
# rm -f data/identity/products.json data/identity/identity-map.json
# rm -f data/identity/store-master.json data/identity/template-snapshots.json

# ── 6. 启动并验证 ──
HOST=0.0.0.0 PORT=3000 node dist/src/server.js
```

### 4.4 验证清单（回滚后逐项确认）

| 检查 | 命令 | 期望 |
|---|---|---|
| 语法 | `node --check dist/src/server.js` | 无输出 |
| 服务 | `curl -s http://127.0.0.1:3000/api/version` | 有 pid |
| 核心 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/status` | `200` |
| 看板已消失 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/selection-board` | **`404`** |
| 身份层已消失 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/identity/products` | **`404`** |
| F1 总账 | `node scripts/verify-system-state.mjs` | `20/20` |
| 页面 | 浏览器硬刷新 | 不白屏 |
| **第三方改动仍在** | `git diff --stat nawu-fetch/lib/dxm-c6r.cjs` | **仍有 29 行改动** |

---

## 5. 回滚能力矩阵

| 档位 | 语义 | 可行 | 依据 |
|---|---|---|---|
| R-A | 整体回滚到 `8970876`（看板一起消失） | ✅ **已实测**（§3） | 基线服务 pid 21584 启动成功、200/404 符合预期 |
| **R-B** | **只回滚阶段 1、保留看板（回到 1.0 单状态）** | ❌ **不可行** | 1.0 从未进 Git，被 2.0 覆写，无备份 |
| R-C | 回滚到「阶段 1 提交点」 | ⏳ 需先做一次提交（当前禁止） | — |

> **不得声称「阶段 1 可以单独回滚」。**

---

## 6. 回滚时必须保护的第三方改动（本轮新发现）

### 6.1 事实

```bash
ls -la --time-style=full-iso nawu-fetch/lib/dxm-c6r.cjs
# -rw-r--r-- 1 User 197121 22414 2026-10-30 13:06:38.105129700 +0800

git diff --stat nawu-fetch/lib/dxm-c6r.cjs
# 1 file changed, 29 insertions(+), 1 deletion(-)

git diff nawu-fetch/lib/dxm-c6r.cjs | grep -cE "identity|selection-board|phase1|ykb-v1"
# 0
```

| 项 | 值 |
|---|---|
| 文件 | `nawu-fetch/lib/dxm-c6r.cjs`（纳物 C6 出入记录采集） |
| 修改时间 | 2026-10-30 **13:06:38** |
| 改动内容 | 新增 `setEntryExitAllWarehouse()`，把「出入记录」页的仓库筛选从默认「浙江义乌仓」切到「全部」，否则只抓单仓 |
| 与阶段 1 的相关性 | **0 处**（diff 里没有任何 identity / selection-board / phase1 字样） |
| 是否由我修改 | **否**。本轮我只改 `dist/src`、`public`、`config`、`scripts`、`docs` |
| 建分支前快照中是否存在 | 否（快照 10 项，不含此文件）→ 说明是阶段 1 工作期间被**第三方**（经营者本人或其他 agent）改的 |

### 6.2 为什么这是回滚方案的关键约束

如果按常见做法执行：

```bash
git checkout -- .        # ← 危险
git clean -fd
```

会**连带丢弃这份 C6 修复**。而红线明确「不修改纳物 C6/C7」—— 丢别人的 C6 改动同样属于事故。

因此本报告 §4.3 的回滚脚本使用**逐文件精确恢复**，绝不用 `git checkout -- .`。

同样，`git stash push -u` 虽然会保存它，但 `pop` 时若冲突容易丢失，也不推荐作为主路径。

---

## 7. 本次验证未做的事

- 未对当前工作区执行任何回滚操作（只在文档中给出步骤，并在隔离 worktree 验证了可行性）
- 未在真实数据目录上运行基线服务（用 `USER_DATA_DIR` 沙盒替代）
- 未删除 `.worktrees/phase1-baseline`（保留作为可复核证据）
- 未触碰 `nawu-fetch/lib/dxm-c6r.cjs` 与 `public/draft-executor-panel.js`
- 未提交、未合并、未部署
