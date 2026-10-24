# SOP · 仅生产 SEO 与商品文案（`seo_content_only`）

> 版本：v1 ｜ 生成时间：2026-09-10
> 依据：`F:\yikuaborder-deploy` 当前代码逐行核对（`automation-service.js` / `batch-listing-create.js` / `product-session.js` / `dianxiaomi-facts.js` / `prompts/03、04`）
> 适用：只要**关键词词库 + 标题/属性词/详情页文案**，不要 AI 作图、不要主图。

---

## 0. 这个模式到底做什么（代码定义）

开关是 `standardWorkflowGoal = "seo_content_only"`。它的行为差异（非推测，代码分支）：

| 环节 | 完整 Listing (`full_listing`) | **仅 SEO 与文案** |
|---|---|---|
| 产品图 | 必须有，空图直接报错 | **可以没有图**（`automation-service.js:499` 只对非 seoOnly 报「产品图为空」） |
| 视觉规划 + AI 生图 | 走（10 张图） | **完全跳过**（MVP1 后不再进 planning / images） |
| 市场调研 | 走 | 单品模式走；**批量模式强制跳过**（`skipResearch:true`） |
| product-facts.json | AI 桥接生成 | 批量模式**不生成**，归档时用本地兜底补（见 §7.3） |
| 最终产物 | 03 + 04 + 10 张图 | **只有 03 + 04 两份 Markdown** |
| 完成判据 | `completedPhase === "MVP5"`（含图） | `stage==="COMPLETED" && completedPhase==="MVP5"`（无图也可达） |

一句话：**3 次 ChatGPT 对话（事实 → SEO → 文案），落 2 个 md 文件。**

---

## 1. 前置检查（每次开跑前，逐项打勾）

| # | 检查项 | 命令 / 位置 | 不通过后果 |
|---|---|---|---|
| 1 | Chrome 已带调试端口启动 | `chrome.exe --remote-debugging-port=9223 --user-data-dir=F:\yikuaborder-deploy\.chrome-profile` | 首行即 `ECONNREFUSED 127.0.0.1:9223` |
| 2 | CDP 探活 | `curl http://127.0.0.1:9223/json/version` | 同上 |
| 3 | ChatGPT 已登录且输入框可用 | 浏览器里打开 chatgpt.com 看一眼 | 报「ChatGPT 未登录或输入框不可用」 |
| 4 | 工作台在跑 | `curl http://127.0.0.1:3000/api/status`（当前：✅ 200） | 接口全 404 |
| 5 | 队列未锁 | `/api/status` 里 `running` 为 false | 上传/开跑被 409 拒 |
| 6 | 店小秘登录态 | 需要上架时才查 | 上架阶段失败 |

> 当前实测（2026-09-10 11:00）：工作台 3000 ✅，**CDP 9223 未开** → 先开 Chrome 再跑。

---

## 2. 跑法 A：批量（推荐，xlsx 驱动）

### 2.1 准备 input.xlsx

必需列与可选列（`batch-listing-create.js: parseRows()`）：

| 列名（任一写法） | 必填 | 本模式下的作用 |
|---|---|---|
| `productName` / 产品名 | ✅ | 必填，空行自动跳过 |
| `mode` / 模式 | 建议显式填 | 填 `seo_content_only`（也认 `seo`、`仅seo`、`seo文案`、`仅 seo 与商品文案`） |
| `category` / 商品类目 | 建议填 | 防类目靠猜，直接进 AI 输入 |
| `notes` / 备注 | **无图时强烈建议填** | 见 §6.1，直接决定事实底稿质量 |
| `imageUrls` / 图片链接 或 `imageUrl1..N` | 可选 | **本模式可留空**；填了会导入并上传给 ChatGPT |
| `localImages` / 本地图片 或 `localImage1..N` | 可选 | 本机绝对路径，分号/逗号分隔多张 |

硬限制（代码常量）：**≤50 行**、**每行 ≤20 张图**、`mode` 留空默认 `full_listing`（会去生图！所以务必显式填 `seo_content_only`）。

最小可用示例（无图纯文本）：

| productName | mode | category | notes |
|---|---|---|---|
| 硅胶隐形乳贴 | seo_content_only | 女士内衣配件 | 材质医用硅胶，直径 8cm，肤色，可水洗重复使用 20 次，2 对装 |

### 2.2 上传 → 开跑 → 监控 → 取结果

