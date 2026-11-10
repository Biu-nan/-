# A2d · 方案 C（最小版）· 可执行实施清单

> 状态：**待授权 apply**。本文件给出「一步能落地」的精确改动、验证与回滚；**尚未修改任何生产代码**。
> 关联评审：`docs/A2D2_CREDENTIALS_REVIEW_2026-11-10.md`（A/B/C 三方案，结论＝先上 C）。
> 目标：让生产**可自证身份 + 可被判活**，同时**不暴露业务 API**；不引入网关、不引入凭据。

---

## 0. 一句话

在 `dist/src/server.js` 里加**一个仅当 `CEO_PRODUCTION_MODE===1` 才注册的中间件**：放行 `/healthz` 与 `/api/version`，其余 `/api/*` 一律 404。非生产模式该中间件不注册 ⇒ **现役 `:3000` 行为零变化**。

---

## 1. 现状锚点（已读代码确认）

| 位置 | 事实 |
|---|---|
| `dist/src/server.js` ~L95 | `const CEO_PRODUCTION_MODE = !CEO_G1_ENABLED && process.env.CEO_PRODUCTION_MODE === "1";` |
| `dist/src/server.js` L6661 | `app.get("/healthz", ...)` —— **仅 CEO 形态（SHADOW/PRODUCTION）挂载**；生产会挂 ✅ |
| `dist/src/server.js` L6666 | `app.get("/api/version", ...)` —— 恒挂；生产下 `mode=PRODUCTION` |
| 全局 `/api` 中间件 | **当前不存在**（所以现在生产下 `/api/*` 全裸） |
| 首个 `/api` 路由 | ~L567（`/api/agent/active-task`）—— 中间件须注册在它之前 |

---

## 2. 改动（唯一一处）

**文件**：`dist/src/server.js`
**位置**：`const app = express()` 之后、**首个 `/api` 路由（~L567）之前**。

```js
// A2d 方案 C（最小版）：生产下只放行 /healthz 与 /api/version，其余 /api/* 默认 404。
// 不装网关、不引凭据；目的 = 生产「可自证身份 + 可判活」而不暴露业务 API。
// 非生产（CEO_PRODUCTION_MODE=false）此中间件不注册 ⇒ 现役行为零变化。
if (CEO_PRODUCTION_MODE) {
  const PROD_PUBLIC_API = new Set(["/api/version"]);
  app.use((req, res, next) => {
    if (req.path === "/healthz") return next();        // 交给 L6661 的路由
    if (req.path.startsWith("/api/") && !PROD_PUBLIC_API.has(req.path)) {
      return res.status(404).json({ error: "NOT_FOUND", mode: "PRODUCTION" });
    }
    next();                                            // 非 /api（静态/UI）照常
  });
}
```

**为什么放这里**：Express 按注册顺序匹配；中间件先注册即可短路 `/api/*`，而 `/healthz` 走 `next()` 落到 L6661 的真实路由。非 `/api` 全部放行，静态资源与页面仍可访问。

---

## 3. 验证（三步，全部已备）

1. **验证器自测**（不碰真实实例，进程内 mock）：
   ```
   node scripts/verify-production-gate.mjs --self-test
   ```
   期望：`SELF-TEST PASS`（已验证 3/3）。
2. **应用后 · 生产实例**（设 `CEO_PRODUCTION_MODE=1` 起实例后）：
   ```
   node scripts/verify-production-gate.mjs --port 3000 --mode PRODUCTION --expect-api 404
   ```
   期望三项全 PASS：`/healthz=200`、`/api/version=200 且 mode=PRODUCTION`、`/api/status=404`。
3. **非生产回归**（不设 `CEO_PRODUCTION_MODE`，即现役）：
   ```
   node scripts/verify-production-gate.mjs --port 3000 --mode "" --expect-api 200
   ```
   期望：`/api/status=200`（现役行为不变）。

**看门狗**：A2d-0 的探针优先探 `/healthz`；生产已挂 `/healthz` ⇒ 判活走 healthz，**不会**去探 `/api/status`，无重启循环。可用 `scripts/verify-watchdog-probe.mjs` 复验。

---

## 4. 回滚（三条，任选）

- **零成本**：不设 `CEO_PRODUCTION_MODE=1` ⇒ 中间件根本不注册，等价现役。
- **代码级**：`git revert <该提交>`。
- **运维级**：删掉该 `if (CEO_PRODUCTION_MODE) { ... }` 块。

---

## 5. 已知取舍（必须知情）

- 生产下前端页面的 `/api/*` 调用会 **404**，因此 **UI 不可用**——这是「identity-only 最小版」的**刻意**取舍，不是 bug。它的价值是：证明「生产能起、能自证、能被判活」。
- 真正要「生产 UI 可用」，须升级到**方案 B**（HttpOnly 会话 + 服务端凭据表），见评审稿 §4。
- 本改动**不改变** `ceo-production-admission` 的 7 步准入、`ceo-governance` 契约、`CEO_PRODUCTION_MODE` 默认值（仍默认关）。

---

## 6. 落地前提

1. **Lance 授权**（动 `dist/src/server.js` 属生产代码，红线）。
2. 先起一个**非 `:3000`** 的临时实例（如 `PORT=3100 CEO_PRODUCTION_MODE=1`）验证，再考虑 `:3000`；避免直接影响看门狗。
3. 若走 `:3000`：因 `watchdog.js` 的 `NODE=process.execPath` 继承启动者，需在终端重启看门狗让其带 `CEO_PRODUCTION_MODE=1`（且确认准入批准就绪，否则 fail-closed 拒启动——这是预期）。

> 授权后，我按 §2 apply、跑 §3 三步验证、留证据；不通过即回滚。
