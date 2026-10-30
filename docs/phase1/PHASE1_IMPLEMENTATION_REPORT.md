# 阶段 1 实施报告｜统一产品身份与状态模型基础改造

- **任务编号**：`YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1`
- **执行日期**：2026-10-30
- **执行分支**：`feature/ykb-v1-phase1-identity-state`（隔离分支，未合并主分支）
- **基线来源**：`YKB_OS_V1_Dev_Baseline_R1.zip`（README / 01 说明书 / 02 ERD / 03 状态机 / 04 实施指令 / 05 决策记录，共 1166 行，已完整阅读）
- **状态**：9 项实施 + 14 项测试全部完成，等待经营者验收

---

## 0. 一句话结论

九项改造全部落地，**没有新建数据库、没有建 16 张表、没有改历史数据**：新增 4 个模块 + 1 个配置文件，改动 7 个既有文件；14 条验收断言全部通过；474 件分层结果与 20,051 个历史产品文件零改动（有哈希与 mtime 双重证据）。

过程中发现 3 个审查报告未覆盖的事实，已按 `DIFFERENCE_FOUND` 处理并写入 §3。

---

## 1. 实施清单（对应 04 指令 D–I）

| # | 指令条款 | 落地物 | 证据 |
|---|---|---|---|
| 1 | D1 统一 Product UUID 注册入口 | `dist/src/product-identity-service.js` `registerProduct()` | 测试 01/02/03 |
| 2 | D2 历史 ID 映射机制 | 同文件 `product_identity_map` + `buildCrosswalkDryRun()` | 测试 04，dry-run 写入 0 |
| 3 | D3 纳物一店 Store UUID 待核验登记 | 同文件 `registerStore()`，启动时幂等登记 | 测试 05 + 运行时 `GET /api/identity/stores` |
| 4 | E selection-board 三套状态拆分 | `selection-board-service.js` 重写为 schema 2.0 | 测试 06/07/08 |
| 5 | F 图片 `sourceUrl` 原始地址修复 | 同文件 `addImageUrls()` 改逐条下载 + URL 映射 | 测试 09 |
| 6 | F 风格参考图与产品事实图隔离 | `dist/src/image-isolation-guard.js` + `scanProductImages` 命名守卫 | 测试 10 |
| 7 | G Listing 模板本地快照 | `dist/src/listing-template-snapshot-service.js` | 测试 11 |
| 8 | H 474 件分层语义映射保护 | `config/attention-layer-alias.json`（旁挂，不改原配置） | 测试 12 |
| 9 | I 幂等与复用 | 复用 `charm_publish_attempts` 幂等模式；推送幂等键 | 测试 13 |

### 新增文件（4 模块 + 1 配置 + 1 测试）

| 文件 | 行数量级 | 职责 |
|---|---|---|
| `dist/src/product-identity-service.js` | ~400 | 规范 UUID 注册 / 历史映射 / store 主数据叠加层 / 幂等键 |
| `dist/src/selection-board-service.js` | ~700（重写） | 三套状态拆分 + 图片 URL 修复 + 推送幂等 |
| `dist/src/listing-template-snapshot-service.js` | ~200 | 本地模板快照，拒绝伪造平台版本 |
| `dist/src/image-isolation-guard.js` | ~90 | 内容哈希级图片隔离审计（只读） |
| `config/attention-layer-alias.json` | — | 474 分层 `ATTENTION_PRIORITY` 语义映射 |
| `scripts/verify-phase1-identity-state.mjs` | ~430 | 14 条验收断言 |

### 改动文件

| 文件 | 改动摘要 |
|---|---|
| `dist/src/server.js` | +343 行：identity/template/store 共 12 条新路由；启动时幂等登记 400370；服务实例化与 load |
| `dist/src/image-files.js` | +6 行：`scanProductImages` 增加风格图命名守卫 |
| `dist/src/config.js` | +10 行：选品看板目录常量（上一轮） |
| `public/selection-board.js` | 三状态 UI：11 个开发阶段 + 8 个同步状态 + 逐店刊登列表 |
| `public/index.html` | 指标卡改为语义分组；script/style 版本号 bump |
| `public/styles.css` | +413 行：看板 + 三状态块 + 窄容器降级 |