```bash
# ① 上传（返回 jobId）
curl -F "workbook=@F:/path/input.xlsx" \
  http://127.0.0.1:3000/api/batch-listing-create/upload

# ② 开跑（本模式一般不要开 autoUpload）
curl -X POST http://127.0.0.1:3000/api/batch-listing-create/start \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<jobId>","autoUpload":false,"categoryOverrides":{}}'

# ③ 监控（看每行的 currentStage / message / progress）
curl http://127.0.0.1:3000/api/batch-listing-create/status

# ④ 取结果（原 xlsx 追加 status / outputDirectory / artifacts 三列）
curl -o result.xlsx http://127.0.0.1:3000/api/batch-listing-create/download
```

### 2.3 批量模式的三个强制行为（必须知道）

1. **`skipResearch: true`** —— 不注入市场调研报告，且**不打开 ChatGPT 联网搜索开关**（代码注释：避免联网卡死整批）。
   后果：SEO 词库不联网验证，靠模型自身知识 + 你填的 notes。
2. **`skipProductFacts: true`** —— 不调 AI 整理 `product-facts.json`。
   归档时用 `buildProductFactsFallback` 本地兜底生成，**只保证标题/详情页/主图三项齐全，颜色/尺寸/价格留空**，`meta.source = "local_fallback"`。
   后果：**可直接进店小秘上架，但颜色/尺寸/价格需人工补**（或依赖店小秘端 autofix）。
3. **单行硬超时 30 分钟**（`ROW_TIMEOUT_MS`）—— 超时该行判 failed，不阻塞下一行。

---

## 3. 跑法 B：单品（UI 或 API）

### 3.1 UI 路径（http://127.0.0.1:3000）

1. 点「**仅 SEO 与商品文案**」按钮（`public/index.html:95`，`data-goal=seo_content_only`）。
2. 导入产品图（可选；本模式允许不选图）。
3. 填客观信息（产品名 / 类目 / 补充信息）。
4. `POST /api/run` → 完成 MVP1 事实底稿。
5. 单品模式下**默认走市场调研**（`skipResearch:false`），会开 ChatGPT 联网搜索；想跳过就在跑之前确认状态。
6. `POST /api/run/seo-listing` → 生成 03 + 04。
7. 中途断了用 `POST /api/run/resume` 从断点续跑。

### 3.2 API 等价命令

```bash
# ① 设定目标
curl -X PUT http://127.0.0.1:3000/api/standard-workflow-goal \
  -H "Content-Type: application/json" -d '{"goal":"seo_content_only"}'

# ② MVP1 产品事实
curl -X POST http://127.0.0.1:3000/api/run

# ③ SEO 词库 + Listing 文案
curl -X POST http://127.0.0.1:3000/api/run/seo-listing

# 断点续跑
curl -X POST http://127.0.0.1:3000/api/run/resume

# 随时看状态
curl http://127.0.0.1:3000/api/status
```

> 单品模式**不会**跳过 `product-facts.json`：MVP5 后会调一次 AI 桥接整理 facts（失败非致命，会退回本地兜底）。所以**要上架的单品走跑法 B，质量比跑法 A 好**。

---

## 4. 内部流水线（阶段 → 在干嘛）

| 阶段 | 动作 | 本模式是否经过 |
|---|---|---|
| `VALIDATING_INPUT` | 校验输入 | ✅ |
| `CREATING_CHAT` | 新建 ChatGPT 对话（无图时提示「seo_content_only 模式跳过图片」） | ✅ |
| `UPLOADING_IMAGES` | 上传产品图（有图才有） | 有图才走 |
| `SENDING_PROMPT` → `WAITING_FOR_RESPONSE` | **① 产品事实提取**（MVP1） | ✅ |
| `SENDING_RESEARCH` → `WAITING_FOR_RESEARCH` | 联网市场调研 | 单品走；批量跳过 |
| `SENDING_SEO_KEYWORDS` → `WAITING_FOR_SEO_KEYWORDS` | **② SEO 词库**（prompt 03） | ✅ |
| `SENDING_LISTING_CONTENT` → `WAITING_FOR_LISTING_CONTENT` | **③ 标题/属性词/详情页**（prompt 04） | ✅ |
| `SAVING_LISTING_CONTENT` | 写盘 03 + 04 | ✅ |
| `COMPLETED` (`MVP5`) | 完成 | ✅ |
| `SENDING_PLANNING` / `GENERATING_IMAGES` / `DOWNLOADING_IMAGE` | 视觉规划 + 生图 | ❌ 跳过 |

