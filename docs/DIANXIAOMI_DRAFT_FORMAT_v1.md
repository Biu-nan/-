# 店小秘草稿格式 v1（速卖通 Choice 半托管）

> 2026-10-27。依据：`dist/src/listing-engine.js`（23 步引擎）、`dist/src/dianxiaomi-adapter.js`（5486 行）、
> `dist/src/config.js:176-430`（4 个类目 profile）、`schemas/product-fact.schema.json`、
> `dianxiaomi-field-framework.md`（101 控件枚举）、`dist/src/dianxiaomi-verify.js`（回读三态）。
> 定位：**草稿的输入契约 + 字段格式 + 执行顺序 + 保存判据**。业务口径不在此文（见 `docs/superpowers/specs/2026-10-26-ceo-os-operating-loop-design.md`）。

---

## 〇、先分清三种「格式」（混谈必错）

| # | 是什么 | 载体 | 现状 |
|---|---|---|---|
| ① 平台侧草稿 | 店小秘 Choice 创建页表单，保存后进「待发布」列表 | 无公开 API，只有页面 DOM + `rowid` / `edit_url` | 平台私有，不可直写 |
| ② 草稿意图（我方输入契约） | `product-facts.json` + 表格行 + 类目 profile **三源合并** | 本地 JSON | 三份真相，未合并成一份计划 |
| ③ 草稿回执（产物） | `已完成产品/<name>/dianxiaomi-upload.json` | 本地 JSON | **只有 5 个字段**，无 draftId/editUrl |

**结论**：现在没有「草稿格式」，只有「三源散件 + 一个 5 字段回执」。下面第 1–4 节是**事实上的隐式格式**（代码正在执行的那份），第 6 节给**显式格式提案 v2**。

---

## 一、三源合并规则（隐式格式的真身）

`listing-engine.runListingEngine({ facts, profile, row })` 的取值优先级，逐项已核对：

```
row（input.xlsx 该行列）  >  facts（product-facts.json）  >  profile 缺省  >  页面已有值（引用/采集带入）
```

| 源 | 承载什么 | 证据 |
|---|---|---|
| `row` | 业务决策：`store` / `stockType` / `productTemplate` / `logisticsAttribute` / `material` / `sourceUrl` / `variantParams` | `listing-engine.js:244,253,270,307,532`、`batch-listing-create.js:1112-1122` |
| `facts` | 产品事实：标题 / 材质 / 品牌 / 产地 / 类型 / 图片 / 描述 / variants.matrix / compliance | `schemas/product-fact.schema.json` |
| `profile` | 类目固定配置：店铺 / 备货 / 分类 / 属性模板 / 合规主体 / 海关 / 物流 / 变种是否人工 | `config.js:176-430` |

表格列名容错（`batch-listing-create.js:1112-1122`）：`productName|产品名`、`uploadMode|上架模式`（`引用/reference/ref` → 引用，其余一律 `collect`）、`searchTitle|采集箱标题`、`productTemplate|模板`、`logisticsAttribute|物流`、`material|材质`、`referenceProductId|引用ID`、`variantThemeMap|变种映射`、`outputDirectory|归档目录`。

---

## 二、字段级格式表（草稿 = 6 个区块 · 25 个字段）

控件 id 是**按 profile 不同含义不同**的（见第五节风险 1），下表以箱包 `xiangBao` 为准。

### 2.1 基本信息

| 字段 | 控件 | 类型 | 来源 | 必填 | 缺省/兜底 | 回读 |
|---|---|---|---|---|---|---|
| 店铺名称 | `rc_select_0` | combobox | row.store → profile.fixed.storeName | ✅（未选则「引用模板」静默无反应） | 无，直接抛 | 选中值非空 |
| 备货类型 | `rc_select_1` | combobox | row.stockType → profile.fixed.stockType | ✅ | `国内履约` | 选中值非空 |
| 产品分类 | `rc_select_2` | combobox（树） | profile.category | ✅ **硬门**（见 3.3） | 无 | `ensureCategoryFilled` |
| 产品标题 | `input`（label「产品标题」） | text | facts.title.en → facts.title.zh | ✅ | 无，直接抛 | `fillInputVerified` |
| 来源URL | `form_item_sourceList_0` | text | row.sourceUrl → facts.sourceUrl | ⬜ 非必填 | 空则**记 attention**（不静默留空） | 非致命 |
| 引用产品模板 | — | 按钮+下拉 | row.productTemplate → profile.defaultProductTemplate | ✅（箱包必填） | `箱包配件-包饰` | `moduleNames` 是否含目标模块 |