---

## 2. 关键设计决定（实施中形成，需经营者知悉）

### 2.1 身份存储用「三文件叠加层」，不建库

为什么不是一张 `products` 表：

- `已完成产品/` 下 151 份 `product-profile.json` 是**归档快照**，改它们等于改写历史；
- `store-profiles.json` 是生产数据文件，阶段 1 明确不写生产数据；
- 三者生命周期不同（产品注册 / 身份映射 / 店铺核验），合并成一张表会引入不必要的事务耦合。

因此：

```
data/identity/products.json       规范产品主档（product_id + development_stage + 来源指针）
data/identity/identity-map.json   product_identity_map（LEGACY_ID_MAP）
data/identity/store-master.json   store 叠加层（不修改 store-profiles.json）
data/identity/template-snapshots.json  本地模板快照
```

`data/` 在 `.gitignore` 内（第 7 行），所以这些是**运行态数据**，不进版本库；schema 与规则进 `config/` 与 `dist/src/`，可审查。

### 2.2 旧 `status` 改为派生只读字段

拆分后旧前端仍在读 `item.status`。做法是**不删字段、改为派生**：

```
deriveLegacyStatus(item) → 由 developmentStage + dianxiaomiSyncStatus 计算
```

写 `status` 时按 `LEGACY_STATUS_TO_STATE` 反查落到新字段。旧客户端读写都不崩，新模型不被污染。

### 2.3 图片下载器可注入

`addImageUrls` 原来直接 import `downloadPublicImage`，导致无法离线测试（该函数会拒绝私网地址，这是正确的 SSRF 防护）。改为构造时可选注入，**生产默认行为不变**，测试可注入 stub。

### 2.4 幂等键复用既有模式

`charm_publish_attempts.idempotency_key` 已验证可用，选品看板推送幂等键用同一算法（`sha256` 前 24 位），指纹 = `itemId + 图片名列表 + 风格图名列表 + 客观信息`。

---

## 3. DIFFERENCE_FOUND（与审查报告不符处，已按指令 C 标记）

### 3.1 `已完成产品/` 是 151 份档案 / 149 个唯一 ID，不是 149 份

审查报告 §1.1 写「149 份 product-profile 的 productId」。实测：

- `已完成产品/` 下**有 151 个目录含 `product-profile.json`**；
- 其中 `productId` **唯一值 149 个**。

**差异原因**：有 2 组「同一 productId 被两个目录共用」，均因归档时目标目录已存在、加了 `(2)` 后缀，但 productId 沿用旧值：

| productId | 共用目录 |
|---|---|
| `a60e04bd-f103-457e-8d3c-6d68299231c8` | `Louis Vuitton Low Key Hobo 内胆` / `Louis Vuitton Low Key Hobo 内胆 (2)` |
| `46d90bcd-bfe9-4a54-b0cb-b8458bccbb30` | `肥皂香皂压捏捏乐` / `肥皂香皂压捏捏乐 (2)` |

**处理**（遵守「不自动合并」）：

- 映射键 `source_record_id` 改用**目录名**（文件系统唯一），不再用 productId；
- productId 写入 `evidence_ref` 供人工比对；
- 判定为两条独立来源记录，各自可发 provisional UUID；
- 这两组究系「同一产品的两次归档」还是「两个产品误共用 ID」，**标记 NEEDS_VALIDATION，不猜**。

### 3.2 店小秘模板连 ID 都没有，只有名称

审查报告说「平台不返回模板版本号」。实测更严格：`dist/src/dianxiaomi-adapter.js` 全流程靠**模板名称字符串**定位（第 194 行「模板名前缀归一：店小秘模板名偶尔带「-星造」这类店铺后缀」），**没有稳定的模板 ID**。

**处理**：`template_ref` 直接使用模板名称，并在设计文档中声明它是「名称引用」而非「平台 ID」。

### 3.3 `product-stratification` 的 `B` 层语义是「衰退清仓」，与安全库存 `B`（稳定款）**反义**

