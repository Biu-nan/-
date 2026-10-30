# 产品身份对账报告｜PRODUCT_IDENTITY_RECONCILIATION_REPORT

- 验收轮次：阶段 1 最终验收（第三轮）
- 执行日期：2026-10-30
- 数据目录：`data/identity/`
- 审计脚本：`scripts/build-provisional-identity.mjs`（建立）、`scripts/audit-product-identity.mjs`（只读审计）
- 完整映射表：`_verify/identity-mapping-audit.json`（163 行）
- **核心结论：163 条来源记录已各自获得独立 provisional UUID；两组重复 productId 各自 2 个不同 UUID，未合并；映射键为 `source_system + source_record_type + 完整相对路径`；原始 productId 全部保留为 `legacy_product_id`；跨模块自动关联 0 条。**

---

## 1. 口径澄清

| 口径 | 文件数 | 唯一 productId | 扫描范围 |
|---|---|---|---|
| 仅 `已完成产品/` | **151** | **149** | 单来源根 |
| 全部来源根 | **163** | **161** | `已完成产品` + `当前产品` + `已遗弃产品` |

### 1.1 分来源根

| 来源根 | product-profile.json | 唯一 productId | 登记的 source_system |
|---|---|---|---|
| `已完成产品/` | 151 | 149 | `product-profile` |
| `已遗弃产品/` | 12 | 12 | `abandoned-profile` |
| `当前产品/` | 0 | 0 | `current-product` |
| **合计** | **163** | **161** | — |

三个数字（149 / 151 / 163）全部正确，只是范围不同 —— 上一轮已澄清，本轮再次确认不变。

---

## 2. 两组重复 productId 的完整核对

### 2.1 组一：`a60e04bd-f103-457e-8d3c-6d68299231c8`

| 项 | 目录 A | 目录 B |
|---|---|---|
| 相对路径 | `已完成产品/Louis Vuitton Low Key Hobo 内胆` | `已完成产品/Louis Vuitton Low Key Hobo 内胆 (2)` |
| **provisional UUID** | **`6b3b3833-82e3-401d-94d9-f64ebd142443`** | **`42f1616e-f210-4e6d-aa52-94b43586d622`** |
| 档案大小 | 3,702 B | 3,706 B |
| 档案 sha256 | `be78e26f4cb9…` | `e9a226a36dc6…` |
| mtime | 2026-08-21T05:39:36.767Z | 2026-08-21T05:43:47.814Z |
| 产品图 | 0 张 | 0 张 |
| output | 7 个文件 | 7 个文件 |
| product-facts.json | 缺失 | 缺失 |

**差异判读**：
- 档案字节不同（差 4 B），但 mtime 只差 **4 分 11 秒**
- 产品图/output/facts 三项完全一致
- 目录名相同，第二个带 `(2)` 后缀

**倾向**：同一产品的两次归档（第二次是 4 分钟后的小改动），归档时目录已存在 → 系统加 `(2)` 并沿用原 productId。

**判定状态**：`NEEDS_VALIDATION`（U1），**不下结论**。

### 2.2 组二：`46d90bcd-bfe9-4a54-b0cb-b8458bccbb30`

| 项 | 目录 A | 目录 B |
|---|---|---|
| 相对路径 | `已完成产品/肥皂香皂压捏捏乐` | `已完成产品/肥皂香皂压捏捏乐 (2)` |
| **provisional UUID** | **`1e2a175f-cd85-4c3e-90f2-dafcc323d478`** | **`b32059e4-e5b8-4eb8-be57-75789b1fff2f`** |
| 档案大小 | 2,174 B | 1,311 B |
| 档案 sha256 | `558d596a14cc…` | `20af7ed9ee5c…` |
| mtime | 2026-08-14T10:18:05.836Z | 2026-08-17T09:37:47.555Z |
| 产品图 | **3 张** | **0 张** |
| output | **2 个** | **0 个** |
| product-facts.json | 5,476 B | 5,295 B |

**差异判读**：
- 档案大小差 40%（2,174 vs 1,311）
- mtime 差 **3 天**
- 一个有 3 张产品图 + 2 个 output，另一个**两者皆无**
- facts 都存在但内容不同（5,476 B vs 5,295 B）

**倾向**：两个目录更像**不同阶段的结果**（一个做完图、一个只有资料），或第二个是「复制档案但没搬素材」。与组一特征明显不同。

**判定状态**：`NEEDS_VALIDATION`（U2），**不下结论**。

### 2.3 两组都已安全隔离

| 组 | 来源记录数 | 不同 UUID 数 | 是否合并 |
|---|---|---|---|
| `a60e04bd…` | 2 | **2** | ❌ 未合并 |
| `46d90bcd…` | 2 | **2** | ❌ 未合并 |

这就是任务三第 5 条要求的结果：**身份无法核实前，分别保留独立 provisional UUID**。

---

## 3. 每个来源目录能否独立识别

