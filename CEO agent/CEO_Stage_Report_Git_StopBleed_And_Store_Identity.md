# CEO Agent｜Git 安全止血与真实店铺身份｜阶段报告

日期：2026-11-05（Asia/Shanghai）
范围：P0 Git 止血准备（含隔离副本验证）+ P1 平台店铺标识最短路径核验
状态：**止血方案已验证但未在主工作区执行；店铺身份已进一步收紧，平台 ID 仍需一次 Human 输入。**

本轮未执行 reset / clean / revert / push / fetch / 历史重写 / gc，未删除任何浏览器数据，未修改主工作区索引，未登记核准人，未把任何 UNVERIFIED 升级为 VERIFIED。

---

## 1. Git 止血方案、实际验证与待批准差异

### 1.1 检查点机制已定位到实现层

宿主检查点在 `app.asar` 内的 `worktreeTask.checkoutBranch → handleDirtyBeforeCheckout`：

| 项目 | 实测 |
|---|---|
| 触发条件 | 切换分支时工作树不干净 |
| 策略取值 | `abort` / `commit` / `stash` / `discard` |
| 默认策略 | `abort` |
| 本次实际策略 | `commit` |
| `commit` 分支实现 | `git add -A` → `git commit -m "[Checkout-checkpoint] from <from> to <to> (HH:MM:SS)"` |
| `stash` 分支实现 | `git stash push -u -m "[Checkout-autostash] before branch switch"` |
| `discard` 分支实现 | `git reset --hard HEAD` + `git clean -fd` |
| 仓库内 git hooks | **无自定义钩子**（仅有 .sample） |
| 仓库内产生该提交的脚本 | **0 个** |

**关键结论：`git add -A` 与 `git clean -fd` 都尊重 `.gitignore`，且 `stash push -u` 也不会收忽略文件。** 所以忽略规则不是"锦上添花"，而是当前唯一有效的结构性防线，且不需要改动宿主程序。**机制仍然存在，还会再次触发**——只要还能切分支且工作树不干净。

### 1.2 止血方案（最小化）

| 动作 | 内容 |
|---|---|
| `.gitignore` 追加 8 行 | `.chrome-cdp-9223/`、`_verify/`、`_shortlist_result.json`、`*.bak-*` |
| 索引移除 | `git rm -r --cached` 上述 4 组，**7,157 条路径** |
| 提交 | 单次 commit，仅含索引变更 + `.gitignore` |
| 跟踪文件数 | 8,237 → **1,080** |
| 磁盘文件 | **一个都不动** |

未加入忽略的（故意保留跟踪并已核实用途）：`config/market-scan.json`（4 个脚本读取，是输入）、`docs/**`、`dist/**`、`public/**`、`nawu-fetch/lib/**`、`CEO agent/**`。

### 1.3 隔离副本中的实际验证结果

在 `git clone --shared --no-checkout` 副本（共享对象，未复制 682 MB）中完整执行了一遍：

| 验证项 | 结果 |
|---|---|
| 索引移除后 7 个凭证类文件仍在磁盘，Cookies sha256 不变 | ✅ PASS |
| 止血提交后树内 `CEO agent/` = 398、`dist/src/` = 83 | ✅ PASS |
| **新增写入 `Cookies-journal` + `_verify/new-artifact.json` + 修改 `README.md`，再执行 `git add -A`** | ✅ 暂存区**只有 README.md**，敏感路径命中 0 |
| `git clean -fdn`（模拟 discard 策略） | ✅ 输出为空，浏览器目录与 `_verify` 均不在清理列表 |
| `git check-ignore` | ✅ 命中 `.gitignore:115` |

最后一项是本轮最关键的证据：它直接复现了导致 `e19e704` 的那条代码路径，并证明补齐忽略后不会再发生。

### 1.4 待批准差异（主工作区尚未执行）

精确变更清单已单独成文：`CEO agent/Git_StopBleed_Approval_Request.md`，包含逐条命令、7,157 路径清单文件、验收断言与回滚方式。

- 路径清单：`CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-removal-list.txt`
- 验证证据：`CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-verification.json`

**主工作区当前状态（未变）：** HEAD 仍为 `e19e704`，索引无暂存变更，仅 5 个未跟踪交付物。

### 1.5 一个必须先处理的顺序问题

那 5 个未跟踪交付物（四份报告 + G2B1 证据目录）会被宿主检查点用 `git add -A` 一并卷入。**建议先单独提交它们，再执行止血**，否则止血提交会混入无关文档，将来回滚时难以分离。Approval Request 的步骤 0 已写明。

---

## 2. 高风险提交的传播风险与历史净化建议

### 2.1 传播通道核查

