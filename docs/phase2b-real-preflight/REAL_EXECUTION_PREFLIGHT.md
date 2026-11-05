# 一跨 OS V1.0 阶段2B · 真实 Listing 执行前阻断项清零报告

> 稳定检查点：`f16d9fd`（分支 `feature/ykb-v1-phase2b-listing-executor`）
> 本轮时间：2026-10-30 20:11 → 21:05 (GMT+8)
> 依据：经营者指示「先查 ecom-translator 已跑通的店小秘上品路径」并据此推进 B0/B1/B2。
> 权限：仅环境准备、只读扫描、必要临时环境操作；未执行真实 Listing、未消耗额度、未创建 REAL 任务、未迁移幂等键、未登记生产产品、未启用 autoStartWorkflow、未发布、未部署/合并、未改 C6/C7、未读 Cookie/Token/密码。

---

## 0. 结论（B0 / B1 / B2 状态）

| 阻断项 | 状态 | 一句话 |
|--------|------|--------|
| **B0 执行工作区** | ✅ **已清零** | 正确执行工作区 = `F:/yikuaborder-phase2b-wt`（干净 f16d9fd，Worker/Host/IPC 与 checkpoint 哈希一致）；`.worktrees/phase2-product-workbench` 为**脏/坏**树（worker 模块被 staged 删除），弃用；主工作区分支未切换。 |
| **B1 Chrome CDP** | ✅ **已清零** | 9223 已用**验证过的独立登录 profile**（`D:/ecom-translator/work/dianxiaomi-browser-profile`）拉起：Chrome 156、`/json/version`+`/json/list` 正常、WebSocket 调试连通；**ChatGPT 与 店小秘 均已登录**；日常 Chrome(9222) 未动。 |
| **B2 产品/模板准入** | 🟡 **部分清零** | 产品：已从 119 候选中筛出 **Top 5**（见 `TEST_PRODUCT_SHORTLIST.md`）；模板：**0 条 CAPTURED 快照**，机制已查清（见 `TEMPLATE_CAPTURE_READINESS.md`），需经营者定模板+授权捕获。 |

**总体裁决：仍为 NO-GO（暂不可真实执行），但已从 3 个阻断降为 1 个（B2-模板/选品待人工）。** 待经营者选定产品、确认模板并授权后，按 `FIRST_REAL_EXECUTION_PLAN.md` 执行。

---

## 1. B0 · 执行工作区（已清零）

### 1.1 结论：用 `F:/yikuaborder-phase2b-wt`
| 检查 | 结果 |
|------|------|
| HEAD | `f16d9fd8b0dbd12dd4661454aca0b6569594bbcc` ✅ |
| 分支 | `feature/ykb-v1-phase2b-listing-executor` ✅ |
| git status | **干净（0 改动）** ✅ |
| Worker/Host/IPC | 磁盘哈希与 `f16d9fd` blob **逐一 MATCH**（`listing-worker-ipc` `958aa75…`、`child` `ae82eb9…`、`host` `4727fae…`）✅ |
| 依赖 | `node_modules` 缺 → 已建 junction 指向主树 `node_modules`（express 可达） |

### 1.2 弃用：`.worktrees/phase2-product-workbench`（脏/坏树）
- HEAD 虽是 `f16d9fd`，但工作树 **27 处改动**：`listing-worker-ipc/-child/-host.js` 与全部 phase2b 审计文档/验证脚本被 **staged 删除**，多个核心文件被改。**不可用于执行**，本轮未触碰其状态（避免破坏未知改动）。

### 1.3 主工作区分支未切换
- 主检出仍为 `feature/ykb-v1-phase1-identity-state`@`052abd7`（**未切换**，符合红线）。

### 1.4 生产 vs E2E 数据目录（关键）
| 类型 | 目录 | 状态 |
|------|------|------|
| **生产数据根** | `F:/yikuaborder-deploy`（`USER_DATA_DIR`） | `data/workbench/tasks.json` **不存在 → 0 任务**；`已完成产品/` 151；`商品队列/选品看板/board.json` 空 |
| **E2E 测试数据** | `F:/yikuaborder-phase2b-wt/data/`（worktree B 自身） | 含测试 `tasks.json`（4 要素键 2 条）+ `runs/` |
| **E2E 测试数据（坏树）** | `.worktrees/phase2-product-workbench/data/` | 含旧 3 要素键 2 条 |

**历史测试任务不会进入生产任务库**：执行时以 `USER_DATA_DIR=F:/yikuaborder-deploy` 启动 → 任务库落到生产 `data/workbench/tasks.json`（当前不存在，干净）；worktree 内 E2E 测试任务不加载。**首次真实执行前仍建议再清一次生产 `data/workbench/`（当前为空，天然满足）。**