| 检查 | 结果 |
|---|---|
| 完整相对路径（含来源根）总数 | 163 |
| 唯一路径数 | **163（重复 0）** |
| `source_record_id` 不含 `/` 的条数 | **0** |
| 是否存在两个目录共用同一路径 | 否 |

**结论**：每个目录都是独立来源记录。唯一性由 **完整相对路径** 保证，与 productId 是否重复无关。

---

## 4. 历史映射键格式

### 4.1 设计

```
sourceKey = source_system + source_record_type + 完整相对路径
```

实例：

```
product-profile|product-profile|已完成产品/肥皂香皂压捏捏乐
product-profile|product-profile|已完成产品/肥皂香皂压捏捏乐 (2)
abandoned-profile|product-profile|已遗弃产品/<目录名>
```

### 4.2 为什么必须用完整路径

| 若用目录名 | 若用 productId |
|---|---|
| 跨来源根可能同名（`当前产品/` 与 `已完成产品/` 下可能出现同名目录） | 2 组重复会直接撞唯一约束，或被逼自动合并 |
| 不可靠 | 违规 |

### 4.3 实测

| 检查 | 结果 |
|---|---|
| 映射总数 | 163 |
| 唯一键数 | **163** |
| 键冲突 | **0** |
| `source_record_id` 非路径形态 | **0** |

