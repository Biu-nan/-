# 阶段2D 失败恢复设计（PHASE2D_FAILURE_RECOVERY_DESIGN）

> 任务2：新增 `OWNER_UNRESPONSIVE` 状态与安全恢复规则。**不得为提高可用性牺牲互斥安全性。**
> 核心原则：**心跳是唯一权威的存活证明；只有确认 holder 已死（PID 死或 PID 复用）才允许自动接管；心跳超时但 holder 可能仍活 → 禁止自动接管。**

---

## 1. 状态机

| 状态 | 判定 | 允许接管？ | 调用方行为 |
|------|------|-----------|-----------|
| `FREE` | 锁文件不存在 | —（直接获取） | acquire |
| `HELD` | 存在且**心跳新鲜**（`now-heartbeatAt <= ttl`） | ❌ | BUSY（等/让路） |
| `OWNER_UNRESPONSIVE` | 心跳**超时**，但 holder **PID 仍存活且身份匹配**（或身份无法判定） | ❌ **禁止自动接管** | BUSY/UNRESPONSIVE（需人工/等待） |
| `OWNER_DEAD` | 心跳超时，且 **PID 已死** 或 **PID 被复用**（创建时间不符） | ✅ 允许安全接管 | takeover |
| `TAKEOVER_IN_PROGRESS` | `<lock>.takeover` 存在 | ❌ | TAKEOVER_BUSY（稍后重试） |

> `OWNER_UNRESPONSIVE` 是**一等状态**：它明确表达"心跳没了但我不确定它死没"，据此**拒绝接管**——安全优先。

## 2. 存活判定（权威顺序）

1. **心跳新鲜** → 视为存活（`HELD`）。理由：只有真 holder 会 `renew()`；PID 复用者不会续心跳 → 心跳过期。**心跳比 PID 更权威。**
2. 心跳超时后，再看 PID：
   - **PID 不存在** → `OWNER_DEAD`（可接管）。
   - **PID 存在** → 进入 **PID 复用检查**。

## 3. PID 复用检查（进程身份指纹）

- 锁记录在 acquire 时写入 holder 的 **`pidCreateTime`**（进程创建时间，epoch ms 或平台等价），并记 `host`。
- 进程身份 = `host + pid + pidCreateTime`（**不是只看 pid**）。
- 复用判定：
  - 记录有 `pidCreateTime` 且当前 PID 的创建时间**可读且不一致** → **PID 被复用 = 原 holder 已死** → `OWNER_DEAD`（可安全接管）。
  - 创建时间**一致** → 原 holder 仍在（只是卡住/心跳停）→ `OWNER_UNRESPONSIVE`（**不接管**）。
  - 创建时间**不可读/未知** → 保守 `OWNER_UNRESPONSIVE`（**不接管**）。

### 3.1 创建时间获取（各端）
- **Python**：优先 `psutil.Process(pid).create_time()`；无 psutil 时 Windows 用 `ctypes GetProcessTimes(CreateTime)`，Linux 用 `/proc/<pid>/stat` 第 22 字段(starttime)。
- **Node**：自身可 `Date.now() - process.uptime()*1000` 近似记录；**读取他人创建时间**能力有限 → Node 作为验证者时，若无法取得对方创建时间，**退回"心跳权威 + OWNER_UNRESPONSIVE"保守策略**（见 §2/§3）。
- 存储为字符串/整数皆可；**只用于身份比对，不作授权**。

## 4. 自动接管规则（严格）

- **仅 `OWNER_DEAD` 允许自动接管**（经 `<lock>.takeover` 守卫串行 + 二次确认）。
- `OWNER_UNRESPONSIVE` **禁止自动接管**：返回 `OWNER_UNRESPONSIVE`，调用方 BUSY；**需人工**执行"强制接管"（见 §5）。
- `TAKEOVER_IN_PROGRESS` → 拒绝（稍后重试）。
- 任何"不确定"一律**不接管**（Fail Closed）。

> 明确否定的反模式：**不得**因为"心跳超时"就直接接管——那会把仍在跑的长任务（如 18 分钟 Listing）踢掉，制造双写。

## 5. 人工强制接管（OWNER_UNRESPONSIVE 的出路）
- 提供显式命令（非自动）：`force-takeover --confirm --reason "<说明>"`：
  1. 二次确认 `OWNER_UNRESPONSIVE`（心跳仍超时）；
  2. 记录审计（谁/何时/原因/旧 holder owner+pid+createTime）；
  3. 写新锁（新 leaseId）；
  4. 旧 holder 若其实仍活：其下一次 `verifyLease`/`renew` 会因 `leaseId` 不符**自动放弃**（见 §6）→ 停止操作，不双写。
- 强制接管是**人工兜底**，不放进自动路径。

## 6. 子进程发现 Lease 失效 → 必须停止
- 子进程周期性 `verifyLease({leaseId})`；一旦 `valid=false`（leaseId 不符 / 心跳过期 / holder 死 / 被强制接管）：
  - **立即停止后续所有 9223 操作**；
  - 关闭自己打开的临时页（不 `browser.close()`，避免误关）；
  - 任务标记 `BLOCKED_LEASE_INVALID`（不可伪装成功）；
  - 不再写入页面/不点保存。
- 这样即使父被误杀/被强制接管，**也不会出现两个进程同时驱动 9223**。

## 7. 失败/恢复矩阵
| 情形 | 状态 | 自动动作 | 人工动作 |
|------|------|----------|----------|
| 正常持有 | HELD | 心跳 | — |
| holder 卡住但进程活 | OWNER_UNRESPONSIVE | **不接管**，BUSY | 诊断进程后 `force-takeover` 或等其恢复 |
| holder 崩溃(PID死) | OWNER_DEAD | 自动接管 | — |
| PID 复用 | OWNER_DEAD（创建时间不符） | 自动接管 | — |
| 创建时间未知 | OWNER_UNRESPONSIVE | **不接管** | `force-takeover` |
| 正在被接管 | TAKEOVER_IN_PROGRESS | 拒绝 | 稍后重试 |
| 子进程 Lease 失效 | — | **停止 9223 操作** | 父级重新获取 |

## 8. 安全底线（不可为可用性让步）
- 心跳权威 > PID；不确定 > 不接管；**宁可 BUSY，不可双控**。
- 所有接管写入审计（旧 holder owner/pid/createTime、接管者、原因）。
- 自动接管**只**发生在"确认已死"。
