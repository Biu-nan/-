# 借 ecom 的三样东西：SKU 来自链接、发布新品→引用模板、填充准确性规则

> 2026-10-26。依据：实读 `D:\ecom-translator\collector\sku.py`、`src\erp_sku_table.py`、`src\erp_planner.py`、
> `tools\dianxiaomi_draft_executor.mjs`；对照 `F:\yikuaborder-deploy\dist\src\dianxiaomi-adapter.js`（4248 行）、
> `dianxiaomi-facts.js`、`batch-listing-create.js`。
> 本文只讲这三件事，不重复 `docs\ECOM_WORKFLOW_MIGRATION_MATRIX.md` 的全链路判定。

---

## 〇、结论

| 你点的三处 | ecom 的真正做法 | 一跨现状 | 可迁移性 |
|---|---|---|---|
| **链接中的 SKU** | 商品页用 AliPrice 导出 SKU CSV → 归一（**双币种不猜**）→ 装载（15 类别名、唯一键、说明行过滤）→ 计划（库存门槛、变体命名、重名门禁）→ `sku_plan.rows` 与 `write_rows` 分开存 | SKU 由 **AI 看图猜** 或 SKU 规划卡手填；`fillSkuRow` 只认 4 个值，无来源表、无币种口径 | ⭐⭐⭐ 高。缺的是"表"这一层，不是技术难度 |
| **发布新品 → 引用模板** | 新建 add 页 → 选店铺 → **引用产品模板（类目唯一来源）** → **断言模板生效** → 备货 → 标题 → … | 已有 `applyProductTemplate()`，但成功判据是"弹窗关闭 + 无 loading"（**点了就算），无生效断言**，行匹配还有 fuzzy 回退 | ⭐⭐⭐ 高。改动小，防的是一类整批误判 |
| **填充准确性** | 统一原语 `commit(write→read→compare)` + 三态；**写入必须真实键盘**、回读必须读目标控件自身、MISMATCH 抛 / UNREADABLE 按字段定 | `inp.value=…` + `dispatchEvent` 直接赋值，**零回读**；包装尺寸有 verify 但注释写明"不抛错，仅记日志"且只抽查首行 | ⭐⭐⭐⭐ 最高。这是"填对了没有"的唯一防线 |

一句话：**SKU 补的是"钱和数据从哪来"，模板补的是"页面结构对不对"，回读补的是"到底填进去没有"。** 三者不重叠，缺任何一个都会让草稿"看起来成功"。

---

## 一、SKU 来自商品链接

### 1.1 ecom 的四段链路

```
offer URL（1688）
  └─ collect_sku_csv()          浏览器扩展在商品页导出 SKU CSV
       列：SKU 图片 / SKU名称 / SKU ID / 价格 / 价格2 / 运费 / 库存 / 计算价格
  └─ collector/sku.py           归一：**双币种不猜**，按店铺结算币种显式选一列并改名「供货价」
  └─ src/erp_sku_table.py       装载：15 类别名、编码三级回退、唯一键、说明行过滤
  └─ src/erp_planner.py         计划：库存门槛 → 变体上限 → 命名 → 消歧 → 重名门禁 → write_rows
```

四个关键设计（每一条都有对应事故）：

**① 双币种不猜。** AliPrice 同时给 `价格`(CNY) 和 `价格2`(USD)，`erp_sku_table` 故意拒绝替用户二选一：

```python
if has_price and has_price2:
    raise SkuTableError('SKU 表同时存在"价格"和"价格2"；请由店铺配置或 --supply-price-column 明确供货价列。')
```

`collector/sku.py` 的做法是**做一次显式选择并留证**，不是猜：把 CNY 列改名为 `供货价`，理由写进 `report['reason']`（"本店国内履约、采购价以 CNY 结算"），**价格与库存数值一个都不改**。

**② 无币种即报错，绝不默认 CNY。** 币种来源是 `currency` 列或 `US$/¥/€/£` 符号推断；两样都没有就抛。

**③ 原值可审计。** `sku_plan.rows`（商家表原始行）与 `sku_plan.write_rows`（实际写入值）分开存。页面填的是 write_rows，出问题回查 rows。

