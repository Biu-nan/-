# CEO 只读经营简报入口（T1）

15:20 接续更新：WorkBuddy 已实际调用并提交独立回执，Codex 已复算原始输出哈希匹配；本地 WorkBuddy 对话只读链路验证通过。详见 [经营端验证记录](./2026-10-26-business-entry-verification.md)。下方 T1 实现阶段“经营入口待回执”为当时状态，现由本更新覆盖；其他入口和自动运行仍未验证。

2026-10-26，Asia/Shanghai。分支 `upgrade/ceo-read-brief-20261026`，基线 `0b41c7a0c7d0dfd1722dc9f383affe7cd47f33f5`。本轮只实施已承诺的 T1，T2 决策校验与 T3 今日草案尚未实施。

## 交付行为

- `dist/src/ceo-read-brief.js` 导出 `readCeoBrief`，单次 GET 现有 `/api/system/state`，8 秒超时，不重定向或重试。
- 地址限 HTTP 的 literal `127.0.0.1` 或 `localhost` 加明确端口；拒绝凭证、其他主机、查询、片段与意外路径，校验后才请求。
- 返回 `ceo-brief/v1`，保留来源、待决、原汇总与时间；来源失败或原汇总不健康时显示 DEGRADED。
- 每个单元保留原 state/rawState，并标 verification=UNVERIFIED。原 DONE 只转换业务提示为 PENDING_VERIFICATION；人工 resolved 不能当成外部动作已核验。
- `scripts/ceo-read-brief.mjs` 提供命令入口，导入时没有请求/输出副作用。stdout 为单份 JSON；失败 exit 1，stderr 只显示稳定代码及通用说明，不回显 URL 凭证、后端异常或堆栈。

这是整个本机工作台的运行状态简报，不是按店铺 400370 过滤的销售/利润报告。系统汇总生成时间不等于平台事实采集时间，无法据此判断 12 月 200 件/日与不含品质罚款的月利润目标已达成。

## 使用

从任意工作目录执行：

```powershell
node "F:\yikuaborder-deploy\.worktrees\ceo-read-brief\scripts\ceo-read-brief.mjs"
```

指定本机其他端口：

```powershell
node "F:\yikuaborder-deploy\.worktrees\ceo-read-brief\scripts\ceo-read-brief.mjs" --base-url http://127.0.0.1:3000
```

不需要启动另一份工作台；它读取现有服务。受宿主本机连接权限影响，连接失败如实返回 CONNECTION_FAILED。未修改 WorkBuddy 的 commerce-os 连接器、远程 Supabase、生产服务或原目录六个代码文件。

## 实际验证

| 检查 | 结果 |
|---|---|
| 首轮失败测试 | 实现前 40 项因入口文件/行为不存在而失败，记录 t1-red.log |
| 新增专项测试 | 实现后 41/41 通过，另加 8 秒超时配置的特征测试 |
| 原可靠性回归 | 45/45 通过，0 跳过，隔离 USER_DATA_DIR/TEMP/TMP |
| 完整测试基线 | 168 项：144 通过，24 失败 |
| 改后完整测试 | 209 项：185 通过，24 失败 |
| 失败名称对比 | 24 项名称完全一致，没有新增或消失；全量测试仍不全绿 |
| 语法检查 | 两个新增入口 `node --check` 通过 |
| 真实工程命令 | 成功取回 ceo-brief/v1、7 个来源、5 个活跃单元、DEGRADED，0 个单元被标为已核验 |

真实调用观测时间为 `2026-10-26T02:52:40.580Z`，即北京时间 10:52:40。此计数仅对应当时快照，不能当作后续实时业务进度。工程会话已运行入口，**目标 ChatGPT Work/WorkBuddy 经营会话实际调用仍待回执**；本轮不将 P0.3 标为通过，也没有验证无人值守启动。

最初受限权限完整测试另有 2 项 EPERM；在隔离短路径和可用权限下取得上述 24 项基线，改后用相同权限对比。依赖从父项目 node_modules 解析，无新增包或完整重新安装声明。

测试和原始简报仅保存在本隔离分支 `.superpowers/sdd/2026-10-26-ceo-first-loop-implementation/`；原始业务状态 JSON 不提交私有源码仓库。

## 原有 24 项失败（未在本轮修复）

1. accepts all ten prompt start and end markers
2. assembles the smt_choice_listing sample chain
3. does not hard-stop image generation on storyboard or prompt-pack QC failures
4. does not hard-stop listing generation when ChatGPT web search cannot be toggled
5. does not upload the same image twice when ChatGPT resets its file input
6. exposes Listing visual workflow v2 prompt templates through the prompt registry
7. exposes a manual reset for insert market radar selection
8. exposes all backend prompts in the knowledge prompt library
9. keeps ChatGPT tool selection resilient to composer menu role changes
10. keeps legacy planning completion available for standard Listing
11. keeps the strict luxury insert layouts and fixed copy in the template
12. reads the agent job
13. reads the artifact sample
14. reads the context pack
15. reads the sample task
16. reads the smt_choice_listing workflow spec
17. recognizes stopped thinking with no assistant output instead of waiting for the global timeout
18. recovers listing content from previously sent Chinese listing prompts
19. reports ready health when all P0 fixtures and the sample chain are available
20. sends listing content with a stable backend fingerprint
21. shows the Listing visual workflow v2 stages without replacing legacy controls
22. supports the seven-image luxury insert prompt pack
23. surfaces write failures instead of swallowing them
24. uses the native editor insertion path for a long prompt

## 下一任务与风险

让实际经营会话读取本入口并返回 schema、观测时间、数据健康、待决及未核验事项；只有收到真实回执才确认该入口已接通。随后按已定 T2/T3 实施决策校验与今日草案，并补 P2 的共享写入/审批/执行证据与回滚施工单。现有 24 项旧失败独立列 Backlog，不为通过当前入口检查而改旧功能或测试。

## 独立代码审查

独立新上下文审阅线程 ceo_brief_code_review 检查三文件提交 `4c2557b`，并独立运行专项 41/41 通过；未发现 Critical/Important 阻塞问题，T1 可接受。本轮没有合并或部署到原运行服务，原目录六个 WorkBuddy 修改不受影响。

保留一项 Minor：收到 HTTP 200 后读取响应体若超时，目前归类 INVALID_RESPONSE，可能影响排查方向；它仍明确失败、不会返回假成功。建议将该情况归类 CONNECTION_FAILED，并补响应头/响应体两个中止路径测试。本轮不扩展修复，列 Backlog。当前 8 秒配置已测，未声称做过实际 8 秒断网集成测试。

审查明确认可本机 GET 边界、损坏源降级、旧 DONE 的待核验标识、CLI 导入与脱敏错误输出；基础 shape 校验不等于全业务 schema。sources[].error 依契约保留原值，因此“CLI 错误不泄露原始异常”不代表成功简报全文已全面脱敏。T2/T3、旧失败与真实经营入口回执仍按原边界处理。
