# 阶段2B 真实产品候选 Top 5（只读筛选）

> 关联：REAL_EXECUTION_PREFLIGHT.md 任务3
> 范围：`已完成产品/` 下 130 个可读目录，119 个满足「facts+profile+≥2 图」。
> 原则：优先**通用品（无品牌/IP 风险）+ 资料完整 + 图够 + 可匹配箱包/钥匙扣类模板**；本次**未登记、未改动任何生产数据**。

---

## 0. 重要前置风险（务必先读）

1. **产品身份双 ID**：`product-facts.productId` 绝大多数 = `1005005575013300`（平台 facts id，**不可作唯一标识**）；唯一身份请用 **`product-profile.productId`（UUID）**。
2. **图片与产品一致性**：脚本无法可靠判定「图=品」，**必须经营者目检**（尤其下面候选的 `产品图/`）。
3. **材质缺失**：部分候选 `material=null`；店小秘材质为必填，模板可能带默认值（但可能不准）。
4. **模板可用性**：目前无 CAPTURED 模板快照，全部候选在真实执行前都需先完成模板捕获（见 `TEMPLATE_CAPTURE_READINESS.md`）。

---

## 1. Top 5 候选

### 🥇 P0 推荐 · 迷你石锅按键解压钥匙扣
| 项 | 值 |
|----|----|
| profileId (UUID) | `758ee6cf-2f4a-49e5-b109-ac596b627fc8` |
| 原始目录 | `已完成产品/迷你石锅按键解压钥匙扣/` |
| 图片数 | 3（产品图/） |
| 资料完整度 | 高：material=**有**、keyAttributes=8、SEO+Listing 产物齐全 |
| 模板可用性 | 类目匹配（钥匙扣/挂件），候选模板「箱包配件-包饰」类；**待捕获** |
| 风险 | 图偏少（3 张，店小秘主图需多槽位，可能触发回退）；需目检图品一致 |
| 证据 | profile.identity.category 含钥匙扣；facts.material 非空；output 含 03_SEO/04_LISTING |

### 🥈 P1 · 音乐发声解压钥匙扣
| 项 | 值 |
|----|----|
| profileId (UUID) | `4e70cec4-8596-4fe3-ab60-adadc04009c0` |
| 原始目录 | `已完成产品/音乐发声解压钥匙扣/` |
| 图片数 | 3 |
| 资料完整度 | 高：material=**有**、keyAttributes=**15**（最丰富）、SEO+Listing 齐全 |
| 模板可用性 | 类目匹配（钥匙扣/发声玩具）；待捕获 |
| 风险 | 图偏少；"发声/电子"属性可能涉及电池合规，需目检说明 |
| 证据 | keyAttributes 15 条；material 非空；output 齐全 |

### 🥉 P2 · 豌豆荚挤压挂件
| 项 | 值 |
|----|----|
| profileId (UUID) | `27281682-e7bb-4034-b8e7-30a486ce81aa` |
| 原始目录 | `已完成产品/豌豆荚挤压挂件/` |
| 图片数 | **9**（最充足） |
| 资料完整度 | 中高：material=**缺**、keyAttributes=12、SEO+Listing 齐全 |
| 模板可用性 | 类目匹配（挂件/包饰）；待捕获 |
| 风险 | 材质缺失（依赖模板默认值，可能不准）；图多利于 listing 但需目检 |
| 证据 | 9 张产品图；keyAttributes 12；material=null |

### P3 · 三泡按压钥匙扣
| 项 | 值 |
|----|----|
| profileId (UUID) | `c2195802-a7ea-45aa-87db-19e4cee5752e` |
| 原始目录 | `已完成产品/三泡按压钥匙扣/` |
| 图片数 | 7 |
| 资料完整度 | 中高：material=**缺**、keyAttributes=13、SEO+Listing 齐全、output 另有 10 张生成图 |
| 模板可用性 | 类目匹配；待捕获 |
| 风险 | 材质缺失；objectiveInfo 为空（需补/由模板或事实补） |
| 证据 | 7 图 + output/Image_01..10；profile.artifacts 完整 |

### P4 · 复古立体篮球钥匙扣
| 项 | 值 |
|----|----|
| profileId (UUID) | `4e509f8f-2b65-4c56-92e5-533a4348d038` |
| 原始目录 | `已完成产品/复古立体篮球钥匙扣/` |
| 图片数 | 3 |
| 资料完整度 | 中：material=有、keyAttributes=5、SEO+Listing 齐全；factsId 为空 |
| 模板可用性 | 类目匹配；待捕获 |
| 风险 | keyAttributes 偏少；"复古篮球"若涉球队/联盟 logo 有 IP 风险，需目检 |
| 证据 | material 非空；keyAttr 5；output 齐全 |

---

## 2. 决策建议（给经营者）
- **首次真实执行（重稳不重快）**：选 **P0 迷你石锅** 或 **P1 音乐发声**——材质齐全、类目清晰、通用无品牌，字段风险最低。
- **若要 listing 质量更好（图多）**：选 **P2 豌豆荚(9图)** 或 **P3 三泡(7图)**，但需先解决 `material`（模板默认或补 facts）。
- **P4** 仅在目检确认无球队/IP logo 后考虑。
- 无论选谁：**先目检 `产品图/` 与品名一致**，再确认类目对应的店小秘模板名，然后走模板捕获。

## 3. 排除项
- 品牌类（Coach/Chanel/Longchamp/Celine/LV/Gucci… 共 4 个以上）→ **IP 风险，不作首次样本**。
- 图 <2、缺 facts/profile、factsId 大面积共享的同一批次 → 不作首选。

## 4. 未做
未登记任何产品到 board、未写入生产 `已完成产品/`、未创建任务、未改任何生产数据。
