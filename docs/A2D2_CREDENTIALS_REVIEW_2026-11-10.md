# A2d-2 · CEO 生产网关凭据体系 · 设计评审稿

> 状态：**评审稿（设计 only）**，日期 2026-11-10。**未写一行业务代码、未改生产、未启停服务。**
> 目的：给出「把 CEO `/api/*` 在生产下暴露时，凭据怎么发、存、轮换、撤销」的可选项与推荐，交 Lance 决策。
> 关联：`dist/src/ceo-governance.js`、`dist/src/server.js`、`dist/src/ceo-production-admission.js`、`docs/A2_PREREQ_BINDING_2026-11-10.md`。

---

## 0. 一句话

现在生产模式**只自报身份、不装网关**；一装网关，`/api/*` 全挡 401（含看门狗探的 `/api/status`）→ 重启循环。所以 A2d 的真问题不是「加个中间件」，而是**先定义「谁、凭什么是合法调用方」**，再决定 token 放哪、怎么轮换撤销、看门狗怎么判活。

---

## 1. 现状事实（读代码得出，非推测）

### 1.1 网关契约已写死（`ceo-governance.js`）

- `createCeoGovernance({credentials})` 对每条凭据强制校验：
  - `id` ≤120 字符且唯一；`storeId === policy.storeId`（= **400370**）；
  - `profile ∈ policy.profiles`；`role ∈ {owner, agent}`；
  - **`token` 字节数 32–256**（`Buffer.byteLength`）且唯一；
  - `expiresAt` 必须是带时区 ISO（`Z` 或 `±hh:mm`）且可解析。
