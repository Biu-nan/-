# A1 影子验证报告 · 85 个隔离候选文件

日期：2026-11-10
状态：**验证完成，结论 = 有条件通过（合并清单需从 85 扩到 94）**
执行方式：全程在影子目录，主目录 `F:/yikuaborder-deploy` 未修改、:3000 未重启、无 git 写操作。

---

## 1. 结论先行

| 问题 | 答案 | 证据 |
|---|---|---|
| 85 个候选文件能不能跑起来？ | **能**，但必须用「代码目录 + 数据目录」双根布局 | 见 §3 |
| 能不能直接当生产 server 用？ | **不能**。`bindingConfirmed` 被写死为 `false`，永远 `ready:false` | 见 §4 |
| 合并清单完整吗？ | **不完整**。代码实际需要 94 个文件，清单只有 85 | 见 §5 |
| 候选代码质量能不能接受？ | **可以**。新增失败只有 2 个，且这 2 个在候选自己的源工作树里同样失败 | 见 §6 |

---

## 2. 为什么必须双根布局（本次最大发现）

启动时先后撞上两道互相矛盾的守卫：

```
ceo-main-boundary.js:10-11
  realpathSync(fixtureRoot) === realpathSync(dataRoot)
  realpathSync(projectRoot) === realpathSync(fixtureRoot)
  → 数据根 = 项目根 = cwd，三者必须同一目录

ceo-runtime-manifest.js:18
  if (code===data || within(code,data) || within(data,code)) fail('CODE_DATA_OVERLAP')
  → 代码根与数据根绝不能重叠
```

第一次尝试（全部放一个目录）报 `CODE_DATA_OVERLAP`。正确布局是分离：

| 角色 | 实际路径 | 来源 |
|---|---|---|
| 代码根 CODE_ROOT | `F:/yikuaborder-shadow-merge` | 由 `dist/src/config.js` 位置推导（上两级） |
| 项目根 PROJECT_ROOT | `F:/yikuaborder-shadow-data` | = cwd |
| 数据根 USER_DATA_DIR | `F:/yikuaborder-shadow-data` | 未设 env 时默认等于 PROJECT_ROOT |
| 事件根 CEO_EVENT_ROOT | `F:/yikuaborder-shadow-data/_shadowdata/events` | 我新增的可覆盖参数 |

启动命令：

```bash
cd F:/yikuaborder-shadow-data
CEO_G1_FIXTURE_ROOT="F:/yikuaborder-shadow-data" \
PORT=3100 \
CEO_EVENT_ROOT="F:/yikuaborder-shadow-data/_shadowdata/events" \
node F:/yikuaborder-shadow-merge/dist/src/server.js
```

fixture 标记文件（两份，都在数据根）：
- `.ceo-isolated-fixture.json` → `{"synthetic":true}`
- `synthetic-principals.json` → 三个 principal，id 必须以 `fixture-` 开头，token ≥32 字节

---

## 3. 启动证据（:3100）

```
TCP  0.0.0.0:3100  0.0.0.0:0  LISTENING  42824
```

`GET /healthz` → **503**
```json
{"schema":"ceo-runtime-health/v1","ready":false,"readOnly":true,
 "releaseId":"g1-unreleased","mode":"SHADOW","storeId":"400370",
 "fingerprint":"afeea3af8843b652...","pid":42824,
 "dependencies":[],"reasons":["BINDING_UNCONFIRMED"]}
```

`GET /api/version` → **200**
```json
{"branch":"unknown","commit":"unknown",
 "codeRoot":"F:\\yikuaborder-shadow-merge",
 "projectRoot":"F:\\yikuaborder-shadow-data",
 "userDataDir":"F:\\yikuaborder-shadow-data",
 "mode":"SHADOW","port":3100,
 "governance":{"policyVersion":"ceo-governance/v1",
               "credentialSource":"SYNTHETIC_FIXTURE_ONLY",
               "productionIdentityMigration":false}}
```

`GET /api/status` → **401** `{"error":"UNAUTHORIZED"}`

完整原始输出存于 `F:/yikuaborder-shadow-data/_shadowdata/A1-boot-evidence.txt`。

---

## 4. 生产可用性：NO（这是设计如此，不是 bug）

`ceo-main-boundary.js:58` 把 `bindingConfirmed` 写死为 `false`：

```js
health:()=>runtimeHealth({manifest,identity,bindingConfirmed:false,dependencies:[]})
```

所以 `/healthz` **永远返回 ready:false / BINDING_UNCONFIRMED**。同时 `installCeoMainBoundary` 铸了一道全 `/api/*` 网关（`ceo-governance.js`）：

- 只有 `/healthz`、`/api/version` 是 `public.read`，免认证
- 其余全部要 `Authorization: Bearer <token>`，token 必须在 fixture principals 里
- **带任何 query string 直接 403**（`if(url.search)fail('FORBIDDEN')`）
- 含 `%2f %5c %00 %2e` 或反斜杠的路径直接 403
- 只有 `human` profile 且 `allowIsolatedHumanManual=true` 时才拿到 `human.manual` 权限

**含义**：这套 server 是「影子外壳」，它的设计目标就是不宣称生产就绪。要上生产必须改掉硬编码的 `bindingConfirmed:false`，这属于口径/授权决策，需要 Lance 明确批准，不在 A1 范围内。

---

## 5. 合并清单不完整：85 → 94

