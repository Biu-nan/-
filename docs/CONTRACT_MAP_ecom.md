# 契约映射：ecom-translator → 一跨而境（P0）

> 依据：真实样例
> - 源：`ecom-translator/output/其他类别/CH化妆包…/product_info.json`（15KB, schema_version=3）与 `listing_handoff.json`（7KB, schema_version=1）
> - 目标：`一跨而境/已完成产品/<name>/product-facts.json`（schemaVersion=1.0）

---

## 一、两侧结构对照

| ecom-translator | 一跨而境 |
|---|---|
| `product_info.json`（schema_version=3，snake_case） | `product-facts.json`（schemaVersion=1.0，camelCase） |
| `specifications.{dimensions,weight,capacity,material,color,model,package_contents}`（证据数组） | `dimensionsCm{length,width,height}` / `weight` / `material` / `keyAttributes[]` / `variants` |
| `listing_handoff.json.verified_facts` | 同上事实区 |
| `listing_handoff.json.delivery_gate`（can_generate_listing_draft / review_required） | `productFactsReady` + 上架闸门 |
| `listing_handoff.json.image_assets` | `已完成产品/<name>/产品图/` 与 `output/` |
| `listing_handoff.json.listing_draft.artifacts` | `03_SEO_KEYWORDS.md` / `04_LISTING_CONTENT.md` |
| `quality` / `gaps_and_conflicts` / `anomalies` | 一跨而境**无对应字段**（需落到 `meta.provenance`） |

---

## 二、字段映射（可直接实现）

| 源字段（ecom） | 目标字段（一跨而境） | 规则 |
|---|---|---|
| `specifications.material[].value` | `material` | 取证据最强的一条；无证据留 `null` |
| `specifications.dimensions[]` | `dimensionsCm.{length,width,height}` | 仅当三维同源可确认才组合；未知轴向留空（沿用 ecom 的「未知轴向不组合」规则） |
| `specifications.weight[].value` | `weight` | 单位统一为 g/kg，保留原文单位到 `meta` |
| `specifications.package_contents[]` | `originalBox` / `keyAttributes` | 包装清单进 `originalBox` 文本；单件属性进 `keyAttributes` |
| `verified_facts.variants[]` | `variants.{colors,sizes,matrix,skus}` | 一跨而境变种矩阵需 `colorImages/colorCustomNames`，缺则留空 |
| `evidence_backed_selling_points[]` | `keyAttributes[]` | 仅「有证据」的卖点进；未验证建议不进 |
| `quality.status` / `gaps_and_conflicts[]` | `meta.provenance.{qualityStatus,gaps,conflicts}` | **必须携带**，作为人工复核依据 |
| `delivery_gate.review_required` | `productFactsReady=false` + `meta.provenance.reviewRequired` | 复核态不得标就绪 |
| `listing_draft.artifacts` | `output/03_SEO_KEYWORDS.md`、`04_LISTING_CONTENT.md` | 文件名一致，直接落盘 |
| `image_assets[]` | `产品图/`（源）或 `output/`（译后） | 需保留 `source`（原图/译图）标记 |

---

## 三、两侧互为缺口

**ecom 有、一跨而境缺（移植时要补）**
- 证据链：每个规格带 evidence id / 置信度 / 来源图片。
- `gaps_and_conflicts`：显式记录「未知/冲突」，而不是静默留空。
- `delivery_gate`：能否生成草稿/能否自动发布的分级闸门。

**一跨而境有、ecom 缺（移植时保留）**
- `title{zh,en}` / `description{pc,mobile}`（Listing 成稿结构）。
- `images.main[]` 主图清单与 `variants.matrix` 变种矩阵。
- `mainKeyword`、`hsCode`、`compliance`。

---

## 四、诚实规则（不可破）

1. **不补写事实**：ecom 的 `gaps_and_conflicts` 必须原样进 `meta.provenance`，不得因目标 schema 没有该字段就丢弃。
2. **未知轴向不组合**：`dimensions` 不足三维时，`dimensionsCm` 对应轴留空，不进猜测值。
3. **复核态不放行**：`review_required=true` 时 `productFactsReady=false`，且 UI 必须显示原因。
4. **原图/译图标注**：`image_assets[].source` 决定它是 `产品图/`（源）还是 `output/`（译后），不可混。

---

## 五、最小转换骨架（伪代码）

```js
function toYikuaborderFacts(info, handoff) {
  const spec = info.specifications ?? {};
  const dims = pickDimensionsCm(spec.dimensions); // 三维同源才组合
  return {
    schemaVersion: "1.0",
    productId: info.product?.folder ?? "",
    material: strongest(spec.material) ?? null,
    weight: toWeight(spec.weight),
    dimensionsCm: dims,
    originalBox: joinValues(spec.package_contents),
    keyAttributes: (handoff.evidence_backed_selling_points ?? []).map(p => p.text ?? p),
    variants: toVariants(handoff.verified_facts?.variants),
    images: { main: (handoff.image_assets ?? []).filter(a => a.source === "output").map(a => a.name) },
    meta: {
      provenance: {
        source: "ecom-translator",
        qualityStatus: info.quality?.status,
        gaps: info.gaps_and_conflicts ?? [],
        conflicts: info.conflicts ?? [],
        reviewRequired: Boolean(handoff.delivery_gate?.review_required)
      }
    }
  };
}
```

> 实现位置建议：`dist/src/ecom-contract.js`（纯函数，可单测），先只做「读 ecom 产物 → 写 一跨而境 product-facts.json」，不碰现有上品流程。
