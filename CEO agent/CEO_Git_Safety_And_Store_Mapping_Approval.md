# CEO Agent｜G2-B1 验收收尾：Git 安全核验与店铺映射核准准备

日期：2026-11-05（Asia/Shanghai）
范围：P0 主工作区 Git 只读安全核验 + P1 纳物一店真实店铺映射准备
状态：**只读核验完成，两项均未产生任何写操作；未清理、未核准、未推送、未进入真实数据接入。**

本轮没有新增 CEO 功能模块，没有新增合成测试，没有修改 `config/ceo-store-mapping.v1.json`，没有登记任何核准人。G2-B1 的提交 `61fd2ad`、历史报告与证据全部保留。

---

## A. Git 安全风险与处置建议

### A.1 提交事实（只读核验）

| 项目 | 实测结果 |
|---|---|
| 提交 | `e19e704034c8ab01c36fcaa46f9701b49dc27ab2` |
| 父提交 | `052abd7`（**单一父提交，非合并提交**） |
| 作者 / 提交者 | `Workbench <workbench@local>` |
| 提交时间 | 2026-11-05T15:07:58+08:00（作者与提交时间相同） |
| 提交信息 | `[Checkout-checkpoint] from feature/ykb-v1-phase1-identity-state to master (15:07:01)` |
| 规模 | **7,592 文件**（新增 7,587 / 修改 5），+1,689,064 / −31 行 |
| 工作树体量 | 该提交树内受跟踪文件合计 **722.2 MB**，其中浏览器目录 **681.6 MB** |
| 仓库当前 pack | 304.89 MiB |

**来源判定：** 这是本机宿主工具在"尝试切换分支到 master"时生成的自动检查点。判定依据：提交信息含 `[Checkout-checkpoint]` 模板、作者为 `Workbench` 而非任何开发者身份、仓库历史上存在同模板提交 `46324d2`（2026-10-29，同样是切换分支时生成）。**本轮自始至终只在 `.worktrees/ceo-g2b1-20261105` 内执行 git 操作，未对主工作区执行 commit/checkout/reset。**

### A.2 远程与推送状态

| 项目 | 实测结果 |
|---|---|
| 远程仓库 | `origin` → `github.com/Biu-nan/-.git`；`private-backup` → `github.com/Biu-nan/yikuaborder-private-backup.git` |
| 该分支 upstream | **未配置**（`fatal: no upstream configured`） |
| 包含该提交的本地分支 | 仅 `feature/ykb-v1-phase1-identity-state` |
| 包含该提交的远程跟踪引用 | **无**（`git branch -r --contains e19e704` 为空） |
| 包含该提交的 tag | **无** |

**结论：无任何远端传播证据。** 该提交只存在于本地一个分支上；它既没有 upstream，也没有被任何 `refs/remotes/*` 包含。同时本轮未执行 `git fetch`（避免改动引用），因此判断基于本地已有的远端跟踪引用，属于"无证据显示已传播"，而非"已证明从未传播"——但结合该分支从未设置 upstream 这一事实，实际推送概率极低。

### A.3 内容分类（仅路径、类型、数量、风险等级；未输出任何内容）

| 风险 | 类别 | 数量 | 代表路径 |
|---|---|---:|---|
| **HIGH** | 浏览器凭证类 | 12 | `Default/Network/Cookies`、`Default/Login Data`、`Default/Login Data For Account`、`Default/Web Data`、`Local State`、`Default/History`、`Default/History-journal`、`Default/Preferences`、`Default/Secure Preferences`、`Default/Network/Trust Tokens`、`Default/Storage/ext/nmmhkkegccagdldgiimedpiccmgmieda/def/Network/Trust Tokens` |
| **MEDIUM-HIGH** | 浏览器状态与站点存储 | 57 | `Default/Local Storage/`（5）、`Session Storage/`（4）、`IndexedDB/`（9）、`Service Worker/`（29）、`Sessions/`（2）、`WebStorage/`（2）、`Sync Data/`（6） |
| **MEDIUM** | 扩展代码与扩展本地存储 | 5,827 | `Default/Extensions/<20 个扩展 ID>/…`（5,799）、`Default/Local Extension Settings/<7 个扩展 ID>/…`（28） |
| **LOW** | 浏览器缓存与组件资源 | 1,241 | `GPUPersistentCache/`、`GrShaderCache/`、`ShaderCache/`、`component_crx_cache/`、`optimization_guide_model_store/`、`ZxcvbnData/`、`hyphen-data/` 等 |
| **MEDIUM** | 经营数据 | 2 | `_shortlist_result.json`（选品结果）、`config/market-scan.json` |
| **LOW-MEDIUM** | 内部验证产物 | 18 | `_verify/*.json`、`_verify/*.png`（基线对比、身份审计、看板截图） |
| **LOW** | 交接文档 | 398 | `CEO agent/**`（报告与证据；已按高置信密钥模式扫描，0 命中） |
| **LOW** | 正常源码 | 10 | `dist/src/automation-service.js`、`public/draft-executor-panel.js`、`nawu-fetch/lib/*.cjs`、`nawu-fetch/lib/nawu-inventory.cjs.bak-20261101`、`config/metrics-schema.json`、`docs/**` 30 份 |

