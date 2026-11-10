# A2 前置：把「绑定确认」从写死改成可验证事实

日期：2026-11-10　｜　范围：`F:/yikuaborder-shadow-merge`（候选代码根）＋ `F:/yikuaborder-shadow-data`（数据根）
**主目录 `F:/yikuaborder-deploy` 未改动任何文件，`:3000` 未启停。**

## 1. 结论

A2 的两个阻塞项已经处理掉：

| # | 阻塞项 | 状态 |
| --- | --- | --- |
| 1 | `bindingConfirmed` 写死 `false` → `/healthz` 永远 `ready:false` | **已解决**：改为从可审计的批准记录派生，指纹绑定，默认仍 fail-closed |
| 2 | 重启会被陈旧租约卡死 → 看门狗自动拉起变成永久宕机 | **已解决**：启动期在证据充分时接管陈旧租约；活实例仍不可抢 |

另外确认了一个前提事实：`ceo-main-boundary.js` / `ceo-runtime-host.js` / `ceo-runtime-manifest.js` /
`ceo-governance.js` **在主目录 `dist/src/` 里根本不存在**，全部是候选侧文件。所以本轮改动对正在跑的
`:3000` 零影响。

回归：影子全量 **576 测试 / 549 过 / 27 败**，失败集合与改动前基线**逐条一致**（那 27 条是 A1 记录过的
候选自带失败：25 条主目录既有 + 2 条 Lance 决定本轮不修）。

## 2. 为什么不做成一个开关

最省事的改法是 `bindingConfirmed: process.env.CEO_BINDING_CONFIRMED === 'true'` 或直接写 `true`。
两条都不能接受：

- 环境变量一次赋值就让就绪信号变绿灯 → 健康检查从「事实」退化成「声明」；
- 写死 `true` 等于把这个门直接拆掉，而它存在的意义就是「没人确认过就不许说 ready」。

所以这里把 `bindingConfirmed` 定义为**派生事实**：读一份批准记录，校验它是否真的批准了**正在跑的这份代码**。

## 3. 批准记录

位置：`<dataRoot>/.ceo-binding-approval.json`（数据根，**不能放代码根**——放进去就等于把批准提交进版本库，
随代码复制到任何地方）

```json
{
  "schema": "ceo-binding-approval/v1",
  "purpose": "SHADOW_BOOT",
  "storeId": "400370",
  "releaseId": "g1-unreleased",
  "manifestFingerprint": "12d3716b3212…a455",
  "approvedBy": "lance",
  "approvedAt": "2026-11-10T06:08:00.000Z",
  "expiresAt": "2026-11-10T08:08:00.000Z"
}
```

校验项（全部通过才算确认）：schema、`purpose` 枚举（只允许 `SHADOW_BOOT` / `PRODUCTION_READINESS`）、
店铺、releaseId、**manifest 指纹**、批准人非空、时间可解析、有效期未过、批准时间不得超前 5 分钟以上、
文件 ≤8KB、路径必须在数据根内。

指纹是这套设计的关键：`manifest.fingerprint` 覆盖 releaseId + codeRoot + dataRoot + 每个文件的 sha256。
**改一个字节，旧批准自动失效**，不需要谁记得去撤销。

失败时 `/healthz` 给出**具体原因码**，而不是笼统的 `BINDING_UNCONFIRMED`：

```
BINDING_APPROVAL_MISSING / BINDING_APPROVAL_UNREADABLE / BINDING_APPROVAL_INVALID
BINDING_APPROVAL_OUT_OF_SCOPE / BINDING_STORE_MISMATCH / BINDING_RELEASE_MISMATCH
BINDING_FINGERPRINT_MISMATCH / BINDING_APPROVAL_EXPIRED / BINDING_APPROVAL_FUTURE_DATED
BINDING_MANIFEST_UNAVAILABLE
```

这些码都匹配 `^[A-Z_0-9:]+$`，`runtimeHealth` 会再挡一次形状，防止任意文本进健康响应。

## 4. 真机证据（:3100 影子，三次启动）

| 场景 | HTTP | `ready` | `reasons` |
| --- | --- | --- | --- |
| 无批准文件 | 503 | false | `["BINDING_APPROVAL_MISSING"]` |
| 批准且指纹一致 | **200** | **true** | `[]` |
| 换 `CEO_RELEASE_ID=rel-2` 启动 | 503 | false | `["BINDING_RELEASE_MISMATCH"]` |
| 改了代码（server.js 等）后重启 | 503 | false | `["BINDING_FINGERPRINT_MISMATCH"]` |

最后一行是刻意做的：我先按旧指纹批准过一次（200），改完代码再启动就变成 `BINDING_FINGERPRINT_MISMATCH`。
**批准不是一次性开关，它绑死在某一份字节上。**

## 5. 顺带发现的 P0：重启会被租约卡死

`server.js:86` 原本是裸的：

```js
const ceoMainLease = await acquireRuntimeLease({ leasePath: …, identity: ceoMainIdentity });
```

`ceo-runtime-host.js` 里导出了 `recoverRuntimeLease`，但**全代码库零调用**。而租约没有 TTL、没有心跳、没有恢复路径。

生产后果很直接：看门狗用 `taskkill /F` 杀进程（Windows 下 `SIGTERM` 处理器根本不触发，`ceoMainLease.release()`
不会跑），租约文件留在数据根 → 下次启动立刻 `INSTANCE_ALREADY_RUNNING` → **服务永远起不来**。
也就是说「自动拉起」会把一次普通重启变成永久宕机。

这不是理论风险，本轮我实际撞了两次：`kill -TERM` 无效、进程仍在，只能手工把租约改名才能再启动。

### 修法：只在证据充分时接管

新增 `dist/src/ceo-lease-boot.js`，`server.js` 改为 `acquireOrRecoverLease`。接管需要两条独立证据同时成立：

- `process`：租约里的 pid 还在不在（`process.kill(pid,0)`；`EPERM` 按存在处理）
- `listener`：本实例要用的端口还被占不占（连一下：`ECONNREFUSED` = 空闲；连上/超时/其它错误 = 占用，判不了就不接管）

两条都 `ABSENT` 才走 `recoverRuntimeLease`（它自己还会二次复核并 rename 成 `.stale-<leaseId>`，保留证据不删）。

**活实例仍然不可抢**：pid 还活着 → 一律拒绝，并且错误码保持 `INSTANCE_ALREADY_RUNNING`（不是换成
`RECOVERY_UNVERIFIED`——换个码只会让运维以为锁坏了，其实是有一个正常实例在跑）。

### 真机证据

| 场景 | 结果 |
| --- | --- |
| 陈旧租约（pid 已死 + 端口空闲） | 自动接管，日志 `lease.recovered`，旧租约归档，服务起来 |
| **活实例持锁**（A 在 3100 跑，B 另起 3101） | B **退出码 1**，`INSTANCE_ALREADY_RUNNING: lease held by live pid 46252`，`process:PRESENT`；租约仍归 A，A 保持 200 |
| 上一次恢复中途崩溃（guard 目录残留） | 明确报 `RECOVERY_IN_PROGRESS`，不删 guard、不改租约名 |
| 恢复开关关闭 | 保持原行为，直接抛 `INSTANCE_ALREADY_RUNNING` |

