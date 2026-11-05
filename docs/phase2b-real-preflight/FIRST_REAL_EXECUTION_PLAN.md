# 阶段2B 首次受控真实 Listing 执行方案（接入 ecom 已验证路径）

> 关联：REAL_EXECUTION_PREFLIGHT.md（B0/B1 已清零，B2 待经营者定选品+模板）
> 依据：ecom-translator `D:/ecom-translator` 已跑通的店小秘上品链路（`dianxiaomi_browser_service.py` + `tools/dianxiaomi_draft_executor.mjs`）。
> 原则：**单产品 · REAL · 人工验收 · 只存草稿不发布 · 失败即停**。

---

## 0. 执行前前置（P0，必须先完成）

| 前置 | 动作 | 完成判据 |
|------|------|----------|
| P0-1 执行工作区 | 用 **`F:/yikuaborder-phase2b-wt`**（干净 f16d9fd；**勿用 `.worktrees/phase2-product-workbench`**，它是脏/坏树） | `git -C F:/yikuaborder-phase2b-wt rev-parse HEAD`=`f16d9fd`；`git status` 干净；三个 `listing-worker-*.js` 存在且哈希 MATCH |
| P0-2 干净任务库 | 以 `USER_DATA_DIR=F:/yikuaborder-deploy` 启动 → 任务库落生产 `data/workbench/tasks.json`（当前不存在=干净）；执行前再确认无 RUNNING/WAITING_EXECUTOR 残留 | 生产 `data/workbench/tasks.json` 为空或不存在 |
| P0-3 浏览器就绪 | **优先**用 ecom 的 `dianxiaomi_browser_service.ensure_ready()`（DETACHED 启动，长期稳定）；或已确认 9223 在线（Chrome 156，profile=`D:/ecom-translator/work/dianxiaomi-browser-profile`） | `/json/version` 返回 Browser；`/json/list` 有 ChatGPT + 店小秘 页 |
| P0-4 登录确认 | 9223 的 profile 内 **ChatGPT + 店小秘 均已登录**（本轮已验：ChatGPT 有输入框、店小秘在加产品页且有「引用产品」）；经营者再目视确认一次 | 两站均非登录页 |
| P0-5 模板 CAPTURED | 见 `TEMPLATE_CAPTURE_READINESS.md`：确认模板名→提供内容/授权 schema 捕获→`POST /api/identity/template-snapshots`→`status=CAPTURED` | `GET /api/identity/template-snapshots/require?ref=<模板名>` 返回 `ok:true` |
| P0-6 产品准入 | 从 `TEST_PRODUCT_SHORTLIST.md` 选 1 个（建议 P0 迷你石锅 / P1 音乐发声）；目检图品一致；登记到生产 board（独立 UUID productId、主图+附图、objectiveInfo、templateRef） | board 项齐全；该产品无活动任务 |

> ⚠️ **CDP 铁律**：连接 9223 的 playwright **禁止 `browser.close()`**（会关掉对方的 Chrome 导致 9223 掉线，ecom 已踩过）。用 `connectOverCDP` 后只关自己新建的 page，不 close browser。

---

## 1. 执行流程（对齐 ecom 已验证链路）

> 一跨 phase2b 的编排：**ChatGPT 生成 Listing（9223）→ 店小秘 引用模板存草稿（9223）**。店小秘段严格沿用 `dianxiaomi_draft_executor.mjs` 的已验证顺序。

### 步骤1 · 产品选择
- 动作：从 Top 5 选定 1 个；目检 `产品图/` 与品名一致；确认其类目对应的店小秘模板名。
- 成功标准：满足 8 项准入（`TEST_PRODUCT_SHORTLIST.md`）。
- 失败处理：图品不一致/无对应模板 → 换候选。
- 停止条件：未满足准入不进步骤2。

### 步骤2 · 创建 REAL 任务
- 动作：`createTask({ productId:<UUID>, workflowType:LISTING_PREPARATION, contextVersion, executionMode:"REAL", trigger:"MANUAL" })`。
- 成功标准：`{created:true, task.runMode:"REAL", status:"QUEUED"|"WAITING_EXECUTOR"}`；四要素幂等键写入。
- 失败处理：`idempotentReplay:true` → 检查是否有残留活动任务（P0-2 未清）。
- 停止条件：创建失败/幂等误命中 → 停。

### 步骤3 · 独立 Worker 启动
- 动作：HTTP 主服务经 `ListingWorkerHost.execute()` `fork()` 子进程 `listing-worker-child.js`；**主进程绝不调 `setActiveWorkspace()`**。
- 成功标准：子进程 `READY` → 主服务 `dispatch` EXECUTE。
- 失败处理：`WORKER_SPAWN_FAILED/WORKER_CRASHED` → 读 stderr 诊断（缺依赖等）；重试≥2 次仍失败 → 停。
- 停止条件：连续启动失败 → 转人工。

