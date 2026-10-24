# Prompt · 引用一跨而境核心代码并融合到你的板块

> 用法：整段粘贴给那个本地 Agent（做图片翻译 / 产品信息总结的那个）。
> 2026-09-12 ｜ 覆盖：Listing 生成 + 箱包配件店小秘上品 两个能力。

---

你要在自己的流水线里新增两个能力模块，代码**从一跨而境已抽好的可移植内核引用并改造**，不要从零写，也不要依赖一跨而境的 3000 服务。

## 一、引用清单（按路径读，不要猜）

| 文件 | 作用 | 重点看 |
|---|---|---|
| `F:\yikuaborder-deploy\tools\seo_core_kernel.mjs` | Listing 生成内核（仅 SEO 与商品文案） | 全文；重点是 `step()` 的指纹复用、`waitReply()` 的完成判定、`sendPrompt()` 的落字校验 |
| `F:\yikuaborder-deploy\核心运行代码_可移植内核_v1.md` | 上面那个内核的机制讲解 | §2 五个机制、§5 融合建议、§6 坑清单 |
| `F:\yikuaborder-deploy\tools\dianxiaomi_core_kernel.mjs` | 店小秘上品内核（箱包配件 xiangBao） | 全文；重点是 `referenceProduct()` 与 `fillFromFacts` 顺序、`applyAttribute()` 双通道定位 |
| `F:\yikuaborder-deploy\箱包配件_店小秘自动化上品_完整执行方案_v1.md` | 上品方案与常量 | §1 常量卡、§4 执行顺序、§5 facts 契约、§7 坑清单 |

需要更多细节时再去读一跨而境的原始实现（只读，不改、不启动它的服务）：
`dist/src/chatgpt-adapter.js`（`sendPromptOnce` 699 / `waitForResponseAfterPrompt` 965）、
`dist/src/dianxiaomi-adapter.js`（`fillFromFacts` 1782 / `fillAiSections` 1689 / `referenceProduct` 455）、
`dist/src/config.js`（`xiangBao` profile 239）、`prompts/03_SEO_KEYWORDS_PROMPT.md`、`prompts/04_LISTING_CONTENT_PROMPT.md`。

## 二、融合目标

在你现有流水线（图片翻译 → 产品信息总结）之后接两段：

1. **Listing 生成**：产出英文 SEO 关键词库 + 标题/属性词/详情页 → `03_SEO_KEYWORDS.md`、`04_LISTING_CONTENT.md`
2. **店小秘上品（箱包配件）**：把产品信息组装成 facts JSON，自动填店小秘速卖通半托管创建页 → **只保存草稿**

## 三、融合步骤

1. 把两个 `.mjs` 拷进你的项目，改成你的模块命名与日志规范；只依赖 `playwright-core`，用你自己的 `run.bat` 环境跑。
2. **输入映射**：你的「产品信息总结」→ 生成内核的 `--notes`（≤2000 字，无图时这是唯一事实源）；品名 → `--name`；类目 → `--category`；原图 → `--images`。
3. **facts 组装**：按方案 §5 的 JSON 契约，把你的总结映射成 `title/mainKeyword/brand/material/type/origin/description/compliance`。图片看不出的字段填 `null`，**禁止编造**。
4. **产物落位**：用 `--out` 直接指向你自己的 `output/产品/<目录>/`；上品产物只保存草稿，记录草稿 URL。
5. **接进你的异常核对与交接机制**：失败/超时写入核对清单，沿用你「只记录、不改 OCR 事实、不动 input」的原则，不中断主流程。
6. **补你的回归测试**：至少覆盖 facts 组装映射、fingerprint 复用（重跑不重复生成）、上品顺序（模板在第 0 步）、保存草稿不发布。

## 四、不可违反的约束

1. **不依赖、不启动、不调用一跨而境的 3000 服务** —— 两个内核都是独立进程 + CDP，互不干扰，也不占工作台的单实例任务。
2. **上品顺序不能变**：引用产品模板必须是第 0 步，否则后面填的值会被模板整体冲掉。
3. **箱包常量照抄**：模板 `1005012741652735`、店铺「自营箱包全托2店」、备货「国内履约」（不是「国内备货」）、海关税率代码 `8308909000` 种类「其他」、物流「普货」、包装尺寸缺省 15/10/5 cm。
4. **默认只保存草稿，不发布** —— 发布是人工闸门，你不许替他点。
5. **保留 fingerprint 机制**：每个 prompt 首行的唯一标记用于幂等与断点续跑，改了它重跑就会重复烧额度。
6. **串行，不并发**：一个 Chrome、一个对话、一次一个产品；跨步骤前等上一轮 stop 按钮消失。
7. **采集箱模式沿用源变种**，不要用 facts 去勾选/取消颜色尺寸。
8. **变种板块人工填**，你不生成 SKU。

## 五、交付与验收

改完请给我：
1. 新增/改动的文件清单；
2. 你的回归测试结果（沿用你原有的测试体系，全部通过）；
3. **一个真实箱包产品跑通的证据**：03/04 文件路径 + 店小秘草稿 URL + 保存结果日志；
4. 已知未覆盖项与 `[需实测校准]` 选择器的实测结论（保存按钮文案、CKEditor、上传控件、引用面板搜索框）。

跑通之前不要宣称完成。若 Chrome CDP `:9223` 未开或登录态失效，直接跳过这两个步骤并记入核对清单，不要尝试启动一跨而境的服务或浏览器。
