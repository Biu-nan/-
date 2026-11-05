# 阶段2D 锁获取顺序审计（PHASE2D_LOCK_ORDER_AUDIT）

> 任务1：解决旧锁(`listing_drafts.lock`)与新锁(`cdp-9223.lock`)的**死锁风险**。本轮只出设计。
> 核心结论：**禁止"持有 C 再去等 L"**；定义全局偏序 **L ≺ C**，且 **Runner 不得持 C 去调 listing_rebuild**。

---

## 0. 风险复述（必须关闭）
新方案若写成"ERP Runner 先持 `cdp-9223.lock`，再启动 `listing_rebuild`（其第一步是取 `listing_drafts.lock`）"，则出现 **C→L 的反向获取**：
- 进程甲：持 C，等 L；
- 进程乙（另一 Listing 队列）：持 L，等 C；
→ **循环等待 = 死锁**。
本审计关闭此风险。

---

## 1. 锁清单
| 符号 | 锁 | 类型 | 归属 | 语义 |
|------|----|------|------|------|
| **L** | `D:/ecom-translator/work/listing_drafts.lock` | 文件(O_EXCL) | ecom `listing_rebuild` | **Listing 队列**互斥（ecom 内部） |
| **C** | `D:/ecom-translator/work/cdp-9223.lock` | 文件(link) | 共享 | **9223 浏览器**跨系统互斥 |
| S | `_START_LOCK`(threading) | 线程 | browser_service | 启动冷却（进程内） |
| R | `_RESTART_LOCK`(threading) | 线程 | erp_control_center | 重启（进程内） |

> 全部**保留**；S/R 为进程内线程锁，不参与跨进程排序。

## 2. 全局偏序（唯一允许方向）
> **L ≺ C**：任何"同时需要 L 与 C"的路径，**必须先 L 后 C**；释放**逆序 C→L**。
> **禁止 C→L**（持 C 时再去取 L）。

## 3. 四类任务：持有者与获取顺序（锁获取顺序矩阵）

| 任务类型 | 触发入口 | 锁持有者（唯一） | 获取顺序 | 释放顺序 | 子进程是否验证父级 L |
|----------|----------|------------------|----------|----------|----------------------|
| **LISTING（经 listing_rebuild 队列）** | `listing_rebuild.py` | **listing_rebuild** | **L → C** | C → L | **否**（子只验证 C 的 Lease；L 属父队列内部） |
| **LISTING（Runner 直接跑 seo_kernel）** | `erp_operations_runner` | **Runner** | **C** | C | 子验证 C Lease |
| **ERP_DRAFT** | `erp_operations_runner` | **Runner** | **C** | C | 子验证 C Lease |
| **SEO（seo_core_kernel 独立运行）** | `tools/seo_core_kernel.mjs` | **自身（双模）** | **C** | C | — |
| **独立 CLI**（`run_batch_and_report` / `run_first_fillverify` / `verify_draft_path`） | 直接运行 | **CLI 自身** | **C** | C | — |
| **完整任务（LISTING+ERP_DRAFT 一个 job）** | Runner | **分段持有**（见 §4） | LISTING 段：L→C（由 listing_rebuild）；ERP_DRAFT 段：C | 段间**释放** | 子验证各段 C Lease |

## 4. 关键修正：完整任务的分段持有（消除 C→L）

**规则：C 只在"实际驱动 9223 的那一段"持有，段间释放；Runner 绝不持 C 跨越 `listing_rebuild` 调用。**

```
完整 job（Runner 编排）
  ├ 阶段 LISTING:
  │    Runner 调用 listing_rebuild（此时 Runner 不持任何锁）
  │      └ listing_rebuild: acquire L → acquire C → 驱动(子 seo_kernel 验证 C) → release C → release L
  │    （段结束，C/L 全释放）
  └ 阶段 ERP_DRAFT:
       Runner: acquire C → spawn(executor, lease=C) → 执行器驱动 → release C
```
- 若 LISTING 由 Runner 直接跑 seo_kernel：`Runner: acquire C → 跑 → release C`（不取 L）。
- **任何时刻都不会出现"持 C 去取 L"** → 无 C→L 边 → 无环。

## 5. 子进程是否验证父级"旧锁 L 的所有权"？
**结论：不需要。**
- 子进程（`seo_core_kernel` / `dianxiaomi_draft_executor` / `dianxiaomi_draft_kernel`）只需 **验证 C 的 Lease**（浏览器授权）。
- **L 是 ecom 内部 Listing 队列锁**，只约束"同时只有一个 Listing 队列"，与"子进程能否用浏览器"无关；把 L 塞进 Lease 会让跨系统耦合、且跨系统无意义（一跨无 L）。
- 因此 **Lease 只承载 C**；L 由 `listing_rebuild` 自管（进程内自查，不重复取）。

## 6. 不可重入 & 不重复获取
- L 与 C **均不可重入**（持有期间再次 acquire 必失败）。
- 规则：
  1. **只有 listing_rebuild 取 L**（它是 Listing 队列的唯一入口）。
  2. **C 由"最外层浏览器驱动边界"取**：WorkerHost / Runner 段 / listing_rebuild / 独立 CLI。
  3. 子进程**见到 `YKB_CDP_LEASE` 即 verify-only**（绝不 acquire C）。
  4. 同一进程内若已持 C（例如 Runner 段），**不得再调会取 C 的组件**（避免同进程二次 acquire）；跨段前先释放。
- 死锁充要：**禁止 C→L**；L→C 单向 → 无环。

## 7. 旧锁保留策略
- L、S、R **全部保留，不删、不改语义**；C 为**新增叠加**。
- 不通过"删除旧锁"来掩盖冲突（旧锁承担队列/启动/重启语义，与 C 职责不同）。

## 8. 死锁证明（简述）
- 等待图顶点=进程；边=进程 A 持 X 等 Y。
- 允许的边仅：`∅→L`（自由取 L）、`L→C`（持 L 取 C）。**无 `C→L` 边**。
- 若存在环，必含反向边 `C→L`，但被禁止 → 无环 → **无死锁**。
- `verifyLease` 为只读，不产生等待边。
