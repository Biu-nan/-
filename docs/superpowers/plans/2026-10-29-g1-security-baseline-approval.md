# G1 工程安全基线：首批最小变更审批单与实施计划

> 执行提示：本文件是待审批方案，不是开工授权。获明确批准后按 `superpowers:executing-plans` 逐项执行；当前不派发实施任务、不创建工作树、不提交 Git。

**Goal:** 先在真实隔离环境验证入口默认拒绝和删除守卫保留，再申请部署；不扩大 CEO 或业务执行权限。

**Architecture:** 复用现有主服务、Listing Agent 和任务系统，在两个 HTTP 入口之前加入同一确定性访问策略。首批只提供认证后的最小安全状态读取；业务写入与带副作用的读取继续阻断。删除守卫只移除应用主动绕过，不重建平台删除机制。

**Tech Stack:** 现有 Node.js ESM、Express 4、Node HTTP、node:test、node:crypto；不新增第三方依赖。

**Spec:** `F:/yikuaborder-deploy/yikuaborder_OPC_ultimate_blueprint_V1.0_RC1.md`；签署记录 `F:/yikuaborder-deploy/docs/coordination/2026-10-29-V1.0-human-signoff.md`。

日期：2026-10-29（Asia/Shanghai）。状态：**PROPOSED / 待 Human 批准具体实施范围**。本轮用户“那就开始吧”承接编制审批单，不视为批准本文尚未呈现的代码、配置、网络或测试变更。

## 1. 基线、边界与新证据

- 完整目标 SHA256：`6E0D2EFC79B90D74EA6BAA882C2C07523571726E04D5381E868B58AB5ED1A8F2`，本轮复核一致。
- 主目录 HEAD：`382c320f798f7cda565c7ad79649da36807ec8c1`。实施基线必须同时记录所选文件的实际字节哈希，不能只用 HEAD，主目录保留未提交修改。
- 已有 7 个 tracked 修改：`docs/coordination/CODEX_STATUS.md` 和 6 个 public 文件；本方案不修改它们。
- 源码入口是 `dist/src/server.js`（package start 所指），未见根级 `src/`。不能凭测试里的 src 路径另建一套源码或重新生成整个 dist。
- 前轮主机证据：3000 全 IPv4 网卡监听且存在匹配程序的 Public/Any 入站 Allow。此为历史时点证据，本轮没有重新读取运行时，不能称当前已经缓解或证明公网可达。

| 风险/入口 | 本轮静态证据 | 必须纳入首批设计的原因 |
|---|---|---|
| 草稿执行 | `dist/src/server.js:1244,1279,1284`；`draft-executor-bridge.js:20,22,71,85` | commit true/false 都可能派生真实外部执行器；不能只守保存按钮 |
| GET 状态自愈 | `dist/src/server.js:940–951` | GET /api/status 在特定状态执行 store.update、ensureCurrentReferenceSet，不能自动列为只读白名单 |
| GET 任务状态修正 | `dist/src/server.js:506–531` | GET /api/agent/active-task 会写回 agent 状态 |
| GET 启动执行 | `dist/src/server.js:1747–1797` | GET /api/dossier/status 会启动 runDraftExecutor(commit:false) 或 submitPipelineTask；仅拦 POST 不够 |
| 其他批量入口 | `dist/src/server.js:409,6233–6258`；`dist/src/batch-listing-create.js:808,853,923` | 通用门禁必须早于外部模块注册的路由，覆盖 run、preview、重试与上传 |
| 独立 Listing 服务 | `listing-agent/src/server.js:53–86` | 独立 HTTP run/preview 可绕开主服务；listen 未指定 host。是否实际监听 3200 本轮未确认 |
| 进程内 fallback | `listing-agent/src/agent-client.js:35–61` | HTTP 失败可进入本地 provider；必须在调用 client 之前拦截，不能用关端口当授权 |
| 删除守卫绕过 | `dist/src/server.js:59–72` | 清空 3 个 CODEBUDDY 变量；回收站可恢复性仅源码注释，未独立验证 |
| 启动副作用 | `dist/src/server.js:347–381` | 初始化目录/文件、恢复状态并写回；HTTP 门禁不保护启动本身，禁止在生产目录启动补丁验证 |

