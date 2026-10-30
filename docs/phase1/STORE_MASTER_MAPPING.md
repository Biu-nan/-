# 店铺主数据映射｜STORE_MASTER_MAPPING

- 对应指令：04 §D3 + 决策记录 Q2
- 实现：`dist/src/product-identity-service.js` → `registerStore()` / `canPublishToStore()`
- 存储：`data/identity/store-master.json`（叠加层，**不修改** `store-profiles.json`）

---

## 1. 现状（实测）

`store-profiles.json` 共 **2 条**记录：

| store_id | store_alias | platform | store_role | status |
|---|---|---|---|---|
| `d7449032-0e4e-4396-8968-08b4817cde27` | Phase1A Test Store | AliExpress | test | enabled |
| `02b6af05-4252-495f-b217-339610aea6d1` | 洛慈三店 | AliExpress | main | enabled |

**没有**「纳物-箱包全托1店」，也没有任何与外部编号 `400370` 关联的字段。

即：逐店刊登所需的 `store_id` 在店铺主数据里不存在 → 若不解决，`store_listings` 无从建立。

---

## 2. 为什么不直接改 store-profiles.json

| 理由 | 说明 |
|---|---|
| 它是生产数据文件 | 基线 §9.2「不在生产环境执行数据库迁移」；阶段 1 只做隔离登记 |
| 它没有外部编号字段 | 直接加字段会让「生产店铺档案」与「待核验登记」混在一起，核验状态无处安放 |
| 回滚成本 | 改生产文件后回滚要恢复原文件；叠加层只要删一个文件 |
| 边界清晰 | 叠加层可以只读引用 `source_store_id`，未来正式核验后再决定是否合并回主档 |

因此采用**叠加层（augmentation）**：`data/identity/store-master.json` 只增不改。

---

## 3. 登记结果

启动时幂等登记（`dist/src/server.js`，`identityService.registerStore(...)`）：

```json
{
  "store_id": "029555ee-cfaa-4626-baa2-855f12cf0143",
  "store_name": "纳物-箱包全托1店",
  "external_store_code": "400370",
  "external_id_namespace": "UNKNOWN_PENDING_VERIFICATION",
  "verification_status": "PENDING_VERIFICATION",
  "publishing_allowed": false,
  "source": "MANUAL_REGISTRATION_PHASE1",
  "source_store_id": null,
  "evidence_ref": "docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md#Q2 / 05_开发基线决策记录_R1.md#Q2",
  "registered_at": "2026-10-30T04:28:55.660Z"
}
```

### 3.1 字段语义

| 字段 | 值 | 说明 |
|---|---|---|
| `store_id` | 系统生成 UUID | 内部主键，**永不是 400370** |
| `external_store_code` | 字符串 `"400370"` | 外部编号，只作字符串比较，不参与任何主键/索引 |
| `external_id_namespace` | `UNKNOWN_PENDING_VERIFICATION` | 来源命名空间待核验（店小秘？速卖通账号？），**不猜** |
| `verification_status` | `PENDING_VERIFICATION` | 三态：PENDING_VERIFICATION / VERIFIED / REJECTED |
| `publishing_allowed` | `false` | 硬闸：核验通过前不允许为 true |

### 3.2 代码级防止「400370 当主键」

```js
const storeId = randomUUID();
if (storeId === externalStoreCode) {
    throw new Error("内部 store_id 与外部编号冲突，拒绝登记");
}
```

并且外部编号格式校验 `^[A-Za-z0-9_-]+$`，只接受字符串。

---

## 4. 发布门禁

```js
identityService.canPublishToStore(storeId)
```

| 情形 | 返回 |
|---|---|
| 店铺未登记 | `{ allowed:false, reason:"STORE_NOT_REGISTERED" }` |
| 核验未通过 | `{ allowed:false, reason:"STORE_PENDING_VERIFICATION" }` |
| 核验通过但未开启发布 | `{ allowed:false, reason:"PUBLISHING_NOT_ALLOWED" }` |
| 三项都满足 | `{ allowed:true, reason:"OK" }` |

运行时实测（`GET /api/identity/stores/<uuid>/publish-gate`）：

```json
{ "storeId": "029555ee-...", "gate": { "allowed": false, "reason": "STORE_PENDING_VERIFICATION" } }
```

该门禁目前**尚未接入**任何发布路由（阶段 1 不建发布链路），只是先立好契约。

---

## 5. 幂等

- 以 `external_store_code` 为自然键；
- 重复登记返回 `created=false` + 原 `store_id`；
- 实测：连续两次登记，`stores.length` 恒为 1。

启动时自动登记一次，进程重启不会产生第二条。

---

## 6. 与现有 2 个店铺的关系

| store-profiles 记录 | 叠加层处理 |
|---|---|
| `d7449032` Phase1A Test Store | **不登记**。它是测试店铺，不属于纳物业务店铺 |
| `02b6af05` 洛慈三店 | **不登记**。阶段 1 只处理 Q2 明确要求的纳物首店；避免批量触碰生产店铺 |
| — | 新登记 `029555ee` 纳物-箱包全托1店（待核验） |

未来若要统一，可给叠加层加 `source_store_id` 指向 `store-profiles` 记录；当前 400370 的 `source_store_id` 为 `null`，因为它在主数据里根本不存在 —— 这本身就是要核验的内容之一。

---

## 7. 待核验清单（PENDING_VERIFICATION 的具体含义）

| 项 | 谁来核验 | 核验后动作 |
|---|---|---|
| 400370 的命名空间（店小秘店铺ID / 速卖通账号ID / 纳物内部编号） | 经营者 + 店小秘后台比对 | 填 `external_id_namespace` |
| 该店铺在店小秘的真实操作入口 | 经营者 | 决定后续 RPA 路径 |
| 该店铺是否已有在售商品 | 经营者（稳卖/店小秘） | 决定是否需要与 `listing-cards` 对齐 |
| 账号归属（哪个平台账号） | 经营者 | 填 `platform` |

核验完成前：`publishing_allowed=false`，不可创建任何真实发布任务。
