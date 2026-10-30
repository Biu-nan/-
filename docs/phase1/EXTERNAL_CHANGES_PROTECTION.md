# 外部改动保护｜EXTERNAL_CHANGES_PROTECTION

- 目的：把工作区里**不属于阶段 1** 的改动单独隔离、备份、留证，确保阶段 1 提交时不会误带，也不会因回滚误删
- 采集时间：2026-10-30 13:50
- 备份目录：`F:/yikuaborder-deploy/.tmp-external-backup/`（匹配 `.gitignore` 的 `/.tmp-*`，不会污染 git status）

---

## 0. 结论

| 文件 | 归属 | 是否纳入阶段 1 提交 | 是否已备份 |
|---|---|---|---|
| `nawu-fetch/lib/dxm-c6r.cjs` | **第三方**（阶段 1 期间，13:06:38） | ❌ 否 | ✅ 是 |
| `public/draft-executor-panel.js` | **原有未提交**（阶段 1 之前，2026-10-29 13:00） | ❌ 否 | ✅ 是 |

两个文件都**不是**阶段 1 的产物，都必须被排除在提交之外。它们在当前工作区里完好无损。

---

## 1. `nawu-fetch/lib/dxm-c6r.cjs`

### 1.1 基本信息

| 项 | 值 |
|---|---|
| 路径 | `nawu-fetch/lib/dxm-c6r.cjs` |
| 当前 SHA256 | `745380ecbe24c5e6519d99c0c09cd9fe8f4a7c865a0a30589d7d2ec8099de6a0` |
| 基线版本 SHA256 | `33f9d5501ebf6a89a3fafc4fe88bd591aead2a47dd06ceb0dfa02575058f43ab` |
| 文件大小 | 22,414 B |
| mtime | **2026-10-30 13:06:38.105** |
| diff 规模 | +29 / −1（52 行 diff） |
| 备份文件 | `.tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs` |
| diff 存档 | `.tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs.diff` |

### 1.2 归属判定

| 判据 | 结果 |
|---|---|
| 建分支前快照（10 项）是否包含它 | ❌ 不包含 |
| 我本轮/前两轮是否改过 `nawu-fetch/` | ❌ 没有（只改 `dist/src`、`public`、`config`、`scripts`、`docs`） |
| diff 中是否提及阶段 1 概念 | **0 处**（无 identity / selection-board / phase1 / ykb-v1 字样） |
| 改动内容性质 | 纳物 C6 出入记录采集的页面筛选修复 |
| 结论 | **第三方修改**（经营者本人或其他 agent 在 13:06 所为） |

### 1.3 完整 diff

```diff
diff --git a/nawu-fetch/lib/dxm-c6r.cjs b/nawu-fetch/lib/dxm-c6r.cjs
index d2aa30d..891ec24 100644
--- a/nawu-fetch/lib/dxm-c6r.cjs
+++ b/nawu-fetch/lib/dxm-c6r.cjs
@@ -34,6 +34,30 @@ async function setEntryExitAllTime(page, log) {
   return r === 'CLICKED';
 }

+// ---------- 出入记录：切到「仓库位置=全部」（关键：默认锁在「浙江义乌仓」，会漏其它仓）----------
+// 2026-10-30 修：出入记录页「仓库位置」默认=浙江义乌仓（非「全部」），导致只抓到单仓。
+// DOM：ant-form-item 内 `label[title="仓库位置"]`（id=searchForm_warehoseId 拼写如此），
+//      选项为 .d-tag-group-item（全部 / 浙江义乌仓 默认 / 云仓-义乌 / 乐临仓-代发 / 洛慈-代发仓），
+//      当前项带 active。必须点「全部」才能覆盖所有仓。
+async function setEntryExitAllWarehouse(page, log) {
+  const r = await page.evaluate(() => {
+    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
+    const label = document.querySelector('label[title="仓库位置"]') || document.querySelector('#searchForm_warehoseId');
+    if (!label) return 'NO_LABEL';
+    const box = label.closest('.ant-form-item') || label.parentElement;
+    if (!box) return 'NO_BOX';
+    const items = Array.from(box.querySelectorAll('.d-tag-group-item'));
+    const target = items.find((it) => /^全部/.test(txt(it)));
+    if (!target) return 'NO_ALL';
+    if (/(^|\s)active(\s|$)/.test(target.className || '')) return 'ALREADY';
+    target.click();
+    return 'CLICKED';
+  });
+  if (r === 'CLICKED') await sleep(6000);
+  log && log.info('出入记录 仓库位置=全部 -> ' + r);
+  return r === 'CLICKED' || r === 'ALREADY';
+}
+
 // 兜底：自定义日期范围（antd RangePicker，取可见输入框）
 async function setEntryExitDateRange(page, fromDate, toDate, log) {
   // 先点「自定义」快捷项（若存在）
@@ -77,6 +101,10 @@ async function collectEntryExitWindow(page, opts, log) {
   const { fromDate, toDate, extractor, goNextPage, sleep, maxPages = 120, waitAfterNextMs = 2500 } = opts;
   if (typeof extractor !== 'function' || typeof goNextPage !== 'function') throw new Error('collectEntryExitWindow 缺少 extractor / goNextPage');

+  // ⓪ 仓库筛选：默认可能锁在「浙江义乌仓」，必须先切「全部」才能取到所有仓
+  const whOk = await setEntryExitAllWarehouse(page, log).catch(() => false);
+  if (!whOk) log && log.warn('出入记录「仓库位置=全部」未确认 → 可能仅取到默认仓');
+
   // ① 时间筛选：优先「全部」；失败回退自定义范围（保证能翻到窗口起点之前）
   let filterMode = 'ALL';
   const allOk = await setEntryExitAllTime(page, log).catch(() => false);
@@ -393,4 +421,4 @@ async function collectProductTypeMap(page, pageUrl, log) {
   return { counts, lists, declared, collected, complete };
 }

-module.exports = { clickText, setEntryExitAllTime, setEntryExitDateRange, ENTRYEXIT_COLUMNS, dayOf, collectEntryExitWindow, extractPurchaseOrderRows, extractSupplierRows, extractSupplyRelationRows, readProductTypeTabs, readTableTotal, extractProductTypeRows, clickProductTab, collectProductTypeMap };
+module.exports = { clickText, setEntryExitAllTime, setEntryExitAllWarehouse, setEntryExitDateRange, ENTRYEXIT_COLUMNS, dayOf, collectEntryExitWindow, extractPurchaseOrderRows, extractSupplierRows, extractSupplyRelationRows, readProductTypeTabs, readTableTotal, extractProductTypeRows, clickProductTab, collectProductTypeMap };
```

