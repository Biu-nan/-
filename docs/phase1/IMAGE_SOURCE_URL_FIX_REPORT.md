# 图片原始 URL 修复报告｜IMAGE_SOURCE_URL_FIX_REPORT

- 对应指令：04 §F1–F3
- 实现：`dist/src/selection-board-service.js` → `addImageUrls()`

---

## 1. 缺陷描述

`images[].sourceUrl` 字段一直存在，但**恒为空字符串**。

### 1.1 根因

旧实现批量调用 `importImageUrlsToDirectory(dir, urls)`，该函数返回的是**文件名数组**，不返回 `文件名 → 原始 URL` 的对应关系：

```js
const result = await importImageUrlsToDirectory(dir, trimmed, [], {...});
// result.imported = ["a.jpg", "b.jpg"]   ← 没有 URL
for (const name of result.imported) {
    item.images.push({ name, origin: "url", sourceUrl: "", ... });  // ← 只能填空
}
```

即使传入的是明确的产品主图直链，落盘后也丢失了来源。后果：

- 无法回溯"这张图来自哪个 1688 页面/哪条直链"；
- 下游若需重新拉取原图（比如原图被压缩失真），没有依据；
- 违反基线 01 §3.2-2「保存用户提供的原始 `sourceUrl`，禁止只保存转换后的 URL 或留空」。

---

## 2. 修复方案

改为**逐条下载 + 即时记录 URL**，不再依赖批量函数的返回值：

```
for (const url of trimmed) {
    buffer = await downloadImage(url)          ← 可注入的下载器
    ext    = detectImageExtension(buffer)
    result = await importImagesToDirectory(dir, [{ originalname, buffer }])
    if (!result.imported.length) → 记入 failed（保留原因），URL 不丢
    else → item.images.push({ name, sourceUrl: url, sourceUrlStatus: "RECORDED" })
}
```

### 2.1 关键点

| 点 | 处理 |
|---|---|
| URL 原样保存 | `sourceUrl: url`（未经 encode/decode、未 trim 内部、未补协议） |
| 失败不丢 URL | 进 `result.failed[]`，含 `{ url, reason }` |
| 不去重误判 | 同内容不同 URL 仍各自保留自己的 URL（`allowDuplicateContent: true`） |
| 主图/附图 | 第一张自动 `MAIN`，之后 `ADDITIONAL` |
| 私网防护 | 保持不变（下载器仍拒绝 127.0.0.1 等私有地址） |

### 2.2 新增字段

| 字段 | 值 | 含义 |
|---|---|---|
| `sourceUrl` | 原始 URL / `""` | 用户给什么存什么 |
| `sourceUrlStatus` | `RECORDED` / `NOT_APPLICABLE` / `MISSING_LEGACY` | 区分「有 URL 已记」「本地上传无 URL」「旧数据丢了 URL」 |
| `assetType` | `MAIN` / `ADDITIONAL` / `STYLE_REFERENCE` | 对应 ERD `PRODUCT_IMAGE_ASSET.image_type` |
| `downloadStatus` | `OK` / `FAILED` | 下载结果 |

这三个状态值把「没存」和「本来就没有」区分开 —— 符合基线 §8.1「UNKNOWN 不等于 0」的同源原则。

---

## 3. 本地上传路径为何 `sourceUrl` 仍为空

`addImages()`（用户从本机选图）没有来源 URL，写 `sourceUrlStatus: "NOT_APPLICABLE"`。

这不是"漏存"：字段存在但值为空 + 状态明确标注不适用，与"该存没存"（`MISSING_LEGACY`）是两回事。

---

## 4. 修复后的全链路

| 环节 | 是否保留原始 URL | 证据 |
|---|---|---|
| 录入（API 入参） | ✅ `urls[]` | — |
| 下载 | ✅ `downloadImage(url)` 收到原值 | 测试 09 断言 `receivedUrl === url` |
| 落盘 | ✅ 内存 image 记录带 `sourceUrl` | — |
| **序列化到 board.json** | ✅ | 重读后仍一致 |
| **从 board.json 读取** | ✅ | 测试 09 用新实例重新 load 验证 |
| 前端展示 | ⬜ 阶段 1 未展示 URL 列表（详情弹窗只显示图片缩略图） | 阶段 2 工作台补 |

---

## 5. 测试证据

测试 09 的六项断言：

| # | 断言 | 结果 |
|---|---|---|
| 1 | 下载器收到的 URL 与用户输入一字不差 | ✅ |
| 2 | `imported.length === 1` | ✅ |
| 3 | 内存 `sourceUrl === url`，`sourceUrlStatus === "RECORDED"` | ✅ |
| 4 | 第一张 `assetType === "MAIN"` | ✅ |
| 5 | **新实例重新 load 后 `sourceUrl` 仍一字不差** | ✅ |
| 6 | 第二张 `assetType === "ADDITIONAL"` | ✅ |
| 7 | 私网地址仍被真实下载器拒绝（`failed.length === 1`） | ✅ |

### 5.1 测试为何用注入下载器

真实 `downloadPublicImage` 会拒绝私网地址（正确的 SSRF 防护），本机测试服务器必然被拦。
因此给 `SelectionBoardService` 增加可选构造参数 `downloadImage`，生产默认仍是 `downloadPublicImage`，行为不变；测试注入 stub 验证 URL 链路，另起一个不注入的实例验证防护未被削弱。

---

## 6. 回归影响

| 受影响方 | 影响 |
|---|---|
| 既有产品图导入 `/api/import-images` | 无（走 `image-files.js` 原路径，未改） |
| 风格参考图 `/api/style-ref-images` | 无（走 `style-reference-service.js`，未改） |
| 选品看板图片直链导入 | 行为改变：逐条下载（原来是批量）。导入 12 张时请求数从 1 批变为 12 次串行下载，耗时略增，但换来 URL 可追溯 |
| 店小秘图源 | 无（看板图片独立目录，不参与店小秘上传） |

---

## 7. 遗留

| 项 | 说明 |
|---|---|
| 历史数据的空 `sourceUrl` | 改造前若有 URL 导入的图片，其 URL 已永久丢失 → 会标 `MISSING_LEGACY`。当前看板 0 条数据，无实际损失 |
| 前端未展示 URL | 详情弹窗可加"来源链接"列，阶段 2 补 |
| 编辑单个图片的 URL | 当前只支持删除重加，不支持原地改 URL（避免"改了 URL 但文件没换"的不一致） |