## 2. 方案选择与明确影响

| 方案 | 范围与取舍 | 建议 |
|---|---|---|
| 仅封 /api/draft/execute | 文件少；GET dossier、批量入口及独立服务仍能执行 | 不作为 R03 完成条件 |
| 通用默认拒绝 + 最小已核验读取白名单 | 两个 HTTP 入口统一拦截，未经证明安全的接口不放行；上线会暂时限制现有功能 | **推荐作为临时安全基线，先隔离实现** |
| 一次接通登录、全部权限和审批、恢复全部功能 | 连带前端/身份/任务审批状态及执行契约，超出本次最小批次 | 后续单独批准 |

推荐项是工程建议，尚非 Human 已选定方案。首批若部署：现有驾驶舱读取和操作中未进白名单者将返回拒绝，自动化调用也可能暂停。不能把这种行为宣称为“完全兼容旧版”。保留全部业务实现，不删除路由、不改任务契约；逐项复核和单独审批后恢复接口。

首批只请求批准**隔离开发与限定测试**。不请求据此直接部署上述限制，不宣称完成长期身份体系或完整审批接入。

## 3. R03 最小访问策略契约

新增独立纯模块 `dist/src/http-access-policy.js`，不导入 config、业务服务或浏览器适配器。

拟议接口：

```text
evaluateHttpAccess({method, pathname, authorization, authorizationHeaderCount}, {readTokenSha256})
 -> {allow:boolean, status:200|401|403|503, code:string}
```

1. 策略首批只允许认证成功的 `GET /api/security/status`，响应固定 `{mode:"restricted", businessExecutionEnabled:false}`，不读取/修改业务状态。HEAD、OPTIONS 及所有其他 method/path 默认拒绝，不按前缀继承权限。
2. 令牌 SHA256 从新环境项 `YIKUA_G1_READ_TOKEN_SHA256` 读取，必须为 64 位十六进制；缺失/无效配置时 API 返回 503 `SECURITY_NOT_CONFIGURED`。没有开发后门或自动生成持久令牌。
3. 请求只接受单一 `Authorization: Bearer <token>`；两个 HTTP adapter 均从 rawHeaders 统计认证头数量，不依赖可能已合并/丢弃重复值的 headers。对 token 做 SHA256，使用等长 Buffer 的 timingSafeEqual；缺失/错误/重复认证头返回 401 `UNAUTHENTICATED`。令牌查询参数、cookie、请求体 token 均不采信。
4. 正确认证也仅具上述读取权限；其他请求返回 403 `OPERATION_NOT_APPROVED`。body 中 commit、approved、role、approvalId 或任何环境“启用业务”开关不能增加权限。有效身份不等于审批通过。
5. 主服务对所有路径先做方法约束：非 GET/HEAD 请求均进入门禁，包含未知路径；`/api`（忽略大小写及尾斜杠变体）所有方法统一进入门禁。主服务 API 新路由必须在门禁之后；不能通过多斜杠、编码、大小写、HEAD 的 GET 回退绕过。歧义 URL 默认拒绝。
6. 主服务原静态页面/静态图片 GET/HEAD 维持原逻辑，本批不宣称解决静态文件保密或全站认证。该边界须在部署审批中显式接受；若要求静态资源身份保护，应另列影响而非静默扩大补丁。
7. 独立 Listing HTTP 服务对所有请求执行同一策略；在 readBody、agent.run/validate 及任何 provider 初始化触发之前作出拒绝。保留现有导出和执行语义，不顺带改端口或监听 host。
8. 主服务挂载位置：`const app = express()` 后、任何路由注册和 express.json/multer 处理之前；主服务内部 agentClient、草稿桥及回退路径不可因未授权请求被调用。
9. 拒绝响应只含稳定 code，不回显 token、绝对路径或堆栈；不创建数据库/任务/审批记录。第一批不新增安全审计库，限定测试以假 handler 调用计数和合成文件快照留证。

权限与审批接入的明确范围：所有 effectful 操作的服务器端授权集合为空，审批门禁为确定性拒绝。未来恢复前，必须复用既有任务/审批系统并绑定 subject、action、店铺/对象、任务版本、输入指纹和期限；不能从本批“认证有效”推导出执行许可。该后续接入不是本批要新建的第二套任务系统。