异常态：`READY_FOR_LOGIN`（未登录）、`PAUSED`（人工暂停，可续）、`RECOVERING_RESPONSE`（ChatGPT 空回，自动追加一次续写指令，再失败交人工）。

---

## 5. 产物清单

当前产品目录 `当前产品/`，完成后归档到 `已完成产品/<产品名>/`：

```
output/03_SEO_KEYWORDS.md      # 关键词词库
output/04_LISTING_CONTENT.md   # 标题 + 属性词 + 详情页
product-profile.json
run-state.json                 # 断点续跑状态
product-facts.json             # 单品模式=AI 整理；批量模式=本地兜底（local_fallback）
产品图/                        # 有图才有
```

**03 SEO 词库应含**（`prompts/03`）：核心大词 / 精准长尾词 / 场景与痛点词 / 核心否定词（每类 ≥8 个）+ Recommended Primary Keyword、Secondary、High-Intent Cluster、Seasonal Cluster、Negative Strategy、Keyword Risks。

**04 文案应含**（`prompts/04`）：Step 0 数据解析 → Step 1 流量词与属性映射 → Step 2 VOC 洞察 → Step 3 交付（3.1 算法标题 Clean Title / 3.2 AEO 结构化五点 / 3.3 商品详情页）。

---

## 6. 质量保障（这部分决定成败）

### 6.1 无图时，notes 就是事实底稿

本模式允许不给图，此时 MVP1「产品事实」只能来自 `产品名 + 类目 + 补充信息`。**notes 写得越具体，03/04 越准**。模板：

```
材质：医用硅胶；尺寸：直径 8cm；颜色：肤色/黑色；数量：2 对装；
用途：婚纱/礼服/日常无肩带；卖点：可水洗重复使用 20 次、防汗、隐形无痕；
禁忌：不写医疗功效；目标市场：美国
```

### 6.2 验收清单（出稿后逐项过）

- [ ] `03` 四类词每类 ≥8 个，且都是英文、与商品相关
- [ ] `03` 里没有把没确认的材质/尺寸硬写成事实（应标「待人工确认」）
- [ ] `04` 的 Clean Title 长度合理、无堆砌、无竞品品牌词
- [ ] `04` 的 3.2 五点覆盖材质/尺寸/场景/痛点
- [ ] 详情页没有编造认证、销量、专利
- [ ] 如果要上架：检查 `product-facts.json` 的 `meta.source` —— `local_fallback` 意味着颜色/尺寸/价格为空，需人工补

---

## 7. 已知约束与坑

| 坑 | 表现 | 处理 |
|---|---|---|
| `mode` 留空 | 默认 `full_listing` → 跑生图，慢且风险高 | 显式填 `seo_content_only` |
| 批量不联网 | SEO 词库无实时搜索量验证 | 接受降级；要联网就走单品模式 |
| 批量 facts 降级 | `product-facts.json` 为 `local_fallback`，颜色/尺寸/价格空 | 上架前人工补，或改用单品模式跑 |
| 单行 30 分钟 | 超时 failed | 用 `/retry` 重跑该行；反复超时的行拆出来单品跑 |
| Chrome 掉线 | `ECONNREFUSED 9223` | 重开 Chrome → `/retry` |
| ChatGPT 未输出 | 进入 `RECOVERING_RESPONSE` 自动续写一次 | 再失败就人工在网页上手动继续 |
| 队列锁 | 上传/开跑返回 409 | 等 `running:false`，或 `/api/task/pause` 后重试 |

---

## 8. 最小执行卡片（复制即用）

```bash
# 0) 开 Chrome（登录 ChatGPT），保持不关
#    chrome.exe --remote-debugging-port=9223 --user-data-dir=F:\yikuaborder-deploy\.chrome-profile

# 1) 探活
curl -s -o /dev/null -w "server:%{http_code}\n" http://127.0.0.1:3000/api/status
curl -s -o /dev/null -w "cdp:%{http_code}\n"    http://127.0.0.1:9223/json/version

# 2) 先拿 3 行试水（mode 必须显式写 seo_content_only）
curl -F "workbook=@F:/path/input.xlsx" http://127.0.0.1:3000/api/batch-listing-create/upload

# 3) 开跑
curl -X POST http://127.0.0.1:3000/api/batch-listing-create/start \
  -H "Content-Type: application/json" -d '{"autoUpload":false}'

# 4) 看进度 / 取结果
curl http://127.0.0.1:3000/api/batch-listing-create/status
curl -o result.xlsx http://127.0.0.1:3000/api/batch-listing-create/download
```