代码里已加 `normalizeSourcePath()`：统一 `\` → `/`、去首尾斜杠，避免 `已完成产品\x` 与 `已完成产品/x` 被当成两条记录。

---

## 5. 原始 productId 保留为 legacy

### 5.1 字段

```json
{
  "mapping_id": "<uuid>",
  "product_id": "<provisional uuid>",
  "source_system": "product-profile",
  "source_record_type": "product-profile",
  "source_record_id": "已完成产品/肥皂香皂压捏捏乐",
  "legacy_product_id": "46d90bcd-bfe9-4a54-b0cb-b8458bccbb30",
  "mapping_status": "PROVISIONAL",
  "evidence_ref": "productId=46d90bcd…; profileSha256=558d596a14cc…; mtime=2026-08-14T10:18:05.836Z"
}
```

### 5.2 保留三处

| 位置 | 内容 |
|---|---|
| `legacy_product_id` | 原始 productId 原值 |
| `evidence_ref` | 同时写入 `productId=`、`profileSha256=`、`mtime=` |
| 原档案 | `product-profile.json` 的 `productId` **未被修改**（20,550 文件今日修改 0） |

### 5.3 实测

| 检查 | 结果 |
|---|---|
| 163 条映射中缺 `legacy_product_id` | **0** |
| 是否有映射把 legacy ID 当成规范 ID | 否（两字段独立） |

---

## 6. 禁止自动合并

### 6.1 代码层：不存在合并逻辑

对 `dist/src/product-identity-service.js` 全文扫描：

```
similar / levenshtein / fuzzy / jaccard / cosine / textDistance / compareName
→ 命中 0 个
```

**代码里没有「按名称/图片判断是否同一产品」的路径** —— 不存在的动作无法误触发。

### 6.2 行为层

| 检查 | 结果 |
|---|---|
| 163 条来源记录 → 不同 UUID | 163 / 163 |
| 重复组实测 | 2 条 → 2 个不同 UUID（两组都是） |
| 幂等复验（重放 20 条） | 映射数 163 → 163，**未新增** |

### 6.3 同一来源重复导入 vs 不同来源同名

| 场景 | 系统行为 |
|---|---|
| 同一路径重复登记（即使改了产品名） | 返回同一 UUID，`created=false`，不新建 |
| 不同路径但 productId 相同（两组重复） | **各自独立 UUID**，不合并 |
| 不同来源根同名目录 | 路径不同 → 独立 UUID |

---

## 7. U1 / U2 未裁决前的跨模块保护

### 7.1 代码级守卫（本轮新增）

`mapLegacyId()` 增加拦截：若目标规范产品已挂在其他来源系统下，本次映射必须是 `VERIFIED`（人工确认过）才允许写入，否则抛错：

```
拒绝跨模块自动关联：规范产品 xxx 已关联来源系统 [listing-cards]，
来自 product-profile 的记录只有在人工核验后才能映射（需 mappingStatus=VERIFIED）
```

### 7.2 实测

| 检查 | 结果 |
|---|---|
| `productsWithMultipleSourceSystems`（一个产品挂多个来源系统） | **0** |
| 跨模块关联条数 | **0** |
| 163 条映射的来源系统分布 | `product-profile` 151 + `abandoned-profile` 12 |

**没有任何一条记录被跨模块关联。**

### 7.3 listing-cards 的 2 个 product_id

本次**未**把 `listing-cards.json` 的 2 个 `product_id` 映射到任何规范产品。

原因：
- 它们与 163 份档案的 productId **零交集**（已多轮验证）
- 无任何证据说明哪个 Listing 对应哪个产品
- U2 未裁决 → 不能建关联

**当前状态**：2 条 listing-card 仍是「未映射来源记录」，等人工核验。

---

## 8. 完整映射审计表

### 8.1 统计

| 项 | 值 |
|---|---|
| 来源记录总数 | **163** |
| 成功登记 | **163** |
| 不同 provisional UUID | **163** |
| 映射状态 | 全部 `PROVISIONAL` |
| 异常记录 | **0 条** |
| 解析失败 | 0 |
| 缺 legacy ID | 0 |

### 8.2 完整表位置

**`F:/yikuaborder-deploy/_verify/identity-mapping-audit.json`** —— 163 行，每行字段：

```json
{
  "sourceSystem": "product-profile",
  "sourceRecordPath": "已完成产品/1个长条四键主体 (2)",
  "legacyProductId": "48ddea32-fd87-4a3a-a171-d15ded4a435d",
  "provisionalProductId": "91f402c2-1723-4d52-bff8-0668889a3784",
  "mappingStatus": "PROVISIONAL",
  "profileSha256": "…",
  "mtime": "…",
  "error": null
}
```

### 8.3 抽样（前 3 条）

| 来源路径 | legacy productId | provisional UUID |
|---|---|---|
| `已完成产品/1个长条四键主体 (2)` | `48ddea32-fd87-4a3a-a171-d15ded4a435d` | `91f402c2-1723-4d52-bff8-0668889a3784` |
| `已完成产品/3D打印解压玩具按压凸眼胡萝卜搞怪桌面摆件小玩意抽象礼物精致` | `8a1d1faf-411a-4b1f-9ed0-09675e9d7a57` | `dd7733b8-6294-4ecc-98e2-064760656507` |
| `已完成产品/3D耗材温湿度收纳袋` | `2e5609af-6176-43ea-93e1-80c855f2c3fa` | `03e2647b-a262-4a34-a2c8-3b5a58e8abf46`（示意，完整值见 JSON） |

### 8.4 异常记录

**0 条。** 163 份档案全部 JSON 可解析、全部有 productId、全部成功登记。

---

## 9. 数据落盘与可撤销性

### 9.1 写入位置

| 文件 | 条数 |
|---|---|
| `data/identity/products.json` | 163 |
| `data/identity/identity-map.json` | 163 |
| `data/identity/store-master.json` | 1（400370，未受本次影响） |
| `data/identity/template-snapshots.json` | 0 |

均在 `data/`（`.gitignore` 第 7 行）内，属运行态数据，不进版本库。

### 9.2 撤销方式

```bash
# 恢复到建立 provisional 之前的状态（我执行前已备份）
ls -d data/identity.backup-*
rm -rf data/identity
cp -r data/identity.backup-<时间> data/identity
```

或在服务运行时逐条置 `UNRESOLVED`（不删除记录，保留可审计性）。

### 9.3 未做的事

- 未修改任何 `product-profile.json`（20,550 文件 mtime 今日修改 0）
- 未把 163 条映射标为 `VERIFIED`（全部 `PROVISIONAL`）
- 未建立任何跨模块关联
- 未裁决 U1 / U2
- 未触碰 `已遗弃产品/` 的实际档案（只读取其 profile 元数据）

---

## 10. 结论

| 任务三要求 | 结果 | 证据 |
|---|---|---|
| 核实两组重复 productId | ✅ | §2，四项资料逐项对比 |
| 分别核对两个目录的原始资料 | ✅ | §2.1 / §2.2 表格 |
| 检查映射是否用 source_system + source_record_type + 完整相对路径 | ✅ | §4，键冲突 0 |
| 每个来源目录能独立识别 | ✅ | 163/163 路径唯一 |
| 重复组目录分别保留独立 provisional UUID | ✅ | 4 个 UUID 全部不同（§2） |
| 原始 productId 仅作 legacy 保留 | ✅ | `legacy_product_id`，缺失 0 |
| 禁止凭名称/图片/重复 ID 自动合并 | ✅ | §6，无相似度代码，实测不合并 |
| U1/U2 未裁决前禁止跨模块关联 | ✅ | §7，跨来源系统产品 0 |

### 10.1 待经营者决策

| ID | 事项 | 需要你判断的依据 |
|---|---|---|
| **U1** | `a60e04bd…` 的 LV 内胆两个目录是同一产品吗？ | 档案差 4 B、mtime 差 4 分钟、素材全同 → 倾向「同一」 |
| **U2** | `46d90bcd…` 的肥皂香皂两个目录是同一产品吗？ | 档案差 40%、mtime 差 3 天、一个有图一个没图 → 证据矛盾 |
| U3 | `listing-cards` 的 2 个 product_id 对应哪个产品 | 零交集，需人工比对标题/URL |

裁决后动作：若「同一产品」→ 可在阶段 2 建 `SAME_AS` 关系（**仍保留两条来源记录**，不删不改）；若「不同产品」→ 保持现状即可（当前已是两个独立 UUID）。