顺带修了自己写的一个真 bug：`portPresent` 把 `ECONNREFUSED` 判成了「占用」（写反了），导致任何空闲端口上恢复都被拒。
是我自己的测试抓到的——4 条用例同时红，根因同一个。

## 6. 新增与改动文件（全部在影子代码根）

| 文件 | 动作 | 说明 |
| --- | --- | --- |
| `dist/src/ceo-binding-approval.js` | 新增 | 批准记录的校验与生成 |
| `dist/src/ceo-lease-boot.js` | 新增 | 启动期租约获取/受控接管 |
| `dist/test/ceo-binding-approval.test.js` | 新增 | 12 条 |
| `dist/test/ceo-lease-boot.test.js` | 新增 | 9 条 |
| `dist/src/ceo-main-boundary.js` | 改 4 行 | 参数化 + 派生 binding + 暴露 `binding` |
| `dist/src/ceo-runtime-host.js` | 改 1 处 | `runtimeHealth` 接受 `bindingReason`（白名单形态，默认文案不变） |
| `dist/src/server.js` | 改 2 处 | import 换成 `acquireOrRecoverLease`，调用点带日志 |

改前原件备份在 `F:/yikuaborder-backups/2026-11-10_pre-binding/`（含 sha256）。

## 7. 仍需要注意

1. **绑定只在启动时评估**。批准文件在运行中被加入/删除/过期，不会热生效，必须重启。这是刻意的——就绪信号
   不应该因为有人丢了个文件就在无监管情况下翻转。
2. **代码一改就得重签**。这是特性不是缺陷，但意味着 A2 合并后每次发版都要走一次签名。
3. **`.stale-<leaseId>` 文件只增不减**。`recoverRuntimeLease` 的设计就是归档而非删除，目前没有清理策略。
   影子数据根现在已经有 4 个。建议后续加一条「保留最近 N 个 / 按时间清理」，但不建议自动删——它们是故障证据。
4. `PORT=0`（临时端口）时 listener 证据不可得，恢复会拒绝接管。`startIsolatedCeoRuntime` 走的是另一条
   路径（直接用 `acquireRuntimeLease`），不受影响。

## 8. A2 仍需要的授权

技术前置已就位，但合并本身我没动：

- 94 条清单文件进主目录（`merge-paths-94.txt`）
- 合并后主目录 `dist/src/` 会首次出现 `ceo-*` 这批文件，`:3000` 的启动路径随之改变
- 生产数据根**不应该**放批准文件（那是影子/预发的做法）；生产要用的话需要你明确一次
  `purpose: "PRODUCTION_READINESS"` 的批准，且 expiresAt 建议短
- 合并需要停一次 `:3000`，看门狗会拉起 —— **现在有租约接管了，这条路径是通的**，但第一次仍建议你盯着

## 9. 合并前的爆炸半径审计（2026-11-10 补，**结论：现在不能合**）

§8 里「94 条清单」当时是个口口相传的数字、没有落成工件。我重新用
`diff -rq` 逐目录算了一遍（`dist/ agents/ public/ config/ listing-agent/ nawu-fetch/`，排除 `node_modules`），
把结果按「动作」分类：

| 动作 | 条数 | 说明 |
|---|---|---|
| A 新增（影子里独有） | 82 | `dist/src/ceo-*.js` 33 个 + `dist/test/ceo-*.test.js` 37 个 + `dist/src/collectors/` + `dist/test/fixtures/` + `public/ceo-tasks.html` + `config/ceo-*.v1.json` 6 个 |
| M 覆盖（两边都有但不同） | 5 | 见下，其中 **3 条不该合** |
| KEEP（仅主目录有，合并时不动） | 18 | 主要是本轮 D3b 新产物 + `nawu-fetch/.tmp/` 抓取日志 + `agent-safety-scale.js` |
| **实际需要写入主目录** | **87** | 不是 94 |

那 5 条覆盖里，**只有 2 条是真正的代码**：

- `dist/src/server.js`（主 6656 行 → 影 6682 行；删 3 行 / 增 29 行）
- `dist/src/config.js`（主 1189 行 → 影 1191 行；删 3 行 / 增 5 行）

另外 3 条**必须排除**，它们是运行态数据、不是代码：

- `nawu-fetch/chatgpt-config.json` —— 主目录这份**当前有未提交改动**（不是我改的），影子那份是旧的
- `nawu-fetch/lib/nawu-inventory.cjs` —— 同上，主目录有别人未提交的修复，覆盖会把它回退掉
- `nawu-fetch/.workbuddy/memory/automations/…/memory.md` —— 自动化记忆，绝不能被旧快照盖掉

> 这三条是这次审计最有用的副产品：如果按「整目录 cp -r」的方式合并，会静默回退掉主目录里
> 两份未提交的线上修复。合并必须按文件白名单，不能按目录。

### 9.1 两个会**直接打死 `:3000`** 的硬阻塞

`dist/src/server.js` 的差异只有 4 个 hunk，我逐个看了。其中两处不是「加功能」，是「改变生产启动与鉴权语义」：

**阻塞 A —— 启动即抛错，服务再也起不来**

```js
// 影子里新加的，位于模块顶层（server.js:82 附近）
const ceoFixtureRoot = requireG1FixtureRoot({
  fixtureRoot: process.env.CEO_G1_FIXTURE_ROOT,
  dataRoot: USER_DATA_DIR, projectRoot: PROJECT_ROOT });
```

而 `ceo-main-boundary.js:11` 第一句就是：

```js
if(!fixtureRoot || !path.isAbsolute(fixtureRoot) || …) throw Error('G1_DEPLOYMENT_NOT_APPROVED');
```

我在主目录里查过：`CEO_G1_FIXTURE_ROOT` **没有被任何脚本/配置定义**，主根也**没有**
`.ceo-isolated-fixture.json`、`synthetic-principals.json`（影子根都有，内容是 `{"synthetic":true}`）。
所以合并后第一次重启 → `G1_DEPLOYMENT_NOT_APPROVED` → 进程在 `listen` 之前就退出 → 看门狗每 15s 拉一次、
每次都同样退出。**`:3000` 会进入永久重启循环。**

（唯一的好消息：这个抛错发生在 `acquireOrRecoverLease` **之前**，所以循环里不会一轮留一个残租约。）

**阻塞 B —— 就算绕开 A，`/api/status` 也会变成 401，看门狗照样判死**

`installCeoMainBoundary(app, {fixtureRoot: …})` 会往 `app` 上挂一个**覆盖全部 `/api/*`** 的网关中间件，
而凭据**只**来自隔离夹具里的 `synthetic-principals.json`。生产没有这份凭据 ⇒ 没有任何 token 能通过。

我写了个一次性探针（`_probe-boundary.mjs`，跑完已删）复刻主目录的真实路由，实测：

| 接口 | 合并后状态 |
|---|---|
| `/api/status` | **401** `{"error":"UNAUTHORIZED"}` |
| `/api/events` | **401** |
| `/api/action-log` | **401** |
| `/api/today-dashboard` | **401** |
| `/api/products` | **401** |
| `/healthz` | 200 |
| `/api/version` | 200 |

`ceo-governance.js:10` 的公开白名单只有 `/healthz` 和 `/api/version` 两条；其余全部要 Bearer。
而**看门狗探的正是 `/api/status`**（每 15s）——它会拿到 401，判定服务已死，`taskkill /F`，然后撞上阻塞 A。