### 1.4 业务含义

原实现只抓「浙江义乌仓」一个仓库的出入库记录（页面默认筛选），会漏掉「云仓-义乌」「乐临仓-代发」「洛慈-代发仓」。本次修复新增 `setEntryExitAllWarehouse()`，在采集前把筛选切到「全部」，并在失败时 warn 而非静默。

**这是一份有价值的修复，必须保留。**

### 1.5 保护措施

| 措施 | 状态 |
|---|---|
| 已备份当前版本 | ✅ `.tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs` |
| 已备份完整 diff | ✅ `.tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs.diff` |
| 已记录双版本 SHA256 | ✅ §1.1 |
| **阶段 1 提交时排除** | ← 提交白名单不含此文件 |
| **回滚时不得 `git checkout -- .`** | ← 会连带丢弃这份修复（见 `ROLLBACK_VERIFICATION_REPORT.md` §6） |

### 1.6 恢复方法（若日后需要单独还原）

```bash
# 还原到基线版本
git checkout 8970876 -- nawu-fetch/lib/dxm-c6r.cjs

# 或还原到本次备份的当前版本
cp .tmp-external-backup/nawu-fetch_lib_dxm-c6r.cjs nawu-fetch/lib/dxm-c6r.cjs
sha256sum nawu-fetch/lib/dxm-c6r.cjs
# 应得 745380ecbe24c5e6519d99c0c09cd9fe8f4a7c865a0a30589d7d2ec8099de6a0
```

---

## 2. `public/draft-executor-panel.js`

### 2.1 基本信息

| 项 | 值 |
|---|---|
| 路径 | `public/draft-executor-panel.js` |
| 当前 SHA256 | `98bf76037efa2b76d3c77a2595624a317931e63afff00b802f1c9aa09b19d91b` |
| 基线版本 SHA256 | `7a2ba34a292434ce76a0325a70ac7d2b63edcd7305b2511b95298d18604e7709` |
| mtime | **2026-10-29 13:00:04**（阶段 1 开始前约 23 小时） |
| diff 规模 | +2（14 行 diff） |
| 备份文件 | `.tmp-external-backup/public_draft-executor-panel.js` |
| diff 存档 | `.tmp-external-backup/public_draft-executor-panel.js.diff` |

### 2.2 归属判定

| 判据 | 结果 |
|---|---|
| mtime | **2026-10-29 13:00**，早于阶段 1（10-30 12:26） |
| 建分支前快照是否包含它 | ✅ **包含**（快照 10 项里有它） |
| 内容是否属阶段 1 | ❌ 不属（上架草稿执行器的 blockers 显示） |
| 结论 | **原有未提交修改**（早于阶段 1，与阶段 1 无关） |

### 2.3 完整 diff

```diff
diff --git a/public/draft-executor-panel.js b/public/draft-executor-panel.js
index 5d5f4b1..71fba81 100644
--- a/public/draft-executor-panel.js
+++ b/public/draft-executor-panel.js
@@ -199,7 +199,9 @@
           } else {
             setBadge('FAILED', 'bad');
             const reasons = (s.reasons || []).map((x) => `<div style="color:#b45309;">• [${esc(x.stage)}] ${esc(x.reason)}</div>`).join('');
+            const blockers = (s.blockers || []).map((x) => `<div style="color:#dc2626;">⛔ ${esc(x)}</div>`).join('');
             show(`${errBox('未完成', f.error || s.error)}