### 2.2 类目属性（分类落定后才渲染）

| 字段 | 控件 | 来源 | 必填 | 兜底 |
|---|---|---|---|---|
| 材质 | `rc_select_15` | row.material → facts.material → 源值保留 | ✅ | **非破坏式**：源值合法则保留，源值命中 `nipple|breast|petal|bra|乳贴` 黑名单才覆盖（`adapter:2625-2657`） |
| 类型(Type) | `rc_select_13` | facts.type | ✅ | `fillMandatoryAttribute` 选**页面真实存在**的枚举 + attention |
| 品牌 | `rc_select_11` | facts.brand → `NONE` | ✅ | 同上（`viaBrandTemplateSync`） |
| 产地（国家或地区） | `rc_select_14` | facts.origin.country | ✅ | 同上 |
| 中国省份(CN) | `rc_select_17` | 无 facts 字段 | ✅ 联动（产地选「中国大陆」后才出现） | 候选兜底（恒为浙江/义乌），**必须走 id 定位**（label 不稳） |
| 高关注化学品 | 按 label | 无 | ✅「至少选择一项」 | `天然未处理(None)`，已选则 skip |
| 重量（类目属性） | text | — | 由「包装重量」统一填，见 2.5 | — |

### 2.3 图片

| 字段 | 契约 | 规则 |
|---|---|---|
| 主图 `images.main` | 字符串数组（**文件名，不是绝对路径**） | ≤6 张；上传前统一缩放 **1000×1000 白底补边**（原图不动，只传合规副本）；文件不存在 → **整步抛错**（不再伪装成 attention） |
| 营销图 `images.marketing` | 数组 | 1:1 白底 + 3:4 场景两槽；为空只记 attention |
| 每色图 `variants.colorImages` | `{颜色: 文件名}` | 挂到「颜色(Color)」字段的「选择图片」；组合表无图列 |
| 尺寸建议 | — | 1:1 ≥800×800 或 3:4 ≥750×1000；不符只记 attention（不阻断） |

### 2.4 描述

| 字段 | 控件 | 内容要求 | 备注 |
|---|---|---|---|
| PC端描述 | `ckeditor35` | **3.2 AEO 结构化五点**（非整份研究文档） | 填完把已上传主图 CDN 插到正文下方 |
| 无线端描述 | `ckeditor33` | 新版编辑器「根据PC端描述一键生成」 | 采集箱模式**跳过**（弹窗残留会拦住后续必填项）；非保存必填 |

### 2.5 变种 / SKU / 包装（钱与编码，逐行回读）

| 字段 | 载体 | 规则 |
|---|---|---|
| 变种参数（颜色/尺寸） | `facts.variants.matrix` 行 | 引用模式默认 `keepVariants`（沿用模板带出）；采集箱默认 `keepSourceVariants`（**禁止用 facts toggle**，否则取消源真实颜色） |
| 每色自定义名称 | `variants.colorCustomNames` / `colorMap` | 行数必须 == 变种行数，否则重复名检测（`sku-naming.js`）报 attention |
| 供货价 | `matrix[].price` | 行数 == rows，逐行写+回读 |
| SKU 编码 | `matrix[].sku` | 严格相等比较（`WDZAI-1` vs `WDZAI-11` 禁包含匹配） |
| 包装重量 | 单个 input（4 个 name 一起填） | `matrix[0].weight` → `defaultWeight` → `product.weight` → `pkg.weightKg`；**>20 视为克**；都没有 → 默认 **0.12kg**（净重100g+包装20g）+ attention |
| 包装尺寸 | `variationLength/Width/Height` | 缺省 **12×10×5cm** + attention |
| 每色包装尺寸 | 同上（每色行） | 缺省 **15/10/5cm**（`fillProductPackageSize`） |
| 库存 | 铅笔图标 → 修改仓库 → 应用到全部 | 取 `defaultStock` → `matrix[0].stock` → **50** |