## 4. 候选代码与测试文件白名单

以下为批准后隔离副本中的改动；本轮未创建这些产品/测试文件。

| 文件 | 动作 | 唯一责任 |
|---|---|---|
| `dist/src/http-access-policy.js` | 新增 | 上述纯策略与令牌摘要比较，业务副作用为零 |
| `dist/src/server.js` | 最小修改 | 引入策略、最前置门禁和最小 status 响应；移除 59–72 的守卫绕过及误导日志 |
| `listing-agent/src/server.js` | 最小修改 | 使用同一策略，在请求体与 agent 处理前拦截 |
| `dist/test/http-access-policy.test.js` | 新增 | 身份、空授权、HTTP 变体及零副作用反例 |
| `dist/test/http-entry-security.test.js` | 新增 | 两个入口接入顺序、真实路由登记覆盖、传输层/纯策略一致性 |
| `dist/test/delete-guard-preservation.test.js` | 新增 | 保护变量不被源码清空、守卫拒绝不会被旁路重试 |

不修改 `public/*`、package/lock、config、业务桥、外部 ecom、数据库 schema 或旧 CEO 工作树。若以上 6 文件不足以安全验证（例如需要提取最小 handler 工厂），先给出明确新增文件与理由，扩大批准前不得顺便重构 server。

## 5. R04 最小修复、兼容和回退

- 删除主服务对三项保护变量的赋空与“guard disabled”日志/注释；不把其改成其他 falsy 值，不在子进程 env 或 preload 中再次抹除，不用重试、分批或同步删除旁路守卫。
- 平台 shim 缺失时不伪造“守卫已生效”。首批验收只能证明应用停止主动绕过；平台实际 preload/版本/阈值及回收行为需要独立证据，仍作为正式删除功能恢复的前置门槛。
- 合法归档/放弃/临时清理可能重新返回守卫错误，这是应传播的阻断，不自动宣称成功或完成任务；相关行为若仍吞错，单列缺陷并暂停依赖它的放行，不扩改状态机。
- 测试仅在合成目录用假 shim 拒绝删除并核对 sentinel 原样保留；不能删除真实产品文件或超过真实平台阈值来实验。
- 回退只在隔离副本恢复本次准确差异。禁止重置主目录、清理未跟踪文件，禁止回退到生产环境绕过守卫的旧实现；部署后出现故障应维持写入关闭并修复，而非重新打开原漏洞。

## 6. R05 隔离准备包（先满足，后运行测试）

推荐无网络、无共享盘的独立 Windows 虚拟机。是否已有可用虚拟机/虚拟化能力本轮待确认；不安装或启用虚拟化、不变更主机配置。不具备条件时暂停测试，不降级为同账户下的普通文件夹。

拟议客体目录 `C:/g1-lab/yikuaborder`；由用户批准后建立，**不把此路径当作主机本轮写入位置**。

| 隔离面 | 准备要求 | 验收证据 |
|---|---|---|
| 输入快照 | 只复制实际审核过的源码、schema、测试和必要依赖；记录所选字节哈希，.git 不进入客体 | 输入 manifest 与依赖版本；不是只拷 HEAD 丢失实际代码 |
| 凭证/业务数据 | 排除 .agent、data、users、真实 JSON 配置、浏览器 profile、日志、导出资料和全部生产库；必要配置用合成夹具 | 明确文件白名单，无“复制整个项目再删除敏感文件”的操作 |
| 文件访问 | 客体无主机共享目录、盘符透传或生产目录可写权限；检查所有链接最终目标 | 挂载/共享清单、链接审计；哈希哨兵不能替代访问控制 |
| 依赖 | 使用经审查的普通文件副本或离线依赖包，拒绝共享可写 node_modules Junction；核对 Node 与依赖版本 | 不默认安装、不执行 npm lifecycle；缺依赖停止并单独申请 |
| 写路径 | 独立 cwd/USER_DATA_DIR/TEMP/TMP、产物和合成状态；所有按 PROJECT_ROOT 定位的文件也在客体内 | 最终解析路径清单与越界拒绝证据 |
| 进程环境 | 仅保留运行所需 PATH/SystemRoot/TEMP 及明确测试项；清除真实 CDP、ECOM_ROOT、代理、令牌、用户数据根；外部适配器全部 fake | 子进程环境字段清单，不记录秘密值 |
| 网络/浏览器 | 无外部网卡连接、无真实 CDP/登录态、无真实平台；只允许客体回环测试通信 | 网络/浏览器清单；服务端口扫描不是必需，不探测生产 |
| 执行方式 | 不启动完整 server.js，不导入其启动初始化代码；策略测试和假 handler 可在 guest 的 127.0.0.1:0 短暂监听 | 端口与 PID 生命周期、测试结束无残留；这是后续限定测试授权的一部分 |
| 副作用测量 | 运行前后记录合成目录清单、假执行器/provider调用计数和进程清单；出界即失败 | 零外部业务调用、零真实数据库连接、拒绝路径下零 handler 调用 |

