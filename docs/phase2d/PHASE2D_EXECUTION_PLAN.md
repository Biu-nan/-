# 阶段2D 实施方案（PHASE2D_EXECUTION_PLAN）· 最终修订（Lease + 锁序 + 安全恢复）

> 依据：`PHASE2D_PREFLIGHT_AUDIT` / `PHASE2D_LOCK_OWNERSHIP_DESIGN` / `PHASE2D_LOCK_ORDER_AUDIT` / `PHASE2D_FAILURE_RECOVERY_DESIGN`。
> 本轮只出设计，不改代码。

---

## 1. 统一锁路径（绝对 + 自检）
- `CDP_LOCK_FILE = D:/ecom-translator/work/cdp-9223.lock`（绝对）；两端默认改绝对。
- 启动自检：`isAbsolute` 真 + 打印解析路径（不打印 leaseId）+ 不一致/非绝对 → **Fail Closed**。

## 2. 锁序（**关键修正：禁止 C→L**）
全局偏序 **L ≺ C**（L=`listing_drafts.lock`，C=`cdp-9223.lock`）。
| 任务 | 持有者 | 顺序 |
|------|--------|------|
| LISTING（经 listing_rebuild） | listing_rebuild | **L → C**（逆序释放） |
| LISTING（Runner 直跑） | Runner | C |
| ERP_DRAFT | Runner | C |
| SEO（独立） | 自身 | C |
| 独立 CLI | CLI | C |
| 完整任务（LISTING+ERP_DRAFT） | 分段 | LISTING 段 L→C（listing_rebuild，段末释放）；ERP_DRAFT 段 C |

- **Runner 不得持 C 去调 `listing_rebuild`**（否则 C→L 反向 → 死锁）。完整任务必须**分段持有、段间释放**。
- 子进程只验证 **C 的 Lease**，不验证父级 L。
- 死锁证明见 `PHASE2D_LOCK_ORDER_AUDIT.md §8`（只存在 L→C 单向边，无环）。

## 3. Lease（详见 LOCK_OWNERSHIP_DESIGN §2）
- 字段含 `leaseId / owner / pid / pidCreateTime / host / system / taskId / acquiredAt / heartbeatAt / ttlMs`。
- `tryAcquire` 返回 `leaseId`；`verifyLease` 只读；`release` 需 owner+pid+leaseId 三者匹配。
- 传递：仅 `spawn` 定向 env `YKB_CDP_LEASE`（不进 argv、不全局 export、不落日志明文）。
- 子进程失败 → `BLOCKED_LEASE_INVALID` 并停止 9223 操作。

## 4. 铁律 Lease-priority
有合法 env lease → verify-only（禁 acquire/release）；无 → 自持（acquire+release）。二者互斥 → 消除重复获取。

## 5. 安全恢复（详见 FAILURE_RECOVERY_DESIGN）
- 状态：FREE / HELD / **OWNER_UNRESPONSIVE** / OWNER_DEAD / TAKEOVER_IN_PROGRESS。
- **心跳权威**；心跳超时但 holder 可能活 → `OWNER_UNRESPONSIVE` → **禁止自动接管**。
- **仅 `OWNER_DEAD`（PID 死 / PID 复用[创建时间不符]）允许自动接管**。
- PID 复用检测用 `pidCreateTime`；不可判定 → 保守 `OWNER_UNRESPONSIVE`。
- 人工 `force-takeover --confirm` 作为 OWNER_UNRESPONSIVE 的唯一出路（写审计）。

## 6. 接入点（按所有权，非"各自 acquire"）
| 系统 | 角色 | 位置 |
|------|------|------|
| 一跨 | 顶层holder | `ListingWorkerHost.execute()`（acquire+heartbeat+spawn(env)+release） |
| 一跨 | 双模 | `EcomExecutorBridge.runPlan()` / `dianxiaomi-adapter.js`（有env→verify；无→自持） |
| ecom | 顶层holder | `erp_operations_runner`（分阶段：LISTING 不持 C 跨 listing_rebuild；ERP_DRAFT 持 C） |
| ecom | 顶层holder | `listing_rebuild`（L→C） |
| ecom | 顶层holder(独立CLI) | `run_batch_and_report` / `run_first_fillverify` / `tools/verify_draft_path.mjs` |
| ecom | 双模(验证者) | `seo_core_kernel` / `dianxiaomi_draft_executor` / `dianxiaomi_draft_kernel` |
| ecom | 只读诊断(豁免) | `session_probe` / `check_*` / `_verify/*` / `erp_page_probe` |
| ecom | 浏览器启动器 | `dianxiaomi_browser_service.ensure_ready`（holder 范围内） |
| ecom | 9224独立 | `aliprice_browser_service` / `collector` / `aliprice_collect` |

## 7. 浏览器入口分类（见 ENTRYPOINT_MAP §分类）
HTTP 被动探测（无锁）/ CDP 页面读取（只读，不取独占锁，限非执行窗口）/ CDP 页面操作（**必须持 C**）/ Chrome 启动（holder 范围内）/ Chrome 关闭重启（**必须持 C，且禁止执行期间**）/ 9224（不取 C）。

## 8. 语义
全程持有（心跳）、finally 释放（仅 holder，带 leaseId）、Fail Closed、仅持有者释放、崩溃恢复（只在已死时）、不假成功。

## 9. 代码改动清单（批准后，最小面）
1. `shared-lock.js`/`shared_cdp_lock.py`：加 leaseId/pidCreateTime/verifyLease/状态派生；release 三校验；默认路径绝对。
2. `listing-worker-host.js`：holder + 带 env spawn + release。
3. `ecom-executor-bridge.js`：双模。
4. ecom `erp_operations_runner`：分段 holder（不含 listing_rebuild 段）。
5. ecom `listing_rebuild`：L→C。
6. ecom `seo_core_kernel`/`dianxiaomi_draft_executor`/`dianxiaomi_draft_kernel`：双模 + 周期 verify。
7. ecom `run_batch_and_report`/`run_first_fillverify`/`verify_draft_path`：自持。
> ecom 侧另一仓库需单独授权；一跨侧基于 `12b7d62`，不改 `f16d9fd`/`12b7d62`。

## 10. 灰度/回退
`UNIFIED_CDP_LOCK` 默认开；`=0` 回退旧行为。2D 独立分支+tag，可 `reset --hard 12b7d62`。
