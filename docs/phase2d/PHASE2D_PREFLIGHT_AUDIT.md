# 阶段2D 前置审计（PHASE2D_PREFLIGHT_AUDIT）

> 目标：统一一跨 OS 与 ecom-translator 的浏览器执行体系，建立**真正的跨系统 CDP 9223 互斥**。
> 本轮：**只读审计，不改代码、不切分支、不改生产数据、不执行真实 Listing。**
> 基线：一跨 `12b7d62`（tag `phase2c-checkpoint-20261030`，worktree `F:/yikuaborder-phase2c-wt`）；ecom `D:/ecom-translator`。

---

## 0. 结论摘要

1. **一跨锁机制本身健全**（原子创建/接管/心跳/仅持有者释放/崩溃恢复），但**默认锁路径是 `cwd/data/locks/cdp-9223.lock`（相对当前工作目录）**。一跨 cwd=`F:/…`、ecom cwd=`D:/…` → **不设 `CDP_LOCK_FILE` 时两侧锁文件不同 = 没有真正互斥**。这是 2D 必须堵死的核心缺口。
2. **ecom 侧目前完全没有接入这把钥匙**：所有 9223 连接点（Listing 内核、店小秘执行器/内核、探测脚本）都直接 `connectOverCDP`，**无一处 acquire 统一锁**。
3. ecom 已有两把**与 9223 相关但非跨系统**的锁：`listing_drafts.lock`（Listing 队列）与 `_START_LOCK`（浏览器启动线程锁）。**不得删除/覆盖**，只能在其上叠加统一锁。
4. 存在多条**绕过统一入口**的直连 9223 路径（`run_batch_and_report.py` / `run_first_fillverify.py` / `tools/verify_draft_path.mjs` / `tools/check_*.mjs` / `_verify/*`），2D 需明确"业务执行必走统一锁，诊断脚本是否豁免"。
5. 采集走 **9224**（`collector/config.py`），与 9223 隔离，**不得纳入 9223 锁**。

---

## 1. 任务1：一跨共享锁复核

### 1.1 文件与路径
| 项 | 结论 |
|----|------|
| Node 默认路径 | `dist/src/shared-lock.js:49` → `options.file || process.env.CDP_LOCK_FILE || path.join(process.cwd(),"data","locks","cdp-9223.lock")` |
| Python 默认路径 | `shared/shared_cdp_lock.py` → `file or CDP_LOCK_FILE or cwd/data/locks/cdp-9223.lock` |
| **是否同文件** | **仅当两侧 `CDP_LOCK_FILE` 设为同一绝对路径**；默认因 cwd 不同而**不同**（关键缺口） |
| takeover 守卫 | `<lock>.takeover` |

### 1.2 JSON 数据结构（Node/Python 一致）
```
{ "schema":"cdp-lock/1", "owner":"<system>:<pid>:<taskId>", "pid":int, "host":str,
  "system":"ykb|ecom", "taskId":str|null, "acquiredAt":ms, "heartbeatAt":ms, "ttlMs":int, "label":"9223" }
```

### 1.3 owner / PID / TTL / 心跳
- `owner` = `system:pid:taskId`（可显式传入）。
- `pid` = `process.pid` / `os.getpid()`；`host` 用于跨主机判断。
- `ttlMs` 默认 60000（`CDP_LOCK_TTL_MS` 可覆盖）；`heartbeatMs` = ttl/3。
- 心跳：`renew()` 仅 owner+pid 匹配时刷新 `heartbeatAt`（temp+rename 原子写）。判定过期用 **heartbeatAt**（非 acquiredAt）→ 长任务心跳新鲜即不被接管。

### 1.4 原子获取 / 释放
- 获取：写临时文件 → `link(tmp, lock)`（Node `fs.linkSync` / Py `os.link`）——目标存在即 `EEXIST`，**原子且内容完整（无空文件竞态）**。
- 过期接管：`<lock>.takeover` 以 `wx`/`O_CREAT|O_EXCL` 串行化 → 二次确认过期 → `rename`/`os.replace` 原子替换。
- 释放：owner+pid 双校验匹配才删除；否则 `NOT_HOLDER`（不误删他人锁）。

### 1.5 崩溃恢复
- 心跳停超 ttl → 可接管。
- 同主机 PID 死 → 立即过期（Node `process.kill(pid,0)`；Python `OpenProcess+GetExitCodeProcess`，只认 `ERROR_INVALID_PARAMETER(87)` 判死，`ACCESS_DENIED(5)` 判活）。

### 1.6 ecom-executor-bridge.js（一跨调用 ecom）
- `executorPath` 默认 `D:/ecom-translator/tools/dianxiaomi_draft_executor.mjs`；`commit=false` 默认（不存草稿）；`published:false` 恒真；失败不伪装。**bridge 目前未涉及 9223 锁**（需在 2D 接入）。

> **任务1 结论**：锁实现正确，但"同文件"依赖环境变量；ecom 与一跨当前都在"各管各的"，**尚未形成跨系统互斥**。

---

## 2. 任务2：ecom 全部浏览器执行入口（详见 CDP_ENTRYPOINT_MAP）