现有工作树不得直接标为隔离验收通过。`reliability-phase2/node_modules` 指向主目录依赖，CEO `.test-*` 目录仅为历史产物。依赖复制/虚拟机准备需另获准，本轮仅记录方案。

## 7. 执行任务与验收命令（全部尚未执行）

安全修复依赖顺序保持 R03 → R04 → 隔离验证 → R01/R02；物理隔离准备须在任何测试执行前完成，不与该修复优先级混淆。

### Task 0：批准并建立隔离输入

- [ ] 批准本单“隔离开发＋限定测试”；重新核对主目录实际变动和基线哈希，保留并发修改；不得自动采用脏文件版本或切换 Git。
- [ ] 先完成第 6 节访问隔离和白名单输入，保存环境验收证据。环境不合格就停止，不跑 RED 测试。

### Task 1：R03 写入口门禁

- [ ] 在候选测试文件建立失败反例：缺失/错误/重复 Bearer；坏摘要配置；有效身份仍不能写；commit false/true/伪造 approved 均拒绝；上传、重试、preview、未知路由、GET dossier/status、GET active-task/status；大小写/编码/重复斜杠/HEAD 回退；拒绝前零 body parser/provider/handler 调用。
- [ ] 隔离运行策略测试，确认因缺少策略/接入而失败，而不是环境损坏；实际记录失败输出。
- [ ] 实现第 3 节纯策略与两个入口接入；用假处理器验证唯一允许的认证 GET 状态返回固定内容，无业务调用。
- [ ] 接入顺序用 AST/源码结构核查，并以最小测试 HTTP harness 验证；不得启动真实服务来测试。真实 handler 的 URL/方法匹配规则必须与 harness 一致，测试不得只是复制实现再断言。

### Task 2：R04 删除保护

- [ ] 先写失败反例：3 个保护变量在应用源码中没有赋空/删除操作；假 shim 拒绝操作后 sentinel 保留且不旁路重试。
- [ ] 只移除绕过段；验证错误仍阻断，记录未加载真实平台 shim 的限制，不把假 shim 通过写成真实平台守卫通过。

### Task 3：隔离安全验证与审批回执

- [ ] 在已验收客体中运行：

```powershell
node --check dist/src/http-access-policy.js
node --check dist/src/server.js
node --check listing-agent/src/server.js
node --test dist/test/http-access-policy.test.js dist/test/http-entry-security.test.js dist/test/delete-guard-preservation.test.js
```

- [ ] 再静态审查旧回归的导入/清理边界；确认仍全在客体与临时夹具后，运行限定回归：

```powershell
node --test dist/test/state-store.test.js dist/test/visual-qc-safety.test.js dist/test/visual-runner-safety.test.js listing-agent/test/listing-agent.test.js listing-agent/test/listing-safety.test.js
```

- [ ] 任一失败、越界、真实服务/浏览器调用或非预期残留均不得验收；不以历史 45 项通过代替本次结果。不运行 npm test、npm start 或 start:test。
- [ ] 提交准确文件 diff、环境输入清单、红绿测试原始结果、零业务调用证据、已知兼容限制与回退包。没有 Git 提交/推送/合并授权；如需此类操作另行批准。