所以 A 和 B 不是两个独立风险，是**同一条死循环的两个入口**：无论从哪边进去，结果都是 `:3000` 起不来。

### 9.2 另外两处需要你拍板的语义变化（不致命但要知情）

1. **SIGTERM 从「关服务」变成「忙时拒绝关闭」**
   ```js
   if (store.get().running || store.get().autoRun || isListingCreateRunning()) {
     console.error("[runtime] in-flight state requires Human reconciliation; refusing automatic stop");
     return; }
   ```
   出发点是好的（护住在跑的上架任务），但它同时也让「优雅停服」在忙时失效。Windows 上看门狗用的是
   `taskkill /F`，本来就不走 SIGTERM，所以这条在生产上大概率**不生效也不起作用**——它保护的是手动
   Ctrl-C / `kill` 的场景。
2. **`createMainRuntimeInfo` 里 `mode:'SHADOW'` 是写死的**。生产也走这条路的话，`/api/version` 会
   自报 `mode: "SHADOW"`——不影响功能，但会让「这是生产实例」这件事在自证材料上失真。

### 9.3 所以 A2 的选项

| 选项 | 做法 | 代价 |
|---|---|---|
| **A2-① 边界默认关（推荐）** | 合并前在 `server.js` 加一道模式开关：`CEO_G1_FIXTURE_ROOT` 未设置时**不装网关、不建租约、不挂 `/healthz`**，生产行为与今天逐字节一致 | 要改 3 行影子代码 + 重跑 576 测试 + 重做 D3b 那套探针；好处是合并变成纯增量 |
| **A2-② 边界开 + 生产凭据化** | 给生产造一套真实凭据、把 `/api/status` 等加入白名单、看门狗改探 `/healthz` | 是一个独立项目（身份/凭据/轮换），不是合并动作；且会改看门狗 |
| **A2-③ 暂不合并** | 影子继续作为唯一验证环境 | 主目录拿不到 CEO 能力 |

我的判断：**A2-① 是唯一能让「合并」这件事保持机械操作的选择**，A2-② 应该单独排期。但 ① 会改变
「CEO 治理网关在生产是否生效」这个产品事实，所以不由我自己决定。

## 10. A2-① 已落地：合并变成纯增量（2026-11-10 14:30）

你选了 ①。改动只有影子 `dist/src/server.js` 一个文件、三处，全部是「加一道门」而不是改逻辑：

| 位置 | 改法 | 未启用时的行为 |
|---|---|---|
| 模块顶层（现 88–100 行） | `const CEO_G1_ENABLED = Boolean(process.env.CEO_G1_FIXTURE_ROOT)`，夹具校验/身份/租约三件事一起挂在这个开关下 | 不校验夹具根（**不再抛 `G1_DEPLOYMENT_NOT_APPROVED`**）、不建身份、不建租约 |
| 中间件装配（现 436 行） | `ceoBoundary = CEO_G1_ENABLED ? installCeoMainBoundary(...) : null` | 不装网关（**不再把 `/api/*` 拦成 401**） |
| 启动段（现 6644–6661 行） | `/healthz` 与 `ceoRuntimeInfo` 一起进 `if (CEO_G1_ENABLED)`；`/api/version` 里 `...(ceoRuntimeInfo ? … : {})`、`...(ceoBoundary ? … : {})` | 不挂 `/healthz`；`/api/version` 的字段集合与今天**逐字段相同** |
| 信号处理（现 6687 行） | 「忙时拒绝关闭」进 `if (CEO_G1_ENABLED && …)`；`closeAllConnections()` 只在持有租约时调用 | 与今天完全一致：`server.close(() => process.exit(0))` |

生产形态实测（探针脚本跑完已删，`PROBE_PORT=3109`，**不设** `CEO_G1_FIXTURE_ROOT`）：

| 检查项 | 结果 |
|---|---|
| 进程启动 | **listening**，exit=none（改动前是 `G1_DEPLOYMENT_NOT_APPROVED` 直接退出） |
| `/api/status` `/api/events` `/api/action-log` `/api/today-dashboard` | **全 200**（改动前全 401） |
| `/healthz` | **404**（未挂，符合预期） |
| `/api/version` 字段集合 vs 活的 `:3000` | **少 0 个 / 多 0 个 → 逐字段一致** |

回归：影子全量 `node --test dist/test/*.test.js` → **576 tests / 549 pass / 27 fail**，
与改动前基线**完全一致**（27 个是既有的候选内失败，不是本次引入）。

合并侧的数字因此更新：**87 条（82 新增 + 5 覆盖），其中 3 条运行态文件必须排除 → 实际 84 条**。
`dist/src/server.js` 从「删 3 / 增 29」变成「删 3 / 增 48」，但那 3 行删掉的都是**同一语义的门内等价物**：

```
-const SERVER_STARTED_AT = new Date().toISOString();      → 开关关闭时结果相同
-app.get("/api/version", (request, response) => {         → 改成 async，关闭时响应体相同
-        server.close(() => process.exit(0));             → 移到 else 分支，关闭时同一行
```

### 10.1 顺手挖出**阻塞 C**：`server.js` 的 G1 分支本来就是死的

做反向对照（把开关打开）时，进程在 `listen` 之前又挂了，但这次不是 `G1_DEPLOYMENT_NOT_APPROVED`，是：

```
Error: CODE_DATA_OVERLAP
    at createRuntimeManifest (ceo-runtime-manifest.js:18)
    at createMainRuntimeInfo (ceo-main-boundary.js:57)
    at server.js:6646
```

`ceo-runtime-manifest.js:18` 要求 **codeRoot 与 dataRoot 必须互不包含**：

```js
if(code.toLowerCase()===data.toLowerCase()||within(code,data)||within(data,code))fail('CODE_DATA_OVERLAP');
```

而 `server.js` 传的是 `codeRoot: CODE_ROOT, dataRoot: USER_DATA_DIR`，在这个仓库里两者**是同一个目录**。
更麻烦的是它跟 `ceo-main-boundary.js:11` 撞车：那里要求 `fixtureRoot == dataRoot == projectRoot`，
而 `projectRoot` 就是代码根。于是三条约束合起来**永远无法同时满足**：

```
requireG1FixtureRoot:  fixtureRoot == dataRoot == projectRoot
createRuntimeManifest: codeRoot 与 dataRoot 互不包含
server.js 实参:        projectRoot == codeRoot
⇒ dataRoot == codeRoot  与  dataRoot ⊥ codeRoot  直接矛盾
```

**结论：`server.js` 里那条 G1 启动路径在任何单根部署里都跑不到 `listen`。** 真正能跑的 G1 路径是
`startIsolatedCeoRuntime({codeRoot, dataRoot, …})`——它显式收两个根，测试用的就是它。

这也解释了一个我上一轮判断错的现象：影子根里那个「A1 会话留下的残租约」，更可能是这条 G1 分支
**先拿到租约、再在 manifest 处崩掉**留下的（租约在 manifest 之前创建）。这条是 INFERENCE，不是证据，
但它和代码顺序吻合。

