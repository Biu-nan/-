# CDP 9223 入口全表（PHASE2D_CDP_ENTRYPOINT_MAP）· 最终修订（浏览器操作分类）

> ecom-translator（`D:/ecom-translator`）所有 9223/9224 入口的**操作分类 + 职责/所有权**。
> 职责：**顶层holder** / **Lease验证者(双模)** / **只读诊断(豁免)** / **浏览器启动器** / **9224独立**。

---

## A. 浏览器操作分类（任务4：是否需锁 + 持锁允许的操作）

| 类别 | 典型入口 | 需要锁？ | 持锁期间允许 | 说明 |
|------|----------|----------|--------------|------|
| **① HTTP 被动状态探测** | `GET /json/version`、`GET /json/list`（只读 JSON） | **否** | 任意时刻可用 | 不开页、不操作页面；**不干扰执行**（专项 D9） |
| **② CDP 页面读取** | `dianxiaomi_draft_kernel.mjs`(schema)、`session_probe.mjs`、`check_*.mjs`、`_verify/*` | **否（只读诊断豁免）** | 仅**非执行窗口**；短时；不开产品业务页 | 若必须开临时页，读完即关，不与业务抢标签 |
| **③ CDP 页面操作** | `seo_core_kernel.mjs`(ChatGPT)、`dianxiaomi_draft_executor.mjs`(店小秘填/存) | **是（必须持 C）** | 仅 holder 执行 | 会写页面/发请求/产生结果 |
| **④ Chrome 启动** | `dianxiaomi_browser_service.ensure_ready()` | **是（holder 范围内）** | 仅 holder 触发 | 禁止执行中二次启动 |
| **⑤ Chrome 关闭/重启** | 关闭/重启入口、`taskkill` 类 | **是（必须持 C）且禁止执行期间** | 仅 holder 显式发起 | 非 holder **不得擅自关闭**（专项 D8） |
| **⑥ 9224 采集** | `aliprice_browser_service`、`collector`、`aliprice_collect.mjs` | **否（不取 C）** | 独立运行 | 与 9223 隔离（专项 D9/B9） |

> 一句话：**只有 ③页面操作 / ④启动 / ⑤关闭重启 需要 C；①②只读不需要；⑥是另一把体系**。

## B. 9223 入口职责（所有权）

| 模块 | 操作类别 | 职责 | 备注 |
|------|----------|------|------|
| `dianxiaomi_browser_service.py` | ④启动 / ①探测 | **浏览器启动器** | 只起 Chrome/探活，不驱动页面 |
| `erp_operations_runner.py` | 编排 | **顶层holder（分阶段）** | LISTING 段不持 C 跨 listing_rebuild；ERP_DRAFT 段持 C |
| `listing_rebuild.py` | ③(经 seo) | **顶层holder** | **L → C**（逆序释放） |
| `tools/seo_core_kernel.mjs` | ③ChatGPT | **双模** | 有 env→verify；无→自持 |
| `tools/dianxiaomi_draft_executor.mjs` | ③店小秘 | **双模** | 有 env→verify |
| `tools/dianxiaomi_draft_kernel.mjs` | ②schema | **双模/只读** | 有 env→verify；独立则只读 |
| `src/llm/chatgpt_web.py` | ③ChatGPT | 双模/验证者 | 随上层 |

## C. 直连 / CLI 旁路（不得绕过）

| 模块 | 类别 | 职责 |
|------|------|------|
| `run_batch_and_report.py` | ③(CLI) | **顶层holder（独立运行）** |
| `run_first_fillverify.py` | ③(CLI) | **顶层holder** |
| `tools/verify_draft_path.mjs` | ③(会填页) | **顶层holder** |
| `tools/session_probe.mjs` | ②只读 | 只读诊断（豁免） |
| `tools/check_draft_exists.mjs` / `check_dianxiaomi_overlays.mjs` / `check_dianxiaomi_editor_target.mjs` / `check_dianxiaomi_album_space.mjs` / `_debug_search.mjs` | ②只读 | 只读诊断（豁免） |
| `erp_page_probe.py` | ②只读 | 只读诊断（豁免） |
| `_verify/*.mjs` / `_verify/*.py` | ②只读 | 只读诊断（豁免） |

## D. 9224 采集（绝不取 9223 锁）
`aliprice_browser_service.py` / `collector/*` / `tools/aliprice_collect.mjs` → **9224独立**。

## E. 旧锁（保留）
`listing_drafts.lock`（L，listing_rebuild）、`_START_LOCK`（启动冷却）、`_RESTART_LOCK`（重启）。只叠加不替换。

## F. 调用链与所有权
```
erp_control_center → erp_operations_runner [顶层holder·分阶段]
   ├ LISTING → listing_rebuild [L→C] → seo_core_kernel [verify]   | 或 Runner 直跑 seo_kernel [C]
   └ ERP_DRAFT → dianxiaomi_browser_service.ensure_ready [启动器] → draft_executor [verify]
直连CLI: run_batch_and_report / run_first_fillverify / verify_draft_path [顶层holder]
只读: session_probe / check_* / _verify/* [豁免]
9224: aliprice_browser_service / collector [独立]
```