代码实际引用了 9 个**清单里没有、F: 盘任何位置都找不到**的文件。它们全部存在于 `.worktrees/ceo-g2b1-20261105/`：

| # | 文件 | 硬依赖证据 |
|---|---|---|
| 1 | `dist/src/ceo-workbuddy-local.js` | `CEO_CONVERSATION_FILES.code` 清单 |
| 2 | `dist/src/ceo-workbuddy-host.js` | 同上 |
| 3 | `dist/src/ceo-workbuddy-mcp.js` | 同上 |
| 4 | `schemas/ceo-cockpit-projection.schema.json` | `ceo-conversation-cli.js:12`、`ceo-g2b4-runtime-route.test.js:14` |
| 5 | `config/ceo-knowledge.v1.json` | `ceo-operational-entry.js:102` **readFile 算哈希，缺则整链抛错** |
| 6 | `config/ceo-g2b1-connection-contract.v1.json` | 同上 |
| 7 | `config/ceo-store-mapping.v1.json` | `ceo-conversation-cli.js:12` |
| 8 | `config/ceo-paid-orders.real-policy.v1.json` | 同上 |
| 9 | `config/ceo-workbuddy-host.candidate.v1.json` | 同上 |

补齐后新增失败从 **10 个降到 2 个**。

### 版本一致性复核

这 9 个文件在 `ceo-g2b1-20261105` 与 `ceo-ui-security-20261106` 两个工作树间，**归一化行尾后只有 2 个真有差异**：

- `ceo-workbuddy-local.js` ← 真差异
- `ceo-workbuddy-mcp.js` ← 真差异

其余 7 个内容一致（此前的 DIFF 是行尾噪声）。本次取 `ceo-g2b1-20261105` 版，因为 `server.js`、`config.js`、`ceo-isolated-runtime.js`、`ceo-conversation-entry.js` 都已确认与该树 hash 一致。

---

## 6. 测试证据（含对照组）

单跑 `node --test dist/test/*.test.js`，串行（`--test-concurrency=1`）结果与并行完全相同，排除并行污染。

| 组 | 测试数 | 通过 | 失败 |
|---|---|---|---|
| **对照组**：纯主目录状态（无候选） | 168 | 143 | 25 |
| **候选组**：85 文件 | 555 | 520 | 35 |
| **候选组**：85+9=94 文件 | 555 | 528 | 27 |

### 失败项归因

| 类别 | 数量 | 举例 |
|---|---|---|
| 主目录本来就有（非候选责任） | 8 个名字 | `standard listing image generation`、`prompt pack validation`、`P0 protocol service`、`selection recoverFromDisk`、`basic feature smoke guards`、`daily operation waiting items`、`standard listing SEO and content handoff`、`ChatGPT response waiting` |
| 候选自己源工作树里也失败 | 2 | `inspect is read only and produces the host goal with quarantined facts`、`save-draft persists once using the inspected host context` |
| 本次合并清单漏文件导致（已修） | 8 | 全部因缺 `schemas/ceo-cockpit-projection.schema.json` 报 ENOENT |

**关键对照**：在 `ceo-g2b1-20261105` 工作树里直接跑 `ceo-workspace-cli.test.js`，结果同样是 3 通过 / 2 失败，报错同样是 `capacityMinutes: 300 !== null` 和 `INVALID_DECISION`。**证明这 2 个不是合并引入的。**

---

## 7. 三个把我坑到的假信号（方法论教训）

### 7.1 `grep -E` 不支持 `(?:...)`

扫跨目录依赖时用了 `(?:from|import)`，GNU grep 的 POSIX ERE 不支持非捕获组，**静默返回空**。我差点据此判定「没有跨目录依赖」，随后启动就报 `ERR_MODULE_NOT_FOUND: listing-agent/src/agent-client.js`。
→ 改成 `(from|import)[[:space:]]*["']` 才扫出来。**扫描器报"全清"时先怀疑扫描器。**

### 7.2 `cp -rp` 退出码 0 不等于复制完整

`cp -rp F:/yikuaborder-deploy/docs F:/yikuaborder-shadow-merge/docs` 返回 0，但影子 `docs/` 只有 **2 个文件**（主目录 226 个）。直接导致 8 个测试文件在加载阶段就 ENOENT 报 `ceo-first-loop-draft-input.json` 缺失，被误算成"候选引入的失败"。
→ 复制后必须**逐目录比文件数**，不能信退出码。

### 7.3 行尾差异伪装成版本分叉

`sha256sum` 比对同一文件在两工作树的结果，9 个里 5 个报 DIFF，看起来像严重的平行真相。用 `tr -d '\r'` 归一化后，5 个里 3 个其实是同一内容。
→ **比 hash 前先归一化行尾**，否则会把行尾噪声当成分叉证据。

---

## 8. 建议的下一步（等 Lance 决定）

1. **合并清单改为 94 条**，新增的 9 条来源统一指向 `ceo-g2b1-20261105`。清单文件：`F:/yikuaborder-backups/2026-11-10_pre-merge/merge-paths-94.txt`（待生成）。
2. **2 个候选自带缺陷先记录不修**（`capacityMinutes` 断言、`INVALID_DECISION`），因为它们属于另一条线，修它们会扩大 A1 范围。
3. **`bindingConfirmed:false` 要不要参数化**——这是上生产的前置，但涉及授权语义，必须 Lance 决策，不能我自己改。
4. 主目录真正合并仍**需要授权**（属于"必须先问你"那一栏）。A1 只完成了"在影子目录证明它能跑"。
