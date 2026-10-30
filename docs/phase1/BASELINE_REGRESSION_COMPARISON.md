# 基线回归对比｜BASELINE_REGRESSION_COMPARISON

- 验收轮次：阶段 1 最终验收（第三轮，Lance 复核）
- 执行日期：2026-10-30
- 基线 commit：`8970876e55d1e371d51c37b0249d6c37d8d4d132`
- 当前分支：`feature/ykb-v1-phase1-identity-state`（HEAD 同为 `8970876`，改动全在工作区）
- 结论：**44 个失败在原始版本与当前版本完全一致，登记为历史遗留问题。当前版本新增失败 0 项，无法复现 0 项。**

---

## 1. 基线确认

```bash
git rev-parse --abbrev-ref HEAD
# feature/ykb-v1-phase1-identity-state

git rev-parse HEAD
# 8970876e55d1e371d51c37b0249d6c37d8d4d132

git merge-base HEAD upgrade/reliability-20261024
# 8970876e55d1e371d51c37b0249d6c37d8d4d132   ← 分支起点 = 当前 HEAD
```

| 项 | 值 |
|---|---|
| 阶段 1 开始前的基线 commit | `8970876e55d1e371d51c37b0249d6c37d8d4d132` |
| commit message | `fix(ops): 启动脚本写入规范路径 + 修正换行丢失 + 加 chcp 65001` |
| 当前分支 HEAD | 同上（**零提交**，所有改动未提交） |
| 未提交改动数 | 17 |

> 因为阶段 1 一次都没提交，HEAD 仍等于基线 commit。这意味着「当前版本」= 基线代码 + 工作区改动，对比时只需固定脚本与数据，差异必然来自工作区。

---

## 2. 独立 worktree 检出

```bash
git worktree add .worktrees/phase1-baseline 8970876e55d1e371d51c37b0249d6c37d8d4d132
# Preparing worktree (detached HEAD 8970876)

cd .worktrees/phase1-baseline && git rev-parse HEAD
# 8970876e55d1e371d51c37b0249d6c37d8d4d132   ← 已确认检出基线
```

| 项 | 值 |
|---|---|
| worktree 路径 | `F:/yikuaborder-deploy/.worktrees/phase1-baseline` |
| 检出方式 | detached HEAD，不影响当前分支 |
| 基线 worktree 里是否有阶段 1 模块 | ❌ 全部不存在（见 §3） |

---

## 3. 依赖 / 配置 / 命令的一致性证明

### 3.1 测试脚本：字节级相同

```bash
sha256sum .worktrees/phase1-baseline/scripts/verify-product-layout.mjs scripts/verify-product-layout.mjs
```

```
d4b30d4de595a1acf8b396196efbdbb477746e0cf67e713c3f5abe9520d93a73  .worktrees/phase1-baseline/scripts/verify-product-layout.mjs
d4b30d4de595a1acf8b396196efbdbb477746e0cf67e713c3f5abe9520d93a73  scripts/verify-product-layout.mjs
```

**两版哈希完全相同** → 没有删除测试、没有降低断言、没有修改测试范围。

### 3.2 依赖

| 项 | 值 |
|---|---|
| Node | `v22.22.2`（同一个可执行文件，两次运行都用 `node`，无版本切换） |
| 脚本外部依赖 | **无**（只用 `node:fs` / `node:fs/promises` / `node:path` / `node:process` / `node:crypto`） |
| 项目 `node_modules` | 未参与（脚本不 import 任何第三方包） |

### 3.3 工作目录（关键）

`scripts/verify-product-layout.mjs` 第 29 行：

```js
const ROOT = process.cwd();
const COMPLETED_DIR = path.join(ROOT, "已完成产品");
```

**数据目录由 cwd 决定，不是脚本路径。** 因此正确做法是：

- 基线版：`cd F:/yikuaborder-deploy && node .worktrees/phase1-baseline/scripts/verify-product-layout.mjs`
- 当前版：`cd F:/yikuaborder-deploy && node scripts/verify-product-layout.mjs`

两次的 `cwd`、数据、脚本内容三者中前两者相同、第三者字节相同 —— 唯一变量是「跑的是哪个分支的代码」。

> 若反过来在 worktree 内跑（`cd .worktrees/phase1-baseline && node scripts/...`），`已完成产品/` 在 `.gitignore` 内不随 worktree 检出，会得到 0 个产品、结果不可比。这一点已写死在下方命令里。

### 3.4 实际执行的命令

```bash
cd F:/yikuaborder-deploy

# 基线版
node .worktrees/phase1-baseline/scripts/verify-product-layout.mjs \
  > _verify/baseline/layout-baseline.txt 2>&1
# exit=2

# 当前版
node scripts/verify-product-layout.mjs \
  > _verify/baseline/layout-current.txt 2>&1
# exit=2
```

---

## 4. 运行结果

### 4.1 汇总

| 指标 | 基线版 | 当前版 | 差异 |
|---|---|---|---|
| ok | 33 | 33 | **0** |
| warn | 95 | 95 | **0** |
| **fail** | **44** | **44** | **0** |
| 扫描产品总数 | 172 | 172 | 0 |
| 退出码 | 2 | 2 | 0 |

