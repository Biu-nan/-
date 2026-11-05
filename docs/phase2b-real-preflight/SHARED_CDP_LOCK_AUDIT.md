# 浏览器全局互斥审计（SHARED_CDP_LOCK_AUDIT）

> 关联：任务四。检查 Listing Worker 与 ecom-translator 是否共用执行锁；若无则给最小改造方案。

---

## 1. 现状：两套锁，互不感知

| 系统 | 锁 | 位置/形式 | 作用域 | 是否覆盖 9223 浏览器 |
|------|----|-----------|--------|----------------------|
| 一跨 | `lockAdapter.acquireLock()`（`execution-lock.json`） | `data/workbench/execution-lock.json`（JSON，owner+ttlMs，过期接管） | **仅一跨进程内**任务 | ❌ 只管一跨自己的任务 |
| 一跨 | host `busy` 闸门 | 内存 | 仅一跨 host 内**串行**子进程 | ❌ 只管一跨内部 |
| 一跨 | `lockWorkspaceSwitch()` | 进程级 | 防止主服务切工作区 | ❌ 与浏览器无关 |
| ecom | `listing_rebuild._acquire_listing_lock()` | `work/listing_drafts.lock`（文件） | **仅 ecom** Listing 草稿 | ❌ 只管 ecom 自己 |
| ecom | `dianxiaomi_browser_service._START_LOCK` | `threading.Lock()` | 仅启动冷却（20s） | ❌ 只管启动竞态 |
| ecom | `erp_control_center._RESTART_LOCK` | `threading.Lock()` | 重启 | ❌ 无关 |

**结论：一跨 与 ecom 各自用不同文件/不同格式的锁，没有任何一方检查对方是否正在驱动 9223。** → 若两者同时运行：一跨的 ChatGPT 作图/Listing 与 ecom 的店小秘草稿会**同时接管同一个 Chrome(9223)**，互相抢标签页/抢输入框/抢遮罩，产生不可预期的错填或失败（ecom 注释已记载"job holds 9223, without either flow stealing the other's tabs"这一风险）。

> 注：一跨 host 的 `busy` 只保证**一跨内部**串行；ecom 的 `listing_drafts.lock` 只保证**ecom 内部**串行；**跨系统无互斥**。

---

## 2. 最小改造方案（推荐）

**目标**：给 9223 设一把**跨系统浏览器会话锁**，任一系统驱动 9223 前必须持有，拿不到即 `BUSY` 让路（fail-closed），带 owner + TTL + 过期接管。

### 2.1 锁文件（中性路径，双方都能写）
`D:/ecom-translator/work/cdp-9223.lock`（JSON）：
```json
{ "owner": "ykb-worker|<pid>|<taskId>", "acquiredAt": "ISO", "ttlMs": 1800000, "label": "listing-9223" }
```
- 放在 ecom 的 `work/`（既有 `listing_drafts.lock` 同目录，权限已验证可写），一跨以绝对路径读写。

### 2.2 一跨侧（改动最小）
- `ListingWorkerHost.execute()` 在 `fork()` 子进程**之前**：`acquireBrowserLock('9223')`；`finally` 释放。
- 复用现成 `ExecutionLock`（已是 JSON+ttlMs+owner+过期接管），**只需把 `lockFile` 指向 `cdp-9223.lock`**（或加第二把 `browserLock`），逻辑不改。
- 拿不到 → 返回 `WORKER_BUSY`，不 fork（不抢浏览器）。

### 2.3 ecom 侧（改动最小）
- `erp_operations_runner` 在进入 `ERP_DRAFT`/`LISTING`（需 9223）阶段前：`acquire` 同一 `cdp-9223.lock`；结束释放。
- ecom 现有 `listing_drafts.lock` 保留（管 ecom 自身），新增对 `cdp-9223.lock` 的获取即可；或直接把 `listing_drafts.lock` 语义升级为"9223 会话锁"并让一跨也用它。

### 2.4 兼容与格式
- 文件锁格式统一为上面的 JSON（一跨的格式）；ecom 侧读/写同格式（或提供兼容解析）。
- TTL 建议 30min（覆盖一次真实上品 15–20min + 余量）；stale 规则：`now - acquiredAt > ttl` 即可接管，并在接管前写 audit（谁抢了谁的锁）。

## 3. 备选（更轻但更弱）
- 仅用**端口占用探测**：驱动前 `curl /json/version` 之外，检查是否有"活动执行标记"——不可靠（9223 常在，不代表空闲）。
- **不推荐**：仅靠"约定不同时跑"（人工纪律），无代码保障，易忘。

## 4. 结论
- 现状：**无跨系统互斥**，真实执行前若 ecom 控制台（8765 在跑）触发了店小秘任务，会与一跨真实 Listing 抢 9223。
- 最小改造：**新增 `cdp-9223.lock` 共享浏览器会话锁**，一跨 host 与 ecom erp 阶段各 acquire/release 一次（复用两方已有文件锁能力，约几十行）。
- 在完成该改造前，**首次真实执行必须确保 ecom 控制台不触发任何 9223 任务**（人工保证）。

## 5. 未做
未实现该锁（仅方案）；未改一跨/ecom 代码。