**④ 库存门槛与变体上限保序择优。** `config.json`：`sku_min_stock=30`、`sku_max_variants=28`。先门槛后上限，按库存降序选，但**输出保持原表顺序**（否则 SKU 行序与销售属性勾选顺序错位）。

### 1.2 一跨现状

| 环节 | ecom | 一跨 |
|---|---|---|
| SKU 从哪来 | 商品页导出 CSV | `config.js:234` 的 prompt 让 AI 从图里列 `variants.skus`；或 SKU 规划卡手填 |
| 供货价来源 | 表中 `supply_price`（真实采购价） | AI 猜或人填（`price: 3.5` 这类占位） |
| 币种 | 显式列或符号，缺失即报错 | 无概念 |
| 库存 | 表内真实库存 + 门槛过滤 | 无来源 |
| 变体矩阵 | 表行 → 矩阵 | 人工"生成组合表"（默认 One Size） |
| 写入 | `write_rows` | `fillSkuRow` 直接吃 `matrix[i]` 的 price/stock/barcode/sku |

**风险直说**：Choice 半托管里供货价直接决定钱。AI 从图里猜一个 `3.5`，和真实采购价 16.74 差 4 倍，没有任何环节会拦。

**一个刚查到的事实**：`已完成产品/` 有 169 个产品目录，其中只有 **1 个**带着 SKU 表（`幸运草…_956873405999_sku_list.csv`，真实 AliPrice 导出、双币种、库存 31916/33308/34245）。也就是说**输入端几乎没通**，而这一张恰恰证明表一旦进来就能用。缺的不是能力，是"每张链接都要有一张表"这一步。

### 1.3 已落地：`dist/src/sku-table.js`（纯逻辑，零浏览器依赖）

```js
loadSkuTable({ text, supplyPriceColumn, defaultProductId, storeId })
  -> { headers, rows, currency, supplyPriceColumn, supplyPriceReason, problems, warnings }
   - CSV 解析支持双引号包裹（AliPrice 的 SKU ID 写成 "5881525976425"，裸 split 会把引号留在值里）
   - 10 类别名归一（去空白/下划线/括号 + 小写）
   - 双币种：同时有 价格 与 价格2 → `DUAL_CURRENCY`，**不返回任何行**，等显式指定
   - 无币种符号 → `CURRENCY_UNKNOWN`（不默认 CNY）；混币种 → `MIXED_CURRENCY`
   - 必填 SKU 列；唯一键 (productId, store, sku) 重复 → `DUPLICATE_KEY`（不去重，静默去重会让"少一个变体"永远查不出来）
   - 说明行过滤：`/勿拍|以上为|需勾选|合计|备注/` 命中即跳过并留 warning
planSkuRows(rows, { minStock, maxVariants })
  -> { kept, dropped, stockFilter }   先门槛后上限，按库存降序择优，**输出保持原表顺序**
buildWriteRows(rows, { customNameLimit=20, inventory=50, warehouse, customNameBuilder })
  -> writeRows[]  原值（sourceCustomName/sourceInventory/sourceSkuId）与写入值同存
```

**验证用的是真实数据**：`已完成产品/幸运草…_sku_list.csv`（真实 AliPrice 导出，3 个变体，双币种，库存 31916/33308/34245）。`scripts/verify-sku-table.mjs` **37/37 PASS**，其中关键几条：

| 断言 | 结果 |
|---|---|
| 不指定列时装载 | 报 `DUAL_CURRENCY`，**0 行**（不替你选币种） |
| 指定 `价格` 列 | 3 行、CNY、供货价 1.49、`supplyPriceReason` 记录选列理由 |
| SKU ID 引号 | `"5881525976425"` → `5881525976425` |
| 库存是真实值 | 31916（不是硬编码 50） |
| 门槛 33000 | 留 2 掉 1 |
| 上限 2（库存降序后） | 输出仍是原表顺序（33308 在 34245 前） |
| 中文变体名 | 落 `fallback` + `customNameRequiresHumanReview=true`（不假装翻译成功） |
| 注入 builder | 用 builder 输出并截断到上限 |

**必须保留的红线**：① 不换汇、不算佣金运费利润（Choice 只报供货价，售价由平台定）；② 原值与写入值分开存；③ 币种缺失不默认；④ **变体名不靠代码猜中文** —— 命名器必须按品类注入（ecom 那 600 条颜色/主题词典是箱包挂件的实测产物，换品类等于重写词表）。

