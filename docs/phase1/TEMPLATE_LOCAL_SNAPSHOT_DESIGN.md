# 本地 Listing 模板快照设计｜TEMPLATE_LOCAL_SNAPSHOT_DESIGN

- 对应指令：04 §G + 基线 01 §3.3
- 实现：`dist/src/listing-template-snapshot-service.js`
- 存储：`data/identity/template-snapshots.json`

---

## 1. 为什么只能做「本地快照」

### 1.1 实测证据：平台连模板 ID 都没有

`dist/src/dianxiaomi-adapter.js` 里模板相关工作全部是 UI 操作：

| 行号线索 | 事实 |
|---|---|
| 第 194 行 | 「模板名前缀归一：店小秘模板名偶尔带「-星造」这类店铺后缀，而弹窗行文本是纯模板名」 |
| 第 612-614 行 | 「引用现有产品（不保存）。引用后表单被模板源产品预填」——靠点「引用产品」按钮 + **按模板名选** |
| 第 575 行 | 同一操作在页面不同加载状态下弹窗行为不同，需重试 |

结论：

- 没有 API 返回模板对象；
- **连稳定的模板 ID 都拿不到**，只有显示名称；
- 更没有版本号。

### 1.2 所以「保存平台模板版本号」在物理上做不到

若强行加一个 `platform_template_version` 字段并填值，只能是伪造。基线 §3.3 明确禁止。

---

## 2. 数据结构

```json
{
  "snapshot_id": "<uuid>",
  "product_id": "<uuid|null>",
  "template_ref": "箱包配件-Choice半托管模板",
  "template_name": "箱包配件-Choice半托管模板",
  "local_snapshot_version": "LOCAL-20261030-1",
  "content_hash": "<sha256>",
  "content": "标题规则: ...\n图片规则: ...",
  "content_file_ref": "",
  "capture_method": "MANUAL_INPUT",
  "captured_at": "2026-10-30T...Z",
  "snapshot_status": "CAPTURED",
  "platform_template_version": "NOT_AVAILABLE_FROM_PLATFORM",
  "provenance_note": "一跨本地规则副本；不代表店小秘平台模板的真实版本号。",
  "source_platform": "dianxiaomi"
}
```

### 2.1 字段职责

| 字段 | 作用 | 设计要点 |
|---|---|---|
| `template_ref` | 模板引用 = **模板名称** | 平台无 ID，只能用名称；名称变更需人工重新捕获 |
| `local_snapshot_version` | 一跨内部版本号，`LOCAL-YYYYMMDD-N` | 与平台版本**完全不同空间**，前缀强制区分 |
| `content_hash` | sha256(内容) | 内容一变哈希就变，可发现「同名不同内容」 |
| `captured_at` | 捕获时间 | 回答「这份规则是哪天的」 |
| `capture_method` | MANUAL_INPUT / LOCAL_FILE / CONFIG_EXPORT / AGENT_READ | 回答「这份副本可信度如何」 |
| `snapshot_status` | CAPTURED / MANUAL_CAPTURE_REQUIRED / STALE / SUPERSEDED | 决定能否用于 Listing 任务 |
| `platform_template_version` | 恒为 `NOT_AVAILABLE_FROM_PLATFORM` | **不是空字符串、不是 unknown**，是一个明确的终态值 |

### 2.2 为什么用 `NOT_AVAILABLE_FROM_PLATFORM` 而不是留空

留空会被后续代码当成「还没填」，进而有人去补；补的时候只能编。
写死一个明确的「不可得」值，才能在代码里断言：

```js
if (input.platformTemplateVersion !== PLATFORM_VERSION_UNAVAILABLE) {
    throw new Error("拒绝写入平台模板版本号：...任何具体值都必须是伪造");
}
```

---

## 3. 状态流转

```
capture(有内容)      → CAPTURED
capture(无内容)      → MANUAL_CAPTURE_REQUIRED
同名再次 capture     → 旧 CAPTURED 置 SUPERSEDED（保留不删）
内容变更             → markStale() → STALE
```

### 3.1 使用门禁

`requireUsableSnapshot(templateRef)`：

| 情形 | 返回 |
|---|---|
| 有 `CAPTURED` 快照 | `{ ok:true, snapshot }` |
| 只有 `MANUAL_CAPTURE_REQUIRED` | `{ ok:false, blocked:"BLOCKED_TEMPLATE", reason }` |
| 只有 `STALE` | 同上（STALE 不冒充可用） |
| 没有快照 | 同上 |

对应基线 01 §3.3「模板缺失、停用或版本不可读取时，任务进入 `BLOCKED_TEMPLATE`，不得静默使用默认模板」。

> 阶段 1 只提供该门禁的**实现与测试**，尚未接入上品流程的启动路径（那属于阶段 2 工作台范围）。

---

## 4. 与 Listing 任务的衔接方式（阶段 2 预留）

任务记录应保存 `templateSnapshotId`（选品看板 item 已有该字段）：

```
product → listing_template_ref（名称）
        → templateSnapshotId（本次实际读的本地快照）
        → snapshot.content_hash（可复核内容没换）
```

这样即使模板后来被改、被删、被改名，历史 Listing 也能回答「当时按什么规则做的」。

---

## 5. 谁来做内容捕获（当前唯一可行路径）

| 方式 | 可行性 | 说明 |
|---|---|---|
| 平台 API 拉取 | ❌ | 无 API |
| 页面 DOM 抓取模板定义 | 🟡 | 店小秘「引用产品模板」弹窗只显示模板名，不展示规则正文；要抓需要进模板编辑页，属未验证路径 |
| 人工粘贴规则正文 | ✅ | 当前唯一确定可行；`captureMethod=MANUAL_INPUT` |
| 本地规则文件 | ✅ | 若已有模板说明文档，`contentFileRef` 指向它，`captureMethod=LOCAL_FILE` |

阶段 1 的实际状态：**没有任何模板快照被捕获**，因为一跨目前没有「模板规则正文」的可信来源。首次捕获需经营者提供一份模板规则文本。

---

## 6. 测试证据

测试 11 验证：

| 断言 | 结果 |
|---|---|
| `content_hash` 为 64 位 sha256 | ✅ |
| `captured_at` 存在 | ✅ |
| `snapshot_status = CAPTURED` | ✅ |
| `platform_template_version = NOT_AVAILABLE_FROM_PLATFORM` | ✅ |
| `local_snapshot_version` 以 `LOCAL-` 开头 | ✅ |
| 传入 `platformTemplateVersion: "v2.3"` 被拒绝 | ✅ |
| 无内容时状态为 `MANUAL_CAPTURE_REQUIRED` | ✅ |
| 缺失模板返回 `BLOCKED_TEMPLATE` | ✅ |

---

## 7. 遗留

| 项 | 说明 |
|---|---|
| 模板规则正文来源 | U4：未确定。需经营者提供或验证模板编辑页可抓 |
| 模板改名后的关联 | 当前靠名称匹配，改名即断链。阶段 2 可考虑人工建立 name→ref 别名表 |
| 多店铺同模板 | `product_id` 可为 null，模板可跨产品复用；实际使用时以快照 ID 为准 |
