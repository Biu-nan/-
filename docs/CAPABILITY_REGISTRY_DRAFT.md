# F2 · Capability Registry 能力清单（草案 v0.1，待裁决）

> 2026-10-25。**只列声明，不动代码**。分级严格按 `docs/SYSTEM_FRAMEWORK_v1.0.md` §4.3。
> 目的：让"这个操作危不危险、重不重、要不要人批"从 if 判断里搬到声明里。
> 本文件是给你**圈选**的，不是最终配置。圈定后再生成 `config/capabilities.json`。

## 0. 副作用分级（文档既定，不在本文重定义）

| 级 | 含义 | 授权 |
|---|---|---|
| P0 | 纯读 | 自由执行 |
| P1 | 写本地事实/草稿 | 自由执行 |
| P2 | 生成本地文件（图片/文档） | 自由执行 |
| P3 | 改平台草稿态数据 | **需人批** |
| P4 | 改价 / 改库存 | **需人批 + 金额上限** |
| P5 | 发布 / 上架（不可逆外部动作） | **必须人点** |
| P6 | 删除 / 清空 / 回滚 | **每次单独确认** |

## 1. 二十条清单

### A. 商品环（9 条）

| # | 能力 id | 干什么 | 现有入口 | sideEffect | 幂等键 | 实现状态 |
|---|---|---|---|---|---|---|
| 1 | `product.onboard` | 单品建档，落四区目录骨架 | `POST /api/product-profiles/lightweight` | P1 | `contentHash(name+sourceUrl)` | ✅ 已有 |
| 2 | `product.facts.extract` | 从店小秘/图抽取 product-facts | `POST /api/dianxiaomi/extract-facts`、`POST /api/product/facts/regenerate` | P1 | `contentHash(productId)` | ✅ 已有（含 fallback 兜底） |
| 3 | `product.images.import` | 源图入库到 `产品图/` | `POST /api/import-images`、`/api/import-image-urls` | P1 | `contentHash(urls)` | ✅ 已有 |
| 4 | `listing.content.generate` | 生成标题/描述/属性草稿 | `POST /api/run`、`POST /api/run/seo-listing` | P1 | `contentHash(productId+facts)` | ✅ 已有（走 ChatGPT 8–12min） |
| 5 | `listing.images.generate` | 生成商品图到 `output/` | `POST /api/run/images`、`POST /api/charm/run/images` | P2 | `contentHash(productId+prompt)` | ✅ 已有（**src 基线检测**） |
| 6 | `listing.draft.save` | 写入店小秘草稿（不发布） | `POST /api/dianxiaomi/batch-apply`、`/collect-batch-apply` | **P3** | `operationId=rows 指纹` | ✅ 已有 |
| 7 | `listing.review.decide` | 人工拍板放行/打回 | `POST /api/listing-jobs/:id/approve` | **P3** | `jobId+token` | ⚠️ 有令牌但审核是空壳 |
| 8 | `listing.publish` | 真正发布上架 | `POST /api/listing-jobs/:id/publish` | **P5** | `jobId` | ⚠️ 链路存在但未与真实发布绑定 |
| 9 | `listing.upload.retry` | 重试失败上架 | `POST /api/dianxiaomi/batch-retry` | **P3** | `operationId` | ✅ 已有 |

### B. 店铺环（6 条）

| # | 能力 id | 干什么 | 现有入口 | sideEffect | 幂等键 | 实现状态 |
|---|---|---|---|---|---|---|
| 10 | `metrics.product.scan` | 全量抓商品 474×43 字段 | `scripts/fetch-ae-items.mjs` | P0 | `statDate+storeId` | ⚠️ **CLI 脚本，无 HTTP** |
| 11 | `metrics.store.scan` | 店铺日扫 17 facts | `scripts/fetch-ae-metrics.mjs` | P0 | `statDate+storeId` | ⚠️ **CLI 脚本，无 HTTP** |
| 12 | `metrics.recompute` | facts → 指标重算 | `scripts/recompute-metrics.mjs` | P0 | 天然幂等（纯函数） | ⚠️ **CLI 脚本，无 HTTP** |
| 13 | `product.stratify` | 474 件定层 S/A/B/M/N/C1/C2 | `scripts/stratify-products.mjs` | P0 | 天然幂等 | ⚠️ **CLI 脚本，无 HTTP** |
| 14 | `inventory.audit` | 实仓+占用+在途真实库存核对 | **无** | P0 | 天然幂等 | ❌ **需新建只读函数** |
| 15 | `price.adjust` | 改价 | **无**（仅平台菜单路径） | **P4** | 无 | ❌ **未实现** |

### C. 系统环（5 条）

| # | 能力 id | 干什么 | 现有入口 | sideEffect | 幂等键 | 实现状态 |
|---|---|---|---|---|---|---|
| 16 | `system.state.read` | 统一总账 13 单元 | `GET /api/system/state` | P0 | 天然幂等 | ✅ F1 已交付 |
| 17 | `queue.control` | 队列启停/暂停/放弃当前 | `POST /api/queue/{start,pause,resume,abandon-current}` | **P3** | 状态机守卫 | ✅ 已有 |
| 18 | `task.rollback` | 任务回滚 / 放弃 | `POST /api/task/rollback`、`/api/task/abandon` | **P6** | `taskId+确认串` | ✅ 已有 |
| 19 | `browser.session.ensure` | 探测/拉起登录态 | `POST /api/browser/check`(P0)、`/launch`(P3) | P0 **+** P3 | 无 | ✅ 已有（**实为两条**） |
| 20 | `secretary.intent.compile` | 自然语言 → 草稿 intent | `POST /api/secretary/chat` | P1 | `message+pageContext` | ✅ 已有（只产草稿） |