---

## 二、发布新品 → 引用模板

### 2.1 ecom 的顺序，以及"模板必须第一步"的原因

`dianxiaomi_draft_executor.mjs:789-792` 的顺序是死的：

```
打开 add 页 → 遮罩压制自检 → 选店铺 → 引用产品模板 → 备货类型 → 标题 → 来源URL → 材质 → …
```

**类目不是独立步骤**——它由「引用模板」带出。模板没生效时：产品分类仍是"请选择分类" → 属性区不渲染（`#rc_select_15` 不存在）→ 变种区 0 项 → 后面每一步失败都只是这一个原因的下游症状。

所以 ecom 在模板后加了一道**后果断言**（`assertTemplateTookEffect`）：

```js
if (text && /请选择分类/.test(text))
  throw Error(`引用模板「${label}」后产品分类仍未带出：模板实际未生效，属性区与变种区不会渲染；请人工确认该店铺下是否仍有此模板。`);
// 读不到 ≠ 没生效：可能是读法不匹配当前页面，只留痕
return text ? '' : `引用模板后未读到产品分类，无法确认模板是否生效；请人工核对页面。`;
```

注意这道断言的**取窄原则**：只在"正面读到占位文案"时才抛；读不到只记 attention。

还有一处更隐蔽的：行匹配只认**以模板名开头**且含「引用」的 `tr`：

```js
const rows = page.locator('tr').filter({ hasText: expected });
for (...) { const text = await row.innerText();
  if (!text.startsWith(expected)) continue;   // 跳过外层容器行与表头
  if (!text.includes('引用')) continue;
  await clickText(row, '引用');
```

原因写在注释里：模板弹窗的**外层容器本身也是一个 tr**，它的文本同时含表头与模板名，`hasText` 会先命中它 → 点到表头的「引用模块」→ 模板其实没被引用。

### 2.2 一跨现状的三个差异

| # | 一跨实现 | 风险 |
|---|---|---|
| 1 | `applyProductTemplate` 的 `result.ok` = **弹窗关闭 + 无 loading**（`adapter:2821-2830`） | "点了"≠"生效"。ecom 曾 8/8 产品审计 SUCCESS 而材质框根本不存在，就是这个判据 |
| 2 | 行匹配 `filter({hasText: templateName}).first()`，找不到就 **fuzzy 回退 `/箱包配件\|包饰\|bag/i`**（`adapter:2735-2746`） | 可能引到**另一个模板**，而结果仍是 ok:true |
| 3 | 无"分类是否带出"的断言 | 一旦没生效，后续每个字段都会失败，但报错指向各自字段（把根因藏起来） |

### 2.3 落地规格

1. `applyProductTemplate` 末尾加 `assertTemplateTookEffect()`：读 `.ant-form-item` 里「产品分类」行，命中 `/请选择分类/` 就抛；读不到写 attention。
2. 行匹配改「以模板名开头 + 含『引用』」，**去掉 fuzzy 回退**——引错模板比引不到更糟（引错会把错误类目的属性一起带进来，而且看起来成功）。
3. 把模板 ID/名称与**期望类目**一起写进审计，事后可核对。

---

## 三、填充准确性规则（最值钱的一条）

### 3.1 一个原语 + 三态

ecom 的根因总结（注释原文）：**"写入动作与确认动作被分开写，每次都是个案修复（改这处、下处照旧）。"** 所以它把两者绑死：

```js
async function commit({ write, read, wanted, compare, settle = 180 }) {
  await write();
  await wait(settle);
  const readback = await read().catch(() => '');
  const verified = compare(readback, wanted);
  return { value: wanted, readback, verified, state: commitState(verified, readback) };
}
```

三态而不是二值：

| 态 | 含义 | 处置 |
|---|---|---|
| `VERIFIED` | 回读到目标值 | 过 |
| `MISMATCH` | 读到了值但不一致 | **抛**（钱/编码/重量类字段必抛） |
| `UNREADABLE` | 读不到（空） | **单独成态**——读不到只说明读法可能不对，不能倒推成"没写进去"，也不能当通过。由字段决定抛还是记 attention |

用 `escalateUnreadable` 逐字段区分：店铺、备货类型这类"读法不稳但填错代价可控"的传 `false`；标题、SKU 编码、供货价传 `true`（默认）。

