# 关注分层别名映射｜ATTENTION_LAYER_ALIAS_MAP

- 对应指令：04 §H + 决策记录 Q5（PRESERVE）
- 实现：`config/attention-layer-alias.json`（新文件，旁挂）
- **未修改**：`config/product-stratification.json`（字节不变）、`data/metrics/strata/2026-10-25.json`（字节不变）

---

## 1. 保护对象

| 项 | 值（阶段 1 基线） |
|---|---|
| 分层结果文件 | `data/metrics/strata/2026-10-25.json` |
| 文件 sha256 | `d982c5c42264fa7f2c1cc8de31df47c06a96a34306505936166fd5a3faf8bae0` |
| 记录数 | 474（`totalItems` = `items.length` = 474） |
| 层分布 | S 4 / A 19 / B 10 / M 59 / N 9 / C1 174 / C2 199 |
| 层归属指纹 | `a76a6476a26c8848b9e6cfebb1921db71934b2394c56e783c1fc8c99c12a1d76` |
| 配置来源 | `config/product-stratification.json` v1.0 |

层归属指纹算法：`sha256(join("\n", items.map(i => `${i.itemId}|${i.layer}|${i.sub||""}`)))`，不用 JSON 序列化，避免跨语言浮点/转义差异造成假报警。任何一件商品被改层，指纹立即变化。

---

## 2. 命名空间声明

```json
"namespace": "ATTENTION_PRIORITY"
```

这七层表达的是**关注优先级**（先看哪个），不是：

- ❌ 商品生命周期（NEW_OBSERVATION / GROWTH / ...）
- ❌ 经营表现等级（纳物 S/A/B）
- ❌ 库存等级 / 备货天数
- ❌ 资金层级

文件内每一层都写了 `"lifecycle_stage": "NOT_DERIVED"` 与 `"inventory_grade": "NOT_DERIVED"`，是**显式否定**，不是留空。

---

## 3. 七层语义映射

| 层 ID | 语义别名 | 关注问题 | 生命周期 | 库存等级 |
|---|---|---|---|---|
| `S` | 主力现金牛 | 它今天有没有可能少卖？ | NOT_DERIVED | NOT_DERIVED |
| `A` | 苗头成长期 | 它会不会成为下一个现金牛？我有没有错过窗口？ | NOT_DERIVED | NOT_DERIVED |
| `B` | **衰退清仓** | 它还在吃我的钱吗？该退出了吗？ | NOT_DERIVED | NOT_DERIVED |
| `M` | 常规稳定 | 它是不是可以不看？ | NOT_DERIVED | NOT_DERIVED |
| `N` | 刚上架观察 | 它来得及吗？ | NOT_DERIVED | NOT_DERIVED |
| `C1` | 新品未起量 | 它是没被发现，还是没被接受？ | NOT_DERIVED | NOT_DERIVED |
| `C2` | 沉睡长尾 | 它凭什么还占着一个坑位？ | NOT_DERIVED | NOT_DERIVED |

`semantic_alias` 直接取自 `config/product-stratification.json` 的 `layers.<id>.label`，标注 `alias_status: "OBSERVED_FROM_CONFIG"` —— 即"来自配置"，**不等于经业务确认的定义**（见 §5 ALIAS-01）。

---

## 4. 必须警示的同形异义（LIFE-C09）

这是本轮审查挖出的最危险一处：

| 层 ID | 一跨 ATTENTION_PRIORITY | 纳物安全库存 V1.0 | 风险 |
|---|---|---|---|
| `B` | **衰退清仓** | **稳定款**（L1 目标 1 天，极薄备货） | **语义方向相反**。若按字母映射，等于给衰退品配稳定款备货策略 |

其余同形项：

| 层 ID | 一跨 | 历史来源 | 冲突 |
|---|---|---|---|
| `S` | 主力现金牛 | 安全库存 S = 超级爆款（L1=3 主动备货） | LIFE-C09（方向一致但参数不可互推） |
| `A` | 苗头成长期 | 安全库存 A = 爆款（L1=2）；C6 资金层级 A | LIFE-C09（"苗头"≠"已爆"） |
| `M` | 常规稳定 | 生命周期 MATURE 成熟期 | LIFE-C05（MATURE 首期未启用） |
| `N` | 刚上架观察 | 生命周期旧版 N = 新品观察 | LIFE-C04 |
| `C1` | 新品未起量 | 生命周期 LONG_TAIL（C7 C） | LIFE-C02（C/D 边界未裁决） |
| `C2` | 沉睡长尾 | 生命周期 DORMANT（C7 D） | LIFE-C03 |

`do_not_confuse_with` 数组把这些逐条写进配置文件，供后续代码做断言或 UI 提示。

---

## 5. UNKNOWN / NEEDS_VALIDATION

| ID | 事项 | 影响 |
|---|---|---|
| `ALIAS-01` | 各层 ID 的**业务定义原文**未从纳物原始分层说明核验；当前 alias 取自 config label | 不影响运行（只读解释）；影响后续把层 ID 用于任何决策前必须人工核验 |
| `ALIAS-02` | "474" 的口径是当前快照数还是历史累计数 | 无运行时影响；以实际文件为准（实测 474） |

---

## 6. 为什么不重命名层 ID

| 方案 | 后果 |
|---|---|
| 重命名为 spec 的 `NEW_OBSERVATION` 等 | 需重跑 474 件分层 → 结果漂移；破坏现有报告与脚本引用；且层与生命周期本就不是同一维度，改名等于承认错误映射 |
| **只加别名（已采用）** | 原文件字节不变；474 结果不变；新增只读解释层；可随时删除回退 |

同理没有修改 `config/product-stratification.json` —— 它是分层规则的**唯一权威**，动它就等于动规则本身。

---

## 7. 测试证据

测试 12 四项断言，全部通过：

| 断言 | 结果 |
|---|---|
| 文件 sha256 完全一致（字节级） | ✅ |
| `totalItems === 474` 且 `items.length === 474` | ✅ |
| 层分布 `{S:4,A:19,B:10,M:59,N:9,C1:174,C2:199}` 完全一致 | ✅ |
| 层归属指纹一致（逐条 `itemId\|layer\|sub`） | ✅ |

附加证据：扫描 `已完成产品/` + `当前产品/` 共 **20,051 个文件**，今日 03:00 后修改数 = **0**。
