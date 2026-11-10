# 上品 Agent 离线评测（D3b）

> 目的：让 `ae-product-design` 在**不开浏览器、不调模型、不联网**的前提下可验证。
> 这不是替代整链跑，而是给结构改动（D3 骨架跨层化）一个能 2 秒出结果的护栏。

## 1. 一句话现状

`evals/cases.json` 有 21 条用例，但**原本没有执行器**——那些断言只是文字，从来没被真跑过。
现在：

| 项 | 数量 |
| --- | --- |
| 用例总数 | 21 |
| 离线完整覆盖 | 14 |
| 离线部分覆盖（写明缺哪一段） | 2 |
| 只能跳过（需要浏览器/网络） | 5 |
| 断言总数 | 132 |
| 整套耗时 | 约 2 秒 |
| 变异测试 | 16 条，**16/16 被抓，0 漏抓** |

## 2. 怎么跑

```bash
# 全跑（约 2 秒）
node agents/ae-product-design/evals/run-offline.mjs

# 只看某几条
node agents/ae-product-design/evals/run-offline.mjs --only hero-score

# 看每条用例的归类（full / partial / skip）
node agents/ae-product-design/evals/run-offline.mjs --list

# 机器可读
node agents/ae-product-design/evals/run-offline.mjs --json

# 证明断言真能红（约 90 秒）
node agents/ae-product-design/evals/mutations.mjs
```

退出码：`0` = 无失败（允许 skip）；`1` = 有失败。

变异测试会临时建一个 `<repo>/.eval-mutants-<pid>/` 工作树（与 `agents/` 同深度，所以
`../../_shared`、`../../../dist` 都照旧解析），跑完删除。**不修改 `agents/` 下任何真实文件。**

## 3. 覆盖口径

### 3.1 完整覆盖（14 条）

| 用例 | 验证方式 |
| --- | --- |
| `golden-dry-run-plumbing` | 真跑 `runAgent({dryRun:true})`：S0–S5 全链路，5 个产物落盘，`budget.modelCalls=0`、`imageGenerations=0`，trace 恰好 1 对 started/completed |
| `golden-marketing-module-separate` | 商品图 6 / 营销图 2；`textPolicy=forbidden` 的槽位 `headline` 必须为空串；`MK2` 目标尺寸 1000×1334 |
| `failure-no-product-images` | 空目录抛 `E_INPUT_IMAGES` 且**未创建 `design/`**（连文案一起断言，否则删掉守卫后仍会被下一层同码兜住 → 假通过） |
| `failure-scope-violation` | `outDir` 越界抛 `E_SCOPE_VIOLATION`；另测前缀陷阱（`/a/b` 与 `/a/bc`）与 `P6` 一律拒绝 |
| `failure-sensitive-egress` | 供应商/成本/利润（含嵌套对象、数组内、中文键）全部整键剔除，且给模型的文本里不含供应商名 |
| `failure-hero-score-below-threshold` | 73 分（识别度 12/25）判 `fail`，理由两条都在，`isQcDeliverable=false` |
| `failure-hero-score-tampered` | `total` 与分项和不一致抛 `E_SCHEMA_INVALID`；容差边界钉死（73.5 放过 / 73.6 拒绝） |
| `failure-mk2-square-instead-of-3x4` | 构造 info + **真实 1000×1000 图片文件**两条路径都断言 |
| `failure-json-fence-or-truncated` | 围栏/带前后缀/数组可解析；截断、无 JSON、空回复必须抛 `E_MODEL_JSON` |
| `regression-skip-optional-slot` | `--skip-slots P6` 后 `counts.requested=7`，P6 以 `skipped` 留在报告里（不许静默消失） |
| `regression-stale-dossier-reuse` | 8 条 storyboard 对 6 个槽位必须抛错；`loadSlots` 的配置校验也一并走 |
| `regression-benchmark-math` | `1000×CTR×CVR` 及不变式、基线差值；`impressions=0`/`clicks>impressions`/`orders>clicks` 都拒 |
| `regression-upscale-detected` | 780×780 被 800px 下限拦住；小于 60KB、超过 2MB 也拦；读真实文件头 |
| `regression-fit-scale-padding` | 真实 python+Pillow：90% 主体 → 扩画布补白到约 0.775，**商品像素不缩放**；二次运行 `already-in-range`；非白底 `not-white-background`；60% 主体不动 |