### 步骤4 · 读取 Product Context
- 动作：子进程按 productId 加载 facts/profile/objectiveInfo/images，组装 Context。
- 成功标准：`productId` 一致、`objectiveInfo` 非空、≥1 主图、`templateSnapshotId` 引用有效。
- 失败处理：身份不一致/`blockingMissing` 非空 → 落 `FAILED`。
- 停止条件：校验不过 → 停。

### 步骤5 · 注入 Listing 模板
- 动作：从快照库取 `templateSnapshotId` 的 CAPTURED 快照，经 `buildTemplateClause()`/`buildSeoKeywordPrompt()`/`buildListingContentPrompt()` 注入 Prompt。
- 成功标准：快照 `status=CAPTURED` 且 `templateRef` 非空；Prompt 含模板条款。
- 失败处理：无 CAPTURED → `BLOCKED_TEMPLATE`，落 FAILED。
- 停止条件：模板不可用 → 停。

### 步骤6 · 执行 Listing 工作流（ChatGPT 9223）
- 动作：Worker 驱动 ChatGPT（CDP 9223）完成 作图 + planning + SEO + Listing 文案；受宿主 busy 闸门 + 执行锁 + Worker 串行三重保护。
- 成功标准：产物落 `output/`，`RESULT{ok:true}`。
- 失败处理：超时（首跑建议 15–20min）/崩溃/额度异常 → `FAILED`，**不留 RUNNING**；`WORKER_ORPHANED` → 孤儿恢复。
- 停止条件：超时/崩溃达 `maxAttempts(3)` → 停。

### 步骤7 · 保存产物
- 动作：落 `data/workbench/runs/<productId>/<taskId>/output/`（独立目录，**绝不回写** `当前产品/产品图/` 等源图目录）。
- 成功标准：清单/图文/文案可读。
- 失败处理：写盘失败 → `FAILED`，保留部分供排查。
- 停止条件：落盘失败 → 停。

### 步骤8 · 店小秘存草稿（沿用 ecom 已验证顺序，**只存不发布**）
> 目标页 `https://www.dianxiaomi.com/web/smtChoice/add`，连 CDP 9223，**顺序严格按 `dianxiaomi_draft_executor.mjs`**：
1) **店铺**：选目标店铺（`#rc_select_0`，校验回读）。
2) **引用模板**：点 `引用产品`/打开 `---请选择引用模板---` 下拉 → 选模板名（按前缀，去 `-星造`）→ **`assertTemplateTookEffect` 校验分类/变体被带出**（未带出=模板未生效，不继续）。
3) **备货类型**（`#rc_select_1`）、**材质**（模板带默认或按 facts 映射；模板带出的默认材质要如实记录）。
4) **产品图片**：主图多槽位，缺翻译图回退原图、再回退 REVIEW 占位（写审计 attention）。
5) **SKU/货品信息**、**来源URL**（`_URL.txt` 四段式）。
6) **保存草稿**：只点「保存」，**绝不点「发布」**。
- 成功标准：草稿保存成功，页面无「真人验证/验证码」拦截。
- 失败处理：命中 `登录|验证码|真人验证` → 停并请经营者处理；模板未生效 → 停。
- 停止条件：任何一步校验不过 → 停，不跳过。

### 步骤9 · 返回结果 + 工作台回写
- 动作：子进程 `RESULT` → 宿主终态去重 → 任务 `SUCCEEDED`+`result`+`events` 持久化；board 记 listing 引用（**不发布**）。
- 成功标准：`tasks.json` 任务 `SUCCEEDED`、`finishedAt` 非空。
- 失败处理：回写失败 → 先内存后落盘，告警人工核对。
- 停止条件：无。

### 步骤10 · 人工验收
- 动作：经营者在店小秘草稿 & `runs/<taskId>/output/` 查看图文与文案。
- 成功标准：经营者确认可用。
- 失败处理：不达标 → 不发布、重做（四要素键不同，不撞旧闸门）。
- 停止条件（关键）：**未经经营者显式批准，绝不点「发布」**。

---

## 2. 全局停止条件（任一触发即停）
1. P0-1~P0-6 任一未完成。
2. 步骤4 身份/完整性校验失败。
3. Worker 启动连续失败≥2 次。
4. 执行超时/崩溃达 maxAttempts。
5. ChatGPT 或 店小秘 登录在运行中失效 / 命中真人验证。
6. 模板未生效（`assertTemplateTookEffect` 失败）。
7. 经营者要求中止。
8. Fail-Closed：任何异常先落 FAILED，绝不留 RUNNING 孤儿。

## 3. 隔离与红线
- **跨产品污染**：Worker 独立进程，`setActiveWorkspace()` 仅在子进程；主服务误调即启动失败。
- **产物隔离**：`runs/<productId>/<taskId>/`，不碰源图/生产目录。
- **幂等隔离**：DRY_RUN/REAL 四要素键分离。
- **额度**：仅 1 产品 1 次 REAL；不启用 autoStartWorkflow、不批量。
- **发布**：只存草稿，发布为独立人工步骤。
- **凭证**：全程不读/不存 Cookie/Token/密码。
- 不部署、不合并、不改 C6/C7、不改 `f16d9fd`。