| 通道 | 实测 | 风险 |
|---|---|---|
| 远端引用 | 无任何 `refs/remotes/*` 包含 `e19e704` | 无传播证据 |
| 该分支 upstream | 未配置 | 不会自动推送 |
| 自动推送脚本 | `git-release.sh` 会执行 `git add -A` + `commit` + **`git push origin "$BRANCH" --tags`** | **中**：若在该分支上运行，会把 `e19e704` 推上去 |
| `push --all` / `--mirror` | 仓库内无 | — |
| Git 计划任务 | 无任何仓库相关计划任务（仅系统/厂商任务） | 低 |
| 其他 worktree | `F:/yikuaborder-run` 等与主库共享同一对象库，但无分支指向该提交 | 低 |
| 外部克隆/镜像 | 无法核实 | **未知** |

**风险定级：本地未扩散，但存在两条人工通道（`git-release.sh`、手工 push）与一条无法核实的外部通道。** 在净化完成前，对 `feature/ykb-v1-phase1-identity-state` 应保持禁止推送。

补充：`git-release.sh` 里的 `git add -A` 也说明——止血同样保护这个发布脚本，否则每次发版都可能把浏览器档案带上去。

### 2.2 历史净化建议（单独审批，本轮不执行）

推荐顺序（先取证，再改写，最后才回收）：

1. **先修好未来**（即第 1 节止血），否则净化完还会再犯
2. **存证**：`git bundle create <备份>.bundle --all` 或轻量 tag，确保旧提交可回溯
3. **改写**：该提交是分支上唯一新增提交、父提交为 `052abd7`、内容为纯检查点，因此最干净的做法是"弃用旧引用 + 从 `052abd7` 重建"，而不是 `filter-repo`（本机未安装）
4. **保留旧引用**：改名为 `attic/checkpoint-20261105`，不立即删除
5. **最后才 gc**：确认无引用后 `git gc --prune=now`，预计回收约 682 MB 工作树内容对应的对象

**明确不建议**：`git reset --hard 052abd7`（会连带丢失 398 份交接资料与 5 个源码修改）、`git revert`（凭据 blob 仍在历史里，且体积不降）。

### 2.3 凭证轮换

仍属单独审批事项。判定依赖唯一未知项：仓库是否曾经离开本机。若无外传，止血 + 净化即可；若有，需轮换该 Chrome 档案登录过的店小秘、速卖通卖家后台、稳卖、Google 账号会话。本轮不执行。

---

## 3. 已核实的真实店铺身份

本轮在授权本地资料中找到了**新的直接证据**，把"命名空间未定"收紧了一步。

### 3.1 新证据：稳卖导出件自带店铺列

`纳物采购最新数据/nawu-1店-inventory-latest.csv`（2026-11-05 11:06 导出，262 行）的去重结果唯一：

| 列 | 值 |
|---|---|
| 店铺 | **纳物-箱包全托1店** |
| storeId | **400370** |
| 导出时间 | 2026-11-05 11:06:12–13 |

对照 `nawu-2店-inventory-latest.csv`（285 行）：店铺 = **纳物-箱包全托2店**，storeId = **416488**。

**这证明了什么：** `400370` / `416488` 是**稳卖（dchain）侧的店铺 storeId**，成对出现、与店铺名一一对应。它**不是**速卖通平台店铺 ID。

### 3.2 渠道有效性得到运行时旁证

抓取链路 `resolveChannelId()` 优先取 `channelIdMap[store.id]`，即 `400370 → 2358891`，再用该 channel 抓库存页。今日 11:06 的导出正是这条链路产出，且行内 `storeId=400370` 与店铺名匹配。

**因此：截至 2026-11-05 11:06，channelId 2358891 仍对应纳物-箱包全托1店。** 这是间接运行时证据，不是在线查询（未获授权连稳卖）。

### 3.3 已核实的完整标识矩阵

| 标识空间 | 值 | 状态 | 说明 |
|---|---|---|---|
| 店铺别名 | 纳物-箱包全托1店（=纳物一店=纳物1店） | ✅ 已证实 | 三个写法同一店 |
| 稳卖 storeId | **400370** | ✅ 已证实 | 今日导出直接标注 |
| 稳卖 channelId | **2358891** | ✅ 运行时旁证 | 今日 11:06 产出该店数据 |
| 内部 UUID | `029555ee-cfaa-4626-baa2-855f12cf0143` | ✅ 已证实 | 系统内部主键 |
| 兄弟店 | 纳物-箱包全托2店 / 416488 / 2443536 | ✅ 已证实 | 成对旁证 |
| **速卖通平台店铺/卖家 ID** | **未获得** | ❌ 仍缺 | 见第 4 节 |

### 3.4 本轮排除的无效来源（避免下一轮重复排查）

| 来源 | 结论 |
|---|---|
| 店小秘导出（商品 / 仓库 / 出入记录） | 表头为 来源/商品SKU/商品名称/仓库/货架位…，**无店铺或账号列** |
| `data/charm-listing-workspace.sqlite`（8 张表） | 无 `shop/store/seller/account/env` 任一列 |
| `store-profiles.json` | 只有 Phase1A Test Store 与 洛慈三店，**无纳物店** |
| `config/*.json`、`nawu-fetch/*.json`、`dist/src/*.js`、`docs/**` | 无 `aliexpress.com/store/<id>` 链接，无 sellerId/shopId/accountId 字段 |