### 3.2 部分覆盖（2 条，只到某一段）

| 用例 | 覆盖到哪 | 缺哪一段 |
| --- | --- | --- |
| `failure-text-on-marketing-image` | 「文字不合规 → 必判 fail 且理由可见」的合成逻辑；以及 `policyOk=false` 却判 `pass` 会被 schema 直接拒绝 | **视觉检出本身**未验证（要模型看图 + 浏览器） |
| `failure-research-fallback-declared` | 降级必须自报 `source=fallback`、说清理由、不留假证据；dry-run 不得把 fallback 说成真实调研 | **双源抓取失败的真实触发**未验证（要断网打靶） |

### 3.3 只能跳过（5 条，写明理由）

| 用例 | 为什么跳过 |
| --- | --- |
| `golden-happy-path` | 需 CDP 9223 + 8 次真实出图 + 视觉 QC，单次约 30 分钟。留给 D4 真实跑通 |
| `failure-silent-text-instead-of-image` | 需构造「创建图片」工具不可用的浏览器会话 |
| `failure-product-drift` | 需模型看图的视觉判定；离线只能验它之后的 fail 传播 |
| `failure-research-empty` | 需在 `collectStyleRefs` 打靶双源抓取失败（断网/反爬） |
| `failure-out-of-scope-request` | 纯 prompt 层契约，没有代码可执行；由 `contract.md` 边界章节保证 |

## 4. 变异测试：证明断言不是摆设

`mutations.mjs` 会故意注入已知缺陷，要求套件**必须变红且命中指定用例**。
判定三态：`CAUGHT` / `MISSED`（注入成功但仍全绿 = 假断言）/ `INAPPLICABLE`（变异串没命中 = 变异脚本坏了）。

| 变异 | 注入的缺陷 | 被抓于 |
| --- | --- | --- |
| `mk2-ratio-check-off` | 关掉比例偏差检查 | `failure-mk2-square-instead-of-3x4` |
| `min-width-check-off` | 关掉 800px 下限 | `regression-upscale-detected` |
| `hero-floor-off` | 取消单项最低占比 | `failure-hero-score-below-threshold` |
| `hero-total-tolerance-open` | 不再校验总分=分项和 | `failure-hero-score-tampered` |
| `benchmark-degrade-to-ctr` | 每千次曝光成交单量退化成只看 CTR | `regression-benchmark-math` |
| `redaction-off` | 关闭敏感字段剔除 | `failure-sensitive-egress` |
| `qc-verdict-never-fail` | 有失败理由也不判 fail | `failure-hero-score-below-threshold`、`failure-text-on-marketing-image` |
| `scope-guard-off` | 关闭越界写保护 | `failure-scope-violation` |
| `empty-product-tolerated` | 无图也放行 | `failure-no-product-images` |
| `json-truncation-tolerated` | 截断当空对象返回 | `failure-json-fence-or-truncated` |
| `fallback-claims-real-research` | 内置库自报真实双源调研 | `failure-research-fallback-declared` |
| `dryrun-style-source-lie` | dry-run 谎报风格来源 | `golden-dry-run-plumbing`、`failure-research-fallback-declared` |
| `skip-slot-ignored` | `--skip-slots` 失效 | `regression-skip-optional-slot` |
| `storyboard-count-unchecked` | 条数不符也能复用 | `regression-stale-dossier-reuse` |
| `fit-scale-no-padding` | 占比超限也不扩画布 | `regression-fit-scale-padding` |
| `dryrun-calls-model` | dry-run 走模型分支 | `golden-dry-run-plumbing`、`golden-marketing-module-separate`、`regression-skip-optional-slot` |

### 我自己踩的两个坑（写在这里防复发）

1. **第一版变异测试是假的。** `restore()` 只还原「当前这条变异」改的文件，于是上一轮改的
   `image-info.js` 一直带着伤，后面的变异全都「因为前面没修好」才变红——那种 `CAUGHT` 毫无意义。
   识别方法：失败集合越来越大（第 2 条只红自己，第 15 条红了大半）。修法：每轮开始与结束**全量还原**。
