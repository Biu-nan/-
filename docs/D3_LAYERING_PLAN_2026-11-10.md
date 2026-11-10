# D3 骨架跨层化 · 迁移方案（未执行，等授权）

日期：2026-11-10
状态：**方案已定，一步未动**
风险等级：中高（触及上品出图的真实链路 `ae-product-design`）

---

## 0. 一句话

把 `agents/_shared/` 五个模块提到 CEO 层，顺带修掉一个已经在代码里埋着的 P 标号冲突。

**这次只做了不碰生产文件的那部分**（新模块 + 测试 + 本方案）。真正的移动需要授权，理由见 §4。

---

## 1. 现在的问题：三个，不是一个

### 1.1 层次颠倒（原本要解决的）

`dist/test/` 是生产测试，却反向依赖 `agents/_shared/`：

```
dist/test/visual-runner-safety.test.js  →  ../../agents/_shared/errors.js
```

生产层依赖 agent 层的私有目录，等于 agent 目录不能独立演进。

### 1.2 P 标号冲突（本次发现的，比 1.1 更危险）

`agents/_shared/permissions.js` 用的是一套「资源轴」标号：

| 常量 | 字面值 | 描述的是 |
|---|---|---|
| `FS_READ` | P1 | 读文件 |
| `NET_READ` | P2 | 读网络 |
| `FS_WRITE` | P3 | 写文件 |
| `MODEL_CALL` | P4 | 调模型 |
| `DATA_EGRESS` | P5 | 外发数据 |
| `DESTRUCTIVE` | P6 | 破坏性 |

框架 `docs/SYSTEM_FRAMEWORK_v1.0.md` §4.3 用的是「副作用严重度轴」：

| 级 | 含义 |
|---|---|
| P0 | 纯读 |
| P1 | 写本地事实/草稿 |
| P2 | 生成本地文件 |
| P3 | **改平台草稿态数据** |
| P4 | **改价/改库存** |
| P5 | **发布/上架** |
| P6 | 删除/清空/回滚 |

**同一个字母，两个含义。** 具体后果：如果有人拿 `PERMISSIONS.FS_WRITE`（字面 `"P3"`）去和框架等级比，会把「改平台草稿」当成「写本地文件」，正好放行最该拦的动作。

已用测试钉死：`dist/test/agent-safety-scale.test.js` 第 5–7 条。改回去就红。

### 1.3 两处定义并存

`agents/purchase-inventory/config/limits.json` 里 `sideEffect.allowed: ["P0","P1"]` 写的是框架轴，而它 import 的 `_shared/permissions.js` 用的是资源轴。不统一就会一直有人搞错。

---

## 2. 本次已完成（纯新增，零改动现有文件）

| 文件 | 作用 |
|---|---|
| `dist/src/agent-safety-scale.js` | 框架 §4.3 的唯一权威实现：七级定义、`assertAtMost` 越级直接抛 `PERMISSION_DENIED`、`requiresHumanApproval`、`isIrreversible`、`fromLegacyResource` 显式映射（无对等项拒绝猜测） |
| `dist/test/agent-safety-scale.test.js` | 7 条契约测试，全过；其中 3 条专门锁死上述冲突 |
| `agents/purchase-inventory/src/limits.js` | 副作用门改走上面的权威实现，不再用字符串比较 |

新代码从此不会踩这个坑。剩下的问题是**老代码还在用错的轴**。

---

## 3. 迁移清单（执行时用这份，17 个文件）

### 3.1 要移动的模块（5 个）

```
agents/_shared/errors.js      → dist/src/agent-shared/errors.js
agents/_shared/permissions.js → dist/src/agent-shared/permissions.js   ← 需重写，见 §3.3
agents/_shared/schemas.js     → dist/src/agent-shared/schemas.js
agents/_shared/state.js       → dist/src/agent-shared/state.js
agents/_shared/trace.js       → dist/src/agent-shared/trace.js
```

### 3.2 要改 import 路径的文件（12 个）

| 文件 | 所属 | 风险 |
|---|---|---|
| `agents/ae-product-design/src/a-plus-runner.js` | 上品出图 | **高** |
| `agents/ae-product-design/src/a-plus.js` | 上品出图 | **高** |
| `agents/ae-product-design/src/cli.js` | 上品出图 | **高** |
| `agents/ae-product-design/src/inputs.js` | 上品出图 | 中 |
| `agents/ae-product-design/src/model.js` | 上品出图 | 中 |
| `agents/ae-product-design/src/planning.js` | 上品出图 | 中 |
| `agents/ae-product-design/src/qc.js` | 上品出图 | 中 |
| `agents/ae-product-design/src/runner.js` | 上品出图 | **高** |
| `agents/ae-product-design/src/style-research.js` | 上品出图 | 中 |
| `agents/purchase-inventory/src/audit.js` | 采购库存 | 低 |
| `agents/purchase-inventory/src/decide.js` | 采购库存 | 低 |
| `dist/test/visual-runner-safety.test.js` | 生产测试 | 低 |

各模块被引次数：`errors` 9、`permissions` 7、`state` 5、`trace` 4、`schemas` 4。

### 3.3 `permissions.js` 不能原样搬

搬过去只会把冲突一起搬走。要拆成两件事：