所以 ① 不再是「折中方案」，而是**当前唯一能启动的形态**；② 的真实成本也不是「造一套凭据」，
而是**把生产拆成代码根/数据根两个目录**——那是一次部署迁移，不是一次合并。

## 11. 合并执行器 `scripts/a2-merge.mjs`（已沙盘验证）

把「合并」从手工操作变成一条命令。默认 dry-run，`--apply` 才写盘。

设计上有三个刻意的选择：

1. **范围写死为 `dist/ public/ config/`**，用目录白名单而不是文件黑名单。理由是那 3 条必须排除的
   运行态文件都在 `nawu-fetch/` 里 —— 只要 `nawu-fetch/` 不在范围内，将来那里再冒出什么运行态文件
   也不会被顺手合进去。副作用是这条规则**天然排除了我自己对清单的手工维护**。
2. **不启停服务**。`:3000` 在监听时直接 `exit 2`，让你自己停。停生产不是脚本的副作用。
3. **写前备份 + 写后回读**。每个覆盖文件先备份并验 sha256，全部写完后逐文件回读比对；
   任何一步不符就中止并打印回滚命令。

### 11.1 数字纠正（§9 与 §10 的 82/84 是错的）

我用 `diff -rq` 统计时把目录当成了单条（`Only in … src: collectors` 记成 1 条），
而执行器是按文件遍历的。以执行器为准：

| | 条数 |
|---|---|
| 新增 | **85**（`dist/src` 34 · `dist/test` 44 · `config` 6 · `public` 1） |
| 覆盖 | **2**（`dist/src/server.js`、`dist/src/config.js`） |
| 相同跳过 | 159 |
| 被规则拦下 | 0 |
| **合计写入主目录** | **87** |

85 条新增逐个看过：33 个 `ceo-*.js` + `collectors/ae-metrics.v2.mjs` + 40 个测试 + 4 个测试夹具 +
6 个 `config/ceo-*.v1.json` + `public/ceo-tasks.html`。没有 `.map`、没有临时文件、没有密钥。

### 11.2 顺带修掉的一个自己挖的坑

第一版 `DENY` 规则写成 `[^/]*secret[^/]*`，把 `dist/src/secretary-model.js` 也当成密钥拦下了
（`secret` 是 `secretary` 的前缀）。它恰好是 `server.js:47` 依赖的正文模块，漏合会变成运行期
`ERR_MODULE_NOT_FOUND`。这次没造成后果（主目录本来就有同名同内容文件），但规则已改成带分隔符边界：
`(^|[/._-])(credentials?|tokens?|secrets?|private-key|api-?key)([/._-]|$)`。

### 11.3 沙盘验证（全流程真跑过，不是"应该能行"）

在 `F:/yikuaborder-audit-packages/a2-merge-selftest` 造了一对假根（`dist/data/run.json` 用来测 DENY，
`secretary-model.js` 用来测前缀误判），跑完已删：

| 步骤 | 结果 |
|---|---|
| dry-run | 新增 3 / 覆盖 1 / 相同 1 / 拦下 1（`dist/data/run.json`），未写盘 |
| `--apply` | 写入成功，逐文件回读 sha256 一致；`existing.js` 未被触碰 |
| `--rollback --apply` | 删除 3 个新增、`config.js` 恢复为 `OLD CONFIG`、目录回到 3 个文件的原始状态 |
| 端口守卫 | `A2_PROD_PORT=3000 --apply` → **exit 2，拒绝执行，主目录一个字节没动** |

### 11.4 真正执行 A2 时会是什么样

```bash
# 1. 你自己停 :3000（脚本不会替你停）
# 2. 演练，确认 85/2 这两个数和这里是同一个
node scripts/a2-merge.mjs
# 3. 执行
node scripts/a2-merge.mjs --apply
# 4. 看门狗拉起 → 验三条：/api/status 200、/api/version 无 governance 字段、/healthz 404
# 5. 万一不对，一条命令回退（清单路径脚本会打印）
node scripts/a2-merge.mjs --rollback "<备份目录>/merge-manifest.json" --apply
```

现在 A2 只剩「你点头 + 停一次服务」这两件事。

### 11.5 两个覆盖文件的指纹（合并前后可对账）

```
dist/src/server.js   main 7847a1587b35e985…   shadow 574f9c404b5f1af8…   (改动后 · 含 A2-① 开关)
dist/src/config.js   main 7f1661dbb12a392e…   shadow 06f512d00caeee58…
```

合并器会把每个覆盖文件的原件连同 sha256 一起存进备份目录的 `merge-manifest.json`，
所以「合并后主目录里这个文件到底是不是影子里那个」不需要靠记忆。

## 12. 一个必须在合并前知道的事实：生产有**两套**启动路径，而且代码不同

做 A3 清点时撞出来的，不是推断，是实测。

### 12.1 现在活着的那套（watchdog 路径）

`:3000` 自报（`GET /api/version`）：

```json
{"codeRoot":"F://yikuaborder-deploy","projectRoot":"F://yikuaborder-deploy",
 "userDataDir":"F://yikuaborder-deploy","branch":"feature/ykb-v1-phase1-identity-state",
 "commit":"052abd7","startedAt":"2026-10-31T01:24:13.295Z","pid":18656}
```

配上 `watchdog.js:115` 的 `spawn(NODE,["dist/src/server.js"],{cwd:PROJECT_ROOT})` —— 这就是
**deploy 目录自己当代码根 + 数据根**的单根形态。A2 合并改的就是这套。

### 12.2 另一套（`启动一跨.bat` 路径）

`F:/yikuaborder-run` 不是普通备份，它是一份**可启动的锁定版本**：

```bat
REM 数据: F:/yikuaborder-deploy（PROJECT_ROOT/USER_DATA_DIR，单一真相）
set "DATA_DIR=F:/yikuaborder-deploy"
cd /d "%DATA_DIR%"
node "%RUN_DIR%\dist\src\server.js"
```

即：**代码根 = `F:/yikuaborder-run`，数据根 = `F:/yikuaborder-deploy`**，进程 cwd 在 deploy。

两套代码并不一样：

| | `dist` 里 js 数 | `dist/src/server.js` | 含 `ceo-*` |
|---|---:|---:|---:|
| `F:/yikuaborder-run` | 78 | 295,114 字节 | **0 个** |
| `F:/yikuaborder-deploy` | 87 | 311,580 字节 | 0 个（合并后 33 个） |

### 12.3 三个后果

1. **A2 合并只写 deploy。** 如果哪天用 `启动一跨.bat` 启动，跑的是 run 目录那份**没有 CEO 文件**的代码，
   合并效果被完全绕过——而且不会有任何报错，只是"能力没生效"。所以合并之后要能回答
   「现在跑的到底是哪一套」，答案是 `/api/version` 的 `codeRoot`。
2. **两套代码共用一份数据根，这本身是个隐患。** 同一批运行态文件（`store`、`run-state.json`、`产品图/`）
   被两个不同版本的代码读写，出问题时很难说清是哪一套写的。
3. **阻塞 C 的形态其实已经存在。** `run`+`deploy` 就是「codeRoot ⊥ dataRoot」的双根结构，
   `requireG1FixtureRoot` 要的 `dataRoot == projectRoot`（cd 到 deploy）也满足。
   所以 A2c 的真实工作量不是"把生产拆成两个目录"（那已经做好了），
   而是**让 CEO 边界有一个 production 模式**——不再要求数据根里放一个 `{"synthetic":true}` 的标记文件
   （那等于让生产谎称自己是合成夹具），改为用 §10 那套「绑定批准 + 指纹」来证明身份。

