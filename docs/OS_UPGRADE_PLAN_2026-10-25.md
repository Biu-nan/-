# 一跨OS 升级方案 v1.0 · 适配 GPT-6 / Intelligent UI 时代

- 日期：2026-10-25
- 触发原因：ChatGPT 侧 10 月发生**模型代际切换 + 输出形态变更**，一跨OS 的模型对齐层与出图检测层仍按 GPT-5.6 时代假设运行
- 状态：**方案待拍板**（未改任何代码）
- 关联文档：`SYSTEM_FRAMEWORK_v1.0.md`（五层框架）、`L4_DATA_ARTERY_SURVEY_2026-10-25.md`（数据源）

---

## 0. 结论先行

一跨OS 现在**看起来在正常跑，但模型对齐层已经处于"假成功"状态**。三个具体判断：

1. **P0 级逻辑 bug（已存在，只是还没被触发）**：`_modelTag()` 取短标 + `includes()` 判定，使目标 `"GPT-6"` 与实际 `"5.6"` 互相误判为匹配（`"5.6"` 包含 `"6"`）。**一旦切到 GPT-6 就会直接跳过切换、跑在旧模型上且日志显示"已符合"。** 这是升级的前置拦路石，必须先修。
2. **P0 级歧义**：模型菜单现在至少有 9 个候选（`GPT-6` / `GPT-6 Sol` / `GPT-6 Luna` / `GPT-6 Astra` / `GPT-6.1 Sol` / `GPT-5.6 Sol` / `GPT-5.6 Luna` / `GPT-5.6 Terra` / `智能极速`，见 10-15 现场探测）。现有 `_modelTextMatches()` 用**双向包含 + 取第一个命中**，`GPT-6` 会命中排在前面的任意一项——可能选中 Astra（最贵）或 Luna（最弱），且**不报错**。
3. **质量红线**：找不到目标模型时代码只 `console.warn` 然后继续跑（非致命设计）。对"全程锁 Sol + 高推理"的流水线，这等于**允许静默降级产出劣质 listing**。这违反 No Evidence No Done。

建议节奏：**P0 三项（约 1 个工作日）先做，做完再开下一轮上品**；P1 在下一轮上品过程中验证；P2 排进框架层 F3。

---

## 1. 外部事实基线（FACT，均已核实来源）

| 时间 | 变更 | 对本系统的影响面 |
|---|---|---|
| 2026-10-07 | **GPT-6 进入 Chat 标签页**，带 Intelligent UI（回答自动混排图表/表单/按钮/地图，支持边想边答）。Plus/Pro/Business/Enterprise → `GPT-6 Sol`；Free/Go → `GPT-6 Luna`；Pro 推理档 → `GPT-6 Astra`。**取代 GPT-5.6 Sol/Luna** | 模型对齐层、出图检测层、完成判定层 |
| 2026-10-16 | `GPT-6 Pro` 更新：更快、工具调用更强、**并行多 agent** | 多 agent 并发会产生多段输出 → 完成判定风险 |
| 2026-10-17 | Chrome 扩展升级为**全浏览器助手**：可读你所有打开的标签页、Work mode 下用 Computer Use 填表/比价，全套餐可用 | 与 CDP :9223 自动化**抢同一浏览器焦点**；数据外泄面（能读到店小秘后台） |
| 2026-10-20 | Locked chats（PIN 隐藏对话） | 无影响 |
| 2026-10-21 | ChatGPT Ads 扩至 26 国，10 万+ 广告主 | 无直接影响；若广告注入回答区会污染文本抓取（待观察） |
| 2026-10-14/15 | 美 8 州起诉 OpenAI（未成年人安全）；FBI 逮捕一名 OpenAI 员工 | 政策风险，可能触发产品行为收紧 |
| 2026-10-23/24 | OpenAI 恢复前沿模型训练但**训练环境断网**（7 月 Hugging Face 事件 + 9/20 DNS 配置错误） | 无直接影响；说明后续模型行为会更保守 |
| 2026-12-11 | **Custom GPTs 全套餐退役**（企业可延至 2027-02-11）；新建 GPT 已于 10-26 截止，custom actions 不迁移 | 若 prompt/文档里引用了自定义 GPT 链接需迁移 |
| 2027-01-14 | API 侧 `gpt-4o` / `4o-mini` / `4.1` / `4.1-mini` 快照下线 | 无影响（本系统不走 API） |

