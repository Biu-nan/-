# ae-product-design · 速卖通产品设计 Agent

给一个产品的参考图 + 资料，自动调研 Amazon / 速卖通同类竞品的视觉风格，产出
**6 张商品图（统一 1:1）+ 2 张平台营销图（1:1 白底 / 3:4 场景）** 与完整验收报告。

契约（唯一依据）：[`contract.md`](./contract.md)。本 README 只讲怎么跑、怎么改、怎么排查。

---

## 1. 快速开始

```bash
# 在项目根目录执行（必须，否则复用不到 dist/src 的 ChatGPT 适配器）
cd /f/yikuaborder-deploy

# ① 冒烟：不联网、不出图，验证输入/槽位/schema/文件链路
node agents/ae-product-design/src/cli.js \
  --product "agents/ae-product-design/fixtures/sample-product" --dry-run

# ② 真跑（会打开本机已登录的 ChatGPT，出 8 张图）
node agents/ae-product-design/src/cli.js \
  --product "已完成产品/xxx" \
  --keywords "makeup bag organizer" \
  --auto
```

前置条件：

1. 本机 Chrome 已用 `--remote-debugging-port=9223` 启动，且 **已登录 ChatGPT**（与工作台共用同一 profile）。
2. 套餐支持图像生成（`创建图片 / DALL·E` 工具在 composer 的 `[+]` 菜单里）。
3. 产品目录形如：

```
<产品目录>/
  产品图/                 # 1–8 张，视觉唯一真相
  product-facts.json      # 可选；没有则只靠图片 + 资料推断
  *.md                    # 可选产品资料
  design/                 # ← 本 Agent 产出，全部在这里
```

---

## 2. 三类图职责不同，所以标准不同

| 图类型 | 核心目标 | 主要考核 | 槽位 |
|---|---|---|---|
| 商品首图 | 吸引精准点击 | CTR + 后续转化 | P1 |
| 平台营销图（独立模块） | 争取搜索 / 推荐场景的有效点击 | 曝光效率 + CTR | MK1 · MK2 |
| 商品辅图 | 建立信任、激发欲望、消除购买障碍 | CVR + 退款退货表现 | P2–P6 |

**八个槽位（改 `config/image-slots.json` 即改产出）**

| 槽位 | 名称 | 模块 | 比例 / 尺寸 | 文字 | 回答买家的哪个疑问 |
|---|---|---|---|---|---|
| P1 | 视觉吸引图（首图） | 商品 | 1:1 / 1000×1000 | 禁 | 这是什么、值不值得点 |
| P2 | 使用场景图 | 商品 | 1:1 / 1000×1000 | 禁 | 我用起来是什么样 |
| P3 | 核心卖点图 | 商品 | 1:1 / 1000×1000 | ≤3 词 | 凭什么买 |
| P4 | 尺寸规格图 | 商品 | 1:1 / 1000×1000 | 数字/单位 | 到底多大 |
| P5 | 品质细节图 | 商品 | 1:1 / 1000×1000 | ≤3 词 | 做工值不值 |
| P6 | 购买确认图（可选） | 商品 | 1:1 / 1000×1000 | 清单 | 到手有什么、有什么限制 |
| MK1 | 白底营销图 | 营销 | 1:1 / 1000×1000 | 禁 | 平台算法能否清楚识别商品 |
| MK2 | 3:4 场景营销图 | 营销 | 3:4 / 1000×1334 | 禁 | 在竖版场景位是否吸引点击 |

技术基线（已按规范固化，代码强校验）：

- 商品图：统一 1:1、≥800×800、单张 ≤2MB、jpg/jpeg/png、无水印牛皮癣边框
- 营销图：1:1 白底 ≥800×800，3:4 场景 ≥750×1000，≤5MB，尽量无文字水印贴纸
- 某类目没有六张图的必要信息（如无配件、无款式差异）→ `--skip-slots P6`，**不要为凑数量重复图片**
- 部分分类（如运动鞋服）不支持营销图 → `--skip-slots MK1,MK2`

---

## 3. 一次运行发生了什么