**敏感度判定（未读取内容，只做存在性与结构性检查）：**

- `Local State` 中 `os_crypt.encrypted_key` **存在**（布尔检查为 true）。这是解密 `Cookies` / `Login Data` 的主密钥材料，受 Windows DPAPI 保护。
- `Network/Cookies` 为 SQLite 数据库（16 字节头为 `SQLite format 3`），即会话 Cookie 库本文件。
- `Login Data`（40 KB）、`Web Data`（151 KB，含自动填充）、`History`（360 KB）体积均非空。

**这意味着：** 该 Chrome 用户档案的会话凭据、保存的登录信息、自动填充数据与解密主密钥**同时**进入了 Git 对象库。单独拿走 Cookies 无法解密（DPAPI 绑定当前 Windows 用户），但本体 + 主密钥 + 登录库三件同时在场，属于**实质性的凭据暴露面**，不能按"已加密所以无害"处理。

**未发现的：** 无非浏览器目录的高置信密钥（私钥头、`sk-`、`ghp_`、`AKIA`、`xoxb-` 模式全部 0 命中）；无 `.env`、无 `id_rsa`、无 `.pem/.pfx/.p12`；无业务 SQLite（提交内 4 个 `.db` 全部为 Chrome 内部库）。`nawu-fetch/.tmp/` 下的会话载荷（含个人信息）**未被跟踪**，不在该提交内。

### A.4 是否进入 Git 历史

**已进入，且是本轮新进入。** 上述 12 个凭证类文件在该提交中的状态全部为 `A`（新增）——此前从未被跟踪。因此不是"历史遗留"，而是"本次新写入"。由于 `.gitignore` **未**覆盖 `.chrome-cdp-9223/`（`git check-ignore` 返回未忽略），该目录当前仍处于"随时可被再次提交"的状态。

### A.5 处置建议（本轮不执行，等待授权）

**第一步：止血（低风险，建议优先批准）**
1. 在 `.gitignore` 追加：`.chrome-cdp-9223/`、`_verify/`、`_shortlist_result.json`、`*.bak-*`
2. 在 `feature/ykb-v1-phase1-identity-state` 上执行 `git rm -r --cached` 移除上述已跟踪路径并提交
3. 效果：未来不再进入新提交；**历史中的 blob 仍然存在**，需第二步才能清除

**第二步：历史净化（需 Human 明确授权，因属历史改写）**
- 该提交是该分支上唯一的新增提交、父提交为 `052abd7`、且内容为纯检查点，因此最干净的做法不是 `filter-repo`，而是"**弃用该分支引用 + 把工作树内容以排除清单重新提交到新分支**"：
  1. 先打本地轻量 tag 或 `git bundle` 保存 `e19e704` 作为取证副本（不删证据）
  2. 从 `052abd7` 建新分支，按排除清单恢复工作树并重新提交
  3. 旧分支引用改名保留（如 `attic/checkpoint-20261105`），不立即删除
  4. 确认无引用后，才考虑 `git gc --prune=now` 回收约 682 MB 对象
- `git filter-repo` 本机**未安装**（已核验），若走该路线需另行安装，暂不建议

**第三步：绝不采用的做法**
- ❌ `git reset --hard 052abd7`：会连同 398 份交接资料与 5 个正常源码修改一起丢弃
- ❌ `git revert e19e704`：只新增一个反向提交，历史里的凭据 blob 仍在，且仓库体积不降
- ❌ 任何 `push --force`：本轮既未推送也不建议推送

### A.6 是否需要轮换凭证

**需要 Human 决策，本轮不执行轮换。** 判定要点：

| 条件 | 事实 | 影响 |
|---|---|---|
| 仓库是否已推到远端 | 无证据，且该分支无 upstream | 未扩散 |
| 是否有本地备份/网盘/打包外传 | **未知**，本轮无法核实 | 决定是否需要轮换 |
| 凭据是否可被离线解密 | 否，受 DPAPI 绑定当前 Windows 用户 | 降低但未消除风险 |