### 3.2 八条细则（每条都对应一次真实事故）

| # | 规则 | 为什么 |
|---|---|---|
| 1 | **空值判定必须放在相等判定之前** | 否则 `''` 与 `''` 相等 → 判成"填进去了"。两侧都空说明这一步根本没写 |
| 2 | 数字按**数值**比，不逐字比 | 页面常把 `50` 渲染成 `50.00`，逐字比必误报 |
| 3 | 下拉回读读**目标控件自身**，不读"页面里任意一处看起来对的地方" | 合规主体曾用全页找文本点击，点了不产生选中效果，一路报 SUCCESS 而草稿仍是"请选择欧盟责任人" |
| 4 | rc-select 的 `input.value` **恒为空**，真实值在 `.ant-select-selection-item` | 旧实现第一行 `if INPUT return node.value` 就返回空，所有下拉 VERIFIED 退化成 UNREADABLE，回读形同虚设 |
| 5 | 写入必须**真实键盘**（click → Ctrl/Cmd+A → 逐字 → Tab），不用 `el.value = x` | React 受控组件会用 state 覆盖回原值；`dispatchEvent` 不能保证受控组件接受 |
| 6 | 回读对象错位会造出"恒通过"的假校验 | 无线端描述回读读的是左侧「添加模块」面板（字数恒 >20），内容还没渲染就点保存，草稿里是空的而审计全 SUCCESS |
| 7 | 保存前统一回读断言（标题 / 全部 SKU 编码 / 全部重量） | 逐字段 VERIFIED 之后表单仍可能被别的动作覆盖 |
| 8 | 保存后反查要区分「确认未找到」与「无法判定」 | 列表空搜索控制组 0 行时只能说"无法判定"，绝不能倒推"草稿不存在"——否则会重复创建 |

### 3.3 一跨逐处对照

| 位置 | 现在怎么写 | 缺什么 |
|---|---|---|
| `fillSkuRow`（adapter:3304-3340） | `inp.value = String(val); dispatchEvent('input'/'change')`，返回 `{ok:true, priceCol, stockCol}` | **零回读**。`ok:true` 只代表"赋了值"。React 是否接受、页面是否回退，全无证据 |
| `fillProductPackageSize`（adapter:2444） | 有 verify，但注释写明"**不抛错，仅记日志**"，且**只抽查首行** | 多行错位不报；值被覆盖不报 |
| `applyProductTemplate`（adapter:2821） | 判据是弹窗关闭 | 点完 ≠ 生效 |
| `fillFromFacts` 各字段 | 有的有 `inputValue().catch(()=>'')` 比较（2651/3583），有的没有 | 无统一原语 → "下处照旧漏" |
| 其它 | — | 无 attention 载体：未确认项不落审计，事后无法知道哪些是推的 |

### 3.4 已落地（本次，零风险）

- `dist/src/dianxiaomi-verify.js`：三态原语 + 一跨特化的比较器（`sameText` / `sameSelection` / `sameSkuCode` / `sameMoney` / `pickEnumReadback` / `commit` / `assertVerified` / `noteUnverified` / `assertRowsVerified` / `fillInputVerified` / `chooseVerified`）。**没有任何现有模块 import 它**，改它不影响运行。
- `scripts/verify-dianxiaomi-verify.mjs`：离线自测 **42/42 PASS**，覆盖空值、数值补零、编码前缀陷阱、下拉包含、三态映射、读失败降级、多行定位、真实键盘顺序、假件模拟 React 覆盖。

代码里额外补了三条 ecom 没有的：

- **`sameSkuCode` 禁用包含关系**。ecom 的 `sameSelection` 用 `includes`，对编码是危险的：`WDZAI-1` 与 `WDZAI-11` 会互判通过。编码必须去空白、大写、**严格相等**。
- **`sameMoney` 用整数分比较**。`3.5` vs `3.50` 相等、`¥16.74` vs `16.74` 相等，但 `3.5` vs `3.05` 不等——避免浮点误差把错价放过。
- **`sameSelection` 的 `strict` 选项**。默认允许包含（`普货（含电池）` vs `普货` → 通过），但**颜色/尺寸类字段必须传 `strict:true`**：默认值会让 `肤色深` 与 `肤色` 互判通过。
  （我最初用"≤3 字中文禁用包含"的长度启发式，自测直接打回——它把「普货」这种最常见的两字值也禁了。长度猜语义不可靠，改成调用方显式声明。）

