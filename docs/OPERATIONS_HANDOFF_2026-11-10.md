# 未完成项操作手册（2026-11-10 18:05）

> 这份文档只回答一个问题：**每一项到底要你给什么、我收到后怎么做、怎么算做完了。**
> 所有命令按 Windows 写，并**分两种终端**：
> **§1 的服务操作用 PowerShell**（查进程需要 `Get-CimInstance`）；
> **测试与采集脚本在 Git Bash 里跑**（`dist/test/*.test.js` 的 glob 必须由 shell 展开 ——
> 实测 `node --test dist/test` 目录形式只跑 1 个用例且失败，不能用）。
> 全文不含推测的前置条件 —— §0 的实况均为本次实测。

## 0. 先纠正一个数字，并给出当前实况

上一轮我说「C/D/E 线：6 个 wait 项」，**这个数字不准确**。
实际未完成 **9 项 = 5 wait + 4 idle**；其中：

| 线 | 未完成 | 明细 |
|---|---|---|
| A | 2 | A2c2 `wait`、A2d `idle` |
| C | 3 | C2 `wait`、C3 `idle`、C4 `wait` |
| D | 2 | D3 `wait`、D4 `idle` |
| E | 2 | E1 `wait`、E2 `idle` |

**实测实况（FACT，本次查询）**

| 项 | 值 |
|---|---|
| `:3000` 服务 | PID **33480** = `F:\软件\node.exe dist/src/server.js` |
| 看门狗 | PID **36992** = `F:\软件\node.exe watchdog.js`（**正在跑**，且用的是正确的 v24） |
| 稳卖 client `:3980` | PID **12592**，**正在监听** |
| CDP | `openEnv` 由稳卖返回端口，无需固定 9223 |
| `data/metrics/` | 已存在（`facts/` 最后写入 11-08） |
| `agents/_shared/` | 已存在（D3 待迁移） |
| `watchdog.log` 最后一行 | `07:46:25Z 拉起工作台服务...`（= 15:46 北京时间，A2 合并演练），之后服务一直正常、看门狗不写日志 |
| 现役 HTTP | `/api/status` 200、`/healthz` 404、`/api/version` 9 字段 |

⚠️ 因此上一轮「需要在终端补起看门狗」的说法要改成：
**看门狗已经在跑，但加载的是改动前的旧 `watchdog.js`；需要的是「重启」，不是「补起」。**

---

## 1. 【最高优先，唯一马上能做的操作】重启看门狗加载 A2d-0

### 为什么必须做
`c813f1f` 改了 `watchdog.js`，但 PID 36992 是改动前启动的，内存里仍是旧逻辑。
将来一旦装网关，旧看门狗会只探 `/api/status`（被判 `unsafe`）→ 把活服务判死 → 无限重启。

### 要你给什么
一句话授权：**「同意重启看门狗」**（服务启停属 `docs/DEV_PLAN_2026-11-10.md` §0 的「必须先问你」栏，我不会擅自执行）。
或者你按下面 3 步自己在终端做，做完把 `watchdog.log` 最后 4 行发我核验。

### 操作步骤（**用 PowerShell 终端**，不是本会话后台任务）

下面每条命令都是本次实测过的写法。注意 PowerShell 里 `curl` 是 `Invoke-WebRequest` 的别名，
必须写 `curl.exe`；`wmic` 已弃用，改用 `Get-CimInstance`。

```powershell
# ① 确认当前两个进程（PID 可能已变，以实际输出为准）
netstat -ano | findstr ":3000"
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*watchdog*' } |
  Select-Object ProcessId, CommandLine

# ② 只停看门狗，不要停服务（33480 是服务，别碰）
Stop-Process -Id 36992 -Force

# ③ 用 v24 的 node 重新拉起（必须是 F:\软件\node.exe，不是 WorkBuddy 自带的 node 22）
Set-Location 'F:\yikuaborder-deploy'
& 'F:\软件\node.exe' 'watchdog.js'
```

第 ③ 步的终端**保持开着**，关掉终端看门狗就没了。
新看门狗启动时会先探一次：现役 `/healthz` 返回 404 → 回退 `/api/status` 返回 200 →
判定 `ok=true`，**不会**重复拉起服务。

### 验收（四条全过才算生效）

