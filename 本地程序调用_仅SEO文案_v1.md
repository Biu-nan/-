# 本地程序调用「仅 SEO 与商品文案」功能

> 版本：v1 ｜ 2026-09-10 ｜ 依据 `dist/src/server.js` 真实路由与前置条件核对，客户端已实测连通。

---

## 0. 三种方式，选哪个

| 方式 | 做法 | 优点 | 缺点 | 建议 |
|---|---|---|---|---|
| **A. HTTP API（推荐）** | 起工作台服务，程序发 HTTP | 跨语言、解耦、和 UI 行为完全一致 | 要起服务 | ✅ 用它 |
| B. 进程内 import | `import dist/src/automation-service.js` | 无 HTTP 开销 | 需自己组装 store/adapters/chatgpt 实例，且 `PROJECT_ROOT=process.cwd()` 强绑定目录；与 UI 抢 Chrome 会话 | 除非深度定制，别用 |
| C. 批量 xlsx API | 生成 xlsx → `/api/batch-listing-create/*` | 一次几十个，强制跳过联网调研 | 要造 xlsx；facts 为本地兜底 | 批量出稿用它 |

现成客户端已写好：`tools/seo_listing_client.py`（零第三方依赖，Python 3.9+）。

---

## 1. 五条硬约束（先读这个，省半天）

1. **服务必须在 `F:\yikuaborder-deploy` 目录下启动**。`config.js` 里 `PROJECT_ROOT = process.cwd()`，所有路径（当前产品 / output / prompts）都基于它。
2. **无鉴权**，`HOST` 默认 `0.0.0.0`（监听所有网卡）、`PORT` 默认 3000。别把它暴露到公网/不可信局域网。
3. **单实例单任务**：引擎只有一个 store，同时只能跑一个商品。并发调用会 409。
4. **Chrome 必须在线**：生成靠 ChatGPT 网页桥接（CDP `:9223`），跟调什么语言无关。
5. **工作区会脏**：残留 `chatUrl` / `completedPhase` / 非 `standard_listing` 模式时，切模式与设目标都会被拒。（当前实测就卡在这，见 §7）

---

## 2. 调用时序（照抄即可）

| 步 | 方法 | 路径 | Body | 说明 |
|---|---|---|---|---|
| 0 | GET | `/api/status` | — | 看 `state.running / stage / completedPhase / chatUrl / workflowMode` |
| 1 | POST | `/api/product/next` 或 `/api/product/abandon` | — | 清洗工作区（MVP5 用 next 归档，其余用 abandon 遗弃） |
| 2 | PUT | `/api/workflow-mode` | `{"mode":"standard_listing"}` | 否则设目标时会报「仅标准 Listing 模式…」 |
| 3 | PUT | `/api/standard-workflow-goal` | `{"goal":"seo_content_only"}` | 关键开关 |
| 4 | PUT | `/api/state/objective-info` | `{"objectiveInfo":"产品名：X\n类目：Y\n补充信息：Z"}` | 截断到 2000 字 |
| 5 | — | 复制图片到 `当前产品/产品图/` | — | 引擎 `scanProductImages()` 自动扫描，无需 multipart。仅 `.jpg/.jpeg/.png/.webp`，单张 ≤15MB，按 sha256 去重 |
| 5' | POST | `/api/import-image-urls` | `{"urls":[...]}` | 用网络图时走这个 |
| 6 | POST | `/api/run/all` | — | 202 受理。一键跑：MVP1 事实 → 调研 → SEO → 文案 |
| 7 | GET | `/api/status` 轮询 | — | 等到 `state.completedPhase==="MVP5" && stage==="COMPLETED"` |
| 8 | — | 读 `当前产品/output/03_SEO_KEYWORDS.md`、`04_LISTING_CONTENT.md` | — | **必须在归档前读**，归档会把文件搬走 |
| 9 | POST | `/api/product/next` | — | 归档到 `已完成产品/<产品名>/`，返回 `archiveDirectory`，然后重置 |