> 关键补充：`GPT-6.1 Sol` **不在 Chat 里**（只在 ChatGPT Work / Codex / API）。所以"想用 6.1"不能靠改 `CHATGPT_MODEL` 解决，必须换通道。这是一个容易踩的坑。

---

## 2. 现状盘点（代码证据）

| # | 位置 | 现状 | 判断 |
|---|---|---|---|
| S1 | `dist/src/config.js:99` | `CHATGPT_MODEL = "GPT-5.6 Sol"`，10-24 明确锁定 + `CHATGPT_REASONING="高"` | 仍可选中（10-15 探测确认并存），但已非默认 |
| S2 | `dist/src/chatgpt-adapter.js:1067-1077` | `_modelTag()` 正则 `(\d+(?:\.\d+)?)` + `_parseComposerPill` 用 `s.includes(tag)` | ⚠️ **短标误判 bug**（详见 G1） |
| S3 | `chatgpt-adapter.js:1213-1219` | `_modelTextMatches()` 归一化后**双向包含**（`t.includes(g) \|\| g.includes(t)`） | ⚠️ 菜单扩容后歧义爆炸（G2） |
| S4 | `chatgpt-adapter.js:1146-1159` | 遍历 `[role=menuitemradio]`，`targetIdx<0` → warn + `return false`，上层 try/catch 只 warn | ⚠️ 静默降级（G3） |
| S5 | `chatgpt-adapter.js:1104-1116` | `_readReasoningFromMenu()` 硬编码 `["即时","中","高"][n-1]`，读 `第 N 项` | ⚠️ 档位扩到 4 档即失效（G4） |
| S6 | `chatgpt-adapter.js:1202` | 强度 ratio 固定 `高=0.98 / 中=0.5 / 即时=0.02` | ⚠️ 档位数变化即错位（G4） |
| S7 | `chatgpt-adapter.js:771-778` | 出图检测：末图 `src` 变化 + `naturalWidth≥600` | ⚠️ 富组件噪声（G5） |
| S8 | `chatgpt-adapter.js:1570-1601` | 完成判定依赖 stop-button 消失；停滞 60s 自动点停止重发 | ⚠️ 边想边答的段落间隙（G6） |
| S9 | 全系统 | 单一 Chrome :9223，含店小秘/ChatGPT 多标签 | ⚠️ 扩展 Work mode 抢焦点（G7） |

---

## 3. 缺口清单与修法

### G1【P0】模型短标误判 —— 升级前必须先修

**证据链**：`_modelTag("GPT-6")` → 正则命中 `"6"`；`_parseComposerPill("思考强度5.6 高", "GPT-6")` → `s="思考强度5.6高"`，`s.includes("6") === true` → `modelOk=true`。若目标强度也恰好是"高"，`ensureChatGptModelAndReasoning()` 在 1027 行**直接 return，连菜单都不打开**。

**影响**：把 `CHATGPT_MODEL` 改成 `GPT-6` 的那一刻，系统会认为自己已经切好了，实际仍跑在 5.6 上——**日志全绿、产物是旧模型**。这是典型的"自证成功"陷阱。

**修法（二选一）**：
- **A（推荐，改动小）**：短标匹配加边界断言。`_modelTag` 保留，但 `_parseComposerPill` 判断改为"tag 是最长数字串且两侧非数字/点"：`new RegExp('(?<![\\d.])' + tag.replace('.', '\\.') + '(?![\\d.])')`。`"5.6"` 里找 `"6"` 时左侧是 `.` → 不命中。
- **B（更稳，稍慢）**：**废掉 pill 快判**，一律以菜单 `aria-checked` 为准。代价是每次发送多开一次菜单（约 +1.5s），收益是判定 100% 可信。

> 建议 A 先上，同时保留 B 作为 `MODEL_TRUST_MENU=1` 的开关。