### 2.6 合规 / 海关 / 物流

| 字段 | 值来源 | 箱包固定值 |
|---|---|---|
| 物流属性 | row.logisticsAttribute → profile.logistics | `普货` |
| 欧盟责任人 | profile.compliance.euResponsible | `GET RICH` |
| 土耳其责任人 | profile.compliance.trResponsible | 空 |
| 品牌制造商 | profile.compliance.manufacturer | `Yiwu Sumu Arts and Crafts Co., Ltd` |
| 海关监管属性 | profile.customs | 模式「添加全球海关监管属性」/ 税率代码 `8308909000` / 种类 `其他` |

> 合规项**按店铺读，不写死**；模板已带入时仍再覆盖一次（保存前校验要求点过「刷新资质信息」）。

---

## 三、执行顺序（23 步，顺序即正确性）

`listing-engine.js` 显式 step 序列，`required=true` 失败即中断（Fail-Closed），`false` 只记 attention：

| 步 | 名称 | 必中断 | 为什么在这个位置 |
|---|---|---|---|
| 0 | 前置门 | ✅ | 遮罩压制自检 + 登录态检测 |
| 1 | 店铺 | ✅ | 未选店铺时「引用模板」静默无反应 |
| 2 | 引用产品模板 | ✅ | **会整体重置表单**，必须早于一切写入（否则先填的被冲掉） |
| 3 | 分类落定门 | ✅ | 本店模板只带「产品属性」不带分类 → 分类空则属性区/变种区**根本不渲染** |
| 4 | 备货类型 | ✅ | 模板会重置它，必须在其后 |
| 5 | 产品标题 | ✅ | |
| 5.5 | 来源URL | ⬜ | 非必填，空则留痕 |
| 6 | 材质 | ✅ | 先自检 `[id^=rc_select_]` 是否渲染，未渲染直接指回第 3 步 |
| 7 | 其余必填属性 | ⬜ | 类型/品牌/产地/省份/高关注化学品，缺值选合法枚举+留痕 |
| 8 | 主图 | ✅ | 路径先验存在性，缺图抛错 |
| 8.5 | 营销图 | ⬜ | |
| 9 | PC端描述 | ✅ | |
| 10 | 变种参数 | ✅ | |
| 10.5 | 变种自定义名称 | ⬜ | 行数校验 + 重名检测 |
| 10.6 | 图片完整性 | ⬜ | 营销图/每色图/主图尺寸缺口汇总为 attention |
| 11 | 供货价与SKU | ✅ | 行数 == rows，逐行回读 |
| 12 | 包装重量尺寸 | ✅ | 4 个 input 同一 step（原来只填尺寸 → 保存必报「请填写重量」） |
| 13 | 物流属性 | ⬜ | 逐行铅笔 → 对话框 → 普货 |
| 14 | 库存 | ⬜ | 库存格不是 input，按列索引必取不到 |
| 15 | 无线端描述 | ⬜ | 弹窗残留风险，失败不放弃 |
| 16 | 合规信息 | ⬜ | |
| 17 | 海关属性 | ⬜ | 倒数第二步 |
| 18 | **保存前统一回读** | ✅ | 标题 / SKU 编码数组 / 重量数组三者任一不一致 → **硬失败**（钱与编码口径，带错值保存比失败更糟） |
| 19 | 保存草稿 + 草稿校验 | ✅ | 见第四节 |

### 两条路径的跳过规则

| 步骤 | 引用模式（reference） | 采集箱模式（collect） |
|---|---|---|
| 主图/营销图/每色图上传 | 执行 | **跳过**（保留采集源图） |
| 变种参数 + SKU | `keepVariants` 默认沿用模板 | **沿用源变种**（除非行内 `variantOverride`） |
| 无线端描述 | 一键生成 | 跳过（弹窗会拦住备货类型下拉） |
| 产品属性补填 | 模板带入则 skip | 未套模板时补填 + 材质覆盖 + **一键翻译成英文** |
| 保存循环 | server.js 统一 | `processCollectBatchRow` 单 owner（避免 save×7 / 翻译×8） |