```powershell
# a) 日志出现新行 —— 这是新代码生效的唯一直接证据
#    -Encoding UTF8 不能省：PS 5.1 默认编码会把中文日志读成乱码
Get-Content 'F:\yikuaborder-deploy\watchdog.log' -Tail 4 -Encoding UTF8
#    期望看到： 看门狗启动 (node=... port=3000)
#             初始探针：via=api-status ok=true running=false

# b) 服务没被重启过（PID 仍是原来的 33480）
netstat -ano | findstr ":3000"

# c) 新看门狗进程存在
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*watchdog*' } |
  Select-Object ProcessId, CommandLine

# d) 本地代理会返回假 502，必须绕开；curl.exe 不能写成 curl，-s 去掉进度条
curl.exe -s --noproxy "*" -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/status
#    期望 200
```

也可以用现成回归脚本再跑一遍（带现役真探，6/6 全过）：
```powershell
$env:WATCHDOG_PROBE_LIVE_PORT = '3000'
& 'F:\软件\node.exe' 'scripts\verify-watchdog-probe.mjs'
```

### 失败回退
若重启后 `watchdog.log` 出现连续的「健康检查无响应」并开始 `killPort`：
```powershell
# 立刻停掉新看门狗，服务不会受影响
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -like '*watchdog*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
旧版源码可从 `git show c813f1f^:watchdog.js` 取回。把日志发我，我按日志定位。

---

## 2. A 线

### A2c2 · run 升级 —— 「建议不动」具体指什么

**现在要做的操作：无。** 保持 `F:\yikuaborder-run` 原样即可，不要 `git pull`、不要拷文件。
唯一已做的变更是 17:40 拷入的 `config/ceo-capabilities.v1.json`（run 的 `git status` 只有这一条未跟踪记录）。

将来真要升级时，按 `docs/RUN_UPGRADE_DIFF_2026-11-10.md` §6 的 6 步执行，其中不能跳过的硬约束：

| 步 | 操作 | 验收 |
|---|---|---|
| 1 | 业务确认接受 2 个 prompt + 14 个服务核心 + 7 个前端的口径变化 | 你一句明确确认 |
| 2 | 白名单备份 run 整目录，逐文件回读 sha256 | 备份清单 + 校验表 |
| 3 | 停 `:3000` 服务窗口（需授权）+ 确认新看门狗已常驻 | §1 的三条验收已过 |
| 4 | **原子同步** `config.js` + `prompts/` + `public/`（146 文件：新增 104 / 覆盖 42） | 三者同批落盘，不分批 |
| 5 | 验收：`/api/status` 200、`/api/version` 的 `codeRoot=F:\yikuaborder-run`、测试失败名集合只减不增、`verify-clean-checkout.mjs` 在 run 侧跑通 | 四项证据 |
| 6 | 回滚准备：备份目录 + run 侧一笔可回退提交 | commit id |

⚠️ **P0**：只换 `config.js` 不换 `prompts/`/`public/` → 静默用 10-29 旧口径跑上品；
只换资源不换 `config.js` → 新版 server 引用 `CODE_ROOT`，旧 config 没有该导出 → 启动即退出。

### A2d · 三块的授权清单

| 块 | 需要你给什么 | 我收到后做什么 | 验收 |
|---|---|---|---|
| **A2d-0** | 什么都不用，**已完成** `c813f1f` | 只差 §1 的重启 | §1 三条 |
| **A2d-1** | 「批准升级 run 并装网关」（含 A2c2 的 6 步授权） | 按上表 6 步 + 装 `installCeoMainBoundary` | 服务 200、看门狗走 `via=healthz`、无重启循环 |
| **A2d-2** | 一份设计评审结论：真实 principal 从哪来、前端凭据怎么存、看门狗带不带 token、Listing Agent 怎么授权、轮换与撤销 | 按结论实现，不先写码 | 需单独一轮 |

**顺序不能跳**：A2d-0 重启生效 → A2d-1 才有 `/healthz` 可探 → A2d-2 才有可保护的 `/api/*`。
`ceo-governance.js` 要求 token ≥32 字节且 `storeId === 400370`；前端若把 token 放 localStorage 等于公开，
所以 A2d-2 不是「加个中间件」。

---

## 3. C 线

### C2 · 采集 11 月全店销售数据（`wait`）

**先纠正看板措辞**：看板写「等你给抓取路径」，但 `docs/TARGET_DECISION_2026-11-10.md` §117 写的是
「采集路径**就绪**，等待执行窗口」。本次实测也确认技术前置齐全：稳卖 client `:3980` 在跑、
`data/metrics/` 已存在、采集器能取 `today / 7d / 30d` 的 `sales.qty.total`。
**真正缺的是范围与执行许可，不是路径。**

**需要你给 3 个参数（一句话回答即可）**：
1. **店铺范围**：只首店 `400370`，还是 4 家店全量？
   （`channelFor()` 只映射了 `400370→2358891`、`416488→2443536`；
   两家梵奢店 `461693` / `461692` **没有 channelId**，要走全量就得先补映射或给 `AE_CHANNEL_ID`）
2. **时间范围**：`2026-11-01 ~ 11-10`（截至今天），还是整月？
3. **执行窗口**：现在允许跑吗？跑一次会 `openEnv` → 连 CDP → 打开 3 个 csp 页面 → 旁听 6 个 mtop 接口。

**我收到后执行**（Git Bash，路径用 POSIX 形式，node 用 v24）：
```bash
cd /f/yikuaborder-deploy
# 先干跑，不落库、不关环境，确认 6 个接口都能旁听到
"/f/软件/node.exe" scripts/fetch-ae-metrics.mjs 400370 --dry-run --keep-open
# 确认无误后正式跑（去掉 --dry-run）
"/f/软件/node.exe" scripts/fetch-ae-metrics.mjs 400370
```
**验收**：`data/metrics/facts/<source>/YYYY-MM-DD.jsonl` 与 `data/metrics/raw/` 有新文件；
`sales.qty.total` 落到 today/7d/30d 三个窗口；金额单位是「分」的字段已 `/100` 转元
（这是历史 100 倍误差高发点）；日切北京 15:00–17:00 的数据按红线跳过不写库。

### C3 · 核准 COGS（`idle`）

**需要你给 3 样东西**：
1. **成本数据源路径**：采购价表 / 店小秘成本导出 / 货通结算单，任选其一，给绝对路径
2. **成本口径一句话**：是否含头程、包装、平台佣金、退款损失
   （`config/metrics-schema.json` 目前**没有** COGS 字段，只有「不含采购成本、头程、包装，绝不可等同于利润」的警告）
3. **一个可对账样例**：某 SKU 的售价、成本、净利三个数，用来验算

**我收到后执行**：在 `metrics-schema.json` 增 COGS / 净利 caliber（**只加不改**既有 33 个），
写一个对账脚本用你给的样例回算，产出「已售成本可复核、净利可算」的证据表。
**验收**：样例回算差额 = 0，且新 caliber 不污染 `sales.qty.total`。

### C4 · 利润目标降级确认（`wait`）

**需要你给一句话**：确认或驳回 `docs/TARGET_DECISION_2026-11-10.md` §131 的结论 ——
> 主指标是销量（日均 500 件 `sales.qty.total`），利润目标 ¥12,000/月**降级为约束条件**而非并列目标；
> 500 件达成时 ¥0.80/件 的净利门槛大概率自动达成，反之不成立。

**我收到后执行**：把结论写进 `docs/TARGET_DECISION_2026-11-10.md` 状态栏与看板 C4，标 `done`。
不需要改代码。**验收**：文档与看板口径一致，无第二处相互矛盾的表述。

---

## 4. D 线

### D3 · 骨架跨层化（`wait`）

**需要你给一句话**：「批准按 `docs/D3_LAYERING_PLAN_2026-11-10.md` 改这 17 个文件」。

改动范围（方案 §3 原文，共 17）：
- **移动 5 个**：`agents/_shared/{errors,permissions,schemas,state,trace}.js` → `dist/src/agent-shared/`
  （`permissions.js` 需重写：资源轴保留为 `RESOURCE_AXIS`，副作用等级改调
  `dist/src/agent-safety-scale.js`，**不做 shim**）
- **改 import 12 个**：`agents/ae-product-design/src/` 下 9 个
  （`a-plus-runner` / `a-plus` / `cli` / `runner` 为**高风险**，是上品出图真实链路）、
  `agents/purchase-inventory/src/{audit,decide}.js`、`dist/test/visual-runner-safety.test.js`
- 最后删 `agents/_shared/`

**我收到后按方案 §5 的 6 步执行**：
1. 基线（**Git Bash**：`"/f/软件/node.exe" --test dist/test/*.test.js`），记下通过/失败数（已知 25 个既有失败，不计入）
2. 复制 5 个模块到 `dist/src/agent-shared/`，只改 `permissions.js`，**先不动调用方**
3. 每改 2–3 个 import 就跑一次 `visual-runner-safety.test.js` + `purchase-inventory/cli.js --evals`
4. 全绿后删 `agents/_shared/`
5. 再跑全量，与基线逐项比 —— **失败项只减不增**
6. 更新方案状态为 DONE，把 §1.2 结论写进 `SYSTEM_FRAMEWORK_v1.0.md` §4.3 旁注

**验收**：132 条上品离线断言改前改后各跑一遍均全绿；16 种变异仍全部被抓；失败名集合无新增。

### D4 · 真实跑通一次（`idle`）

依赖 A2 ✅ + C1 ✅ + D1 ✅ + D2 ✅，但实际还差 **C2 的真实采集数据**。
**需要你给**：C2 的三参数 + 「允许真实跑一次」的窗口。
**我收到后执行**：用真实数据跑 `src/workflow.js` 一条完整 run。
**验收**：事件日志齐全（INTENT→DELEGATED→ACCEPTED→DELIVERED→VERIFIED→HUMAN_GATE→HUMAN_DECISION）、
有 `VERIFIED`、有证据哈希、Human Gate 必停且不自动落盘。

---

## 5. E 线

### E1 · 回写触发规则（`wait`）

**需要你批 `docs/WRITEBACK_RULE_2026-11-10.md`**，三选一：
- **A（建议）**：只批**第一步** —— 只做 T1 口径修正（差异 >5%、双向可回读），
  只做「抽取 → 变更建议 → 人批」，不碰 T2/T3
- **B**：三类全批（T1 口径 / T2 阈值 ≥2 次触发 / T3 经验），规则较复杂
- **C**：逐条改，先说哪几条不同意

批准时一并确认两条红线：**不允许自动落盘**（文档改动必须人批）；
批准项要记入 `docs/CHANGELOG-writeback.md`（时间、类型、目标、diff、批准人）。
**验收**：规则状态从「建议草案」改为「已批准」，且 T1 的一个真实案例能走完
「抽取 → 变更建议 → 你批 → 落盘 → 记账」闭环，落盘前后 sha256 可追溯。

### E2 · 回写机制（`idle`）

依赖 E1，**不需要你现在单独给东西**。E1 批了之后我按批准范围实现。
**验收**：E1 的第一条真实建议能完整走通，且未批准项一字节都没落盘。

---

## 6. 可复制的一句话决策清单

```
看门狗重启：同意 / 我自己重启
C2：范围=首店400370 or 4店全量；时间=11/1-11/10 or 整月；现在可以跑吗=是/否
C3：成本源=<路径>；口径=<含/不含头程包装佣金退款>；样例=<SKU+售价+成本+净利>
C4：确认「销量为主指标、利润降级为约束」 / 驳回
D3：批准改 17 个文件 / 暂不
D4：允许真实跑一次 / 等 C2 结果
E1：只批第一步 T1 / 三类全批 / 逐条改
A2c2：维持不动 / 现在启动升级
A2d：只授权 A2d-1 / 连 A2d-2 一起做设计评审
```

---

## 7. 边界：哪些我能直接做，哪些必须先问你

| 直接做（不用等） | 必须先问你 |
|---|---|
| 新建文档、schema 增字段、只读差分与验收脚本、跑 `--dry-run`、影子目录工作 | 改主目录**既有代码**（D3 的 17 文件、run 升级的 146 文件） |
| 读日志、查进程、比对 hash、跑测试（不改数据） | **启停服务 / 重启看门狗**（§1） |
| 把你的口径结论写进文档与看板 | 真实平台账号操作（CDP `openEnv`、上品、抓真实店铺数据） |
| | `git` 写操作（提交、合并、切分支） |
| | 任何口径 / 目标 / 阈值的裁定 |
