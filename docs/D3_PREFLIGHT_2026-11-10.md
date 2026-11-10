# D3 骨架跨层化 · 影子预演报告（2026-11-10 18:30）

> **状态：纯影子目录预演，主目录零改动，未执行任何迁移。**
> 目的：把 D3 从「授权后 30 分钟盲改 17 个文件」变成「已验证的方案」。
> 预演现场：`F:\yikuaborder-shadow-merge\d3-preflight\`（339 文件，独立可删，不碰主目录）。

## 1. 结论先行

**① 方案的「17 个文件」清单不准，实际是 20 个。**
`docs/D3_LAYERING_PLAN_2026-11-10.md` §3.2 列了 12 个改 import 的文件，
但静态扫描 `agents/` + `dist/` 的真实引用后，漏了 **2 个真 import 方** 和
**1 个路径耦合的评测器**。按原清单「一次改完，改完删目录」会直接断链。

**② 机械路径迁移本身零回归**（把 14 个引用方都改对的前提下）：
132 条上品离线断言全过、2 个安全契约测试 11/11、全量失败名集合 `diff` 为空。

**③ 但 `mutations.mjs` 有结构性耦合，不是改路径能解决的。**
删掉 `agents/_shared/` 后它**先崩溃**；即使修好崩溃，还会**静默失效**
（变异打不到被测代码）—— 后者比崩溃危险得多，会让「16 种变异全部被抓」变成假绿。

## 2. 精确清单：20 个文件（原方案 17）

### 2.1 移动的模块（5 个，方案正确）
```
agents/_shared/{errors,permissions,schemas,state,trace}.js
  → dist/src/agent-shared/