**建议：** 若确认该仓库从未离开本机（无备份上传、无打包外发、无第三方扫描），可仅做 A.5 第一、二步；若存在任何外传可能，则应将下列会话与口令视为已暴露并轮换：该 Chrome 档案中登录过的**店小秘、速卖通卖家后台、稳卖/稳卖开放平台、Google 账号**。以上均需 Human 授权后执行，本轮不做。

### A.7 推送闸门

**安全核验完成前不向远端推送当前主分支**这一要求已遵守：本轮未执行任何 `push`、未执行 `fetch`、未修改任何远程引用。
在 A.5 第一、二步完成前，建议对 `feature/ykb-v1-phase1-identity-state` 保持"禁止推送"。

---

## B. 已证实的真实店铺映射信息

### B.1 三套标识已分离清楚

| 标识空间 | 值 | 状态 | 含义 |
|---|---|---|---|
| 店铺别名 | **纳物-箱包全托1店**（变体：纳物一店 / 纳物1店） | ✅ 已证实 | 同一店铺的三种写法 |
| CEO 外部编号 | **400370** | ✅ 已证实存在 | 本机脚本映射编号，**不是**平台店铺 ID |
| 稳卖渠道编号 | **2358891** | ✅ 已证实 | 稳卖 openEnv 侧渠道编号，用于库存采集 |
| 系统内部主键 | `029555ee-cfaa-4626-baa2-855f12cf0143` | ✅ 已证实 | 内部 UUID，永不等同 400370 |
| **速卖通平台店铺 ID** | **未找到** | ❌ UNVERIFIED | 全部本地资料 0 命中 |

对照：兄弟店 `纳物2店` 的外部编号为 **416488**，稳卖渠道 **2443536**（同一份 `channelIdMap` 中成对出现，互为旁证）。

### B.2 证据清单（逐项附来源、哈希、时间）

| # | 证据 | 路径 | SHA-256 前 16 位 | 时间 | 证明了什么 |
|---|---|---|---|---|---|
| E1 | 店铺主数据叠加层 | `data/identity/store-master.json` | `0cc582830b82be94` | 2026-10-30 12:28:55 | 别名、400370、命名空间 `UNKNOWN_PENDING_VERIFICATION`、`PENDING_VERIFICATION`、`publishing_allowed=false` |
| E2 | 启动登记代码 | `dist/src/server.js` | `7847a1587b35e985` | 2026-10-30 12:23:45 | 以 `MANUAL_REGISTRATION_PHASE1` 幂等登记该店，命名空间显式标为待核验 |
| E3 | 登记实现 | `dist/src/product-identity-service.js` | `7215fb98b91212e0` | 2026-10-30 13:17:55 | 外部编号必须为字符串、内部 UUID 不得等于外部编号、核验未过则禁止发布 |
| E4 | 店铺主数据映射文档 | `docs/phase1/STORE_MASTER_MAPPING.md` | `75294376a52c9ee1` | 2026-10-30 12:33:44 | 生产档案中无此店；`source_store_id=null`；第 7 节列出 4 项待核验 |
| E5 | 生命周期评审 Q2 | `docs/SPEC_REVIEW_LIFECYCLE_V1_2026-10-30.md` | `34b7f7ed5066ebaf` | 2026-10-30 11:52:58 | 原文：`store-profiles.json` 里**找不到这个店** |
| E6 | CEO 首环契约 | `docs/superpowers/specs/2026-10-26-ceo-first-loop-contract.md` | `bb48d31b38507b73` | 2026-10-29 11:53:29 | 原文：400370「**来自当前本机脚本映射，不当成平台通用店铺 ID**」 |
| E7 | 采集渠道映射 | `nawu-fetch/config.json` | `b834b236ca7b9a03` | 2026-10-29 11:53:30 | `channelIdMap: 400370→2358891, 416488→2443536` |
| E8 | 采集任务表 | `nawu-fetch/README.md` | — | — | 任务 01（纳物1店）/ 02（纳物2店）来源为稳卖 openEnv → dchain-web |
| E9 | 生产店铺档案 | `store-profiles.json` | `1173747bee15798d` | 2026-06-20 23:12:04 | 仅 2 条：Phase1A Test Store、洛慈三店；**无纳物店** |
| E10 | 采集侧选店方式 | `nawu-fetch/config.json` | 同 E7 | — | `storeFilter = { includeNameRegex: "纳物", explicitIds: [] }`——按名称正则选店 |
| E11 | 覆盖店铺声明 | `docs/IXSPY_MCP_INTEGRATION_ASSESSMENT_2026-11-05.md` | `3d116e9fb8c36ccf` | 2026-11-05 09:57:26 | 覆盖店铺 1 个，记法为 `env:400370`（环境命名空间，非平台 ID） |