中断续跑：`POST /api/run/resume`。

---

## 3. 直接用现成客户端

```bash
cd F:\yikuaborder-deploy

# 查状态
python tools/seo_listing_client.py --status

# 出稿（有图）
python tools/seo_listing_client.py ^
  --name "硅胶隐形乳贴" --category "女士内衣配件" ^
  --notes "材质医用硅胶；直径8cm；肤色；2对装；可水洗重复使用20次" ^
  --images "F:/img/a.jpg,F:/img/b.jpg" ^
  --out-dir "F:/out"

# 无图纯文本 + 跑完自动归档
python tools/seo_listing_client.py --name "硅胶隐形乳贴" --notes "..." --archive

# 工作区被占用时自动清洗（后果性：会归档或遗弃当前任务）
python tools/seo_listing_client.py --name "..." --notes "..." --force-clean
```

Python 里当库用：

```python
from tools.seo_listing_client import WorkbenchClient, generate_seo_listing

client = WorkbenchClient(base="http://127.0.0.1:3000")
res = generate_seo_listing(
    client,
    product_name="硅胶隐形乳贴",
    category="女士内衣配件",
    notes="材质医用硅胶；直径8cm；2对装",
    images=["F:/img/a.jpg"],
    timeout=1800,
    archive=True,
)
print(res["outputs"]["03_SEO_KEYWORDS.md"][:500])
print(res["archiveDirectory"])
```

---

## 4. 自己写（最小代码）

### curl（验证链路最快）

```bash
BASE=http://127.0.0.1:3000
curl -X PUT $BASE/api/workflow-mode -H "Content-Type: application/json" -d '{"mode":"standard_listing"}'
curl -X PUT $BASE/api/standard-workflow-goal -H "Content-Type: application/json" -d '{"goal":"seo_content_only"}'
curl -X PUT $BASE/api/state/objective-info -H "Content-Type: application/json" \
  -d '{"objectiveInfo":"产品名：硅胶隐形乳贴\n类目：女士内衣配件\n补充信息：材质医用硅胶；2对装"}'
# 复制图片到 F:\yikuaborder-deploy\当前产品\产品图\
curl -X POST $BASE/api/run/all
curl -s $BASE/api/status | python -c "import sys,json; s=json.load(sys.stdin)['state']; print(s['stage'], s.get('completedPhase'))"
```

### Node（fetch，Node 18+）

```js
const BASE = "http://127.0.0.1:3000";
const api = async (m, p, body) => {
  const r = await fetch(BASE + p, {
    method: m,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${j.error ?? ""}`);
  return j;
};
await api("PUT", "/api/workflow-mode", { mode: "standard_listing" });
await api("PUT", "/api/standard-workflow-goal", { goal: "seo_content_only" });
await api("PUT", "/api/state/objective-info", { objectiveInfo: "产品名：X\n类目：Y\n补充信息：Z" });
await api("POST", "/api/run/all", {});
// 轮询
for (;;) {
  const { state } = await (await fetch(BASE + "/api/status")).json();
  if (state.completedPhase === "MVP5" && state.stage === "COMPLETED") break;
  if (["PAUSED", "READY_FOR_LOGIN"].includes(state.stage)) throw new Error(state.stage);
  await new Promise(r => setTimeout(r, 5000));
}
```

---

## 5. 批量出稿（几十个品）

适合"只要文案、不要联网调研"的批量场景（批量强制 `skipResearch:true`、`skipProductFacts:true`）：

```bash
curl -F "workbook=@input.xlsx" $BASE/api/batch-listing-create/upload
curl -X POST $BASE/api/batch-listing-create/start -H "Content-Type: application/json" \
  -d '{"jobId":"<id>","autoUpload":false}'
