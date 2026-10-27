# 单品产品资料生成 workflow（实测版 v0.1）

> 2026-10-26。依据：`listing-agent` 源码实读 + 一次真机执行（黑羊皮革包挂件，36 秒，`status=needs_human`）。
> **从属说明**：本文是商品环「选品建档 → 内容生成 → 审核上架」中**内容生成段的实现级 workflow**，
> 业务闭环以 `docs/superpowers/specs/2026-10-26-ceo-os-operating-loop-design.md` 为准。

## 〇、核心结论：这条链的输入假设是错的

现在的设计假设「**给一张产品图，就能生成完整产品资料**」。实测证伪：

| 事实类别 | 图能不能给 | 例 |
|---|---|---|
| 视觉事实 | ✅ 能 | 形态（小羊头+披风）、颜色（深蓝/黑/棕）、风格（卡通） |
| 商业事实 | ❌ 不能 | 材质、产地、品牌、重量、包装尺寸、HS 编码、供货价 |

所以**校验必然失败不是 bug，是输入缺了一路**。正确形态是两路输入合流：

```
产品图 ──→ 视觉事实 ──┐
                      ├──→ 合并 facts ──→ 校验 ──→ 可上架资料
商品档案 ─→ 商业事实 ──┘   ← 这一路当前不存在
```

**这是本次梳理最重要的结论**：补 schema、补自纠错都只能让流程"往前走一步"，但走不到终点。
必须有「商品档案」这一路输入，否则每次都要人补同样那几个字段。

## 一、节点表（含真实状态）

| # | 节点 | 输入 | 输出 | 执行者 | 副作用 | 实测状态 |
|---|---|---|---|---|---|---|
| N0 | 接收 | 对话附图 / 剪贴板路径 | 绝对路径 | 对话入口 | 无 | ✅ 通 |
| N1 | 归档 | 源图 | `当前产品/<包名>/images/` | CLI | P1 本地写 | ✅ 通 |
| N2 | 归一化 | 图 + profileKey | facts 草稿 | `parse-stage` | 无 | ✅ 通 |
| N3 | AI 生成 | 图 + 类目 prompt | facts（标题/属性/描述/Q&A） | `generate-stage` | P1 | ✅ 通（36s，**唯一 AI 调用**） |
| N4 | 校验 | facts | schema 报告 + 必填缺失 + 质量分 | `validate-stage` | 无 | ❌ **必失败**（9 条 schema 错） |
| N5 | 自纠错 | 缺失项 | 补默认值 / AI 重生成 | `_autoFix` | P1 | ❌ **被短路**（实测 autoFixLog 为空） |
| N6 | 人工补缺 | 缺失清单 | 补全后的 facts | **人** | P1 | 🟡 无界面，只能改 JSON |
| N7 | 草稿入平台 | facts | 店小秘草稿 | `dianxiaomi-publisher` | **P3 需人批** | ⚠️ 存在未验证 |
| N8 | 发布 | 草稿 | 线上商品 | — | **P5 必须人点** | ❌ 未接 |

## 二、三个断点（按修复收益排序）

### 断点 1：`validate` 必失败 —— 一个 facts 对象有 3 份定义

| 位置 | `variants` 允许的字段 |
|---|---|
| `schemas/product-fact.schema.json` | `dimensions` / `skus`，且 `additionalProperties:false` |
| `dist/src/listing-knowledge.js:56-62`（注释） | `colors` / `sizes` / `defaultPrice` / `defaultStock` / `defaultWeight` |
| `dist/src/dianxiaomi-facts.js:18`（实际产出） | 上面全部 + `matrix` / `colorImages` / `colorCustomNames` |

另有两处：`config.js` 的 prompt 明确要求 `mainKeyword` 必填，schema 顶层 `additionalProperties:false` 却没有这个字段；
`schema.unit` 只写 `"string"`，生成器按 `null` 输出 → 类型错。

**后果**：与产品无关，每次运行稳定产出 9 条 `SCHEMA_INVALID`。
**这与系统里「6 套并行状态机」是同一个病**：同一概念多份真相。

### 断点 2：自纠错形同不存在

`listing-agent.js:59`：
```js
if (round === maxRounds || report.blockers.some(b => b.fixable === false)) break;
```

只要**任意一条** `fixable:false` 的 blocker 存在，整轮自纠错直接放弃。
而 `SCHEMA_INVALID` 在 `validate-stage.js:76` 被硬编码为 `fixable: false`。

**后果**：9 条 schema 错把 4 条本来可自动补的缺失项（类型/材质/品牌/产地）一起按下去了。
实测 `autoFixLog: []` —— 一轮都没跑。

**这是设计缺陷不是配置问题**：可修项应该独立于不可修项处理，不该被一起短路。

### 断点 3：人工补缺没有入口

当前只能手改 `product-facts.json` 再重跑。改完没有回环校验，也不知道改对没有。
按定位，这一环本该是 OS 的「人工接管」界面。

## 三、顺序建议

| 序 | 动作 | 收益 | 风险 |
|---|---|---|---|
| 1 | 对齐 schema / prompt / 生成器三份定义 | N4 能过，不再每次 9 条假错 | 低（纯配置） |
| 2 | 可修项不受不可修项短路 | N5 真正生效，能自动补单位/HS/类目默认值 | 低 |
| 3 | 建「商品档案」输入路径 | **这才让 N6 从"每次必停"变成"偶尔停"** | 中（新概念，需定字段） |
| 4 | 人工补缺界面 | 不用手改 JSON | 中（前端） |

注意：1、2 做完后流程**仍然会停在 N6**，因为材质/品牌/产地图里没有。不要误以为修完就能全自动。

## 四、尚未验证的部分（不许当成已通过）

- N7 草稿入平台：publisher 注册表存在，但本次 `publish: false` 未触发；且为 P3，按框架需 Gate。
- N8 发布：从未跑通真实发布。
- AI 看图准确度：本次把小羊头误判为魔鬼鱼（manta ray）。**同类误判会一路错到标题、类目、关键词**。
- 真机模型对齐：已由本次执行验证（`候选 GPT-5.6 Sol / exact`），V4/V5 视为通过。