### 2.1 谁启动 Chrome
| 模块 | 端口 | 说明 |
|------|------|------|
| `dianxiaomi_browser_service.py:_launch_browser` | **9223** | Popen Chrome + `DETACHED_PROCESS`；`ensure_ready()` 缺则拉起 |
| `aliprice_browser_service.py:_launch_browser` | 9224 | 采集浏览器（隔离） |
| `tools/macos_migration/templates/mac/launch_browser.py` | 9223 | **迁移模板**，非运行入口 |

### 2.2 谁连接 9223（connectOverCDP）
- **ChatGPT/Listing**：`tools/seo_core_kernel.mjs:248`（每产品开临时新标签，禁 `browser.close()`）+ `src/llm/chatgpt_web.py`（CDP 9223）。
- **店小秘**：`tools/dianxiaomi_draft_executor.mjs:128`、`tools/dianxiaomi_draft_kernel.mjs:39`。
- **探测/校验**（直连，绕过编排）：`tools/session_probe.mjs`、`tools/verify_draft_path.mjs`、`tools/check_draft_exists.mjs`、`tools/check_dianxiaomi_*.mjs`、`tools/_debug_search.mjs`、`erp_page_probe.py`、`run_batch_and_report.py`、`run_first_fillverify.py`、`_verify/*`（大量诊断）。

### 2.3 调用链
```
erp_control_center.py (控制台; Popen runner/helper)
  └─ erp_operations_runner.py  (阶段编排; Popen node 内核/执行器)
       ├─ LISTING   → tools/seo_core_kernel.mjs (CDP9223, ChatGPT; 每产品新标签)
       │              或 src/llm/chatgpt_web.py (CDP9223)
       └─ ERP_DRAFT → dianxiaomi_browser_service.ensure_ready() 启动 Chrome(9223)
                      tools/dianxiaomi_draft_executor.mjs (CDP9223, 店小秘草稿)
  └─ listing_rebuild.py: _acquire_listing_lock()(work/listing_drafts.lock) → generate_listing_drafts()
```
- `erp_operations_runner.py:101` 的 `connectOverCDP` 只是 **SESSION_FAILURE_MARKERS 失败标记串**，不是连接点。

### 2.4 谁启动后台任务（Popen）
`dianxiaomi_browser_service`（Chrome）、`erp_operations_runner`（node 内核/执行器，line 625/825/983）、`erp_control_center`（runner/helper，line 585/805/1256）、`aliprice_browser_service`（9224）、`run_batch_and_report.py`、`run_first_fillverify.py`。

### 2.5 绕过统一入口的路径
- 直接 `connectOverCDP 9223` 的 **业务/校验脚本**：`run_batch_and_report.py`、`run_first_fillverify.py`、`tools/verify_draft_path.mjs`。
- **诊断脚本**（`tools/check_*.mjs`、`_verify/*`、`session_probe.mjs`）：只读探活，但仍会"占用"浏览器标签页。
→ 2D 需定义：**业务执行必经统一锁**；诊断脚本是否豁免（建议"只读诊断默认豁免但需在锁内短时占用，或显式 `--no-lock` 需人工确认"）。

### 2.6 已有锁（不得删/覆盖）
| 锁 | 位置 | 作用 |
|----|------|------|
| `listing_drafts.lock` | `D:/ecom-translator/work/listing_drafts.lock` | `listing_rebuild._acquire_listing_lock()`：一次只允许一个 Listing 队列控制共享 Chrome；`pid` 存活校验 + 仅本 pid 释放 |
| `_START_LOCK`（threading） | `dianxiaomi_browser_service.py` / `aliprice_browser_service.py` | 浏览器启动冷却（20s）防并发拉起 |
| `_RESTART_LOCK`（threading） | `erp_control_center.py` | 控制台重启互斥 |

> **任务2 结论**：9223 的"业务入口"是 `seo_core_kernel.mjs`(ChatGPT) 与 `dianxiaomi_draft_executor.mjs`(店小秘)，由 `erp_operations_runner` 编排；当前**只有 ecom 内部的 `listing_drafts.lock`**，无跨系统统一锁；且存在多条直连旁路。

---

## 3. 关键风险（2D 必须处理）
1. **锁文件不同源**（cwd 相对）→ 必须固定**绝对路径** `D:/ecom-translator/work/cdp-9223.lock`（或中性共享路径）。
2. **ecom 未接入** → 需在 9223 业务入口（Listing 内核、草稿执行器/内核）外层 acquire/release。
3. **旁路直连** → 业务路径不得绕过；诊断路径需策略。
4. **9224 误纳入** → 采集必须排除（collector 用 9224，明确不 acquire 9223 锁）。
5. **旧锁共存** → `listing_drafts.lock`/`_START_LOCK` 保留，统一锁**叠加**，明确获取顺序防死锁。

（实施方案见 `PHASE2D_EXECUTION_PLAN.md`，验收见 `PHASE2D_ACCEPTANCE_CRITERIA.md`，入口全表见 `PHASE2D_CDP_ENTRYPOINT_MAP.md`。）