**统计**：✅ 完全就绪 11 条（1,2,3,4,5,6,9,16,17,18,20）／⚠️ 需加工 6 条（7,10,11,12,13,19）／❌ 缺口 3 条（8 绑定、14 新建、15 未实现）。

## 2. 声明字段规范（一条样例）

```json
{
  "id": "listing.draft.save",
  "version": "1.0",
  "name": "写入店小秘草稿",
  "endpoint": "POST /api/dianxiaomi/batch-apply",
  "params": {
    "rows": "object[]  必填，每行一个 SKU 组合",
    "mode": "ref | collect  必填",
    "operationId": "string  必填，内容指纹"
  },
  "sideEffect": "P3",
  "gate": { "required": true, "question": "这批 N 行草稿写入店小秘，确认？", "defaultIfIgnored": "stall" },
  "idempotency": "operationId = djb2(rows)，5min 重放窗口",
  "precheck": ["模板已引用（applyProductTemplate 必须第一步）", "rows 非空", "登录态在线"],
  "verify": "返回 autoUploadStatus 有终态且失败数可解释",
  "rollback": "店小秘侧逐条删除草稿，本地清 dianxiaomi-upload.json",
  "produces": { "unitKind": "LISTING_DRAFT", "artifacts": ["dianxiaomi-upload.json"] },
  "cost": { "duration": "3-8min/批", "external": "店小秘站内自动化" }
}
```

**五个字段是硬约束**：`sideEffect`、`gate.required`、`idempotency`、`verify`、`rollback`。缺一个就不许注册——因为缺 `verify` 就无法判成败，缺 `rollback` 就无法从 P3+ 事故里退出。

## 3. 需要你拍板的四个决策

### 决策 1：脚本类能力（10–13）怎么挂？

| 选项 | 做法 | 代价 |
|---|---|---|
| **A（建议）** | registry 支持 `invoke: "cli"`，直接 spawn `scripts/*.mjs`，不新建 HTTP 路由 | 无需改 server.js，零风险；但 CLI 无统一超时/日志格式 |
| B | 包 4 个 `POST /api/metrics/{scan,store-scan,recompute,stratify}` | 能被网页按钮触发；但要改 server.js + 前端 |
| C | 先不注册，F4 再说 | 决策层无数据可依据，F4 直接卡死 |

### 决策 2：`listing.draft.save` 定 P3「需人批」——这与现在的习惯冲突

按框架定义，写店小秘草稿就是改平台草稿态 = P3 = **需人批**。但现在整条链是"跑完自动存草稿"，无人工卡点。
- **A（建议）**：接受 P3，加 Gate，但 Gate 提供 `autoApproveWithin: {maxRows: 10}` 的批量放行档——小批量免打扰，大批量必停。
- **B**：把它降级为 P2（生成本地草稿，不写平台），另立 `listing.draft.push` 为 P3——两级分离，语义更干净，但要改现有代码。
- **C**：维持现状不设 Gate，等于承认 P3 定义在此处不适用——不建议，会开"声明可以撒谎"的先例。

### 决策 3：`listing.publish`（P5）现在怎么处理

链路 `approve → publish` 存在，但从来没有真正跑通过真实发布（② 的 `draftFromFacts` 是本地拼接、`REVIEW_REQUIRED` 是空壳）。
- **A（建议）**：注册但标 `status: "unverified"`，`precheck` 直接写成"未验证链路，禁止自动调用"，只允许人工单步试跑 1 条。
- **B**：暂不注册，等 F3 Gate 上线再一起做。
- **C**：注册为可用——不建议，等于把一个没跑通的动作写进"可编程"清单。

### 决策 4：`price.adjust`、`inventory.audit` 两个缺口

- `price.adjust`：平台有 `price-adjustment-management` 菜单，但零自动化代码。**建议本版不注册**，只在 manifest 里留 `planned` 占位（占位 ≠ 能力，不可调用）。
- `inventory.audit`：字段已在抓取结果里，只是没聚合。**建议本版就做**（纯读，20 行函数），因为它是 P0 假死判定的地基——真实案例里累计出 174 件的商品曾差点被当长尾清掉。

## 4. F2 若开工，交付物边界（不动现有调用）

1. `config/capabilities.json` —— 20 条声明（本次裁决后定稿）
2. `dist/src/capability-registry.js` —— 三个函数：`list()` / `get(id)` / `assertAllowed(id, ctx)`。**未注册即拒调用**（fail-closed）
3. `GET /api/capabilities` —— 只读，供网页与对话共用同一张表（同源要求）
4. `scripts/verify-capabilities.mjs` —— 验收：20 条每条字段齐全、P5/P6 必带 gate、未注册 id 必拒

**不做**：不改任何现有路由的调用方式、不引入新状态机、不碰 `app.js` 主循环。

## 5. 三条红线（我自己先立，供否决）

1. **注册表不许撒谎**：`status: unimplemented` 的能力必须 `assertAllowed` 直接拒，不能"注册了就当有"。
2. **Gate 不许超时放行**：`defaultIfIgnored` 全表只允许 `stall`。
3. **能力不许越级**：P3+ 能力只能由 L3 编排层调，L5 对话入口只能"选能力 + 建 WorkUnit"，不能直接 `invoke`。
