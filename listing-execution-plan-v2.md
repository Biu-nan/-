# 一跨而境 · Listing 自动化生成完整执行方案 v2

> 生成时间：2026-09-10
> 依据：`F:\yikuaborder-deploy` 真实代码 + 运行态实测（非推测）。每条结论标注证据来源。
> 取代 2026-08-15 的 `listing-execution-plan.md`（v1）。

---

## 0. 结论先行

1. **真正跑通的主链只有一条**：批量制作（BLC）→ 店小秘上架。证据：`已完成产品/` 154 个成品包、`data/batch-listing-create/` 50 个批次（最后活跃 8/31）。
2. **生成引擎是 ChatGPT 网页桥接（CDP :9223），不是 API**。Chrome 不在，整条链归零——这是单点依赖，也是当前第一阻塞项。
3. **当前最大风险不是功能，是版本**：自 v1.6.46（8/3）起有 23 个文件 +2961/-505 行改动**未提交**，跑的是"无版本号工作副本"，`package.json` 仍写 1.0.0。
4. 收敛方向：五条链路 → 一条主链 + 品类 profile 插件。详见 §9。

---

## 1. 运行态体检（2026-09-10 实测）

| 项 | 状态 | 说明 |
|---|---|---|
| 工作台 `:3000` | ✅ 200 | `node dist/src/server.js` 在跑 |
| Chrome CDP `:9223` | ❌ 未开 | **跑任何生成前必须先开** |
| 操作员实例 `:3001` | 未起 | 单人作业不需要 |
| 最后 release | v1.6.46（8/3） | 之后改动全部未提交 |

```bash
# 体检三连
curl -s -o /dev/null -w "server:%{http_code}\n" http://127.0.0.1:3000/api/status
curl -s -o /dev/null -w "cdp:%{http_code}\n" http://127.0.0.1:9223/json/version
```

---

## 2. 五条链路盘点（选型矩阵）

| 链路 | 入口 | 状态 | 适用场景 |
|---|---|---|---|
| **批量制作 BLC**（主推） | `POST /api/batch-listing-create/*` | ✅ 生产可用 | 一批 xlsx 产品，出 listing 草稿 |
| 店小秘上架 | `/api/dianxiaomi/*`（引用 / 采集箱两条路径） | ✅ 生产可用 | 草稿 → 待发布 → 上架 |
| 单品对话式 | `listing-agent/cli.mjs` | ⚠️ 8/14 后未更新 | 单张图快速出草稿 |
| 包挂 charm | `/api/charm/*` + sqlite workspace | ⚠️ 专用，8/19 活跃 | 包挂品类专用工作台 |
| 内胆 insert | `/api/insert/*`（含 stock-sheet / market-radar） | ⚠️ 专用 | 奢侈包内胆 |

> 批量与单品不要混用：批量走 BLC，单品走 `listing-agent`。清单：`dist/src/batch-listing-create.js`、`dist/src/dianxiaomi-adapter.js`。

---

## 3. 标准 SOP（主链 · 批量）

### 3.0 前置（每次必做）

1. 启动 Chrome 并带调试端口，登录 ChatGPT + 店小秘：
   `chrome.exe --remote-debugging-port=9223 --user-data-dir=F:\yikuaborder-deploy\.chrome-profile`
2. 工作台在跑：`node dist/src/server.js`（PORT 3000）。
3. CDP 探活通过再往下走。

### 3.1 准备 input.xlsx（列规范）

| 列名（任一写法） | 必填 | 说明 |
|---|---|---|
| `productName` / 产品名 | ✅ | 空行自动跳过 |
| `mode` / 模式 | | `seo_content_only`（只出文案，快）｜`full_listing`（含 AI 生图）。**默认 full_listing** |
| `category` / 商品类目 | | 类目透传，避免靠猜 |
| `notes` / 备注 | | 给 AI 的补充说明 |
| `imageUrls` / 图片链接 | 二选一 | 逗号/分号/换行分隔，或 `imageUrl1..N` 分列 |
| `localImages` / 本地图片 | 二选一 | 本地绝对路径，或 `localImage1..N` 分列 |

硬限制（代码常量）：**最多 50 行**、**每行最多 20 张图**、URL 分块下载 `URL_CHUNK_SIZE=12`。
来源：`dist/src/batch-listing-create.js` 的 `parseRows()`、`MAX_ROWS/MAX_URLS_PER_ROW`。