+              ${blockers}
               ${reasons}
               ${steps ? `<div style="max-height:240px;overflow:auto;margin-top:8px;font-size:.92em;">${steps}</div>` : ''}`);
           }
```

### 2.4 业务含义

上架草稿执行器失败时，除原有 `reasons` 外，把 `blockers` 也渲染出来（红色 ⛔ 前缀），便于定位「为什么被拦住」。

### 2.5 保护措施

| 措施 | 状态 |
|---|---|
| 已备份 | ✅ |
| 已备份 diff | ✅ |
| 已记录双版本 SHA256 | ✅ §2.1 |
| **阶段 1 提交时排除** | ← 白名单不含 |

### 2.6 建议

这个改动只有 2 行，是纯 UI 增强，**建议由经营者单独决定**：可以和阶段 1 一起提交（但要单独说明），也可以留待下次上架草稿相关改动时一并提交。本报告只做隔离与留证，不替经营者决定。

---

## 3. 其他非阶段 1 文件的归属核查

| 文件 | 判定 | 依据 |
|---|---|---|
| `dist/src/config.js` | **阶段 1 相关**（批次 A+B） | 4 个看板目录常量，服务端使用 |
| `public/app.js` | **阶段 1 相关**（批次 A+B） | `viewWorkspace` / topbar / `__ykSwitchView` |
| `public/index.html` | **阶段 1 相关**（批次 A+B） | 看板 section + 三状态 UI |
| `public/styles.css` | **阶段 1 相关**（批次 A+B） | 看板 + 三状态样式 |
| `_verify/`（12 文件） | **临时证据** | 测试截图与对比输出，不入库 |
| `.tmp-external-backup/`（6 文件） | **本报告的备份产物** | 已被 `/.tmp-*` 忽略 |
| `.worktrees/phase1-baseline/` | **基线 worktree** | 已被 `.gitignore` 第 3 行忽略 |
| `data/identity/*.json` | **运行态数据** | 已被 `data/` 忽略 |

---

## 4. 敏感凭证检查

### 4.1 白名单文件扫描

对 9 个新增/重点文件做凭证特征扫描（`sk-*` / `Bearer` / `api_key=` / `password=` / `secret=`）：

| 文件 | 结果 |
|---|---|
| `dist/src/product-identity-service.js` | ✅ 无 |
| `dist/src/listing-template-snapshot-service.js` | ✅ 无 |
| `dist/src/image-isolation-guard.js` | ✅ 无 |
| `dist/src/selection-board-service.js` | ✅ 无 |
| `public/selection-board.js` | ✅ 无 |
| `config/attention-layer-alias.json` | ✅ 无 |
| `scripts/*.mjs`（3 个） | ✅ 无 |

对 6 个修改文件，只扫 `git diff` 的 `+` 行：

| 文件 | 新增行是否含凭证 |
|---|---|
| `dist/src/server.js` | ✅ 无 |
| `dist/src/image-files.js` | ✅ 无 |
| `dist/src/config.js` | ✅ 无 |
| `public/app.js` | ✅ 无 |
| `public/index.html` | ✅ 无 |
| `public/styles.css` | ✅ 无 |

### 4.2 已跟踪的配置文件核查

| 文件 | 跟踪状态 | 内容 | 风险 |
|---|---|---|---|
| `.secretary-llm.json` | 已被 gitignore | — | ✅ 未入库 |
| `.ecom-connector.json` | **已跟踪**（80 B） | `root` / `consoleUrl` | ✅ 无凭证（仅本地路径） |
| `nawu-fetch/chatgpt-config.json` | **已跟踪**（1,532 B） | `cdpUrl` / `outputDir` / `projectUrl` / `conversationUrl` / `promptTemplate` 等 | ✅ 无 token/key/cookie 字段 |

> `nawu-fetch/chatgpt-config.json` 从历史提交 `04ca777` 起就在库中，本次未改动、未涉及。字段扫描确认不含凭证类键名。

### 4.3 结论

**阶段 1 提交白名单内 30 个文件，0 处凭证。** 无 `.env`、无 key 文件、无 token。

---

## 5. 备份清单

```
F:/yikuaborder-deploy/.tmp-external-backup/
├── nawu-fetch_lib_dxm-c6r.cjs            (22,414 B, sha256 745380ec…)
├── nawu-fetch_lib_dxm-c6r.cjs.diff       (52 行)
├── public_draft-executor-panel.js        (sha256 98bf7603…)
└── public_draft-executor-panel.js.diff   (14 行)
```

该目录匹配 `.gitignore` 的 `/.tmp-*` 规则，**不会出现在 git status 里**，也不会被误提交。

---

## 6. 本报告未做的事

- 未修改 `nawu-fetch/lib/dxm-c6r.cjs` 任何内容
- 未修改 `public/draft-executor-panel.js` 任何内容
- 未对任何文件执行 `git add` / `git commit` / `git checkout`
- 未触碰纳物 C6/C7 的生产规则或数据
