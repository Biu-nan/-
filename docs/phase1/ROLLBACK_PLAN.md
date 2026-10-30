# 回滚方案｜ROLLBACK_PLAN

- 适用对象：阶段 1（`YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1`）的全部改动
- 原则：**先确认影响面，再选最小回滚粒度**。四档可选，从软到硬。

---

## 0. 一句话

阶段 1 **没有改写任何历史数据**，所以回滚基本等于「把代码切回旧版 + 删掉新增的运行态文件」。没有数据恢复动作。

已证：

| 对象 | 证据 |
|---|---|
| 474 件分层结果 | 文件 sha256 `d982c5c4…` 与层归属指纹均未变 |
| 20,051 个历史产品文件 | 今日修改数 = 0 |
| `store-profiles.json` / `product-stratification.json` | 未改动 |
| 纳物 C6/C7 | 未接触 |

---

## 1. 四档回滚粒度

### 档 1｜只回滚运行时（最快，1 分钟）

**适用**：只想让系统回到"改造前的行为"，代码留着继续审查。

```bash
# 1) 停服务
netstat -ano | grep ":3000.*LISTENING"     # 取 PID
MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F

# 2) 切回改造前的 selection-board-service（schema 1.0）
#    —— 需要从 git 恢复，见档 3
```

> 注意：选品看板 service 已被覆写，**没有保留 1.0 版本文件**。所以档 1 实际无法单独完成，需要走档 3。这是本轮的一个短板，已记入 §4。

### 档 2｜删除新增的运行态数据（清空身份层）

**适用**：代码保留，但想让身份层回到"从未登记过任何东西"。

```bash
# 先停服务，否则会被内存状态覆盖回去
MSYS_NO_PATHCONV=1 taskkill /PID <pid> /F

# 逐个删除（不要用 rm -rf，本项目 fs.rm 会被 safe-delete shim 路由到回收站）
rm -f data/identity/products.json
rm -f data/identity/identity-map.json
rm -f data/identity/store-master.json
rm -f data/identity/template-snapshots.json

# 重启后会自动重建空结构
```

**影响**：400370 的待核验登记会消失；再次启动会重新生成**一个新的 store UUID**（不是原来那个）。

**不影响的**：产品档案、分层结果、看板数据。

### 档 3｜回滚代码（主回滚路径）

**适用**：验收不通过，需要完全回到 `8970876` 的状态。

由于改动全部未提交，两种做法：

#### 3a. 保留改动但停用（推荐用于"再改改"）

```bash
# 把新模块改名，使 import 失败前先看报错
# —— 不推荐，import 失败会让整个服务起不来
```

不推荐。

#### 3b. 用 git 丢弃工作区改动（彻底）

**⚠️ 危险**：会丢弃**所有**未提交改动，包括阶段 1 之前就存在的 `public/draft-executor-panel.js` 改动和选品看板（批次 A）。

```bash
# 先备份！否则批次 A 的看板功能一起没
git stash push -u -m "phase1-backup-$(date +%Y%m%d-%H%M)"

# 确认已暂存
git stash list

# 恢复工作区到 HEAD
git checkout -- .
git clean -fd dist/src public config scripts docs
```

恢复（若之后要拿回来）：

```bash
git stash pop
```

#### 3c. 精确回滚（推荐）

只回滚阶段 1 触及的文件，保留批次 A 的看板：

```bash
# 1) 备份当前状态
git stash push -u -m "phase1-backup-$(date +%Y%m%d-%H%M)"

# 2) 只恢复本轮改过的既有文件
git checkout -- dist/src/server.js dist/src/image-files.js
#    （config.js / public/* 属于批次 A + B 混合，若只想回滚 B，需手工编辑）

# 3) 删除本轮新增的纯 B 文件
rm -f dist/src/product-identity-service.js
rm -f dist/src/listing-template-snapshot-service.js
rm -f dist/src/image-isolation-guard.js
rm -f config/attention-layer-alias.json
rm -f scripts/verify-phase1-identity-state.mjs
rm -rf docs/phase1
```

**遗留问题**：`dist/src/selection-board-service.js` 已从 1.0 覆写为 2.0，无法"只回滚 B 保留 A"。若要回到 1.0 行为，必须整份重写回去 —— 这是本轮唯一的不可逆点。