### 3.2 上传

```bash
curl -F "workbook=@F:/path/input.xlsx" http://127.0.0.1:3000/api/batch-listing-create/upload
```

### 3.3 开跑

```bash
curl -X POST http://127.0.0.1:3000/api/batch-listing-create/start \
  -H "Content-Type: application/json" \
  -d '{"jobId":"<上一步返回>","autoUpload":false,"categoryOverrides":{}}'
```

- `autoUpload:true` = 出草稿后**自动串行跑引用 + 采集箱上架**（后果性操作，默认 false）。
- `categoryOverrides` = 逐行强制类目，防误判。

### 3.4 监控

```bash
curl http://127.0.0.1:3000/api/batch-listing-create/status
# 或看 UI：http://127.0.0.1:3000
```

### 3.5 取结果

```bash
curl -O http://127.0.0.1:3000/api/batch-listing-create/download
```

落盘结构（`当前产品/<包名>/`，完成后归档 `已完成产品/<包名>/`）：

```
product-facts.json     # AI 提取的商品事实（后续一切的输入）
product-profile.json   # profile / 类目
run-state.json         # 断点续跑
产品图/                 # 源图
output/                # listing 文案、图
```

### 3.6 上架（店小秘，两条路径）

| `uploadMode` | 路径 | 适用 |
|---|---|---|
| `reference` / `yinyong` / `引用` | 引用已有模板产品，覆盖标题/描述/材质/型号/图 | 有同品类模板，字段最稳 |
| `collect` | 采集箱批量编辑 → 加备注「待上架」→ 移入待发布 | 采集箱里已有草稿 |

关键 API：`/api/dianxiaomi/reference-apply`、`/api/dianxiaomi/collect-batch-apply|generate|status|retry`、`/api/dianxiaomi/batch-retry`。

### 3.7 失败重试

```bash
curl -X POST http://127.0.0.1:3000/api/batch-listing-create/retry \
  -H "Content-Type: application/json" -d '{"jobId":"<jobId>"}'
```

常见失败原因（历史实测）：`connect ECONNREFUSED 127.0.0.1:9223`（Chrome 掉线）、`缺少 product-facts.json`（上游没跑完）。

---

## 4. 生成引擎内部（单品流水线阶段）

`dist/src/automation-service.js`，每个阶段可 PAUSED / 断点续跑：

```
VALIDATING_INPUT → CREATING_CHAT → UPLOADING_IMAGES
→ SENDING_PROMPT → WAITING_FOR_RESPONSE        # ① 商品事实提取 → product-facts.json
→ SENDING_RESEARCH → WAITING_FOR_RESEARCH      # ② 市场/竞品研究
→ SENDING_SEO_KEYWORDS → WAITING_FOR_SEO_KEYWORDS  # ③ SEO 关键词
→ SENDING_LISTING_CONTENT → WAITING_FOR_LISTING_CONTENT → SAVING_LISTING_CONTENT  # ④ 标题+详情
   ── seo_content_only 到此结束 ──
→ SENDING_PLANNING → WAITING_FOR_PLANNING      # ⑤ 视觉规划（02B 批量版）
→ VALIDATING_PROMPT_PACK → GENERATING_IMAGES → DOWNLOADING_IMAGE  # ⑥ AI 生图
→ COMPLETED
```

异常态：`READY_FOR_LOGIN`（ChatGPT 未登录）、`PAUSED`（人工暂停/中断）、`BUILDING_PRODUCT_FACTS`。

Prompt 资产：`prompts/` 00 包袋识别、01 研究、02 视觉规划、**02B 批量视觉规划（新增）**、03 SEO、04 Listing 文案、05 奢侈内胆、06 市场雷达、07 内胆文案、08 选品、10 爆品拆解、11 包挂图、12 包挂文案。

**模式选择建议**：只要文案 → `seo_content_only`（分钟级、无生图风险）；要主图 → `full_listing`（十几分钟级，有人机验证/限流风险，必须分批）。

---

## 5. 单品链路（少量图、快速验证）

```bash
cd /f/yikuaborder-deploy            # 必须在根目录，cwd 错位会 ENOENT
node listing-agent/cli.mjs validate --images "F:/abs/图.png" --profile generic  # 秒级体检
node listing-agent/cli.mjs preview  --images "F:/abs/图.png" --profile generic --name "包名"
node listing-agent/cli.mjs run      --images "F:/abs/图.png" --profile generic --publish true --target-store "smtChoice:店铺A"
```