### B.3 冲突与缺口

| 编号 | 类型 | 内容 | 影响 |
|---|---|---|---|
| MAP-C1 | 冲突 | 生产店铺档案中**不存在**纳物首店，也无 400370 关联字段 | `source_store_id` 为 null，逐店刊登状态无法建立 |
| MAP-C2 | 冲突 | 生产档案的主店是**洛慈三店**，且 `hitoor_env_id` 为空、`hitoor_env_name=本地 Chrome` | 不能把洛慈三店的记录当成纳物首店映射，两者归属需 Human 明确 |
| MAP-C3 | 冲突 | 采集侧用 `includeNameRegex: "纳物"` 选店，未用稳定 ID | 改名或新增"纳物×店"会静默改变采集范围，名称不能作映射权威 |
| MAP-G1 | 缺口 | 速卖通平台店铺 ID | 无任何本地记录 |
| MAP-G2 | 缺口 | 400370 的命名空间归属（店小秘店铺ID / 速卖通账号ID / 纳物内部编号） | 文档明确需"经营者 + 店小秘后台比对" |
| MAP-G3 | 缺口 | 稳卖 channelId 2358891 的当前有效性 | 文档要求采集时再核对 |
| MAP-G4 | 缺口 | 店铺账号归属与平台账号主体 | 未记录 |
| MAP-G5 | 缺口 | 权威记录编号与有效期 | 未记录 |

**结论：店铺身份（是哪家店）已可确认；平台店铺 ID（平台侧的稳定标识）仍未获得。** 这两件事不能混为一谈——前者够用来写待审批记录，后者不够用来放行真实数据。

---

## C. 待 Human 审批的映射记录

已生成独立文件：`config/ceo-store-mapping.pending-approval.v1.json`（在本轮 G2-B1 工作区内）。

**关键设计：它不能自行生效。**

| 属性 | 值 | 含义 |
|---|---|---|
| `status` | `PENDING_HUMAN_APPROVAL` | 待审批，不是已核准 |
| `mutatesRegistry` | `false` | 不修改 `config/ceo-store-mapping.v1.json` |
| `preparedBy.approvalAuthority` | `NONE` | 准备者不具备核准权 |
| `resultingMappingDraft.declaredStatus` | `UNVERIFIED` | 草案仍为未核验 |

**已实测验证的不可自升性：**

- 运行时门禁读的仍是 `ceo-store-mapping.v1.json`，实测评估结果 `UNVERIFIED`，理由为：`PLATFORM_SHOP_ID_MISSING`、`AUTHORITY_RECORD_MISSING`、`APPROVER_MISSING`、`APPROVED_AT_MISSING`、`VALID_UNTIL_MISSING`、`MAPPING_HASH_MISSING`、`NO_AUTHORITY_REVIEWER_REGISTERED`。
- 即使把本文件的 `resultingMappingDraft` 直接塞进门禁评估，结果仍是 `REJECTED`（`authorityGranted=false`），因为字节绑定与注册表不一致。
- `authorityReviewers` 仍为空数组——**结构上没有人能核准**。
- 相关测试 21/21 通过，门禁行为未被本轮改动。

**平台店铺 ID 保留三候选（因证据不足，不擅自选一）：**

| 候选 | 含义 | 值 | 差异说明 |
|---|---|---|---|
| PS-1 | 速卖通卖家/店铺 ID | 未获得 | 唯一能作为真实平台绑定的候选，需登录卖家后台取得 |
| PS-2 | 店小秘店铺 ID | 未获得 | ERP 内部编号，不能替代平台 ID，仅能定位 ERP 入口 |
| PS-3 | 纳物内部自定义编号 | 未获得 | 跨系统不可解析，若采用须附到平台的对照凭据 |

**店铺身份则只有一个候选**（证据充分，不设并列）：别名 `纳物-箱包全托1店` + 外部编号 `400370` + 稳卖渠道 `2358891` + 内部 UUID `029555ee-…`。

---

## D. 核准人建议及权限边界

### D.1 角色建议