### 档 4｜切分支（最安全）

```bash
# 完全放弃这个分支，回到主分支继续
git checkout upgrade/reliability-20261024
git branch -D feature/ykb-v1-phase1-identity-state
```

**注意**：`-D` 会丢工作区未提交改动。要先用 `git stash push -u` 保存。

---

## 2. 分项回滚表

| 改动 | 单独回滚方法 | 副作用 |
|---|---|---|
| 三套状态拆分 | 恢复 `selection-board-service.js` 到 1.0（不可行，已覆写） | 无替代方案；建议整份回滚 |
| 图片 sourceUrl 修复 | 单独保留即可，不回滚（纯修复，无副作用） | — |
| 图片隔离守卫 | 删除 `image-isolation-guard.js` + 撤销 `image-files.js` 的 6 行 | 失去第二道守卫，物理隔离仍在 |
| 身份层 | 档 2（删 `data/identity/*`）+ 撤销 `server.js` 的 identity 路由块 | 400370 登记丢失 |
| 模板快照 | 删 `listing-template-snapshot-service.js` + 对应路由 | 无影响（尚未被任何流程使用） |
| 474 别名 | 删 `config/attention-layer-alias.json` | 无影响（旁挂，无人读） |
| 前端三状态 UI | `git checkout -- public/selection-board.js public/index.html public/styles.css` | 看板退回单 status 界面（若 service 也是 2.0，界面会显示不出状态 → 必须同时回滚 service） |

**耦合关系**：前端三状态 UI 与 service 2.0 强绑定。**要么一起回滚，要么一起保留**，不能只回滚一半。

---

## 3. 回滚后的验证清单

回滚完成后依次确认：

1. `node --check dist/src/server.js` 通过
2. 启动服务，`GET /api/version` 有响应
3. `GET /api/selection-board` 返回 200 且 `items` 可读
4. `GET /api/system/state` 正常（F1 总账未受影响）
5. `node scripts/verify-system-state.mjs` 20/20
6. 页面打开不白屏（硬刷新）
7. 若曾删除 `data/identity/`，确认服务重启后自动重建空结构且不报错

---

## 4. 本轮回滚能力的短板（诚实记录）

| 短板 | 后果 | 建议 |
|---|---|---|
| **`selection-board-service.js` 1.0 已被覆写，未留备份** | 无法"只回滚阶段 1、保留批次 A 看板" | 建议审核通过后**立即提交一次**（提交即等于留下可回滚的基线） |
| 改动全部未提交 | 只能靠 `git stash` 保存 | 同上 |
| `data/identity/` 不在版本库 | 登记内容无法从 git 恢复 | 内容极简（4 个 JSON），丢失成本低；`STORE_MASTER_MAPPING.md` 已完整记录 400370 的字段值 |
| 前端与 service 强耦合 | 不能分半回滚 | 见 §2 |

---

## 5. 不可回滚的东西（已经发生且不该回滚）

| 项 | 说明 |
|---|---|
| `data/identity/store-master.json` 里生成的 `029555ee-…` store UUID | 这是 Q2 要求的登记结果，属于阶段 1 交付物。回滚代码没问题，但若曾把它写进任何外部记录，需同步更正 |
| `docs/phase1/*` 交付文档 | 属审核材料，回滚代码不需要删 |

---

## 6. 灾难场景预案

| 场景 | 处置 |
|---|---|
| 回滚后服务起不来 | 先看 `node --check` 报错；再确认 `data/identity/*.json` 是否为合法 JSON（坏文件会被 `readJson` 改名成 `.corrupt-<ts>` 并重建空结构，不会阻塞启动） |
| 回滚后看板数据丢了 | `商品队列/选品看板/board.json` 不受影响；若被误删，该文件是纯 JSON 可直接手写空结构 `{"schemaVersion":"2.0","items":[]}` |
| 回滚后 474 分层被质疑 | 用测试 12 的四项断言独立复核：文件 sha256、记录数 474、层分布、层归属指纹 |
| 误删 `已完成产品/` 文件 | `.gitignore` 内无版本控制。只能从 `github.com/Biu-nan/yikuaborder-private-backup` 备份恢复（最近一次 `backup/current-source-20261026`） |
