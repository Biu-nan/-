# ecom-translator 适配器核验（ECOM_ADAPTER_AUDIT）

> 关联：任务三。核验 ecom 已验证的店小秘上品实现 + 一跨 `dianxiaomi-adapter.js` 的字段映射与是否重复开发。
> 只读研究，未执行任何上品/保存/发布。

---

## 1. ecom-translator 已验证实现（基准）

### 1.1 浏览器托管 `dianxiaomi_browser_service.py`
- CDP `http://127.0.0.1:9223`、专用 profile `work/dianxiaomi-browser-profile`；
- `DETACHED_PROCESS|CREATE_NEW_PROCESS_GROUP` 启动（否则启动者退出浏览器即死）；`--remote-allow-origins=http://127.0.0.1`、`--disable-extensions`；
- `status()` 只探 `/json/version`；`ensure_ready()` 缺则拉起并等就绪。

### 1.2 草稿执行器 `tools/dianxiaomi_draft_executor.mjs`（965 行，**只存草稿，无发布**）
目标页 `https://www.dianxiaomi.com/web/smtChoice/add`；顺序：
店铺(`#rc_select_0`) → **引用模板**(`引用产品`btn-orange.last → `引用产品模板` → `tr` 按模板名前缀选行 → 点行内`引用` → `assertTemplateTookEffect`) → 备货类型(`#rc_select_1`) → 产品标题 → 来源URL → 材质(`#rc_select_15`，枚举映射) → 图片空间/PC描述 → 主图(≤6, 缺图回退) → 营销图 → SKU自定义名/变种图 → 供货价+SKU编码(逐行回读) → 包装重量/尺寸 → 物流属性(普货) → 库存 → 无线端描述 → 欧盟责任人/品牌制造商(按店铺 compliance) → 海关监管(仅布材质) → **保存前字段回读** → 保存草稿 → `verifyDraft()`。

### 1.3 成功判定
- `verifyDraft(context,title)` 在**待发布列表**查草稿；查不到 → `SAVE_UNVERIFIED`/`SAVE_UNKNOWN`，**明确禁止重试创建**（防重复草稿）。
- 保存前**逐字段回读**（标题/SKU编码/重量）不一致即抛错。
- `audit.status`：`DRAFT_VERIFIED` / `DRAFT_REVIEW`(有 attention) / `FILLED_NOT_SAVED` / `ERROR`。

## 2. 一跨 `dianxiaomi-adapter.js`（316KB）核验

### 2.1 主模板机制 = 引用产品模板（与 ecom 对齐）
- `applyProductTemplate(templateName)`（line 3460+）：`button:has-text("引用产品")`.last() → `.ant-dropdown-menu-item` 可见「引用产品模板」→ 弹窗 → 按模板名选行（`templatePrefixOf` 剥离 `-星造`）；**2 轮重试**；源码注释明确溯源 ecom `draft_executor.mjs:792/131`。
- 另有 `referenceProduct(templateId)`（line 615，**引用现有产品**按 `templateProductId` 搜索）——次要/备用路径，与主流程的"引用产品模板"是两套。

### 2.2 字段映射（Product Context → 店小秘）
| 一跨来源 | 店小秘字段 | 说明 |
|----------|-----------|------|
| title（facts/title.zh） | 产品标题 | `focus+全选+键入+value校验`（防引用模板残留旧标题） |
| images.main / 主图 | 产品图片（≤6 槽位） | 引用模板带旧图先清空；缺图回退（翻译→原图→REVIEW 占位） |
| sku_plan.write_rows（custom_name/supply_price/sku_code/sku_image_url） | 变种表 SKU 自定义名/供货价/SKU编码/变种图 | 供货价与编码**逐行回读** |
| material | `#rc_select_15`（材质枚举） | `materialCandidates/map`：ABS→塑料、硅胶→橡胶、锌合金→锌合金…（不在枚举时按事实选最近并写 attention） |
| sourceUrl（`_URL.txt` 四段式） | 来源URL | 为空则 ATTENTION（不阻断，但建议补） |
| store | `#rc_select_0` 店铺 | 引用模板前必选（否则模板列表空/选错） |
| templateRef | 引用产品模板 | 按模板名，剥离 `-星造` |

### 2.3 店铺/模板选择
- 先选店铺（`selectStore`/`#rc_select_0`），再 `applyProductTemplate`；**模板按店铺过滤**（与目录审计一致）。
- 模板名前缀匹配（`templatePrefixOf`），避免点到表头。

### 2.4 保存后判定 / 重试 / 幂等
- 保存后 `verifyDraft`（待发布列表）同 ecom 口径；失败不重试创建。
- 模板弹窗 2 轮重试；Worker `maxAttempts=3`；任务四要素幂等键（productId|workflowType|contextVersion|executionMode）。
- 宿主 `busy` 闸门 + 执行锁（见 `SHARED_CDP_LOCK_AUDIT.md`）。

### 2.5 是否有发布动作
- **无**。一跨 adapter 与 ecom executor 均只点「保存」，**无「发布」按钮调用**（`draft_only`）。首屏自检含「登录|验证码|真人验证」即停。

## 3. 是否重复开发已有功能（任务三关键判定）

- **是，存在重复实现**：一跨 `dianxiaomi-adapter.js`（316KB）是店小秘流程的**完整重写**，其模板前缀匹配、材质枚举映射、海关联动、遮罩压制等均**溯源并复刻** ecom `dianxiaomi_draft_executor.mjs`（965 行）。
- 两者主机制一致（引用产品模板/材质枚举/只存草稿/保存前回读/verifyDraft），但**两套代码各自维护**，存在漂移风险（一跨已因复刻产生多次注释级踩坑记录）。

**最小化建议（不重复开发）**：
- 短期：一跨 Listing 的"店小秘存草稿"一步**委托 ecom 已验证的 `dianxiaomi_draft_executor.mjs`**（同一 9223、同一 profile），一跨只负责产出 `field_plan`（ERP 计划）并读取其 `draft_execution_audit.json`；避免维护第二套 316KB 适配器。
- 若必须自持：把"模板定位/材质映射/海关联动/遮罩压制"抽成**单一共享模块**，两侧引用同一份，禁止各写一份。

## 4. 未做
未执行任何上品、未保存草稿、未发布、未改一跨/ecom 代码。