完成上述任务只可报告“隔离补丁通过限定验收”，不能报告生产风险已消除。生产启用前另批部署、服务启动恢复副作用、网络边界和正在进行的业务任务处置；不自行暂停/修改任务。

## 8. 运行时缓解选项（本轮不执行）

| 选项 | 拟议操作 | 影响与批准前置 |
|---|---|---|
| A：收紧 TCP 3000 入站 | 先导出相关规则清单；新增仅针对 TCP/3000 的非回环入站阻断规则，规则范围不得扩大到所有 Node 程序；实施前复核实际端口、程序路径和本机访问需求 | 可能中断局域网访问；loopback 行为、冲突规则和隧道绕过均须验证，不能预先保证。精确规则定义及回退标识形成后单独审批，不删除已有 Any 规则 |
| B：仅回环监听 | 为选定服务设置 HOST=127.0.0.1 并受控重启 | 会中断连接，启动还会进行状态恢复写入；必须有服务管理方式、活动任务/未知外部副作用核对、配置回退、恢复审批 |
| C：停止相关执行服务 | 通过确认的服务管理方式停服，并核对 watchdog 不会自行重启 | 影响所有业务及内存任务；补偿/恢复范围更大，仅作紧急备选 |

优先评估 A，避免为收紧网络立即触发已知启动写状态；但未经完整规则及隧道检查，A 不能标为完成缓解。B/C 都不能绕过当前禁令。独立 Listing 端口也须先实测运行状态再列入对应缓解，不凭默认 3200 修改网络。

这些选项只限制可达性，不能替代入口身份和操作审批；本机进程、已有连接及已启动后台作业仍须单独评估。

## 9. Review Focus 与验收门槛

| 重点反例 | 归属 | 通过条件 |
|---|---|---|
| GET 名义下的状态写入与外部执行 | Task 1 | dossier/status、active-task、status 均被门禁先拦截 |
| 认证成功却越权、伪造审批字段 | Task 1 | 所有业务操作仍 403，假执行器计数为 0 |
| 独立服务、晚注册路由与 HTTP 失败 fallback | Task 1 | 两个外部入口同一策略；拒绝发生在 client/provider 之前 |
| 异常 URL、大小写、HEAD/OPTIONS 的默认行为 | Task 1 | 无新增绕过，未知/歧义请求默认拒绝 |
| 守卫错误后吞错或重复删除、虚假隔离 | Task 0/2/3 | 合成 sentinel 保留；无真实平台调用；平台守卫未知不冒充通过 |

必须同时满足：范围不超白名单、全部限定检查实际通过、隔离边界有证据、没有业务执行权限被打开、旧 CEO 基线未变、回退不重开漏洞。缺一项不得进入部署审批。

## 10. Human 审批栏

| 批准项 | 建议 | 当前状态 |
|---|---|---|
| G1-I：第 6 节隔离准备，不改生产/主机网络配置 | 批准具体隔离条件后实施；现有虚拟化能力仍待确认 | 未批准 |
| G1-D：第 4 节 6 个代码/测试文件，在隔离副本开发 | 采用默认拒绝临时基线，保留业务恢复的独立门槛 | 未批准 |
| G1-T：第 7 节限定测试，含客体回环临时测试 listener | 仅 G1-I 验收通过后执行 | 未批准 |
| G1-M：网络/运行时缓解 | A/B/C 需单独确定精确操作及业务影响，不与代码开发一并放行 | 未批准 |
| G1-P：生产部署/重启/合并 | 待隔离验收结果后另行审批 | 未批准 |

本次建议下一条明确授权范围为：**批准 G1-I、G1-D、G1-T；先验收隔离环境，再进行所列文件补丁与限定测试；不批准生产部署、主机网络变更或真实业务执行。** 若隔离条件不能满足，先报告阻塞，不自动改变方案。

当前目标：形成可审阅的 G1 首批方案。完成内容：证据复核、6 文件候选范围、权限/审批边界、隔离准备、测试及回退定义。实际本轮仅新增本文及交付证据。风险待确认：临时功能限制是否接受、隔离平台能力、真实 shim 状态、当前网络/服务状态。Backlog：R01/R02、长期身份与现有审批的绑定、逐项恢复业务接口、静态资源保密；不在本轮实施。