### G2【P0】菜单歧义 —— 引入有序候选链，禁止双向包含

**现状**：`GPT-6` 同时是 `GPT-6 Sol` / `GPT-6 Luna` / `GPT-6 Astra` / `GPT-6.1 Sol` 的子串。`targetIdx` 取**第一个**命中项，取决于 OpenAI 的列表排序（会变）。

**修法**：
```js
// config.js 新增（env 可覆盖，逗号分隔，从左到右依次尝试）
export const CHATGPT_MODEL_CHAIN = (process.env.CHATGPT_MODEL_CHAIN
  || "GPT-5.6 Sol,GPT-6 Sol").split(",").map(s => s.trim()).filter(Boolean);
```
```js
// chatgpt-adapter.js：匹配语义改为「全等优先 > 前缀全等」，删掉双向包含
_modelTextMatches(text, target) {
  const norm = s => (s ?? "").toString().toLowerCase().replace(/\s+/g, "");
  const t = norm(text), g = norm(target);
  if (!t || !g) return false;
  if (t === g) return true;                 // 全等
  return t.startsWith(g);                   // 前缀（容忍 "GPT-6 Sol 高级"）
}
```
并把"命中多项"变成显式日志：打印 `菜单原文列表 [9项]` + `被选中项`，让人**肉眼可核对**。

### G3【P0】禁止静默降级 —— 找不到模型就硬失败

**现状**：`return false` → 上层 `console.warn` → 继续发送。产物质量无从保证。

**修法**：
- `config.js` 增 `MODEL_STRICT`（默认 **1**）。
- 候选链全部落空时抛 `MODEL_UNAVAILABLE`，错误文案带上**菜单完整原文**（便于一眼看出 OpenAI 又改了名）。
- 该错误映射到 `BLOCKED_NEEDS_HUMAN` 一等状态（符合框架 v1.0 的三抽象），前端 `#errorBox` + 顶部卡显式 FAILED。
- 只有 `MODEL_STRICT=0` 才允许降级，且必须写 `run-state.json` 的 `modelFallback: {requested, actual, at}`，让下游知道"这一批不是标准档位产的"。

### G4【P1】强度档位动态化

**风险**：GPT-6 官方文档提到 **"极高"** 档位。若滑杆变成 4 档：
- `_readReasoningFromMenu` 的 `n=4 → ["即时","中","高"][3] → undefined → ""` → 永远判"未确认" → **每次发送都重开菜单重设**（composer 抖动 + 单条多耗 1.5s）。
- ratio `0.98` 在 4 等分下会落到第 4 档（极高），但回读判不到 → 判定永远失败。

**修法**：档位列表**从 DOM 动态读**（滑杆的刻度元素或菜单里的档位文案），映射表改为数据驱动：
```js
const tiers = await readSliderTiers(page); // 例如 ["即时","中","高"] 或 ["即时","中","高","极高"]
const idx = tiers.indexOf(reasonTarget);
// 点击目标档位的刻度元素中心，而不是按比例猜
```
配置里 `CHATGPT_REASONING` 接受 `极高`，`_normalizeReasoning` 增加 `极高|xhigh|max → 极高`（档位不存在时回退到最后一个可用档，并在日志声明回退）。

### G5【P1】出图检测抗富组件污染

**风险**：Intelligent UI 会在回答里插入图表/表单/地图/按钮。当前"取最后一张 `img` 的 src + `naturalWidth≥600`"会把**组件内插图**当产物图。

**修法**：
- 只统计**图片容器内**的 `img`（`figure` / 图片画廊容器），不扫全局。
- src 域名白名单：`oaiusercontent.com`；排除 `data:` / `blob:` / `https://chatgpt.com/assets/*`（UI 图标）。
- 尺寸下限保留 ≥600；再补一条"必须是生成图的容器后代"。

> 沿用红线：**出图检测用 src 基线不用数量**（DOM 虚拟化使 count 抖动）。本次只收紧**选择域**，不改变基线判定思路。

### G6【P2】"边想边答"对完成判定的干扰

**风险（INFERENCE，需实测）**：GPT-6 分段输出，段落间隙 stop-button 可能瞬时消失 → `waitForCompletion` 提前返回半截文本。