- 默认 listing-only 不生图；`--mode full` 才调 ChatGPT 生图。
- `--publish true` 是后果性操作，执行前二次确认。

---

## 6. 品类 profile 与纠偏铁律

`profileKey`：`ruTie`（乳贴）｜`xiangBao`（箱包内胆/收纳）｜`bagCharm`（包挂）｜`xiangBaoFold`（折叠箱包）｜`generic`（其他）。

1. **绝不依赖 auto**：批次里显式给 `category` + `categoryOverrides`。
2. **ERP 类目与图片事实冲突时，以图片事实为准**（历史坑：肥皂捏捏乐被 ERP 填成「箱包配件」，应强制 `generic`）。
3. `generic` 不套乳贴必填规范，避免误报缺项。

---

## 7. 人工闸门（不可跳过）

| 闸门 | 时机 | 检查什么 |
|---|---|---|
| G1 类目闸门 | 跑批前 | profile / 类目是否与图片一致 |
| G2 草稿闸门 | 出草稿后、上架前 | `product-facts.json` 字段、标题/详情、主图 |
| G3 上架闸门 | `--publish` / `autoUpload` 前 | 目标店铺 + 类目 + 草稿已看过，二次确认 |

---

## 8. 已知坑与遗留（按优先级）

| 级别 | 项 | 现状 | 应对 |
|---|---|---|---|
| P0 | **版本未固化** | v1.6.46 后 23 文件 +2961 行未提交 | 先打 release commit + 同步 package.json 版本 |
| P0 | **Chrome CDP 单点** | 掉线即整批失败（ECONNREFUSED） | 跑前探活；长批次监控心跳 |
| P0 | 乳贴上架三缺口 | Step2 主图写回 / Step3 B 区属性覆盖 / Step4 SKU 组合表 **未修** | 乳贴上架前先确认，否则主图/SKU 必缺 |
| P1 | 长英文标题定位 | 采集箱搜索搜不到完整长标题 | 已加拆词 fallback + `_findFirstRowByScore`（v1.6.42/43） |
| P1 | 跨行 stop-button 残留 | 批量时上一行未生成完 → 下一行 60s 超时 | 已修：waitForSendReady 180s（v1.6.46） |
| P1 | 弹窗残留挡点击 | modal/drawer 残留 | 已修：`_dismissAllOverlays`（v1.6.41） |
| P2 | 品牌边界 | 乳贴无独立 brand 输入框 | 记录待确认，不强行填 |

---

## 9. 收敛路线（下一步建议）

1. **P0-1 版本固化**：打 `v1.7.0` release commit，把 8/3 以来的改动纳入版本，可回滚、可对照。
2. **P0-2 入口收敛**：UI 与文档只暴露一条主链（BLC + 店小秘），charm / insert / listing-agent 降级为品类插件，不在主界面并列。
3. **P1-1 品类插件化**：把 `profileKey` 对应的必填字段规范（现散落在「乳贴必填字段规范 v1」等文档）落成 `schemas/` 里的机器可读配置，由引擎自动套用，而不是靠人记。
4. **P1-2 补乳贴三缺口**（Step2/3/4），否则乳贴品类无法闭环。
5. **P2 引擎解耦**：ChatGPT 网页桥接是最大不确定性，中期评估接 API 或多引擎兜底（代码里已有 `ai-adapter` / `gemini-adapter` 骨架）。

---

## 附：最小可执行起点（现在就能跑）

```bash
# 1) 开 Chrome（登录 ChatGPT + 店小秘），保持不关
#    chrome.exe --remote-debugging-port=9223

# 2) 探活
curl -s -o /dev/null -w "server:%{http_code}\n" http://127.0.0.1:3000/api/status
curl -s -o /dev/null -w "cdp:%{http_code}\n"    http://127.0.0.1:9223/json/version

# 3) 小批量试水：先做 3 行、mode=seo_content_only
curl -F "workbook=@F:/path/input.xlsx" http://127.0.0.1:3000/api/batch-listing-create/upload

# 4) 开跑（先不自动上架）
curl -X POST http://127.0.0.1:3000/api/batch-listing-create/start \
  -H "Content-Type: application/json" -d '{"autoUpload":false}'

# 5) 看草稿 → 过 G2 闸门 → 再决定上架
curl http://127.0.0.1:3000/api/batch-listing-create/status
```
