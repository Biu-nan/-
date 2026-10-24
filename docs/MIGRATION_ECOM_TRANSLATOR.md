# 移植方案：ecom-translator → 一跨而境（v0.1 草案）

> 目标：以「一跨而境」为主系统（Node/Web 工作台），把 ecom-translator 的
> **1688 采集 / 本地图片翻译 / Listing+ERP 治理经验**并进来，补齐「从货源到上架」的全链路。
> 本文只定架构与边界，不改代码。决策确认后按阶段实施。

---

## 一、先讲清一件事：不能全量重写

| 能力 | ecom-translator 实现 | 能否用 Node 重写 |
|---|---|---|
| OCR | PaddleOCR 3.7 + PP-OCRv6（Python） | ❌ 无等价成熟 Node 栈 |
| 擦字 | LaMa（PyTorch，独立 `.lama` 环境） | ❌ 模型/推理链在 Python |
| 翻译 | Ollama + qwen3（HTTP，语言无关） | ✅ 可直连 |
| 1688 采集 | Playwright/CDP + Python 编排 | ✅ 可重写（但没必要先重写） |
| Listing/ERP | Node（`seo_core_kernel.mjs` / `dianxiaomi_draft_executor.mjs`） | ✅ 已是 Node |

**结论**：Node 侧做「编排 + UI + 契约」，Python 侧保留为**本地能力侧车**（OCR/LaMa/Ollama/采集）。
这不是妥协，是让 839 条 Python 测试继续有效。

---

## 二、三种架构（推荐 C）

| 方案 | 形态 | 优点 | 代价 |
|---|---|---|---|
| A. 独立服务 | ecom-translator 起 FastAPI，一跨而境 HTTP 调 | 进程隔离、可跨机 | 多一个常驻服务、端口/进程管理 |
| **C. 子进程桥（推荐）** | 一跨而境 `child_process.spawn` 调 `python -m ...`，stdout 进度 + 文件契约 | **改动最小、无新常驻进程、失败即进程退出可回收** | 需要约定 CLI 参数与退出码 |
| B. 全量 Node 重写 | 采集/翻译都搬进 JS | 单运行时 | 丢掉 OCR/LaMa 与 839 测试，工期数月 |

推荐 **C**：两套系统本来就是**文件契约驱动**（ecom-translator 产出 `output/<产品>/*.json|md`，一跨而境读 `当前产品/`、`已完成产品/`），
用文件对接比 RPC 更稳，也天然可断点重跑。

---

## 三、能力映射（ecom-translator → 一跨而境 落点）

| ecom-translator | 一跨而境 落点 | 说明 |
|---|---|---|
| `collector/`（AliPrice 导出表→图+SKU→产品包） | 新增 `dist/src/collector-bridge.js` + `/api/collect/*` | 产出直接进 `商品队列/` 或 `当前产品/产品图/` |
| `main.py`/`prepare.py`/`inpaint.py`/`render.py` | 新增 `dist/src/translate-bridge.js` + `/api/translate/*` | 产出 `*_en.jpg` 进 `当前产品/output/`（或 `产品图/` 作为源） |
| `product_info.json` / `listing_handoff.json` | `product-facts.json` / `product-profile.json` | 需字段映射（见第五节） |
| `03_SEO_KEYWORDS.md` / `04_LISTING_CONTENT.md` | 同名落 `output/` | 已有，口径一致 |
| `erp_planner` / `dianxiaomi_draft_executor` | 一跨而境已有 `dianxiaomi-adapter` | 不重复造，只借它**治理原语** |
| 契约/守卫/台账/幂等 | 落到一跨而境 A+B+C 之上 | 见 P3 |

---

## 四、阶段计划（每阶段可独立验收、可回滚）

### P0 · 契约对齐（0.5 天，零风险）
- 产出 `docs/CONTRACT_MAP_ecom.md`：逐字段映射 `product_info.json`/`listing_handoff.json` → `product-facts.json`/`product-profile.json`。
- 定 CLI 契约：`spawn` 参数、退出码、stdout 进度行格式（JSON Lines）。
- 验收：拿 ecom-translator 一份真实 `output/<产品>/` 能无损转成 一跨而境产品目录。

### P1 · 1688 采集接入（1–2 天）
- 一跨而境 上品页新增「从 1688 采集」：选导出表 → `spawn python -m collector.run --mode none` → 轮询 `collector/ledger.json` → 合格产品进 `商品队列/`。
- 验收：一张真实导出表 → 队列出现 N 个产品，图与 SKU 齐全，失败条目标红。

### P2 · 本地图片翻译接入（2–3 天）
- 新增「翻译原图」策略：对 `当前产品/产品图/` 跑 Python 流水线，`*_en.jpg` 落 `output/`。
- 与现有「AI 生成 10 图」并存：**每产品二选一**（翻译原图 / 生成 10 图 / 两者都做）。
- 验收：真实产品翻译完成，质检通过率与 ecom-translator 基线一致。

### P3 · 治理原语移植（2–3 天）
- **act-then-verify 统一原语**：把本轮 A+B+C 的 `_withDeadline`、`verify-then-commit`、`progress-manifest` 与 ecom-translator 的「写后回读三态」合并成一套。
- **副作用幂等键**：`productId + operation + planVersion`，落 `.workbuddy/idempotency/<key>.json`。
- **问题指纹台账**：把 `issue_ledger` 的 signature 归一化思路接进一跨而境日志。
- 验收：同类失败第二次出现时能被指纹聚合，且重跑不重复建草稿。

### P4 · 一键流水线（1–2 天）
- 一条链路：1688 采集 → 翻译/生成 → Listing → 店小秘草稿（仍只存草稿）。
- 验收：单产品端到端跑通，人工介入点 ≤ 2（选品确认 + 发布前复核）。

---

## 五、需要你拍板的 3 个决策

1. **架构**：C 子进程桥（推荐）/ A 独立服务 / B 全量重写？
2. **优先级**：先 P1 采集 / 先 P2 翻译 / 先 P3 治理？
3. **图片策略**：翻译原图（保真）/ 生成 10 图（营销）/ 两者可选（推荐）？

---

## 六、红线（不因移植而破）

- 店小秘**只存草稿、永不发布**（延续两边既有约定）。
- 不新增付费 API 依赖；翻译/OCR 保持本地。
- 任何移植阶段都必须：先备份、可回滚、有回归用例。