**修法**：完成判定加**双条件**——stop 消失 **且** 末条 assistant 文本在 2s 内不再增长 **且** 指纹校验通过。指纹不通过就走已有的"生成停滞自动重发"，而不是返回半成品。

**验证方式**：连跑 3 个单品，对比"取到的文本尾巴"是否完整（末句是否以句号/列表项结束）。这类检查必须**独立于实现者的假设**（呼应量纲事故教训）。

### G7【P2】Chrome 实例隔离

**风险**：ChatGPT 扩展升级为全浏览器助手后，能读你所有标签页、Work mode 还能操作页面。与 CDP :9223 自动化共用同一实例会出现：
1. 抢焦点 / 抢 composer 输入（历史上已因双实例抢端口踩过坑）；
2. 扩展可读到店小秘后台的价格、库存、凭据 → 数据外泄面扩大。

**修法**：自动化专用独立 Chrome 用户配置 + 独立端口（建议 :9224），**不安装任何扩展**，与日常浏览完全隔离。改动落在 `CHROME_PATH` 启动参数（`--user-data-dir` + `--remote-debugging-port`）。

### G8【P3】Custom GPTs 退役

12/11 全套餐退役、10/26 起不能新建。巡检一遍 `prompts/` 与文档里是否有 `chatgpt.com/g/...` 链接；有则迁到项目指令或 plugin。目前 grep 未在代码里发现引用 → 预计影响为 0 到文档层。

---

## 4. 分期计划

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **P0**（本轮，先于下一次上品） | G1 短标边界、G2 候选链+精确匹配、G3 硬失败、只读探测器 | 反向用例全过（见 §5），且**故意设错模型名必须失败** |
| **P1**（下一轮上品同步） | G4 强度档位动态化、G5 出图选择域收紧 | 连跑 2 个单品，出图数与人工目视一致 |
| **P2** | G6 完成判定双条件、G7 Chrome 实例隔离 | 3 个单品文本完整性通过；独立实例跑通一次全流程 |
| **P3** | G8 文档巡检 | grep 无残留 |

---

## 5. 验收标准（必须含独立检查点）

> 教训来源：量纲事故中「验收脚本由实现者按同一错误假设编写 → 18/18 全绿却没抓到」。以下用例**不依赖实现者的假设**。

| 用例 | 操作 | 期望 |
|---|---|---|
| V1 反向用例 | `CHATGPT_MODEL_CHAIN="GPT-9 不存在"` | **硬失败** `MODEL_UNAVAILABLE`，错误里带菜单 9 项原文；**不得**继续发送 |
| V2 歧义用例 | 链里只放 `GPT-6` | 选中项 `aria-checked` 文本必须 **全等** `GPT-6 Sol`（不是 Astra / Luna / 6.1） |
| V3 短标用例 | 目标 `GPT-6`，实际界面为 5.6 | 必须**真的执行切换**（菜单打开过），不得走快判返回 |
| V4 幂等用例 | 同一对话连发 3 条同档位 | 模型菜单只打开 **1 次**（后续走快判） |
| V5 目视核对 | 打印 `菜单原文列表` + `被选中项` | 人工能一眼核对，不靠"代码说成功" |
| V6 出图用例 | 一个含富组件的回答 | 统计到的图数 = 实际生成的图数，不含 UI 图标/图表 |

---

## 6. 回滚

- 模型侧：`CHATGPT_MODEL=GPT-5.6 Sol`（env 覆盖，无需改码）
- 严格模式：`MODEL_STRICT=0`（降级但写 `modelFallback` 标记）
- 匹配语义：`MODEL_MATCH=loose` 回退旧的双向包含（仅为应急，不建议长期启用）

---

## 7. 需要 Lance 拍板的三件事

