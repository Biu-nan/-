# 当前源码私有备份与恢复报告

日期：2026-10-26，Asia/Shanghai。范围：P0.1、P0.2。执行者 Codex。

## 结论

当前工作目录中经审查的 460 个源码、配置与文档文件已保存至私有仓库新分支，并通过隔离恢复检查。快照包含 WorkBuddy 的六个未提交修改、系统状态总账、经营口径/分层配置、选定业务脚本和协调文档。它是源码恢复点，不包含业务数据库、账号配置、登录会话或所有生成产物。

- 私有仓库：`Biu-nan/yikuaborder-private-backup`，经本机既有 Git 凭证调用 GitHub 元数据接口确认 private=true。
- 新分支：`backup/current-source-20261026`。
- 提交：`9563ff58fc599c71980ae9f0b8b2762280768ffd`。
- 父提交：`bba5dcd8c79be893d4ebf50064499363fce66779`。
- 清单：[source-baseline/v1](../../coordination/2026-10-26-source-baseline-manifest.json)。460 个纳入文件及 450 个排除候选；清单不自算哈希，清单自身由 Git 提交覆盖。
- Git 树共 461 个文件，包含上述清单。旧 `pre-upgrade-20261024` 标签不变，原工作目录 HEAD 与暂存区未因快照操作改变。

## 实际执行和证据

1. 使用独立 Git index，以准确路径形成快照，未执行 `git add .`，未切换或重置当前分支。对 460 个来源文件及暂存字节检查 SHA-256，形成提交前均一致。
2. GitHub 插件返回 404，转用此前已授权的本机 Git 凭证；只向 private-backup 推送，无公共 origin 推送。
3. Git push 成功；初次 Git 回读发生 TLS EOF，第二次 PowerShell HTTP 请求超时。改用有连接/总时限的 curl 官方 API 请求，回读远程分支 object.sha 与本地提交完全一致。没有把失败回读记为通过。
4. 第一份 Git archive 在本机默认配置下自动把 LF 转为 CRLF，恢复哈希检查发现不一致。源文件与 Git blob 相同；单文件设置 `core.autocrlf=false` 的归档试验证实根因。随后重新按原始字节归档到新的恢复目录，460/460 匹配，无哈希归一化或忽略差异。
5. 恢复目录：`F:/yikuaborder-deploy/.worktrees/ceo-source-recovery-20261026-raw`。原始字节 ZIP 位于本计划本地临时证据目录 `source-recovery-raw.zip`。
6. 33 项 JavaScript 语法检查通过；静态相对模块引用检查未发现纳入源文件依赖缺失。此静态检查不等同于全量模块执行或重新安装全部依赖。
7. 在恢复目录设置独立 `USER_DATA_DIR`、TEMP、TMP，实际运行 `npm.cmd run test:reliability`：45 项通过，0 失败，0 跳过。所用依赖由上级原项目 node_modules 解析；没有声称全新机器安装已验收。尝试创建依赖 junction 遇权限拒绝，未创建成功，测试使用 Node 的上级模块解析即可运行。

## 安全和范围

未额外纳入未跟踪的账号配置、运行状态、业务数据、诊断截图、未审查非必要资产及历史证据产物。对纳入候选执行令牌/私钥/字面凭证模式扫描，未发现命中；这是有限检查，不是绝对无秘密的认证。保留既有跟踪文件，其中原有业务种子/配置记录随源码保留，不声称所有业务相关 JSON 均被剔除；不在备份任务删除历史代码或记录。

六个 WorkBuddy 原目录修改仍为未提交状态，未被 Codex 认领为自己的产品实现。隔离 phase2 的 75 项可靠性工作尚未合入；本次恢复测试对应原目录 45 项测试。未跑全量回归，不宣称现有历史 24 项失败已修复。

## 恢复方式

从私有仓库取得上述提交，在独立目录恢复；如要求原始字节一致，Git archive 须显式设置 `-c core.autocrlf=false`，再按清单 SHA-256 核对。先检查恢复副本，不覆盖当前工作目录。账号和业务数据应从各自受控位置恢复，不从源码快照猜测补造。

本次必要检查命令：`node --check <目标 JS 文件>`、`npm.cmd run test:reliability`；测试须使用隔离数据目录。原始测试日志及回读记录保留在 `.superpowers/sdd/2026-10-26-ceo-os-first-loop-phase0/`，未将含凭证的进程环境写入报告或仓库。