```
S0 输入校验（确定性）     目录/图片可读/≤12MB
S1 事实装载 + 脱敏（确定性） 供应商/成本/采购价整键剔除，写 redacted[]
S1.5 本地视觉识别（Ollama） 识别 SKU/结构/主色/图上文字，按目标 SKU 反选 1–2 张参考图，不占云端配额
S2 双源调研（确定性）     CDP 打开速卖通 + Amazon 搜索页，按域名白名单抽图并下载留证
S3 风格聚类（模型）       2–3 套可复刻的视觉配方；必须同时适配商品六图与双营销图
── 风格闸门（O0）──       终端里选系列；--auto 或 --series 跳过
S4 storyboard（模型）     逐槽位脚本 + 3 条以上外观锚点（P6 可申请跳过）
S5 prompt pack（模型）    逐槽位英文 Prompt，按槽位写死 1:1 或 3:4 与目标尺寸
S6 逐张出图（工具）       每槽位新建对话 + 重传产品图，避免单会话堆图卡死
S6.5 占比校正（确定性）    纯白底图按 bbox 补白到 70%–85%（商品像素不缩放，可重复执行）
S7 验收                 比例/像素/体积确定性校验 + 视觉四项 + 首图 100 分与 160×160 缩略图
S8 报告（确定性）         design-report.json / qc-report.json / trace.jsonl
```

**没有 QC 通过的图不算交付**：`counts.qcPassed` 才是真实成绩，`delivered` 只代表文件落盘。

---

## 4. 首图 100 分模型（发布前代理验收）

| 维度 | 权重 | 最低占比 | 判据 |
|---|---|---|---|
| 产品识别度 | 25 | 72% | 160×160 缩略图下 1 秒内识别品类/外形/核心特征 |
| 视觉吸引力 | 20 | 60% | 色彩、质感、造型能否快速吸引目标消费者 |
| 差异化竞争力 | 20 | 60% | 与同屏竞品并排时是否有清晰购买理由 |
| 商品主体表现 | 15 | 60% | 主体突出、构图完整、无遮挡、不杂乱 |
| 真实性与信任感 | 10 | 70% | 颜色/材质/比例/数量真实，不误导 |
| 移动端适配 | 10 | 60% | 缩略图下卖点仍可识别 |

- 阈值 **80 分**（`heroScoring.threshold`），低于阈值直接判 fail 重出。
- 缩略图不是"让模型想象"，而是用 Pillow **真的生成 160×160** 再喂给视觉模型判定。
- 结构校验：分项之和必须等于总分，单项不得超过权重——防止模型乱打分。

## 5. 上线后：唯一经营结果 = 1000 × CTR × CVR

发布前的 100 分只是代理指标，真实考核必须回到经营结果，且在**同国家 / 同流量来源 / 同价格带**下与基线比较。

```bash
node agents/ae-product-design/src/cli.js --product "已完成产品/xxx" \
  --record-result '{"slotId":"P1","impressions":12000,"clicks":360,"orders":18,
                    "country":"US","trafficSource":"search","priceBand":"10-20",
                    "baseline":{"impressions":12000,"clicks":240,"orders":12}}'
```

结果写入 `design/benchmark.jsonl`，下次跑报告时 `design-report.json` 的 `benchmark.slots` 会带出
`ordersPer1000Exposures` 与 `deltaVsBaseline`。**只提 CTR 掉了 CVR 不算赢**——这个指标会把两者一起算进去。

---

## 6. 产出在哪

```
<产品目录>/design/
  style-refs/{aliexpress,amazon}/  竞品参考图（本地留证，不进任何上传链路）
  style-dossier.json               风格系列（可 --reuse-dossier 复用）
  storyboard.json                  8 槽位脚本（v2.0）
  prompt-pack.json                 8 条英文 Prompt（按槽位写死比例尺寸）
  images/P1..P6,MK1,MK2.jpg        成图（只放 QC 通过的）
  rejected/                        未通过草稿，隔离存放
  thumbs/P1_160.jpg                首图缩略图（移动端可识别性证据）
  qc-report.json                   逐图验收（含 100 分明细）
  benchmark.jsonl                  上线真实数据（--record-result 写入）
  design-report.json               权威汇总（先看这个）
  run-state.json                   断点续跑状态
  trace.jsonl                      OTel-GenAI 事件流（只追加）
```

`status`：`completed`（全部过 QC）· `partial`（部分失败，可 `--resume`）· `escalated`（需人处理）。

---

## 7. 常用参数