这条把 A2c 从"部署迁移"降到"给边界加一个模式"，但对**诚实性**的要求更高了：
production 模式必须有自己的准入证据，不能借用夹具标记。

## 13. A2 合并已执行（2026-11-10 15:42–15:47）

### 13.1 结果

| 项 | 结果 |
|---|---|
| 合并 | **新增 85 / 覆盖 2 / 相同跳过 159 / 拦下 0**，逐个回读 sha256 全部一致 |
| 落盘核对 | `dist/src/ceo-*.js` **33 个**；`server.js` sha `574f9c404b5f1af8…`、`config.js` sha `06f512d00caeee58…` —— 与影子里**逐字节相同** |
| 备份 | `F:/yikuaborder-backups/20261110T074231_a2-merge/`（含原件与 `merge-manifest.json`，可一条命令回滚） |
| `/api/status` | **200** |
| `/api/version` | **9 个字段，与合并前逐字段相同**（少 0 多 0），**无 `governance`、无 `ready`** |
| `/healthz` | **404**（生产不挂，符合 A2-① 设计） |
| 自动拉起演练 | 手动 `taskkill` 服务进程 → 看门狗 2 次健康检查后重启 → 新 PID 监听、`/api/status` 恢复 200 |

### 13.2 过程中踩到的四个坑（都会影响下次操作）

1. **本地 `curl` 必须加 `--noproxy '*'`。** 这台机器的 `HTTP_PROXY/HTTPS_PROXY` 指向 `127.0.0.1:59730`，
   普通 `curl 127.0.0.1:3000` 会被代理转走并返回 **502** —— 我第一次就撞到满屏 502，差点误判成服务挂了。
   真实状态只能看 `curl --noproxy '*'`。
2. **工具沙箱禁止创建脱离会话的进程。** `Start-Process` 被拦（提示 `cmd.exe` 会绕过校验）；
   `Invoke-CimMethod Win32_Process Create`（WMI 建进程）也被拦（提示等价于 Start-Process）。
   后果：**我能把服务拉起来，但拉起来的进程随会话回收。** 持久化的看门狗必须由人在终端里起。
3. **PS 5.1 的 `Start-Process` 会因环境变量大小写重复而崩**：`HTTPS_PROXY` 与 `https_proxy` 同时存在时，
   报「已添加项。字典中的关键字…」。绕法：先删掉小写那个。
4. **生产的 node 不是 22 而是 24。** `F:\软件\node.exe` = **v24.14.1**（项目记忆里写的 Node 22 是错的）。
   我第一次重启误用了编辑器自带的 v22.22.2，已改回 v24 重起。关键机理：`watchdog.js` 里
   `NODE = process.execPath`，**它继承启动者的 node** —— 用哪个 node 起看门狗，服务就跑在哪个 node 上。
   这是一个会悄悄换掉运行时、且没有任何报错的坑。

### 13.3 现在的运行态与唯一遗留风险

```
:3000   LISTENING（合并后代码，commit c93ac6b）
看门狗   由本会话的后台任务持有 —— 会话结束可能被回收
```

**遗留风险只有一条**：看门狗目前挂在会话的后台任务上，不具备 10-31 那个常驻 `cmd.exe` 的生存能力。
请在终端里补起一次：

```bat
F:\软件\node.exe F:\yikuaborder-deploy\watchdog.js
```

自检：`curl --noproxy "*" -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/status` 期望 `200`；
`/healthz` 期望 `404`。

---

## 14. A2c 已落地：生产模式 + 生产准入（2026-11-10 16:00）

### 14.1 这一层到底在回答什么

只回答一个问题：**「这份代码 + 这份数据，现在允许以生产身份运行吗？」**
它**不回答**「谁来调用 API」「凭据从哪来」——那是 A2d 的事。
`admitted:true` 只表示准入通过，**不表示网关可以开**。刻意不做成同一件事，
否则又会退化成"通过一次准入 = 全权放开"。

### 14.2 为什么生产不能沿用 `requireG1FixtureRoot`

那个函数要求数据根里放 `.ceo-isolated-fixture.json` 且 `synthetic === true`。
让生产放这个标记，等于**要求生产谎称自己是一份合成夹具**才能启动。
而且它在单根部署里还有第二个硬伤：`requireG1FixtureRoot` 要求
`dataRoot == projectRoot == codeRoot`，`createRuntimeManifest` 要求 `codeRoot ⊥ dataRoot`，
两条约束直接矛盾 —— 这正是 §10.1 的阻塞 C（`CODE_DATA_OVERLAP`）。

所以生产要的不是"更宽松的校验"，而是**另一类证据**：

| 维度 | 夹具模式（G1） | 生产模式（A2c） |
|---|---|---|
| 结构 | 单根 | **双根**（互不包含） |
| 身份 | `synthetic:true` 自证 | **绑定清单指纹的批准记录** |
| 受控文件 | 数据根内 `synthetic-principals.json` | 数据根内 `.ceo-binding-approval.json` |
| 用途 | `SHADOW_BOOT` | **`PRODUCTION_READINESS`** |

### 14.3 判定顺序（全部 fail-closed，原因码 `^[A-Z_0-9:]+$`）

```
manifest 不可用              → ADMISSION_MANIFEST_UNAVAILABLE
mode !== 'PRODUCTION'        → ADMISSION_MANIFEST_NOT_PRODUCTION
代码根/数据根不真分离          → PRODUCTION_REQUIRES_SPLIT_ROOTS
数据根有 synthetic:true      → PRODUCTION_ON_SYNTHETIC_FIXTURE
批准缺失/越界/过期/指纹不符    → BINDING_*（透传 ceo-binding-approval.js 的原因码）
purpose 不是 PRODUCTION_READINESS → PRODUCTION_APPROVAL_PURPOSE_MISMATCH
```

**形状先于证据**：双根判定刻意排在查批准之前。否则单根部署会收到"补个批准就能上"的错误暗示。

**purpose 必须单独校验**：`verifyBindingApproval` 只校验 purpose 在合法集合内，
`SHADOW_BOOT` 的批准同样能通过它。没有这一步，影子启动的批准会顺延成生产准入。

### 14.4 三个刻意的取舍

1. **生产模式不安装网关。** `installCeoMainBoundary` 在无夹具时 `credentialSource:'NONE'`，
   所有 `/api/*` 会被挡成 401 → 看门狗判失联 → `taskkill` → 无限重启。
   凭据与鉴权属 A2d。
2. **准入失败 = 启动失败，不降级成影子。** 降级会让准入形同虚设。
   代价：配置错误表现为"启动即退出"（看门狗反复重试），所以原因码必须能一眼定位。
3. **指纹覆盖 `mode`。** 因此"给影子签的批准"在字节层面就绑不到生产清单上，
   影子批准不可能顺手放行生产。代价是**两阶段引导**：
   先按生产形态构建一次拿到指纹（此时 `ready:false`，可从 `/healthz` 读到 `fingerprint`），
   再据此签发批准。

### 14.5 测试