---

## 4. 尚缺的唯一或最小 Human 输入

**只需一次输入，两个动作，都在你自己的后台完成，不需要给我账号密码。**

| # | 动作 | 要看到什么 | 用途 |
|---|---|---|---|
| 1 | 登录**速卖通卖家后台** → 店铺信息 / 账号页 | 一个稳定的**店铺 ID 或卖家 ID**（可截图，其他信息可打码） | 填 `platformShopId`，这是唯一真正的平台侧稳定标识 |
| 2 | 登录**店小秘** → 店铺管理 / 授权店铺列表 | 该店铺记录显示的**店铺名称 + 店铺 ID** | 填 `authorityRecordId` 的对照依据，并确认 400370 在 ERP 侧的归属 |

可选但有用：稳卖后台确认 channelId 2358891 当前仍指向纳物-箱包全托1店（我已有今日 11:06 的旁证，非必需）。

**我不会也不能自行获取这些**：速卖通与店小秘均属未授权外部系统，本轮未连接。

拿到后，我会把它填进 `platformShopId` 与 `authorityRecordId`，重算 `mappingHash`，其余字段保持空，仍是 `PENDING_HUMAN_APPROVAL`——**核准动作仍必须由你或你书面指定的 STORE_DATA_OWNER 执行**。

---

## 5. 数据接入门禁是否能够进入核准阶段

**分层回答，避免把两件事混为一谈：**

| 门禁 | 能否进入核准阶段 | 依据 |
|---|---|---|
| **店铺映射层** | ✅ **可以**，只差第 4 节那一次输入 | 门禁代码、待审批记录、最小权限边界、不可自升性均已验证；`authorityReviewers` 仍空，等核准人登记 |
| **契约层** | ⚠️ **不能**，缺源方确认 | 契约仍是 `DRAFT`，列名为建议值，需源所有者确认列名与列语义 |
| **数据层** | ❌ **不能**，缺导出文件 | 无闭期去标识支付导出；15 项核验里 `NO_PERSONAL_DATA`、`COVERAGE_COMPLETE` 等无从评估 |
| **正式归档层** | ❌ **不能** | 正式 Taskboard 指定、日志唯一写入者与认证接口仍 UNVERIFIED |

**一句话：映射层已到"等你核准"的门口；数据层还没到门口，因为门都还没开。**

---

## 6. 下一步最短开发路线

按依赖排序，前两步可并行：

| 步 | 动作 | 谁做 | 产出 |
|---|---|---|---|
| 1 | 批准并执行 Git 止血（先提交 4 个交付物，再改索引） | Human 批准 → 我可代执行 | 跟踪数 8,237 → 1,080，凭据不再入库 |
| 2 | 提供速卖通店铺 ID + 店小秘店铺记录（第 4 节） | Human（一次输入） | 可填 `platformShopId` / `authorityRecordId` |
| 3 | 我重算映射哈希，生成**唯一**候选映射记录，提交核准 | 我 → Human 核准 | 映射从 UNVERIFIED → VERIFIED（由核准人执行） |
| 4 | 源所有者交付闭期去标识支付导出 + 列定义确认 | Human / 源所有者 | 契约可从 DRAFT 走出 |
| 5 | 跑 15 项核验，先看回执再谈报告 | 我 | `verify-<hash>` 回执 |
| 6 | 契约与策略核准信封 | Human | 真实路径唯一放行条件 |
| 7 | 端到端影子诊断（复用现有归档/轨迹/纠错） | 我 | 首份真实经营影子报告 |
| 8 | 历史净化 + 凭证轮换（若第 2 节判定需要） | 单独审批 | 仓库体积回收，暴露面关闭 |

**最短路径其实是 1 与 2 并行**：止血是纯技术动作、风险可控；店铺 ID 是你五分钟就能给的东西。这两件做完，第 3 步当天可完成，门禁就真正进入核准阶段。

---

## 附：本轮产出与边界

| 项目 | 内容 |
|---|---|
| 审批请求 | `CEO agent/Git_StopBleed_Approval_Request.md` |
| 移除清单 | `CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-removal-list.txt`（7,157 行） |
| 验证证据 | `CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-verification.json` |
| 映射记录更新 | 提交 `20fd623`（补入今日导出证据，门禁仍 UNVERIFIED、reviewers 仍空） |
| 回归 | 映射 + 契约测试 15/15 通过 |
| 主工作区 | HEAD 未变（`e19e704`），索引无暂存变更，未执行任何写操作 |
| 未执行 | reset / clean / revert / push / fetch / 历史重写 / gc / 删除浏览器数据 |

停止点：止血方案已备妥待批准，店铺身份已收紧待输入，未执行清理、未核准映射、未进入真实数据接入。