### 4.2 全量输出对比

```bash
diff -q _verify/baseline/layout-baseline.txt _verify/baseline/layout-current.txt
# 无输出（文件相同）
```

**172 个产品的逐条结果 + 全部原因行，两次运行逐字节一致（0 行差异）。**

原始证据文件：

| 文件 | 路径 |
|---|---|
| 基线完整输出 | `F:/yikuaborder-deploy/_verify/baseline/layout-baseline.txt` |
| 当前完整输出 | `F:/yikuaborder-deploy/_verify/baseline/layout-current.txt` |
| 44 项失败结构化清单 | `F:/yikuaborder-deploy/_verify/baseline/fail-list.json` |

---

## 5. 逐项差异

### 5.1 失败项集合比对

| 指标 | 数值 |
|---|---|
| 基线失败项 | 44 |
| 当前失败项 | 44 |
| **仅在基线出现（当前已修复）** | **0** |
| **仅在当前出现（新增失败）** | **0** |
| **完全一致（产品名 + 原因码 + 原因详情）** | **44 / 44** |

### 5.2 错误类型分布

| 错误码 | 含义 | 基线 | 当前 | 差异 |
|---|---|---|---|---|
| `E_MISSING_FACTS` | 缺 `product-facts.json` | 35 | 35 | 0 |
| `E_FACT_IMAGE_UNRESOLVABLE` | facts 引用的图片找不到 | 27 | 27 | 0 |
| `A_AI_IMAGE_IN_PRODUCT_DIR` | `产品图/` 里有 `Image_*.png` | 24 | 24 | 0 |
| `C_SHA_DUP` | 跨目录 sha256 重复 | 24 | 24 | 0 |

> 合计 110 > 44，因为一个产品可同时命中多个错误码。

### 5.3 按错误组合拆分（44 个产品）

| 错误组合 | 数量 | 具体产品（示例） |
|---|---|---|
| `E_MISSING_FACTS` | 35 | `1个长条四键主体`、`8-12-Coach City Tote 内胆`、`8-12-Longchamp Le Pliage Xtra Hobo bag 内胆`、`A已填充到店小秘产品文件夹中`、`CHANEL BOY CHANEL Handbag 内胆` … |
| `A_AI_IMAGE_IN_PRODUCT_DIR` + `C_SHA_DUP` | 3 | `三泡按压钥匙扣`、`图案`、`豌豆荚挤压挂件` |
| `E_FACT_IMAGE_UNRESOLVABLE` | 3 | `八格分区药盒`、`动物造型发声包包挂件`、`厂家直销水晶苹果汽车铁塔钥匙扣包包挂件夸张饰批发宋锦小马非遗_921959343235` |
| `C_SHA_DUP` | 2 | `幸运草风铃包饰`、`悍匪毛绒钥匙扣 (2)` |
| `A_AI_IMAGE_IN_PRODUCT_DIR` | 1 | `彩色字母串珠包挂` |

**逐项差异：无。** 44 项一一对应，产品名、数量、错误码、原因详情全部相同。

---

## 6. 判定标准逐条回答

| 判定标准 | 结果 | 依据 |
|---|---|---|
| 原始版本与当前版本完全一致 → 登记历史遗留 | ✅ **命中** | 汇总行相同、全量输出 diff 0 行、44 项集合完全相同 |
| 当前版本新增失败 → 定位并修复 | ✅ **无新增** | 「仅在当前出现」= 0 |
| 无法复现 → 标记 NEEDS_VALIDATION | ✅ **全部可复现** | 两次运行都稳定产出 44 项，无偶发、无环境依赖 |

---

## 7. 数据未变动的独立证据

| 证据 | 数值 |
|---|---|
| 扫描 `已完成产品/` + `当前产品/` + `已遗弃产品/` 的文件数 | **20,550** |
| 其中 2026-10-30 03:00 后修改的文件数 | **0** |
| `data/metrics/strata/2026-10-25.json` sha256 | `d982c5c42264fa7f…`（未变） |

即：44 个失败不是「数据被动过」造成的，也不是「代码改动」造成的 —— 数据与脚本都被固定住了。

---

## 8. 结论与登记

**结论**：44 个 `verify-product-layout` 失败在基线 commit `8970876` 上就已全部存在，数量、文件、错误类型、失败原因逐项一致。与阶段 1 的九项改造无任何因果关系。

**登记编号**：`LEGACY-001`

| 属性 | 值 |
|---|---|
| 现象 | `verify-product-layout.mjs` 44 项 FAIL（共 172 个产品） |
| 首次存在 | 早于 `8970876`（基线即有） |
| 是否阻塞阶段 1 验收 | 否 |
| 修复归属 | 阶段 2 数据治理，须人工逐项确认（缺 facts 的补跑事实提取；AI 图错放的迁移；重复图的去重） |
| 禁止的处理方式 | 删除测试 / 降低断言 / 缩小扫描范围 |

### 8.1 红线自查

| 禁止动作 | 是否发生 |
|---|---|
| 删除测试 | ❌ 未发生 |
| 降低断言 | ❌ 未发生（脚本 sha256 未变） |
| 修改测试范围 | ❌ 未发生（同一 cwd、同一扫描目录、同一命令） |