1. **资源轴**（`FS_READ`/`NET_READ`/…）保留，用于 `assertWithin`、`sanitizeFacts` 这类路径守卫与敏感键处理 —— 这些和副作用严重度无关。
2. **副作用等级**一律改调 `dist/src/agent-safety-scale.js`。
3. `PERMISSIONS` 常量**改名**为 `RESOURCE_AXIS`，让"这不是副作用等级"在代码里也看得出来。

### 3.4 关于兼容 shim

**不做 shim。** 迁移期间在 `agents/_shared/` 留 re-export 转发文件，短期能少改路径，但会制造"两份看起来都权威的定义"，正是这次要消灭的东西。17 个文件一次改完，改完删目录。

---

## 4. 为什么我不自己动手

三件事：

1. `ae-product-design` 是**上品出图正在用的真实链路**，改坏直接影响出图任务，而它没有和 purchase-inventory 同等密度的测试兜底。
2. 现有生产测试里只有 `visual-runner-safety.test.js` 覆盖到这块，覆盖面不足以证明"移动没破坏行为"。
3. 按 `docs/DEV_PLAN_2026-11-10.md` §0，改主目录既有代码属于「必须先问你」那一栏。

---

## 5. 建议的执行顺序（授权后约 30 分钟）

1. 先跑一次基线：`node --test dist/test/*.test.js`，记下当前通过/失败数（已知 25 个既有失败，别把它们算进来）。
2. 复制 5 个模块到 `dist/src/agent-shared/`，只改 `permissions.js` 的拆分，先不动调用方 —— 此时两处都能跑。
3. 逐个改 12 个文件的 import 路径，**每改 2–3 个跑一次** `node --test dist/test/visual-runner-safety.test.js` + `node agents/purchase-inventory/src/cli.js --evals`。
4. 全绿后删 `agents/_shared/`。
5. 再跑一次全量测试，与步骤 1 的基线逐项对比 —— 失败项必须**只减不增**。
6. 更新本文件状态为 DONE，并把 §1.2 的结论写进 `docs/SYSTEM_FRAMEWORK_v1.0.md` §4.3 旁注。

回滚：整步 2 之前先 `cp -r agents/_shared` 到 `F:/yikuaborder-backups/`，出问题直接还原目录 + `git checkout` 那 12 个文件。

---

## 6. 顺带记一笔：这暴露了一个更根本的缺口

`ae-product-design` 有 8 个槽位、完整契约、真实出图链路，但**没有 eval 用例**（`evals/cases.json` 存在但内容是 golden-happy-path 这类整链用例，跑一次要开浏览器出 8 张图）。所以任何结构改动都无法快速验证。

这意味着：**在 D3 之前，更该先给 ae-product-design 补一组不联网的离线用例**，否则每次动它都是盲改。这条建议独立于 D3，建议单列。
（这条已由 D3b 完成：`run-offline.mjs` 21 用例 / 132 断言 / 2 秒，16 种变异全被抓。）

---

## 7. ⚠ 勘误（2026-11-10 18:30）：§3 的「17 个文件」不准，实际 20 个

影子目录完整预演见 `docs/D3_PREFLIGHT_2026-11-10.md`。**主目录零改动。**

**§3.2 的 12 个改 import 文件漏了 2 个真引用方**：
- `agents/ae-product-design/evals/run-offline.mjs` —— 2 个动态 import
  （`../../_shared/schemas.js`、`../../_shared/permissions.js`）。
  它就是 D3b 的 132 断言评测器；漏掉它，「改动前后各跑一遍离线断言」这条前置在删目录后根本跑不起来。
- `dist/test/agent-safety-scale.test.js:78` —— 1 个故意 import 旧路径的对照实证
  （验证「两套 P 标号同字母不同义」）。改路径后仍通过，但**必须改**，否则删目录即断链。

**此外 §3 完全没提第 3 个结构耦合文件**：
`agents/ae-product-design/evals/mutations.mjs`（5 处 `file: "_shared/…"` 变异目标 +
`buildWorkTree()` 硬编码 `cp(AGENTS_ROOT, "_shared")`）。
删目录后实测直接 `ENOENT … lstat 'agents\_shared'`；
**修好崩溃后还会静默失效** —— 源码迁到 `../../../dist/src/agent-shared/` 后，
从 WORK 副本向上三级会解析到真实 `dist/`，变异打副本、被测代码读真身，
「16 种变异全部被抓」会变成假绿。

**修正后的清单**：5 个移动 + **14 个**真 import 方 + **1 个**结构改造 = **20 个文件**。
另有 2 个只有注释提到 `_shared/`、不必改：`purchase-inventory/src/limits.js`、
`dist/src/agent-safety-scale.js`。

**预演结论**：按 20 文件做机械路径迁移（不改 `permissions.js` 语义）**零回归** ——
132 断言全过、安全契约 11/11、全量失败名集合 `diff` 为空。
但 §5 的执行顺序要补两步：
- 第 4 步之前**单独重设计 `mutations.mjs` 的 WORK 结构**，并注入一个已知假变异验证它确实会红
- §3.3 的 `permissions.js` **语义拆分本次未预演**，必须与路径迁移分两轮验，不要合成一次大改

详细数据与修法方向见 `docs/D3_PREFLIGHT_2026-11-10.md` §2 / §4 / §5 / §6。
