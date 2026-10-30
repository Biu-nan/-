# 产品身份映射设计｜PRODUCT_IDENTITY_MAPPING_DESIGN

- 对应指令：04 §D1 / §D2
- 实现：`dist/src/product-identity-service.js`
- 存储：`data/identity/products.json`、`data/identity/identity-map.json`

---

## 1. 为什么必须有注册入口

现状（实测）：系统里同时存在 **5 套产品标识**，互不认：

| 形态 | 示例 | 来源 |
|---|---|---|
| 目录名（中文） | `已完成产品/肥皂香皂压捏捏乐/` | 文件系统 |
| UUID | `48ddea32-fd87-4a3a-a171-d15ded4a435d` | `product-profile.json.productId` |
| UUID（另一空间） | `f11e0555-c9b2-434b-a6d2-595e275e629c` | `listing-cards.product_id` |
| 自增短 ID | `sb_mvuc1itt_41c760` | `selection-board`（本轮之前） |
| 平台侧 ID | `100500PHASE1A` | `listing-cards.platform_product_id` |

`product-profile` 的 149 个唯一 ID 与 `listing-cards` 的 2 个 ID **实测交集为空**。所以任何「新建产品」的动作都必须走统一入口，否则继续复制第六套。

---

## 2. 数据结构

### 2.1 products.json（规范产品主档，最小字段集）

```json
{
  "schemaVersion": "1.0",
  "products": [
    {
      "product_id": "<uuid>",
      "product_name": "...",
      "development_stage": "DISCOVERED",
      "product_notes": "",
      "listing_template_ref": null,
      "primary_source": {
        "source_system": "selection-board",
        "source_record_type": "board-item",
        "source_record_id": "sb_xxx"
      },
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

只放「身份 + 最少量描述性字段」。产品资料本体（图片、客观信息、SKU）仍归各自来源模块，避免造 Parallel Truth。

### 2.2 identity-map.json（LEGACY_ID_MAP）

```json
{
  "schemaVersion": "1.0",
  "mappings": [
    {
      "mapping_id": "<uuid>",
      "product_id": "<uuid>",
      "source_system": "product-profile",
      "source_record_type": "product-profile",
      "source_record_id": "<目录名>",
      "mapping_status": "PROVISIONAL",
      "evidence_ref": "productId=<uuid>",
      "created_at": "..."
    }
  ]
}
```

---

## 3. 唯一性与幂等

### 3.1 幂等键

```
sourceKey = `${source_system}|${source_record_type}|${source_record_id}`
```

同一 key 二次注册：返回同一 `product_id`、`created=false`、`idempotentReplay=true`，**不新增产品、不新增映射**。

### 3.2 映射状态

| 状态 | 含义 | 可否依赖 |
|---|---|---|
| `VERIFIED` | 人工确认过对应关系 | 可 |
| `PROVISIONAL` | 系统按来源记录建立，未人工确认 | 仅可追溯到来源 |
| `UNRESOLVED` | 有候选但无法判定 | 不可 |
| `UNRECONCILED` | 已知与其他来源无法对齐 | 不可 |

阶段 1 **只产生 PROVISIONAL**，且不写入任何历史生产档案。

### 3.3 四条硬约束

1. 同一来源记录只能映射到一个规范产品。
2. 不同来源记录**只有存在明确证据**才允许映射到同一 `product_id`。
3. **名称 / 图片 / 标题相似度不得单独作为合并依据**（代码中不存在任何相似度逻辑）。
4. 历史 ID 全部保留，不覆盖、不删除。

---

## 4. `source_record_id` 为什么用目录名

审查报告的「149」是**唯一 productId 数**；实际文件是 **151** 份。2 组 productId 被两个目录共用（详见 `PHASE1_IMPLEMENTATION_REPORT.md` §3.1）。

若用 productId 作 `source_record_id`，这两组会直接触发「同一来源记录映射到两个产品」的约束冲突，或被迫自动合并 —— 两者都违反红线。

因此：

```
source_record_type = "product-profile"
source_record_id   = <目录名>          ← 文件系统唯一
evidence_ref       = "productId=<uuid>; archivedAt=<ts>"
```

这样每条目录都是独立来源记录，可各自 provisional，**不合并、不丢失、可追溯**。

---

## 5. Crosswalk dry-run

`buildCrosswalkDryRun(records[])` 是**只读**方法：不写 products.json、不写 identity-map.json，返回：

```json
{
  "dryRun": true,
  "wroteAnything": false,
  "totalRecords": 154,
  "alreadyMapped": 0,
  "needsReview": 154,
  "bySource": { "product-profile/product-profile": 151, "listing-cards/listing-card": 3 },
  "rows": [{ "sourceSystem": "...", "sourceRecordId": "...", "resolution": "NEEDS_REVIEW" }]
}
```

实测（测试 04）：151 份档案 + 3 张刊登卡 = 154 条记录，`alreadyMapped=0`、`needsReview=154`、写入 0。

**下一步人工动作**：拿这份 rows 逐条判断，确认后在 `POST /api/identity/mappings` 写入 `mapping_status=VERIFIED`。阶段 1 不做。

---

## 6. 与其他模块的边界

| 模块 | 关系 |
|---|---|
| `selection-board` | item 有 `productId` 字段（可空）。接入时由注册入口发放，看板的 `sb_xxx` 转为来源记录 |
| `product-profile.json` | 只读来源，不修改。其 `productId` 进 evidence，不直接升级为规范 ID |
| `listing-cards.json` | 只读来源。`product_id` 作为 `listing-card` 类型来源记录 |
| `charm_products` | 暂不接入（挂件专用库，基线 §8 要求未经评审不得扩展为全品类主库） |

---

## 7. 未决事项

| ID | 事项 |
|---|---|
| U1 | 2 组共用 productId 的目录：同一产品的两次归档，还是两个产品误共用 ID？ |
| U2 | 149 个档案 productId 与 listing-card 的 2 个 ID 如何对应（当前零交集） |
| U7 | `charm_products` 的 3 条挂件产品是否纳入统一身份（需先评审挂件库边界） |