2. **变异串跨行匹配会静默失效。** 仓库源码是 CRLF，写 `\n` 的跨行 `find` 一行都命中不了，
   表现成 `INAPPLICABLE` 而不是明确的错误。所以锚点统一用**唯一单行**，并强制校验 `hits === 1`。

## 5. 顺带查出的真实缺陷

按严重度排，**均未擅自修改**（属既有文件，等 Lance 决定）。

### 5.1 P1 · fixture 里有一条错的产品事实

`fixtures/sample-product/product-facts.json` 的 `mainKeyword` 是 `"Nipple Covers"`，
而这份 fixture 的产品是「3D printed vegetable fidget toy」。

`buildFactsText()` 会把 facts JSON 直接拼进给模型的 prompt。也就是说：**拿这份 fixture 跑，
等于告诉模型"这个产品的核心关键词是 Nipple Covers"**。如果真实产品目录沿用了同一份模板，
这是让模型在错误类目上做风格调研和文案。

> 需要确认：这是模板残留，还是有意留的陷阱数据。我倾向残留——因为它和同一个文件里的
> `title.en`、`description.pc` 完全对不上。

### 5.2 P2 · fixture 里带着历史产物

`fixtures/sample-product/design/` 内有 5 个文件（含 `trace.jsonl` 的 4 条历史事件）。
任何「跑在这个目录上」的测试都会**追加**到旧 trace，断言读到的是上一轮的事件 → 看起来通过，其实测的是别人的输出。

第一版 `run-offline.mjs` 就是这么被骗的：断言的 agent.started 在，但那是历史记录。
现在 `cloneProduct()` 复制后强制清空 `design/`，并把断言收紧成「**恰好 1 条** agent.started」。

### 5.3 P2 · cases.json 有三条断言引用不存在的文件

`fixtures/bad-780x780.jpg`、`fixtures/bad-1000x1000-as-mk2.jpg`、`fixtures/slots-6.json`
全部不存在。即使有人照着 cases.json 写执行器，这三条也跑不了。

**已补齐**（新增文件，未改既有）：两张 780×780 / 1000×1000 的噪声 JPEG（>60KB，不会被「过小」误伤）、
一份 6 槽位配置变体。补齐后这两条用例改成从**真实图片头**开始测，不再只构造 info 对象。

### 5.4 P3 · cases.json 有一条期望文案与代码不符

`failure-hero-score-tampered` 写 `messageIncludes: "与分项之和不一致"`，
实际抛的是 `total 95 与分项之和 73 不一致`（中间夹了数字）。

说明**这条期望从来没被执行过**。`run-offline.mjs` 按真实文案断言，并在代码里注明偏差；
`cases.json` 属既有契约文件，未擅自改。

### 5.5 P3 · `fit_scale.py` 无视扩展名强存 JPEG

`canvas.save(src, "JPEG", quality=90)`——若传入 `.png`，会得到一个「扩展名 png、字节是 JPEG」的文件。
当前链路只喂 jpg，没爆；而 `image-info.js` 按魔数识别，会报 `jpeg`，也不会误判合格。属隐患非现症。

### 5.6 P4 · 占比 target 两处默认值不一致

`parseScaleRange("70%-85%")` 算出 `target=0.775`，而 `fitSubjectScale` 的默认 `target=0.78`。
实际调用走 `0.775`（传入了 scaleRange），所以断言区间取 0.76–0.80 两者都能覆盖。

## 6. 纪律：新增用例必须归类

`run-offline.mjs` 会读 `evals/cases.json`，逐条查覆盖表。
**在 cases.json 里新增一条却没有在覆盖表里归类 → 直接判 `FAIL`（`未归类`）**，
不允许「悄悄漏掉」。

理由：这个 Agent 之前的问题不是「测试不够多」，而是「测试没被执行」。归类强制让每条用例
要么被真跑，要么写明为什么不能跑——两者都算有交代。

## 7. 与 D3 的关系

`docs/D3_LAYERING_PLAN_2026-11-10.md` §6 指出的问题：

> `ae-product-design` 有 8 个槽位、完整契约、真实出图链路，但**没有 eval 用例**…
> 所以任何结构改动都无法快速验证。

现在这条前置条件已解决：**动这块骨架之前，先跑这 132 条断言；改完再跑一遍。**
D3 的 17 文件迁移本身仍需授权，但不再是盲改。