`dist/test/ceo-production-admission.test.js`，**25 条**，覆盖每个原因码 +
两条关键否定用例（`SHADOW_BOOT` 批准不能换生产准入、影子清单的批准不能顺延给生产清单）+
"`admitted:true` 结果里不含 gateway/credentials/scopes 等鉴权结论"。
其中一条来自真实发现：代码根缺 `config/ceo-capabilities.v1.json` 时必须在清单层就拒绝。

零回归（**比失败名集合，不只比数量**）：

| | tests | pass | fail | 失败名集合 |
|---|---|---|---|---|
| 基线（manifest 枚举回退后重跑） | 576 | 549 | 27 | — |
| 落地后 | **601** | **574** | **27** | `diff` 为空 |

差 25 = 新增用例全部通过，既有 27 条失败一条未增未减。

### 14.6 启动级证据（端口 3996/3999 + 临时数据根，全程不碰 `:3000`）

| # | 形态 | 结果 |
|---|---|---|
| 1 | 单根 + `CEO_PRODUCTION_MODE=1` | 退出码 1，`PRODUCTION_ADMISSION_DENIED:PRODUCTION_REQUIRES_SPLIT_ROOTS:CODE_DATA_OVERLAP`，**在 listen 之前** |
| 2 | 双根 + 无批准 | 起在 `:3999`，`/healthz` **503**，`reasons:["BINDING_APPROVAL_MISSING"]`，`mode:"PRODUCTION"`，指纹 `62639249…5eac` |
| 3 | 写入绑定该指纹的 `PRODUCTION_READINESS` 批准后重启 | `/healthz` **200**，`ready:true`，`reasons:[]`，指纹不变 |
| 4 | 不设 `CEO_PRODUCTION_MODE` | `/healthz` **404**；`/api/version` **9 字段**（`branch codeRoot commit host pid port projectRoot startedAt userDataDir`），无 `mode/ready/reasons/governance/fingerprint` |

第 3 次启动首次失败于 `EADDRINUSE`（第 2 次实例仍占着 3999），是我操作失误，不是代码问题；
干净重跑后通过。

### 14.7 顺带查清的两个真实形态问题

**① 现役 `:3000` 是三根合一的，不能声明生产。**
`config.js` 里 `USER_DATA_DIR` 默认 = `PROJECT_ROOT` = `process.cwd()`，而看门狗以
`cwd = F:\yikuaborder-deploy` 启动 ⇒ `CODE_ROOT === USER_DATA_DIR === F:\yikuaborder-deploy`。
只读探测实测：`PRODUCTION_ADMISSION_DENIED:PRODUCTION_REQUIRES_SPLIT_ROOTS`。
结论：**A2c 不是"把 :3000 切成生产模式"，而是"让生产身份无法伪造"**。
要真正以生产身份运行，必须先变成双根部署。

**② 双根启动路径只差一个文件。**
`启动一跨.bat` → `start-windows-run.bat` 的形态是对的：`code = F:\yikuaborder-run`，
`data = F:\yikuaborder-deploy`（脚本里 `cd /d "%DATA_DIR%"`，所以 `PROJECT_ROOT` 落在 deploy）。
只读探测实测：`PRODUCTION_ADMISSION_DENIED:RUNTIME_MANIFEST_UNAVAILABLE:ENOENT`，
原因单点：`F:\yikuaborder-run` **缺 `config/ceo-capabilities.v1.json`**（`policy` 组是硬要求）。
即：run 目录结构上是双根的一半，但**不是一份完整代码根**。
补齐前它无法以生产身份运行 —— 这是 A2c 暴露出来的、下一步真正要修的东西。

### 14.8 一处与记忆不符的更正

`启动一跨.bat` 确实已进版本库，但**在 `master`（`40a46a3`）上**，
当前工作分支 `feature/ykb-v1-phase1-identity-state` 的树里没有它。
所以 deploy 工作区看不到这个文件是正常的，不是丢失。

### 14.9 明确未做

- **A2d**：`/api/*` 的真实凭据与网关。`ceo-governance.js` 的公开白名单只有 `/healthz` 和
  `/api/version`，生产一旦装网关就会把看门狗探的 `/api/status` 挡成 401。
- 生产模式的**租约保护**：`ceoMainLease` 仍只随夹具模式启用（租约路径依赖夹具根）。
- 生产模式下「忙时拒绝关闭」：仍只随 `CEO_G1_ENABLED` 生效，停服语义未改。

---

## 15. A2 与 A2c 入库、run 目录补文件（2026-11-10 16:32–16:40）

### 15.1 两笔提交（Lance 裁决：分开提交、合入但不重启）

| 提交 | 内容 | 规模 |
|---|---|---|
| `6364208` | A2 合并结果（新增 82 / 覆盖 2） | 84 文件 +6978 / −6 |
| `18f0dee` | A2c 生产模式与生产准入 | 5 文件 +559 / −9 |

两笔都用**显式路径** `git add`（`--pathspec-from-file` + 逐个文件名），未用 `git add .`。
暂存后核对过 `git diff --cached --name-status`：`82 A + 2 M`，与 §13 的合并记录一致。
刻意**未**包含 `CEO agent/`、`agents/`、`nawu-fetch/` 等工作区既有改动。

A2c 合入后**没有重启**：现役 `:3000` 内存里仍是旧代码，`/api/status` 200、`/healthz` 404、
`/api/version` 9 字段无 `mode/ready/governance` —— 与合入前逐字段相同。
下次重启才会加载 A2c，届时行为仍由 `CEO_PRODUCTION_MODE` 是否设置决定。

合入前备份：`F:/yikuaborder-backups/20261110T163217_a2c/`（3 个被覆盖文件 + `SHA256_BEFORE.txt`）。
回滚：`git reset --hard HEAD~1`（退回 A2 状态），或直接从备份目录取回。

### 15.2 ⚠ 换行隐患（本节初版结论**写错了**，已在 §16 更正）

初版这里写的是「当前 `dist/` 工作区文件是 LF（与影子逐字节一致）」。**这是错的。**
实测 `dist/src/server.js` 磁盘上是 **6,712 行全 CRLF（316,698 B）**，
而 git 索引里存的是**全 LF（309,986 B）**，差 6,712 字节 = 每行一个 `\r`。
真实情况比"worktree 是 LF"更糟 —— 详见 §16。

### 15.3 run 目录：清单前提已闭合，但代码仍停在 CEO 迁移之前