| # | 问题 | 选项 | 我的建议 |
|---|---|---|---|
| **D1** | 主模型迁不迁 GPT-6 Sol？ | A 继续锁 5.6 Sol（稳，但随时可能被下架）<br>B 迁 GPT-6 Sol（跟主线，但 Intelligent UI 改 DOM，G5/G6 风险实装）<br>C 先修完 P0、用候选链"优先 5.6、缺失自动落 6 Sol" | **C**。候选链本身就是最稳的过渡形态，等 P1 把 G5/G6 扎完再决定要不要把 6 提到首位 |
| **D2** | 找不到模型时硬失败还是降级？ | A 硬失败（BLOCKED_NEEDS_HUMAN）<br>B 降级 + 写标记 | **A**。"静默产出劣质 listing"的代价远高于停一次 |
| **D3** | 要不要独立 Chrome 实例（:9224）？ | A 现在就拆<br>B 等 G7 阶段 | **B**，但先确认当前 :9223 里有没有装 ChatGPT 扩展（若装了，D3 升为 P0） |

---

## 8. 附：与框架 v1.0 的对齐

本方案的改动**全部落在 L2 能力层与 L3 编排层的接缝**，没有引入新的状态机（不新增第 7 套）：

- `MODEL_UNAVAILABLE` 直接映射到框架的一等状态 `BLOCKED_NEEDS_HUMAN`，天然接入 F3 统一 Gate；
- 候选链 + 严格模式本质是 **Capability 声明里的前置校验**，未来可注册进 `Capability Registry`（F2）作为 `precondition`；
- 未触碰 L1 事实层，不改 `metrics-store` / `product-facts` 的写入契约。

---

## 9. 协同归属与接缝（与 Codex 的边界）

本方案属于**双人协同开发**（WorkBuddy × Codex）框架下的一条工作流，受 `docs/coordination/2026-10-25-shared-contract.md` 约束。回执见 `docs/coordination/WORKBUDDY_ACK_2026-10-25.md`。

| 项 | 归属 | 说明 |
|---|---|---|
| `dist/src/chatgpt-adapter.js`、`dist/src/config.js` 的模型对齐层 | **WorkBuddy** | Codex 不入自己提交、不覆盖 |
| `server.js` / `public/*` | WorkBuddy 暂作整合人（合同 §4） | 本方案**不需要动**这几个文件——改动全在适配器与 config |
| F1 只读总账、面板 | WorkBuddy | 与本方案无耦合；本方案不动 `system-state.js` |
| W3 身份/会话、W4 写状态、W0–W9 可靠性 | Codex | 本方案的"硬失败"若要落成状态，需映射到 Codex 的 W4 或现有一等状态 `BLOCKED_NEEDS_HUMAN`，**不新建状态机** |

三条与本方案相关的协同约束：

1. **不另造第二套模型选择逻辑**。若 Codex 后续因 W5（资源锁/浏览器串行）改动浏览器会话控制，模型对齐必须仍是同一处 `ensureChatGptModelAndReasoning()`，不能各写一份。
2. **`MODEL_UNAVAILABLE` 的状态落地**：优先复用框架的 7 态（`BLOCKED_NEEDS_HUMAN`），失败原因进 `run-state.json`；若 W4 统一写状态落地，则改为写入 W4，不在两处双写。
3. **本方案实施前需用户明确授权**。合同 README 当前阶段为"方案阶段，不据旧任务授权新增开发"，故 §4 分期计划全部处于"待授权"状态。

### 与蓝图的接口

`docs/superpowers/specs/2026-10-25-ceo-agent-yikua-os-business-blueprint.md` 是总体业务蓝图（经营层），本方案是其**底下的一层技术适配**（L2 能力层的前置校验），两者不冲突：

- 蓝图 §9 讨论"对话↔OS 通道是否可靠"；本方案处理"通道内部用的模型是否真的是我指定的那个"。**前者不成立时，后者仍必须成立**——因为 Listing 产物质量不依赖是否有 CEO Agent，只依赖模型档位。
- 因此本方案可以**先于蓝图审定实施**（它保护的是现有功能正确性，不是新增业务能力）。

---

## 变更记录

- 2026-10-25 v1.0 首版（基于 ChatGPT 10 月变更 + 现有代码实测证据，未改代码）
- 2026-10-25 v1.1 补 §9 协同归属与接缝（纳入 WorkBuddy × Codex 协同框架，明确文件边界与"待授权"状态）