---

## 四、保存判据：自述不可信，只认列表

```
save() 自述  ≠  保存成功
待发布列表（/web/smtChoice/offline）搜得到标题  =  真的落库
```

`verifyDraft(adapter, title)`（`listing-engine.js:132-185`）：
1. 新开页面 → `tableSearchInput` 搜索；搜索键 = 全文 + 「去符号后前 28 字」compact；
2. 命中行取 `rowid`（→ draftId）、`编辑` 的 `href`（→ editUrl）、行文本前 140 字；
3. **保存前先快照同名草稿的所有 rowid**，保存后再搜 → 只有出现**新 rowid** 才判 `isNew=true`；
4. `found && !isNew` → **硬失败**（重复标题被拦 / 保存按钮点了没生效，实测出现过 `success:1` 而实际零新草稿）；
5. `save()` 自述失败但列表搜到 → 判成功 + attention（记录两者差异，不掩盖）。

回读三态原语（`dianxiaomi-verify.js`）：`VERIFIED / MISMATCH / UNREADABLE`。
- 空值永不判通过（`''` vs `''` 会被判"填进去了"，正是要消灭的静默失败）；
- 金额按**整数分**比；SKU 编码**去空白+大写严格相等**；颜色/尺寸必须 `strict`（否则「肤色深」与「肤色」互判通过）。
- 已接入 `fillInputVerified / noteUnverified`；**尚未全量接入** `sameSkuCode / sameMoney / pickEnumReadback`。

---

## 五、现状缺口（诚实清单，按修复收益排序）

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| 1 | **同一 `rc_select_N` 在不同 profile 含义不同** | `xiangBao` 材质=`rc_select_15`、产地=`rc_select_14`；`ruTie` 材质=`rc_select_18`、产地=`rc_select_13`、暴露图片=`rc_select_15` | 换类目沿用旧序号会**填错字段且自证成功**。修法：只按 label 定位，id 仅作兜底并要求 profile 显式声明 |
| 2 | **`xiangBaoFold` / `bagCharm` 的 `stockType` 仍是失效值「国内备货」** | `config.js:349,421`；`xiangBao` 同字段注释明确「旧值不在下拉中，会导致保存失败」 | 两个子类目必卡在备货类型 → 保存失败 |
| 3 | **回执只有 5 字段**，无 draftId/editUrl | `已完成产品/仿真食物挂件/dianxiaomi-upload.json` | 无法复用草稿（重复跑会造第二条）、无法回溯线上对象 |
| 4 | **facts schema 与真实 facts 不一致** | schema `additionalProperties:false` 无 `mainKeyword`/`type`/`matrix`/`colorMap`；`category` required + `minLength:1` 但 `normalizeDianxiaomiFacts` 给 `""`；`unit` 声明 `string` 但生成器给 `null`；`images.main` 要求"路径"实际存文件名 | 每次稳定 9 条 `SCHEMA_INVALID`（与产品无关） |
| 5 | **旧 `fillFromFacts` 与 `listing-engine` 两套顺序并存** | `adapter:2423-2754` vs `listing-engine:196-661` | 同一产品两条路径结果不同，谁在跑取决于入口 |
| 6 | 图片预处理硬编码跨项目 Python 路径 | `listing-engine.js:37` `D:////ecom-translator////.venv////Scripts////python.exe` | ecom 目录一动，主图缩放静默退回原图 |
| 7 | 中文文案点击 + 固定序号双击风险 | 「保存」用 `hasText` 过滤（存在误点「保存并移入待发布」的风险） | 已在采集箱用「操作列直链」规避，引用模式未统一 |

---

## 六、提案：显式草稿格式 v2（`draft_plan.json`）