审查报告只指出「同形不同义」。实测更严重：

| 层 ID | 一跨 config 含义 | 纳物安全库存 V1.0 含义 |
|---|---|---|
| `B` | **衰退清仓** | **稳定款**（L1 目标 1 天，极薄备货） |

这不是「含义不同」，是**方向相反**。若按字母映射，会给衰退品配稳定款的备货策略。

已在 `config/attention-layer-alias.json` 中作为 `do_not_confuse_with` 的首要警示条目写入，并关联 `LIFE-C09`。

### 3.4 `verify-product-layout.mjs` 回归 44 项 FAIL —— 属历史遗留，非本次引入

| 项 | 结果 |
|---|---|
| `verify-system-state.mjs` | 20/20 通过 |
| `verify-sku-table.mjs` | 37/37 通过 |
| `verify-sku-naming.mjs` | 32/32 通过 |
| `verify-product-layout.mjs` | ok=33 warn=95 **fail=44** |

44 项 FAIL 全部是 `E_MISSING_FACTS: 缺 product-facts.json`，集中在历史内胆产品（当时未生成 facts）。

**证明非本次引入**：扫描 `已完成产品/` + `当前产品/` 共 **20,051 个文件**，今日 03:00 之后被修改的文件数 = **0**。

---

## 4. 未完成 / 待裁决（不阻塞阶段 1，但阻塞后续）

| ID | 事项 | 状态 |
|---|---|---|
| U1 | 2 组共用 productId 的目录究系同一产品还是两个产品 | NEEDS_VALIDATION（须人工比对图片/标题） |
| U2 | 149 条历史档案的 productId 与 2 条 listing-card 的 `product_id` 如何对应 | UNRESOLVED（零交集，本轮只出 dry-run，不写映射） |
| U3 | 400370 的外部命名空间（来自店小秘？速卖通账号？） | PENDING_VERIFICATION |
| U4 | 模板快照内容如何自动获取 | 目前只能 `MANUAL_CAPTURE_REQUIRED` |
| U5 | 474 各层 ID 的业务定义原文 | ALIAS-01，当前 alias 取自 config label |
| U6 | LIFE-C01～C09 全部阈值 | 未裁决，未进入任何生产规则 |

---

## 5. 阶段 1 完成定义自查（04 指令 M）

| 条件 | 状态 |
|---|---|
| 身份注册入口与历史映射测试通过 | ✅ 测试 01–04、13 |
| 三套状态字段拆分完成且互不污染 | ✅ 测试 06/07/08 + 前端冒烟 |
| 400370 仅登记为待核验店铺，不可发布 | ✅ 测试 05 + 运行时门禁 `STORE_PENDING_VERIFICATION` |
| 图片原始 URL 保存 bug 修复并通过测试 | ✅ 测试 09（含持久化往返 + 私网仍被拒） |
| 风格参考图已与产品事实图隔离 | ✅ 测试 10（内容哈希级）+ 目录级物理隔离 |
| 本地模板快照模型可追溯 | ✅ 测试 11（hash/时间/状态/拒绝伪造平台版本） |
| 474 件关注分层原值不变 | ✅ 测试 12（文件哈希 + 层归属指纹） |
| 全量相关回归测试通过 | ✅ 4 个既有脚本，44 项 FAIL 已证历史遗留 |
| Git diff、测试报告和回滚方案可审查 | ✅ `GIT_DIFF_SUMMARY.md` / `TEST_REPORT.md` / `ROLLBACK_PLAN.md` |

---

## 6. 停止条件遵守声明

本轮**未**触发任何停止条件，也**未**做以下动作：

- 未生产迁移、未部署、未合并主分支
- 未修改纳物 C6/C7
- 未自动合并任何产品身份
- 未修改 474 件商品原始分层结果（20,051 文件 mtime 零变化）
- 未把 400370 当内部主键，未标记已核验
- 未伪造店小秘平台模板版本号
- 未执行真实采购/付款/平台发布
- 未裁决 LIFE-C01–C09

**阶段 1 完成，不自动进入阶段 2，等待经营者审核。**