| 项目 | 建议 |
|---|---|
| 角色 | `STORE_DATA_OWNER`（店铺数据所有者），**必须是自然人** |
| 候选 | Lance 本人，或经其书面指定的经营者 |
| 明确排除 | 任何 AI/Agent 身份；任何 `fixture-*` 测试身份；任何仅有代码提交权而无店铺经营权的角色 |
| 本轮动作 | **不登记任何核准人**，`authorityReviewers` 保持空 |

### D.2 最小权限边界

核准人**只能**做这些：

1. 仅核准 `mappingId = mapping-nawu-store-1` 这一条映射（不含其他店铺）
2. 仅填写 6 个字段：`platformShopId`、`authorityRecordId`、`approvedBy`、`approvedAt`、`validUntil`、`mappingHash`
3. 有效期建议 ≤ 90 天，到期自动失效需重新核验

核准人**不得**：

- 授权发布（`publishing_allowed` 必须保持 `false`）
- 修改 `ceoStoreId`（400370 为冻结域，改动属身份迁移，需单独批准）
- 修改生产文件 `store-profiles.json`
- 修改采集侧 `storeFilter` 或任何凭据
- 以"核准映射"为由扩展到 Taskboard 指定、日志写入者或 WorkBuddy 接线（各自独立门禁）

### D.3 核准前必须提交的证据

1. 速卖通卖家后台的店铺标识截图或导出（可脱敏，但须能确认"店铺 ID ↔ 别名"对应）
2. 店小秘后台该店铺记录与 ID 对照
3. 稳卖 channelId `2358891` 与 `400370` 的对照确认
4. 核准人身份与其权责声明

---

## E. 进入真实支付数据接入所需的剩余条件

按"必须先满足"排序，并标注本轮是否已推进：

| # | 条件 | 本轮进展 | 仍缺什么 |
|---|---|---|---|
| 1 | **平台店铺 ID 与命名空间核验** | 已把三套标识分离清楚，并证伪"400370 是平台 ID" | 速卖通店铺 ID、店小秘/账号归属（需 Human 从后台取） |
| 2 | **权威记录 + 核准人登记** | 已备好待审批记录与最小权限边界 | `authorityRecordId`、核准人身份、有效期；注册表仍空 |
| 3 | **闭期去标识支付导出** | 未推进（不得自行生成） | 源所有者出具导出文件 |
| 4 | **导出列名与列语义确认** | 契约草案已写明规则，但列名为建议值 | 源方确认 |
| 5 | **契约与策略核准信封** | 两者默认 `DRAFT`，门禁实测拒绝 | 绑定契约字节/快照/期间/映射哈希的核准 |
| 6 | 正式 Taskboard 指定 | 未推进 | 存储所有者的版本化指定与只读快照 |
| 7 | 正式日志/报告所有者与认证接口 | 未推进 | 唯一追加者、认证接口、幂等域、保留策略 |
| 8 | **Git 安全处置完成** | 已完成核验，未执行清理 | Human 授权 A.5 第一/二步；处置前禁止推送 |

**最短可行路径（建议）：** 先做 A.5 第一步止血（不改历史、风险最低）→ 同时由 Human 完成条件 1 与 2（不依赖任何导出文件）→ 再取条件 3、4 → 最后走条件 5 的核准。**条件 1、2 不做完，条件 3 拿到也无法接入。**

---

## 附：本轮证据与边界

- 报告：本文件
- 待审批映射记录：`.worktrees/ceo-g2b1-20261105/config/ceo-store-mapping.pending-approval.v1.json`
- 上游提交：`61fd2ad`（G2-B1，保留未动）
- 本轮提交：`844889a`（仅新增待审批映射记录 1 个文件，未推送）
- 只读保证：本轮未执行 `commit`（除新增待审批记录）、未执行 `reset/clean/revert/push/fetch`、未修改生产配置、未修改 `store-profiles.json`、未连接速卖通/店小秘/稳卖、未读取或输出任何 Secret 内容
- 停止点：安全核验与映射候选准备已完成，**不清理历史、不核准映射、不进入真实数据接入**

### 本轮关于"是否触碰生产"的自检

| 检查 | 结果 |
|---|---|
| `config/ceo-store-mapping.v1.json` 是否被改 | 否（门禁实测仍 UNVERIFIED、reviewers 仍为空） |
| `store-profiles.json` 是否被改 | 否（哈希 `1173747bee15798d` 与核验时一致） |
| `dist/src/*` 是否被改 | 否 |
| 主工作区是否被写入 | 否（仅读取；其 HEAD 变化来自 A.1 所述宿主检查点） |
| 是否产生新提交 | 仅新增待审批记录一个文件，待提交 |