### 3.5 决策记录（2026-10-26，Lance 已拍）

| 决策 | 结论 |
|---|---|
| SKU 表从哪来 | **接 ecom `collector.sku` 自动导**（CDP 9224 + AliPrice 扩展登录态）；消费者先做好 |
| 哪些字段回读不到要抛 | **②** 供货价 / SKU编码 / 库存 / 包装尺寸 / 标题 → 抛；其余 → 只记 attention |
| 改生产 adapter 的时机 | **现在改**，分两次：先模板断言，再 SKU 行与包装尺寸 |
| 变体命名器 | **接 ecom 那 600 条词典，两侧共用同一张表**（已抽成 `config/color-theme-dictionary.json`） |
| 标题 126–128 | **不进 blockers**，越界只触发一次重跑 |
| 主图几张算够 | **0 张阻断 / 1–5 张 attention / ≥6 正常** |

---

## 四、落地清单（2026-10-26 已完成）

| 项 | 文件 | 自测 |
|---|---|---|
| 共用词表（49 色 / 280 主题 / 6 金属色） | `config/color-theme-dictionary.json` | 条目数与源头一致、重复键已登记 |
| 词表驱动变体命名 | `dist/src/sku-naming.js` | `verify-sku-naming` **32/32**，含 33 条与 Python 实现逐字对照 |
| SKU 表装载与计划 | `dist/src/sku-table.js` | `verify-sku-table` **37/37**（真实 AliPrice 表） |
| 三态回读原语 | `dist/src/dianxiaomi-verify.js` | `verify-dianxiaomi-verify` **42/42** |
| 模板生效断言 + 去 fuzzy | `dist/src/dianxiaomi-adapter.js` | 语法检查；真机待验 |
| `fillSkuRow` 真实键盘 + 回读（A2=②） | `dist/src/dianxiaomi-adapter.js` | `verify-fillskurow` **21/21**（假件模拟 React 覆盖） |
| `fillSkus` 行级失败冒到上层 | `dist/src/dianxiaomi-adapter.js` | 同上 |
| SKU 失败进关键失败集 | `dist/src/server.js`（两处 `criticalFailures`） | 代码路径核对 |

**合计离线自测 132 项全过。** 服务已重启（PID 30652，watchdog 18s 拉起，启动日志无报错）。

命名器与 Python 的对照方式：fixture `scripts/fixtures/sku-naming-cases.json` 由
`D:\ecom-translator\.venv\Scripts\python.exe` 直接调 `_sku_custom_name` 生成 33 条，
JS 侧逐条比对 `value / source / requiresReview`。**不靠我读代码猜**——这是"移植"能被称为移植的唯一凭据。

## 五、真机验证清单（必须跑一次，离线测不出）

| # | 步骤 | 期望 | 失败意味着 |
|---|---|---|---|
| 1 | 引用模板 `箱包配件-包饰` | 返回 `templateEffect.categoryText` 含真实类目，`ok:true` | 若报「产品分类仍未带出」→ 模板名与弹窗行不一致，核对 `defaultProductTemplate` |
| 2 | 故意写一个不存在的模板名 | `ok:false` + `template-row-not-found` | 仍 `ok:true` → 行匹配逻辑没生效 |
| 3 | SKU 行填写（3–5 个变体的小包） | 返回 `applied` 每项 `state:"VERIFIED"`，`attention:[]` | 出现 `MISMATCH` → 页面回读与写入不一致，需看 `readback` 原值 |
| 4 | 同上，计时 | 单产品 SKU 步骤 ≤ 8s（每行 4 字段 × ~300ms） | 明显更慢 → 报风控或点击被拦截 |
| 5 | 包装尺寸 | `verifiedRows` = 实际写入行数，无异常 | 报「回读不一致」→ 检查是不是已有值的行被误比（应已排除） |
| 6 | 保存草稿 | 正常存草稿、不发布 | SKU 失败会让该行判 `failed`，看 `applied` 里 `field:"sku"` 的 `reason` |

真机只需跑一个 3–5 变体的小包，不需要整批。