| 参数 | 用途 |
|---|---|
| `--keywords "a,b"` | facts 里没有英文时手动给检索词（**最常需要**） |
| `--style-refs <dir>` | 跳过联网，直接用你给的参考图做风格聚类 |
| `--series <id>` | 直接选风格系列，跳过交互闸门 |
| `--auto` | 无人值守（放行推荐系列） |
| `--skip-slots "P6,MK2"` | 跳过不需要的槽位（不凑数） |
| `--resume` | 崩溃/中断后从 `run-state.json` 续跑 |
| `--reuse-dossier` | 同品类复用上次风格结论 |
| `--no-vision-qc` | 只跑比例/尺寸，视觉项标 `unverified` |
| `--allow-research-fallback` | 双源抓取全失败时用内置风格库 |
| `--dry-run` | 只到 prompt-pack，不联网不出图 |
| `--record-result '<json>'` | 回填上线曝光/点击/订单，算 1000×CTR×CVR |
| `--trace-content` | trace 里落完整 prompt（默认只落哈希） |

---

## 8. 已知限制（实话）

1. **速度**：8 张图单次约 20–35 分钟，瓶颈是 ChatGPT 网页端出图，不是代码。
2. **抓取稳定性**：Amazon 反爬较强，可能只成功速卖通单源；`styleSource` 会如实写 `aliexpress`。全失败时用 `--style-refs` 手工兜底。
3. **3:4 是模型的弱项**：方形惯性很强，MK2 可能被出成方形；尺寸校验会拦截并重出，但会消耗尝试次数。
4. **图片体积**：复用现有保存链路，成图被压到 ≤200KB。含文字的信息图（P4/P6）若嫌糊，需要把压缩阈值参数化。
5. **保真上限**：模型仍可能画"像但不一样"。靠 S7 视觉 QC + 重出兜底，不是靠 prompt 保证。**P1 请人工过一眼再上架**。
5.1 **占比是补出来的，不是画出来的**：模型对 1:1 白底图有撑满画面惯性（实测 88%/93%）。S6.5 用 bbox 补白拉回区间，所以白底图四周留白是"补"的，商品本身像素未缩放。场景图不补白。
6. **100 分不是 CTR**：它是发布前的代理指标，不能替代真实 `1000×CTR×CVR`。指标掉头时优先看 CTR 与 CVR 哪个掉了。
7. **不自动上架**：只产图，不碰店小秘。上架仍走 `batch-listing-create`。

---

## 9. 排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `E_IMAGE_TOOL_UNAVAILABLE` | ChatGPT 没切到「创建图片」 | 手动点 `[+]` → 创建图片，再 `--resume` |
| `E_MODEL_UNAVAILABLE` | 掉登录 / 人机验证 | 浏览器手动过验证后 `--resume` |
| `E_APPROVAL_REQUIRED` | 非交互环境卡在风格闸门 | 加 `--series <id>` 或 `--auto`，带 `--resume` 重跑 |
| `E_RESEARCH_EMPTY` | 双源都抓不到图 | 换 `--keywords`，或 `--style-refs` |
| `E_SCHEMA_INVALID` | 模型输出不合规（自动重问 1 次仍失败） | 看 `trace.jsonl` 最后一次 `llm.called` 的 `validation` |
| 某槽位 `qc.verdict=fail` | 保真漂移 / 加了文字 / 比例不对 / 首图分数不够 | 看 `qc.reason`；修 `config/image-slots.json` 后 `--resume` 只重跑该槽位 |
| 某槽位 `qc.verdict=skipped` 且 reason 提到 product-facts | 缺尺寸/款式/配件数据，守卫拒绝编造 | 补齐 `product-facts.json` 的 `variants` 后重跑 |
| 某槽位 `qc.source=local-vl` | 云端 QC 因附件配额不可用，改本地视觉模型兜底（只覆盖 SKU/镜头/文字） | 配额恢复后重跑以获得完整云端判定 |
| MK2 反复 fail | 出成方形，3:4 校验拦住 | 正常拦截；可先 `--skip-slots MK2` 交货，竖版另跑 |

---

## 10. 目录

```
agents/_shared/        errors / trace / state / permissions / schemas
agents/ae-product-design/
  contract.md          17 节契约（v2.0）
  config/              image-slots.json（8 槽位 + 3 类规格 + 首图评分）· style-library.json
  prompts/             01 风格聚类 · 02 storyboard · 03 prompt pack · 04 vision QC + 100 分
  src/                 cli · runner · inputs · style-research · planning · model · generate · qc
                       image-info（比例） · image-tools（缩略图） · benchmark（1000×CTR×CVR）
  fixtures/            sample-product（冒烟）· empty-product（F-01 守卫用例）
  evals/cases.json     golden + failure-mode + regression
```