把三源焊成**一份可审计、可指纹、可 dry-run 的计划**，执行器只读计划不留即兴判断（借 ecom `field_plan.json` 骨架）。

### 6.1 契约

```json
{
  "plan_version": 2,
  "operation": "CREATE_DRAFT",
  "profile_key": "xiangBao",
  "input_fingerprint": "sha256(facts+row+profile+template+sku_rows)",
  "status": "PLANNED",
  "field_plan": [
    { "section": "basic", "field": "备货类型", "canonical": "stockType",
      "action": "FILL", "value": "国内履约", "source": "profile.fixed.stockType", "reason": "" },
    { "section": "attr", "field": "中国省份(CN)", "canonical": "originProvince",
      "action": "FILL_WITH_REVIEW", "value": "浙江(Zhejiang)", "source": "fallback", "reason": "facts 无此字段，按原产地兜底" },
    { "section": "package", "field": "包装重量", "canonical": "weightKg",
      "action": "FILL_WITH_REVIEW", "value": "0.12", "source": "default", "reason": "facts 无重量，净重100g+包装20g" },
    { "section": "compliance", "field": "欧盟责任人", "canonical": "euResponsible",
      "action": "PRESERVE_OR_VERIFY", "value": "GET RICH", "source": "profile.compliance", "reason": "模板已带入，仍回读核验" }
  ],
  "blockers": [],
  "attention": [],
  "draft_ref": { "draft_id": "", "edit_url": "", "title_key": "" },
  "result": null
}
```

### 6.2 四条硬规则

| 规则 | 内容 |
|---|---|
| action 只有 6 档 | `FILL` / `FILL_WITH_REVIEW` / `PRESERVE_OR_VERIFY` / `SKIP` / `MISSING_SOURCE` / `DISCOVER_ON_PAGE` |
| `MISSING_SOURCE` 必须进 `blockers` | 缺资料**禁止编造**，也不许"选个最近的枚举"混过去（兜底枚举一律降为 `FILL_WITH_REVIEW` + reason） |
| **只有 `PLANNED` 才允许开浏览器** | `REVIEW` 带 blockers，直接 skip 并回报，不开页面 |
| 指纹相同 → 复用不重建 | 命中 + `result.status=DRAFT_VERIFIED` + 有 `draft_id` → 直接归档；有 `edit_url` → 走更新不新建 |

### 6.3 结果状态（统一 6 态）

| 状态 | 判据 |
|---|---|
| `DRAFT_VERIFIED` | 列表搜到 + 新 rowid + 无 attention |
| `DRAFT_REVIEW` | 列表搜到 + 新 rowid + 有 attention（兜底枚举/默认包装/图片缺口） |
| `FILLED_NOT_SAVED` | 只填未 commit（dry-run） |
| `SAVE_UNKNOWN` | 点了保存但列表搜不到 → **禁止重试创建**（否则造第二条） |
| `SAVE_UNVERIFIED` | 搜索框都没出现，无法判定 |
| `BLOCKED_NEEDS_HUMAN` | 带 blockers 未开浏览器（一等状态，不是异常） |

### 6.4 落地顺序（不按这个顺序会返工）

```
① 统一 facts 契约（schema / prompt / 生成器 → 1 份）
② 修 profile 序号与失效枚举（风险 1、2）
③ draft_plan.json 契约 + dry-run（只生成计划，不写页面；可离线单测）
④ 执行器只读计划（listing-engine 改造入参）
⑤ 回执补 draft_id/edit_url/title_key → 幂等四层
⑥ 三态回读全量接入（sameSkuCode/sameMoney/pickEnumReadback）
```

### 6.5 验收（每条都能证伪）

1. 同一产品连跑两次 → 第二次 `IDEMPOTENT_REPLAY`，草稿总数不变；
2. 删掉 facts 的材质 → 计划里出现 `blockers`，**浏览器未打开**；
3. 换到 `bagCharm` → 备货类型能选中（现状必失败）→ 证明风险 2 已修；
4. 计划指纹相同 → `field_plan.json` 逐字节一致（确定性）；
5. 保存后回执含 `draft_id`，用它二次打开是**同一条**草稿。