### 1.5 启动命令与运行环境变量（验证过）
```bash
# 在 F:/yikuaborder-phase2b-wt 下
PORT=3100 HOST=127.0.0.1 USER_DATA_DIR=F:/yikuaborder-deploy CHROME_DEBUG_PORT=9223 node dist/src/server.js
```
- `PORT` 默认 3000；`HOST` 默认 0.0.0.0；`USER_DATA_DIR` 绝对数据根；`CHROME_DEBUG_PORT` 默认 9223。
- 已用该命令把 **3100 预览服务**跑在 worktree B 上（`/api/workbench/tasks` 200，版本 `…@f16d9fd`），供界面查看，不参与真实执行。

---

## 2. B1 · Chrome CDP（已清零）

### 2.1 依据：复用 ecom-translator 已验证的浏览器服务
`D:/ecom-translator/dianxiaomi_browser_service.py` 是**已跑通**的店小秘/浏览器托管：
- 端口 **9223**、专用 profile `work/dianxiaomi-browser-profile`；
- 用 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 启动（注释明确：不加则「启动者一退，Chrome 就死，CDP 连上几秒又断」——正是本轮先踩到的坑）；
- `--remote-allow-origins=http://127.0.0.1`、`--disable-extensions`。
- 权威端口表：**9223 = ChatGPT(Listing) + 店小秘(草稿) 共用**；9224 = 采集(AliPrice)。即**一个 Chrome/一个 profile 同时登录两站**。

### 2.2 本轮实测结果
| 检查 | 结果 |
|------|------|
| 9223 监听 | ✅ 是（Chrome/156.0.8078.76） |
| `/json/version` | ✅ Protocol-Version 1.3 |
| `/json/list` | ✅ 含 2 个 page 目标 |
| WebSocket 调试 | ✅ 连上并成功执行 `Runtime.evaluate` |
| ChatGPT 页面 | ✅ `ChatGPT`，输入框存在（已登录，非登录页） |
| 店小秘页面 | ✅ `店小秘--添加速卖通全托管产品`，有「引用产品」按钮 + 店铺选择器（已登录） |
| 日常 Chrome(9222) | ✅ 未触碰（PID 35700 存活） |
| 凭证 | ✅ 未读/未输出/未保存任何 Cookie/Token/密码（仅读 DOM 登录指示） |

### 2.3 注意（B1 持久性）
- 当前 9223 由**后台任务托管**（会话期间有效）。正式执行前，**建议用 ecom 的 `ensure_ready()`（DETACHED 启动）**以长期稳定，避免会话结束导致 Chrome 退出。
- 若 9223 已被 ecom 控制台占用/其 profile 被锁，需先停 ecom 的自动化任务再用。

---

## 3. B2 · 产品 / 模板准入（部分清零）

- **产品**：119 个候选已扫描，Top 5 见 `TEST_PRODUCT_SHORTLIST.md`。**关键身份风险**：绝大多数 `product-facts.productId` 均为同一值 `1005005575013300`（平台 facts id 不可作唯一标识），唯一身份须用 `product-profile.productId`(UUID)。图片与产品一致性须**经营者目检**。
- **模板**：两处模板快照库（主树 / worktree B）均 **0 条**；捕获机制、真实来源、CAPTURED 校验见 `TEMPLATE_CAPTURE_READINESS.md`。**须经营者确认模板名并授权捕获**，否则 `requireUsableSnapshot` 返回 `BLOCKED_TEMPLATE`。

---

## 4. 交付物
1. `REAL_EXECUTION_PREFLIGHT.md`（本文件，B0/B1/B2）
2. `TEST_PRODUCT_SHORTLIST.md`（Top 5 候选）
3. `TEMPLATE_CAPTURE_READINESS.md`（模板准入）
4. `FIRST_REAL_EXECUTION_PLAN.md`（执行方案，接入 ecom 已验证路径）

## 5. 红线遵守
✅ 未执行真实 Listing · ✅ 未消耗额度 · ✅ 未创建 REAL 任务 · ✅ 未迁移幂等键 · ✅ 未登记生产产品 · ✅ 未启用 autoStartWorkflow · ✅ 未发布 · ✅ 未部署/合并 · ✅ 未改 C6/C7 · ✅ 未读凭证 · ✅ 未切换主工作区分支 · ✅ 未新建重复 worktree · ✅ 未修改稳定检查点 `f16d9fd`。
