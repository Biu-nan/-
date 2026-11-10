# run 目录升级差分（只读分析，2026-11-10 17:50）

> **状态：只读分析，未执行任何写操作。**
> 目的是把 A2c2 / A2d-1 从"要不要升级 run"这种模糊判断，变成一份可核对的清单。
> 决策依据：看板 A2c2 当前结论是「本阶段不动 run」，本文为将来授权后的一次性升级做准备。

## 1. 结论先行

**好消息**：在受管范围内，run 是 deploy 的**严格子集** ——
"仅 run 有、deploy 无" = **0 个文件**。升级是纯增量同步，不会覆盖任何 run 独有资产。

**但坏消息更重要**：这不是"补几个 CEO 文件"，而是**跨 12 天的大版本跳跃**。
run 停在 `master@40a46a3`（2026-10-29），deploy 是 2026-11-10 的 A2/A2c 版本。
差异同时涉及业务 prompt、前端、上品服务核心模块与依赖锁，会改变真实上品行为。

> 这进一步支持「A2d-2 凭据体系没定型前不升级 run」：升级带来的业务语义变化
> 远大于它能换回的能力，风险与收益不对称。

## 2. 差分数字

比对范围：`dist/`、`public/`、`schemas/`、`prompts/`、`config/`、`listing-agent/`、
`package.json`、`package-lock.json`、`watchdog.js`、`start-windows-run.bat`（按 sha256）。

| 项 | 数量 | 说明 |
|---|---:|---|
| deploy 受管文件 | 291 | |
| run 受管文件 | 187 | |
| **仅 deploy 有（run 缺）** | **104** | dist 91 / config 10 / public 2 / schemas 1 |
| **两边都有但内容不同** | **42** | 见 §3 |
| 两边都有且相同 | 145 | 无需动 |
| **仅 run 有** | **0** | ✅ 严格子集，无独有资产 |

⇒ 一次完整升级 = **新增 104 + 覆盖 42 = 146 个文件操作**，145 个不动。

`config/ceo-capabilities.v1.json` 已在 17:40 拷入 run，所以它现在属于"相同"那 145 个；
run 的 `git status` 目前只有这一条未跟踪记录，其余干净。

## 3. 42 个差异文件按风险分类

| 类别 | 数量 | 文件 | 风险 |
|---|---:|---|---|
| **A2 合并的核心** | 1 | `dist/src/config.js` | **P0**：见 §4 |
| 服务核心 | 14 | `server.js`、`ai-adapter.js`、`automation-service.js`、`daily-operation-service.js`、`directory-images.js`、`hidden-data-loop-service.js`、`image-files.js`、`json-write-queue.js`、`operation-service.js`、`operator-service.js`、`p0-protocol-service.js`、`queue-service.js`、`storyboard-gate-service.js`、`types.js` | 真实上品行为变化 |
| **业务 prompt** | 2 | `prompts/03_SEO_KEYWORDS_PROMPT.md`、`prompts/04_LISTING_CONTENT_PROMPT.md` | **P0**：SEO / Listing 文案口径会变 |
| 前端 | 7 | `public/app.js`、`index.html`、`styles.css`、`draft-executor-panel.js`、`p0-visualization.html`、`smt-choice-task-card-preview.html` 等 | 需核对 `app.js?v=` 版本戳 |
| 口径 schema | 1 | `config/metrics-schema.json` | 数据口径变化 |
| 依赖锁 | 1 | `package-lock.json` | 可能需要 `npm install` |
| 看门狗 | 1 | `watchdog.js` | run 侧不跑它（`start-windows-run.bat` 启动），覆盖无害 |
| 测试 | 15 | `dist/test/*.test.js` | 不参与运行时 |

前端版本戳：run `app.js?v=20261028-*`，deploy `app.js?v=20261030-2`。
**改前端必 bump `app.js?v=YYYYMMDD-N`**（项目红线），升级后要确认浏览器缓存策略。

## 4. ⚠ P0：`config.js` 与 `prompts/` / `public/` 必须成对切换

run 的旧 `config.js`（10-29 版）：

```js
export const PROMPTS_DIR = path.join(PROJECT_ROOT, "prompts");
export const PUBLIC_DIR  = path.join(PROJECT_ROOT, "public");
```

deploy 的新版（A2 合并后）：

```js
export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const PROMPTS_DIR = path.join(CODE_ROOT, "prompts");
export const PUBLIC_DIR  = path.join(CODE_ROOT, "public");
```

`PROJECT_ROOT = process.cwd()`，而 `start-windows-run.bat` 里 `cd /d "F:\yikuaborder-deploy"`
⇒ 在双根形态下 `PROJECT_ROOT` 是**数据根 deploy**，`CODE_ROOT` 是**代码根 run**。

两种失败模式：
- **只换 config.js，不换 prompts/public** → 路径指向 run，但 run 里的 prompt 是 10-29 旧版
  ⇒ 静默用旧口径跑上品，比报错更危险
- **只换 prompts/public，不换 config.js** → 新版 server.js 引用 `CODE_ROOT`，
  而旧 config.js 没有这个导出 ⇒ 模块加载失败，启动即退出

所以这三组必须**作为一个原子操作**同步，且同步后要实测
`/api/version` 的 `codeRoot` 变成 `F:\yikuaborder-run`、`/api/status` 仍 200。

## 5. 依赖形态

`F:\yikuaborder-run\node_modules` 是**真实目录**（不是符号链接，2026-07-07 创建），
与之前那些 worktree 的符号链接不同 ⇒ 覆盖它不会误删主目录依赖。
但 `package-lock.json` 有差异，升级后应核对 `npm ls` 或跑一次依赖体检再启动。

## 6. 执行前置条件（等 A2d-1 授权，一条都不能跳）

1. **业务确认**：确认接受 2 个 prompt + 14 个服务核心模块的口径变化（这不是技术升级）
2. **备份**：先把 run 整目录按白名单备份（参照 `scripts/a2-merge.mjs` 的做法），
   逐文件回读 sha256
3. **停服窗口**：升级代码根时 `:3000` 必须停（服务启停需 Lance 授权），
   且看门狗已按 `c813f1f` 的新探针常驻
4. **原子同步**：`config.js` + `prompts/` + `public/` 一起换，不要分批
5. **验收**：`/api/status` 200、`/api/version` 9 字段且 `codeRoot=F:\yikuaborder-run`、
   `node --test dist/test/*.test.js` 失败名集合与基线一致、
   `scripts/verify-clean-checkout.mjs` 在 run 侧也能跑通
6. **回滚**：备份目录 + 一笔可回退的提交（run 是独立 git 工作区，当前干净）

## 7. 与 A2c2 决策的关系

A2c2 现在保持 `wait`。理由不变并被本文强化：

- A2d-2（真实凭据体系）没定型前，升级 run **换不到任何可用能力** ——
  生产模式默认不装网关，装上也会把 `/api/*` 全挡成 401
- 而升级本身会一次性改变 12 天的业务逻辑与前端，风险与收益不对称
- A2d-0（`c813f1f`）已经把"装网关会重启循环"这颗雷拆掉，所以**不急**

证据：`docs/A2_PREREQ_BINDING_2026-11-10.md` §15.3 / §17.6 / §18