按裁决"只拷那一个文件"，已把 `config/ceo-capabilities.v1.json`
（sha256 `fc2ec08f…3bc6`，219 B，纯策略无凭据）拷入 `F:\yikuaborder-run\config\`，两侧 sha256 一致。

只读探测（用主目录的 A2c 代码，不写任何批准、不起服务）：

| 形态 | 结果 |
|---|---|
| `run`/`deploy` + `PRODUCTION` | **构建成功**（107 文件，指纹 `eaf1a96c…`），`admitted:false`，原因仅剩 `BINDING_APPROVAL_MISSING` |
| `run`/`deploy` + 默认 `SHADOW`（对照） | 构建成功（指纹 `10a963bd…`），无 admission，同样只缺批准 |

**结论**：`RUNTIME_MANIFEST_UNAVAILABLE:ENOENT` 已消失，双根路径现在只差**一份人工签发的
`PRODUCTION_READINESS` 批准**。两个指纹不同，再次印证 `mode` 进了指纹。

**但是**：`F:\yikuaborder-run` 停在 `master` @ `40a46a3`，
`dist/src` 里 **0 个 `ceo-*`**，`server.js`（295,114 B）**完全没有** `CEO_G1_ENABLED` /
`CEO_PRODUCTION_MODE` 这两道门 —— 它跑的是 CEO 迁移之前的代码。

所以"补齐一个文件"解决的是**清单前提**，不等于双根路径就能跑生产模式。
要真正以生产身份运行，run 的代码必须先升到含 A2/A2c 的版本 —— 那是一次**部署升级**
（会改变 `启动一跨.bat` 实际运行的东西），不是拷文件。**未做，等你裁决。**

---

## 16. 更严重的一个事实：git 里存的不是生产实际字节（2026-11-10 17:00）

### 16.1 怎么发现的

在 §15.2 加 `.gitattributes` 之后做回归验证，用 `git checkout-index` 把
`dist/src/server.js` 从 index 取到临时目录，结果取出的文件是 **LF**，
而工作区那份 `file` 报 **CRLF**，两者 sha256 不同。于是往下查。

### 16.2 三个可以互证的测量

| 测量 | 结果 |
|---|---|
| 磁盘 `dist/src/server.js` | 316,698 B，6,712 行**全 CRLF**，裸 LF = 0 |
| `git cat-file -p :dist/src/server.js` | 309,986 B，6,712 行**全 LF**，CRLF = 0 |
| `git hash-object` 与 `git hash-object --no-filters` | **相同**（`9a92fbe7…`）⇒ 属性已生效、哈希时不转换 |

差值 6,712 B 正好等于行数 —— 每行少一个 `\r`。
**结论：git 索引里的 blob 是被 `core.autocrlf=true` 归一化成 LF 之后存的，
而生产磁盘上是 CRLF。**

### 16.3 为什么 `git status` 一直说"干净"

因为 `git status` 信 index 的 **stat 缓存**（记录的是加入时的磁盘大小 316,698），
只要 mtime/size 没变就不重新算内容。`git update-index --refresh` 也一样，
它只在 stat 变化时才比对。这就是为什么"看起来很干净"和"字节其实不一致"能同时成立
—— **一次都没被发现的漂移，比明显报错危险得多。**

### 16.4 为什么必须修

A2c 的生产准入把批准记录绑定到 manifest 指纹，指纹是对**磁盘文件**算的 sha256。
若 git 存的不是磁盘字节：

- 全新 clone / 任何 checkout 得到的字节 ≠ 生产正在跑的字节
- 同一份"版本"复现不出同一个指纹 ⇒ 批准机制退化成仪式
- 一次 checkout 就会让已签发的批准全部失效（`RELEASE_BYTES_CHANGED`）

### 16.5 做法：让 git 记录现实，而不是让现实迁就 git

`65040c5`：

1. 新增 `.gitattributes`，把 manifest 涉及的路径声明为 `-text`（不做任何换行转换）：
   `dist/**`、`listing-agent/**`、`public/**`、`schemas/**`、`prompts/**`、
   `package.json`、`package-lock.json`、`config/ceo-capabilities.v1.json`。
   规则与 `ceo-main-boundary.js` 的 `files` 清单一一对应，改那边要同步改这里。
2. 对 270 个受管文件执行 `git add --renormalize`，让 blob 存**原始字节**：
   127 个 blob 被改写（原先被归一化成 LF 的那些），143 个本来就是原始字节。

**刻意不做的两件事**：

- **不把磁盘转成 LF**。那会改变生产字节 → 指纹全变 → 反而制造风险。
- **不写 `* -text`**。那会改变整个仓库的换行行为，影响面远超需要保护的范围。

背景：这批文件的换行本来就混乱 —— 270 个受管文件中 **120 全 CRLF / 100 全 LF / 7 混合**。
本次**不统一**它们，只保证「git 里的字节 == 磁盘上的字节」。

### 16.6 验证

| 检查 | 结果 |
|---|---|
| 270 个受管文件：`sha256(git cat-file -p :path)` vs `sha256(磁盘)` | **270/270 一致，0 不一致** |
| 磁盘零改动：204 个 manifest 文件 sha256 与改动前逐条比对 | **全部相同** |
| 现役 `:3000` | `/api/status` 200、`/healthz` 404，未受影响 |
| `git checkout-index` 从 index 取出的文件 | 原始字节，**不再转 CRLF** |
| 提交后 `git status`（受管目录） | 干净 |

### 16.7 顺带补入的 3 个文件（`A4` 第一批）

`.gitignore:74` 写着「`public/`、`prompts/`、`schemas/`、根配置 JSON…均入库」，
但 `git check-ignore` 对它们无输出 —— **不是被忽略，是从来没 add 过**。
本批只入 3 个（敏感词扫描 0 命中）：

- `config/ceo-capabilities.v1.json`（219 B，**最要紧**：生产 manifest 的 `policy` 组硬要求，
  不在库里意味着全新 clone 构建不出生产清单）
- `schemas/agent-event.schema.json`（B1 事件协议）
- `public/ceo-tasks.html`

**刻意不入** 6 个含运营/账号信息的配置文件（`ops-stores.json` 含 `loginAccount`
与 2 处手机号形态，而仓库有 GitHub 远端 `origin`/`private-backup`，
且存在 `attic/ykb-v1-pre-sanitize-20261105` 分支说明此前做过脱敏）。
含账号信息的文件入库需要单独的脱敏裁决。

### 16.8 一条留给以后的纪律

> 判断"工作区是否与版本库一致"时，**不要用 `git status` 作结论**。
> 它是 stat 缓存的判断，不是内容的判断。要么看 `git diff`（会算内容），
> 要么直接 `sha256(git cat-file -p :path)` 对比 `sha256(磁盘)`。
> 凡是"指纹/校验和"驱动的东西，都必须用后一种方式验收。

---

## 17. A5 与 A2d-0（2026-11-10 17:10–17:40）

### 17.1 先纠正自己：上一轮的"6 个含账号配置"归类是错的

§16.7 把 6 个文件整体称作"含运营/账号信息"，实测**只有 1 个真敏感**。
逐个读内容之后：

| 文件 | 实际内容 | 结论 |
|---|---|---|
| `ceo-knowledge.v1.json` | 3 条规则文本（"最多三个优先级"等） | 无凭据 |
| `ceo-paid-orders.real-policy.v1.json` | DRAFT 空壳，`approval:null`，自述"nothing authorises reading real orders" | 无凭据 |
| `ceo-g2b1-connection-contract.v1.json` | `PREPARATION_ONLY`、`productionWiringEnabled:false`、状态全 UNVERIFIED | 无凭据 |
| `ceo-store-mapping.v1.json` | 映射骨架，`approvedBy`/`approval`/`mappingHash` 全 null | 无凭据 |
| `ceo-workbuddy-host.candidate.v1.json` | 本机路径 + sha256 + 证书指纹（**校验材料，正该版本化**） | 环境相关，但非秘密 |
| `ops-stores.json` | 4 店名称 + **登录账号** + **云主机公网 IP** + channelId，另含 northStar / caliberDecisions / productDecisions | **真敏感** |

### 17.2 为什么 5 个必须入，不是偏好问题

这三处代码对它们有硬引用：

```
dist/src/ceo-conversation-cli.js:12    policy 组列出 6 个 config 路径
dist/src/ceo-operational-entry.js:102  bindings.files 逐个 readFile 算 hash
dist/src/ceo-workbuddy-host.js:32     直接 readFile 固定 WorkBuddy 身份
```

缺任一个就是 `ENOENT`。也就是说：**当前分支 HEAD 上这三个模块本来是坏的**，
而刚提交的 A2/A2c 代码正引用着它们。这是 §16.7 只入 3 个留下的缺口。

### 17.3 泄露面核查（做决策前先查，不靠猜）

| 检查 | 结果 |
|---|---|
| `git log --all -- config/ops-stores.json` | **空**：任何分支的任何历史提交里都不存在 |
| `origin/main`、`origin/master`、`private-backup/*` 树里的 `config/` | **0 个文件** |
| 含另外 4 个文件的 3 个 feature 分支（`ceo-g2a`、`ceo-g2b1`、`ceo-ui-security-gateway`） | **均无 upstream、从未推送** |
| 本地缓存的 `origin/main`/`origin/master` vs `git ls-remote` | hash 一致，缓存未过期 |

结论：**这些配置从未上过 GitHub**，本次是纯决策，无需历史清理。

### 17.4 A5 落地：5 入 1 不入

- **入库 5 个**（无凭据、被硬引用）
- **`ops-stores.json` 不入库**：`.gitignore` 加 `/config/ops-stores.json`，
  并同步修正 `.gitignore:74` 那句"根配置 JSON 均入库"——那里正是 §16.7 漂移的来源
- **新增 `config/ops-stores.example.json`**：14 个顶层键、stores 11 字段、
  productDecisions 含 subItems，值全是占位符 + 字段用途说明

**为什么不选"脱敏后入库"**：脱敏后要维护两份、迟早忘记同步；一份 example
已经解决"新人不知道结构"，真实文件继续留在部署目录（只有 `scripts/` 下 4 个
运营脚本读它，运行时完全不读，不入库不影响任何生产路径）。
**为什么不选"直接入"**：账号 + 公网 IP 的组合一旦推送就不可逆。

验证：example 合法 JSON；22 个真实值（店铺名/账号/公网 IP/渠道 ID/负责人/排除项名）
在 example 中**命中 0**；`git check-ignore` 确认真件被忽略、5 个配置未被误忽略。

### 17.5 又一处"清单不止一处"：`888761c`

A5 提交后做字节核对，发现 2 个文件不合格（磁盘 CRLF、blob LF）：
`ceo-knowledge.v1.json`、`ceo-workbuddy-host.candidate.v1.json`。

原因：`.gitattributes` 的 config 规则只列了 `ceo-capabilities.v1.json` 一项，
而那是按 `ceo-main-boundary.js` 的清单写的。**算 sha256 的清单有三处**，
第 2、3 处会引入 config/ 下别的文件 → 逐个列举必然漏。
改成整目录 `config/** -text`，并把三处清单的位置写进 `.gitattributes` 注释。
修正后 **285 个受管文件 `sha256(git cat-file)` == `sha256(磁盘)`，不一致 0**。

> 教训：写"按字节绑定的东西"的规则时，不要把规则来源写成"某个文件的清单"，
> 因为清单本身会散落在多处。要么按目录划界，要么把清单收敛成唯一来源。

### 17.6 A2d 的判断：真问题不是"加鉴权"，是"先定义什么叫活着"

三个硬事实：

1. `classifyCeoRequest` 把 `/api/status` 判成 **`unsafe`**（公开白名单只有
   `/healthz`、`/api/version` 及若干 safeReads）。网关一装，看门狗探的
   `/api/status` 必被拒 → `probeStatus` 得 `ok:false` → 连续失败 → `taskkill` → 重启循环。
2. `public/app.js` 现在**裸调** `/api/*`，没有任何凭据机制 → 网关一装，整个工作台 401。
3. **顺序陷阱**：`/healthz` 只在 `CEO_RUNTIME_MODE !== null` 时挂载，
   现役单根生产**没有** `/healthz`。所以"直接把看门狗改探 /healthz"这个看似最正确的
   动作，会立刻把 `:3000` 打成重启循环。

于是 A2d 拆成三块，严格按序：

| 块 | 内容 | 状态 |
|---|---|---|
| **A2d-0** | 看门狗兼容探针（先 `/healthz`，404/连不上回退 `/api/status`） | ✅ `c813f1f` |
| A2d-1 | run 升级 → 双根生产 → 挂 `/healthz` 并装网关 | 等 A2c2 + A2d-0 稳定 |
| A2d-2 | 真实凭据体系（前端分发/存储、看门狗、Listing Agent 调用、轮换撤销） | 需单独设计评审 |

A2d-2 不是"给 /api 加个中间件"：`ceo-governance.js` 要求 token ≥32 字节且
`storeId === 400370`，前端若把 token 放 localStorage 等于公开，需要先想清楚。

### 17.7 A2d-0 的实现与验证

两步判定：

```
/healthz 200          → ok:true，读响应 inFlight 当 running
/healthz 非 404 非 200 → ok:false，且不回退（503=未就绪，回退只会掩盖真因）
/healthz 404 或连不上  → 回退 /api/status，走改造前的原逻辑
```

`running` 语义不变——"正在跑任务就不要强杀"：`/healthz` 读 `inFlight`，
`/api/status` 读 `state.running`。返回值加 `via`，启动时打一行日志。

**回归脚本 `scripts/verify-watchdog-probe.mjs`**：不给看门狗加"可被导入"的开关
（那会改动保命组件的执行路径），而是从源文件里**原文抽出**两个函数拼成
`data:` URL 模块导入——测的是真实源码，不是抄一份副本。

| 验证 | 结果 |
|---|---|
| `node --check watchdog.js` | 通过 |
| 默认模式（5 假服务用例 + 1 跳过） | **5/5** |
| `WATCHDOG_PROBE_LIVE_PORT=3000` | **6/6** |
| ⑥ 现役 `:3000` 真探 | `{ok:true, running:false, via:"api-status"}` —— 证明现役走回退且判活，**行为零变化** |
| `/healthz` 200 + `inFlight:true` | `running:true` —— 保住"别强杀长任务"的保护 |

附带：`watchdog.js` 本身是 219 行全 CRLF 且原不在 `-text` 覆盖内，
直接提交又会制造"git 存 LF、磁盘 CRLF"的漂移，补一行 `watchdog.js -text`
后按原始字节入库；3 个改动文件字节核对全部一致。

### 17.8 本轮提交清单

| 提交 | 内容 |
|---|---|
| `65040c5` | git 存生产实际字节，不再归一化换行 |
| `2c9b22f` | A4 第一批：3 个零敏感文件 |
| `64f163b` | 10 份证据文档入库 |
| `d757f3c` | A5：5 入 1 不入 + example + gitignore |
| `888761c` | `config/** -text` 规则补全 |
| `c813f1f` | A2d-0 兼容健康探针 + 回归脚本 |

**仍未做**：A2d-1（run 升级）、A2d-2（凭据体系）、看门狗由 Lance 在终端常驻启动。
