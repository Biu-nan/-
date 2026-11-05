# 阶段2D 验收标准（PHASE2D_ACCEPTANCE_CRITERIA）· 最终修订（含 10 项专项）

> 对应 EXECUTION_PLAN / LOCK_OWNERSHIP_DESIGN / LOCK_ORDER_AUDIT / FAILURE_RECOVERY_DESIGN。
> 全部用临时锁文件（`os.tmpdir()`）；不启动真实 Chrome、不连真实 9223、不写店小秘、不发布。

---

## A. 基础锁互斥（8）
| # | 场景 | 期望 |
|---|------|------|
| A1 | Node 持，Python 抢 | Python BUSY |
| A2 | Python 持，Node 抢 | Node BUSY |
| A3 | N Node + M Py 同时 | 恰好 1 成功 |
| A4 | 持锁崩溃（PID 死/心跳停） | 可安全接管（仅已死） |
| A5 | 心跳续期/长任务 | >2×ttl 期间始终 BUSY；停心跳后可接管 |
| A6 | 非持有者释放 | NOT_HOLDER |
| A7 | 锁异常/不可用 | Fail Closed |
| A8 | 直接入口绕过 | 拒绝执行 |

## B. Lease 所有权与委托（10）
B1 父持锁子 verify 并执行；B2 子不能释放父锁；B3 父结束正确释放；B4 ecom 独立入口自取；B5 Runner 不与子重复获取；B6 父崩溃 Lease 失效；B7 路径不一致拒绝；B8 直接入口不可绕过；B9 9224 不受影响；B10 旧锁与共享锁共存无死锁。

## C. 附加断言
同文件互认 / Lease 不落日志明文 / 非 PID 授权 / 过期拒绝继续 / 旧锁未删 / 顺序无死锁 / 无假成功。

---

## D. 专项测试（本轮新增，10 项，逐条设计）

### D1 旧锁与新锁交叉等待不会死锁
- 装置：进程甲按 `L→C` 持锁；进程乙尝试 `L`（应 BUSY）；另一线程模拟"持 C 取 L"的**被禁止路径**（断言代码层拒绝/不存在）。
- 期望：无环；甲可正常 L→C→释放；乙始终 BUSY；**不出现 C→L**（代码审计 + 运行断言）。
- 验证：并发跑 listing_rebuild(L→C) 与 ERP_DRAFT(C) 各若干，全流程无死锁、无超时。

### D2 心跳过期但父进程存活时禁止接管
- 装置：holder 停心跳但**进程仍活**（不杀）；等 > ttl；他人 `tryAcquire`。
- 期望：返回 `OWNER_UNRESPONSIVE`，**不接管**（acquired=false）。

### D3 父进程死亡后可以安全接管
- 装置：holder 进程**真被杀**（PID 死）；他人 `tryAcquire`。
- 期望：`OWNER_DEAD` → 接管成功（takeover），记录 previous。

### D4 PID 复用不会误判持有者
- 装置：写入锁记录 pid=P、pidCreateTime=T1；构造"PID=P 但创建时间=T2≠T1"（模拟复用）。
- 期望：判定为 `OWNER_DEAD`（原 holder 已死）→ 允许接管；**绝不**把复用 PID 当作 holder 驱动。
- 变体：创建时间不可得 → `OWNER_UNRESPONSIVE`（不接管，保守）。

### D5 Lease 不会传给无关进程
- 装置：holder spawn 子进程带 env `YKB_CDP_LEASE`；另起一个**无关**进程（不继承该 env）。
- 期望：无关进程无 leaseId → `verifyLease` 失败；无法驱动 9223。且 env 未被全局 export。

### D6 子进程不能释放父锁
- 装置：子进程持有 leaseId 但 pid≠holder。
- 期望：`release()` → `NOT_HOLDER`；锁仍在。

### D7 Lease 失效后子进程停止执行
- 装置：子 verify 通过后，父被强制接管（leaseId 改变）；子下一轮 `verifyLease`。
- 期望：`valid=false` → 子**停止**后续 9223 操作，任务 `BLOCKED_LEASE_INVALID`，不写页面/不保存。

### D8 Chrome 不会在锁持有期间被擅自关闭
- 装置：C 被持有；调用 Chrome 关闭/重启入口。
- 期望：关闭/重启入口**先尝试 acquire C**；被占 → **拒绝关闭/重启**（不擅自关）。仅有 holder 可发起且需显式。

### D9 只读 HTTP 探测不会干扰执行
- 装置：C 被持有（执行中）；调用 `GET /json/version`（HTTP 被动探测）。
- 期望：探测正常返回、**不取锁、不影响执行**；不打开/操作页面。

### D10 所有 9223 业务入口均受治理
- 装置：C 被外部持有；逐个调用业务入口（`seo_core_kernel` / `draft_executor` / `draft_kernel` / `run_batch_and_report` / `run_first_fillverify` / `verify_draft_path`）。
- 期望：全部 BUSY/拒绝（双模：无 env 自取失败即拒；有外部锁即拒）；**无一绕过**。

---

## E. 总通过条件
- A(8) + B(10) + C + **D(10)** 全绿 → 通过；任一失败不得提交。
- 通过后独立分支 + tag 提交（不合并、不部署）。