- `authenticateToken(token)`：找不到即 `UNAUTHORIZED`，找到再 `validate`。
- `authorize({principal, operation, storeId})`：**storeId 必须等于 principal.storeId**，且 profile 必须被授予该 operation，否则 `FORBIDDEN`。
- `reserveOperation({...operationId, payload})`：非 GET 必须带 `operationId`（正则 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$`），做请求哈希去重（幂等）。
- `createCeoGateway`：读 `Authorization: Bearer <token>`；`classifyCeoRequest(method,path)` 判 `unsafe` 的走 `resolveOperation`；**请求里任何 storeId/storeRef.environmentId 与 principal 不符即 FORBIDDEN**。

### 1.2 生产模式「刻意不装网关」（`server.js`）

- `CEO_PRODUCTION_MODE = !CEO_G1_ENABLED && process.env.CEO_PRODUCTION_MODE==="1"`。
- 注释原文：生产模式只自报身份（`/healthz`、`/api/version` 的 `mode=PRODUCTION`），准入不过就拒启动；**`/api/*` 的凭据与鉴权是 A2d 的事**。
- 公开白名单只有 `/healthz` 与 `/api/version`；其余 `/api/*` 装网关后即 401。

### 1.3 看门狗与健康探针的强耦合

- 看门狗原先探 `/api/status`。装网关后 `/api/status` 属 `unsafe` → 401 → **看门狗判死 → 重启循环**。
- A2d-0 已把探针改成「先 `/healthz` 200→活；404/连不上→回退 `/api/status`」，现役行为零变化。**A2d 落网关时，生产必须挂 `/healthz` 并让看门狗探它**。

### 1.4 前端现在是裸调

- `public/app.js` 直接 `fetch('/api/*')`，**不带任何 Authorization**。一旦装网关，前端全 401。

### 1.5 准入已能防伪造身份（`ceo-production-admission.js`）

- 7 步 fail-closed；生产准入必须用绑定 manifest 指纹的批准记录（`ceo-binding-approval.js`），影子批准不算数。**这保证「生产身份不可伪造」，但不等于「调用方可信」——那是 A2d-2。**

---

## 2. 目标 / 非目标

**目标**
1. 生产下 `/api/*` 只允许**已认证 + 已授权 + 同店铺(400370)** 的调用方。
2. 凭据可**轮换、可撤销**，撤销后立即失效。
3. 不破坏看门狗判活（探 `/healthz`）。
4. 前端能在不泄密的前提下带上凭据。

**非目标（本阶段不做）**
- 不做多租户 / 多店铺网关。
- 不改 `ceo-governance.js` 契约（token≥32B、storeId=400370 是硬约束）。
- 不做公网穿透；默认仍 localhost/内网。

---

## 3. 三个方案对比

| 方案 | 凭据存放 | 优点 | 致命缺点 | 结论 |
|---|---|---|---|---|
| **A. 前端 localStorage 放 token** | 浏览器 | 改动小 | **等于公开**：任何 XSS/插件/截图都能拿到；token 一旦进前端即不可信 | ❌ 否决 |
| **B. 服务端签发会话 + HttpOnly Cookie** | 服务端会话表 | token 不进 JS；HttpOnly+SameSite 防 XSS/CSRF；可服务端撤销 | 需要会话存储 + 登录/换取逻辑；仍要 `/healthz` 白名单 | ✅ **推荐** |
| **C. 仅绑定 localhost + 无 token** | 无 | 零改前端 | 不满足「已认证」，同机任意进程都能调；过不了「生产身份」初衷 | ⚠️ 仅作为 B 的过渡/兜底 |

---

## 4. 推荐：方案 B（HttpOnly 会话 + 服务端凭据表）

### 4.1 角色与凭据
- **owner**（Lance）：人工登录换取会话，可做 `unsafe` 写操作。
- **agent**（Listing Agent / 看门狗等）：用**服务端注入的长期 token**（≥32B 随机），仅授予其 profile 允许的 operation，`expiresAt` 强制。
- 凭据表**只存 token 的 sha256**（不存明文），撤销即删行。

### 4.2 三个必须同时定死的点
1. **分发**：agent 的 token 从哪来？→ 由 `ceo-production-admission` 的批准记录旁挂一个**密钥文件**（`<dataRoot>/.ceo-credentials.json`，权限 600、gitignore），运维手工写入；前端永不接触。
2. **存储**：浏览器侧用 HttpOnly+Secure+SameSite=Strict Cookie 存**会话 id**（非 token）；服务端会话 → principal 映射，过期即失效。
3. **轮换/撤销**：撤销 = 删服务端凭据/会话行（**下一次请求即 401**，无需重启）；轮换 = 加新行 → 切流量 → 删旧行。审计：每次 `authorize/reserveOperation` 记 `actorId + operation + storeId + ts`。

### 4.3 与现有组件的衔接
- `/healthz`、`/api/version` 加入**公开白名单**（网关直接放行），看门狗探 `/healthz`。
- 网关挂在 `CEO_PRODUCTION_MODE===1` 且准入通过之后；单根非生产**不装**（保持现役零变化）。
- `classifyCeoRequest` 已把 `/api/status` 判 `unsafe` → 生产下看门狗**不得**再探它（A2d-0 的回退仅在 `/healthz` 404 时触发，生产有 `/healthz` 即不触发）。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 装网关后前端全 401 | 先加 Cookie 登录 + 白名单，灰度；保留 `CEO_PRODUCTION_MODE=0` 一键回退（不装网关＝现役行为） |
| 看门狗把活服务判死 | 生产必挂 `/healthz`；A2d-0 探针优先 `/healthz`；上线前用 `verify-watchdog-probe.mjs` 复验 |
| token 泄露 | 只存 sha256；撤销即删行；`expiresAt` 强制；最小 profile 授权 |
| 与 A2c2(run 升级) 耦合 | **本阶段不动 run**；A2d-2 只在「要真正暴露 CEO API」时启动 |

---

## 6. 开放问题（需 Lance 决策，决策前不写代码）

1. **暴露范围**：CEO API 只给本机/内网，还是要给外部（决定要不要上 TLS/反代）？
2. **登录方式**：owner 用「口令 → 会话」还是「一次性魔法链接」？
3. **agent 调用方清单**：除 Listing Agent，还有谁要调 `unsafe`？（决定 profile 授权表）
4. **是否先做方案 C 过渡**（localhost 绑定 + 白名单），把 B 放到真正需要远程时再做？
5. **run 升级（A2c2）是否先于 A2d**：建议否——升级换不到可用能力，却改变 12 天业务语义。

---

## 7. 我的建议

**先做方案 C 的最小版**：生产只把 `/healthz`、`/api/version` 公开，其余 `/api/*` 在 `CEO_PRODUCTION_MODE===1` 下默认 404（不装网关、不引凭据），跑通看门狗与前端读取链路；**等确有远程/多调用方需求，再上方案 B**。理由：目标当前是「首店日均 500 件」，A2d 对订单量边际收益≈0，不值得现在承担凭据体系的复杂度与风险。

> 本稿不构成实施授权。是否开工、选哪个方案，等 Lance 拍板。