curl $BASE/api/batch-listing-create/status
curl -o result.xlsx $BASE/api/batch-listing-create/download
```

xlsx 列：`productName`(必) / `mode`(填 `seo_content_only`) / `category` / `notes` / `imageUrls` 或 `localImages`（本模式可留空）。≤50 行、每行 ≤20 图、单行硬超时 30 分钟。

---

## 6. 错误码怎么接

| 现象 | 原因 | 处理 |
|---|---|---|
| 409「批量队列正在运行或保留当前任务」 | `queueService.isLocked()` | 等队列空闲或 `/api/queue/pause` |
| 409「当前商品已开始，不能切换任务目标」 | 残留 `chatUrl` 或 `completedPhase` | `/api/product/next`（MVP5）或 `/api/product/abandon` |
| 409「仅标准 Listing 模式可以选择此任务目标」 | `workflowMode` 不对 | 先 `PUT /api/workflow-mode` |
| 400「未知标准 Listing 任务目标」 | goal 只能 `full_listing` / `seo_content_only` | 改值 |
| `ECONNREFUSED 127.0.0.1:9223` | Chrome CDP 掉线 | 重开 Chrome |
| 「ChatGPT 未登录或输入框不可用」 | 登录态失效 | 浏览器里重新登录 |
| stage 卡在 `PAUSED` / `READY_FOR_LOGIN` | 人工暂停或未登录 | 人工处理后再 `/api/run/resume` |

---

## 7. 就绪三步走（2026-09-11 实测状态）

实测：工作台 ✅、模式已切到 `standard_listing` ✅、**Chrome CDP ❌ 未开**。只差最后一步。

### 第 1 步 · 开 Chrome（带调试端口，保留登录态）

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9223 --user-data-dir="F:\yikuaborder-deploy\.chrome-profile"
```

打开后确认 **ChatGPT 已登录**（没登录就在网页里登录一次）。这个窗口跑任务期间不要关。

### 第 2 步 · 自检

```bat
cd F:\yikuaborder-deploy
python tools/seo_listing_client.py --check
```

`blockers` 为空数组 = 可以跑了。当前输出：

```json
"chrome_cdp": {"ok": false, "reason": "timed out"},
"blockers": ["Chrome CDP :9223 未开，生成跑不了"]
```

### 第 3 步 · 试跑（拿现成的图）

```bat
python tools/seo_listing_client.py ^
  --name "测试品-验证链路" --category "箱包配件" ^
  --notes "用于验证本地程序调用链路，无需精细" ^
  --images "F:\yikuaborder-deploy\1688_import\Image_01.jpg" ^
  --out-dir "F:\yikuaborder-deploy\tools\out" --no-archive
```

跑完看 `tools\out\` 里的 `03_SEO_KEYWORDS.md` / `04_LISTING_CONTENT.md`。
`--no-archive` 表示先不归档，方便你检查 `当前产品\output\`。确认没问题后，正式跑去掉 `--no-archive`（或事后 `POST /api/product/next`）。

### 循环调用多个产品

```python
from tools.seo_listing_client import WorkbenchClient, generate_seo_listing

client = WorkbenchClient()
for item in products:                      # [{"name":..., "category":..., "notes":..., "images":[...]}, ...]
    res = generate_seo_listing(client, item["name"], item["category"],
                               item["notes"], images=item.get("images"),
                               archive=True)   # 每个跑完自动归档，工作区自动腾空
    save(res["outputs"], res["archiveDirectory"])
```

> 客户端默认**不**自动清洗工作区，避免误伤你正在做的任务；需要时加 `--force-clean`。

---

## 8. 安全检查清单

- [ ] 服务只在 `F:\yikuaborder-deploy` 启动（否则路径全错）
- [ ] Chrome 已开 `--remote-debugging-port=9223` 且已登录
- [ ] 想清楚 `HOST=0.0.0.0` 意味着局域网任何人可调、且**无鉴权**；建议设 `HOST=127.0.0.1`
- [ ] 你的程序要处理 409 与轮询超时，不要并发打
- [ ] 产物在归档前读走