```

### 2.2 真 import 方（14 个，方案只列了 12 个）

| 分组 | 文件 | 真 import 数 |
|---|---|---:|
| 上品出图 src（方案已列 9） | `a-plus-runner.js`(2)、`a-plus.js`(1)、`cli.js`(2)、`inputs.js`(2)、`model.js`(1)、`planning.js`(2)、`qc.js`(1)、`runner.js`(5)、`style-research.js`(1) | 17 |
| 采购库存（方案已列 2） | `audit.js`(1)、`decide.js`(1) | 2 |
| 生产测试（方案已列 1） | `dist/test/visual-runner-safety.test.js`(1) | 1 |
| **方案漏 ①** | `agents/ae-product-design/evals/run-offline.mjs`(2) | 2 |
| **方案漏 ②** | `dist/test/agent-safety-scale.test.js`(1) | 1 |

`run-offline.mjs` 就是 D3b 交付的 **132 条断言评测器** —— 原清单漏它，
意味着「改动前后各跑一遍离线断言」这条前置在删目录后根本跑不起来。

`agent-safety-scale.test.js:78` 那条是**故意** import 旧路径的对照实证：
> 「对照实证：两套标号在同一个字母上含义不同」—— 读 `legacy.PERMISSIONS.FS_WRITE === "P3"`，
> 再证明框架 `P3` 不是「写本地文件」。

改路径后测试仍通过（见 §4），但**必须改**，否则删目录即断链。

### 2.3 结构改造（1 个，方案完全没提）
`agents/ae-product-design/evals/mutations.mjs` —— 5 处 `file: "_shared/…"` 变异目标，
加上 `buildWorkTree()` 里的硬编码复制。详见 §5。

### 2.4 只有注释、不必改（2 个）
`agents/purchase-inventory/src/limits.js`、`dist/src/agent-safety-scale.js`
里出现的 `_shared/` 都在注释或报错文案中，不是模块解析路径。

## 3. 预演方法

预演根放在 `yikuaborder-shadow-merge/d3-preflight/`：
向上可查到影子目录的**真实** `node_modules`（不是符号链接），
`package.json` 带 `"type": "module"`，从 deploy 只做只读复制（339 文件）。

机械迁移（**只改路径，不改 `permissions.js` 语义**）：
- `agents/**/src/*.js`、`evals/run-offline.mjs`：`../../_shared/` → `../../../dist/src/agent-shared/`
- `dist/test/*.test.js`：`../../agents/_shared/` → `../src/agent-shared/`
- `mutations.mjs`：`file: "_shared/` → `file: "dist/src/agent-shared/`（先试，见 §5）
- 复制 5 个模块到 `dist/src/agent-shared/`，删 `agents/_shared/`

## 4. 迁移前 / 后对照（同一预演根，内部对比才有效）

| 验收项 | 迁移前 | 迁移后 |
|---|---|---|
| ① `run-offline.mjs` | 21 用例 / **132 断言** / 失败 0 / 1941ms | 21 用例 / **132 断言** / 失败 0 / 1920ms |
| ② `visual-runner-safety.test.js` + `agent-safety-scale.test.js` | **11 / 11 / 0** | **11 / 11 / 0** |
| ③ 全量 `dist/test/*.test.js` | 526 / 401 / 125 | 526 / 401 / 125 |
| ③ 失败**名集合**（133 条） | — | **`diff` 为空** |
| ④ `mutations.mjs` | 16 种变异全被抓 | **崩溃，见 §5** |

⚠️ 全量的 526/401/125 **不能**与主目录的 601/574/27 直接比：
预演根没复制 `listing-agent/`、`nawu-fetch/`、产品 fixture 等，环境不等价。
有效的是**同一预演根内改前 vs 改后**的逐项对照 —— 上面三项全部一致。

## 5. `mutations.mjs` 的两层问题

### 5.1 第一层：直接崩溃（已实测）
```
Error: ENOENT: no such file or directory, lstat
  'F:\yikuaborder-shadow-merge\d3-preflight\agents\_shared'
    at buildWorkTree (mutations.mjs:219)
```
`buildWorkTree()` 硬编码：
```js
await cp(path.join(AGENTS_ROOT, "_shared"), path.join(PRISTINE, "_shared"), …);
await cp(path.join(PRISTINE, "_shared"), path.join(WORK, "_shared"), …);
```
删掉 `_shared/` 后这两行立即 ENOENT。

### 5.2 第二层：修好崩溃后会静默失效（更危险）
文件开头自己写了一条红线：
> 「WORK 必须与 `agents/` 同深度：源码里有 `../../../dist/…` 与 `../../_shared/…`，
> 换一层目录就会解析到别处，**变异出来的东西根本不是被测代码**。」

迁移后源码里的 `../../../dist/src/agent-shared/…` 从
`WORK/ae-product-design/src/` 向上三级会解析到 **真实 `REPO_ROOT/dist/`**，
而不是 WORK 里的变异副本。后果不是报错，而是：
**变异写了副本，被测代码读的是真身 ⇒ 全部 CAUGHT 变成假阴性**，
「16 种变异全部被抓、漏抓 0」这个结论会悄悄失真。

### 5.3 修法方向（需单独设计，不在机械迁移内）
三选一，都需要改 `buildWorkTree()` 的结构，不是改字符串：
1. WORK 改成**整个预演根/仓库根**的副本（同时含 `dist/` 与 `agents/`），保持所有相对深度
2. 给 `mutations.mjs` 增加一层「真实路径 → WORK 副本路径」的映射，并把 WORK 结构补上 `dist/`
3. 变异直接打真实源码（**不推荐**：必须严格串行 + 每轮全量还原，出错会污染主目录）

推荐 1：最贴合现有注释的设计意图，且改动集中在 `buildWorkTree()` 一处。

## 6. 建议修正后的执行顺序（授权后）

| 步 | 动作 | 验收 |
|---|---|---|
| 1 | 按 §2 的 **20 文件**清单重做迁移清单，不再用 17 | 清单与 `grep -rn "_shared/"` 逐条对齐 |
| 2 | 复制 5 模块到 `dist/src/agent-shared/`，先不动调用方 | 两处都能跑 |
| 3 | 改 **14 个** 真 import 方的路径（每改 2–3 个跑一次 ①②） | §4 的 ① 132 断言、② 11/11 |
| 4 | **单独重设计 `mutations.mjs` 的 WORK 结构** | ④ 16 种变异全被抓，且**注入一个已知假变异验证它确实会红**（防 §5.2 假绿） |
| 5 | 全绿后删 `agents/_shared/` | 全量失败名集合与基线一致 |
| 6 | `permissions.js` 的**语义拆分**（`RESOURCE_AXIS` + 副作用门改调 `agent-safety-scale.js`） | 本次预演**未覆盖**，需单独一轮 |
| 7 | 更新方案状态为 DONE，写 `SYSTEM_FRAMEWORK_v1.0.md` §4.3 旁注 | 文档与看板一致 |

⚠️ 本次预演**只做了路径迁移**，没有做 §6 步 6 的语义拆分。
两步的风险要分开验，不要合成一次「大改」。

## 7. 边界声明

- 主目录 `F:\yikuaborder-deploy` **一个文件都没改**；所有写操作都在
  `F:\yikuaborder-shadow-merge\d3-preflight\`
- 未启停任何服务，`:3000` 全程 200
- 未执行 D3 迁移本身（改主目录既有代码属 `DEV_PLAN §0` 的「必须先问你」）
- 预演现场保留供复查，可随时整体删除（在影子目录内，不影响主目录依赖）
