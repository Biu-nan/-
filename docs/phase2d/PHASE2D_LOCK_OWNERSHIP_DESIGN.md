# 阶段2D 锁拥有权与 Lease 设计（PHASE2D_LOCK_OWNERSHIP_DESIGN）

> 解决"同一调用链多次获取共享锁 → 自我死锁"；确立 **Lease 所有权**。
> 配套：`PHASE2D_LOCK_ORDER_AUDIT.md`（锁序/死锁）、`PHASE2D_FAILURE_RECOVERY_DESIGN.md`（OWNER_UNRESPONSIVE/PID复用）。
> 本轮只出设计，不改代码。

---

## 1. 核心原则：唯一持有者 + Lease 委托
1. 同一调用链**同一时刻只有一个 holder**。
2. holder 是唯一拿到 `leaseId` 的进程，负责 `release`。
3. 子进程**只 verify，不 acquire、不 release**。
4. **Lease-priority 铁律**：有合法 `YKB_CDP_LEASE` → verify-only；无 → 自持（acquire+release）。二者互斥。
5. 持有权 = `leaseId + owner + 心跳新鲜`；**绝不仅凭 PID**（PID 仅用于死亡/PID复用判定）。

## 2. Lease 机制（完整字段与接口）

### 2.1 锁记录字段（`cdp-lock/1` 扩展）
```json
{
  "schema": "cdp-lock/1",
  "leaseId": "9f2c…(128bit hex，仅holder与授权子进程知)",
  "owner": "ykb:12345:task-abc",
  "pid": 12345,
  "pidCreateTime": 1793... (epoch ms 或平台等价；身份指纹，非授权),
  "host": "pc-…",
  "system": "ykb|ecom",
  "taskId": "task-abc",
  "acquiredAt": 0, "heartbeatAt": 0, "ttlMs": 60000, "label": "9223"
}
```
- `pidCreateTime`：holder 自身进程创建时间（用于 **PID 复用**判定，见 FAILURE_RECOVERY）。
- 旧记录无 `leaseId`/`pidCreateTime` → `verifyLease` 视为**无效**（需重新获取），保证语义不被旧数据污染。

### 2.2 接口（Node/Python 同签名）
| 方法 | 语义 |
|------|------|
| `tryAcquire(meta)` → `{acquired, reason, lock, leaseId}` | 成功返回 `leaseId`；记录 `pidCreateTime` |
| **`verifyLease({leaseId, owner?})`** → `{valid, reason, state, holder}` | **只读**：校验 leaseId 命中 + owner(可选) + 心跳 + holder 存活性；**不 acquire/release/改文件** |
| `release()` → `{released, reason}` | 要求 `owner + pid + leaseId` **三者匹配**；子进程 pid 不同 → `NOT_HOLDER` |
| `renew()/startHeartbeat()/stopHeartbeat()` | holder 专用 |
| `status()` → 记录 + 派生 `state`（FREE/HELD/OWNER_UNRESPONSIVE/OWNER_DEAD/TAKEOVER_IN_PROGRESS） | 只读 |

### 2.3 Lease 传递规则（**不是普通环境变量**）
- **仅**通过 `spawn(..., env: {..., YKB_CDP_LEASE: <compact-json>})` **定向**传给**本次 job 的直接子进程**。
- **禁止**：全局 `export`、写 argv（进程列表可见）、写日志明文、传给无关进程、子进程再向无关孙进程传播。
- 结构：`{"leaseId":"…","owner":"…","taskId":"…"}`；子进程只读它做 verify。
- 子进程退出/任务结束即失效（env 随进程生命周期）；父释放锁后 leaseId 自然失效。

### 2.4 日志脱敏
- 只允许打印 `leaseId` 前 6 位 + `…`，或 `sha256(leaseId)[:8]`；**禁止明文**。
- 审计记录存 `leaseIdHash`，不存明文。

### 2.5 Lease 失效后的任务状态与恢复
- 子进程 `verifyLease` 失败 → 任务置 **`BLOCKED_LEASE_INVALID`**（不可伪装成功）。
- 子进程**立即停止**所有 9223 操作（关自己临时页、不点保存、不写页面）。
- 恢复：父级重新 `tryAcquire`（拿到新 leaseId）后重跑；旧子进程不得自行重取（避免双写）。
- 父被强制接管时，旧子进程下一轮 verify 因 `leaseId` 不符而自动中止。

## 3. 三种发起场景
### 场景 A：一跨发起（WorkerHost 持锁）
`WorkerHost.tryAcquire→L` → `startHeartbeat` → `spawn(ecom子, env YKB_CDP_LEASE={L})` → 子 `verifyLease(L)` 驱动（不 acquire/release）→ `WorkerHost.release(L)`。
Host 崩溃 → 心跳停 → 子 verify 失败 → 中止。

### 场景 B：ecom 独立发起（顶层持锁）
顶层 `tryAcquire→L` → 同进程传 L / 跨进程带 env → 结束 `release(L)`。

### 场景 C：ecom ERP Runner 派子（Runner 持锁）
Runner `tryAcquire→L` → `spawn(执行器, env L)` → 执行器 verify-only → Runner `release(L)`。**Runner 与子不重复获取。**

## 4. 锁序（详见 LOCK_ORDER_AUDIT）
- 全局偏序 **L ≺ C**；**禁止 C→L**。
- **Runner 不得持 C 去调 `listing_rebuild`**：完整任务分段持有（LISTING 段由 listing_rebuild 取 L→C 后释放；ERP_DRAFT 段 Runner 取 C）。
- 子进程**只验证 C 的 Lease**；**不需要**验证父级 L（L 属 ecom 内部队列）。

## 5. 统一路径与自检（Fail Closed）
- `CDP_LOCK_FILE = D:/ecom-translator/work/cdp-9223.lock`（绝对）；两端默认改绝对。
- 启动自检：`isAbsolute` 真；打印解析路径（不打印 leaseId）；不一致/非绝对 → 拒绝。

## 6. 全入口职责（详见 ENTRYPOINT_MAP）
顶层holder / 验证者 / 双模 / 只读诊断(豁免) / 浏览器启动器 / 9224独立。直接 CLI 脚本为顶层holder，不遗漏。

## 7. 失败模式（Fail Closed）
| 情形 | 结果 |
|------|------|
| 无 env + acquire 失败(BUSY/UNRESPONSIVE/TAKEOVER_BUSY/UNREADABLE) | 拒绝，`CDP_BUSY` |
| 有 env 但 verify 失败 | 拒绝，`LEASE_INVALID` |
| 路径非绝对/不一致 | 启动拒绝 |
| 锁损坏 | 拒绝 |
| 长任务中途 lease 失效 | 停止，`BLOCKED_LEASE_INVALID`，不假成功 |
