# Reliability Phase 1 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task in this session. Steps use checkboxes. Do not overwrite unrelated workspace changes.

**Goal:** 修复已复现的Listing误提交、视觉QC误放行和主状态静默覆盖，提供可回归的首批可靠性升级。

**Architecture:** 保留现有业务流程和部署方式，提取可复用的交付判定及安全JSON存储。只改变已证实的错误分支，不启动真实浏览器/生图/店小秘操作，不重启服务。

**Tech Stack:** Node.js ESM、node:test、既有Ajv和文件队列，无新增运行依赖。

**Spec:** docs/superpowers/specs/2026-10-24-workbench-reliability-upgrade-design.md（用户已指示开始升级）。

## Global Constraints

- 回滚标签pre-upgrade-20261024与备份分支固定在373dbcb，升级在upgrade/reliability-20261024进行，仅推送private-backup。
- 保留当前未提交的dist/src/chatgpt-adapter.js改动，本计划不修改、不提交它。
- 不更改模型、推理档位、图数/槽位、平台尺寸和账号配置。
- 测试使用独立目录；完整测试的既有失败按名称记录，不把原有失败包装成全绿。
- 本阶段是W1/W2的核心修复；全旧入口统一审批、身份验证、Job数据库与真实草稿回读仍按总方案后续工作包推进，不宣称已完成9.5分升级。

## Review Focus

- Schema硬错但missing为空不能触发publisher；修复次数为0必须生效。
- 来源要求复核经过normalize和AI补全后仍不能提交。
- 首图低分、无缩略图和部分本地QC不能进入passed；缓存旧通过项也要重新验证。
- 主状态无法解析且无有效快照必须保留原文件并报错，不能重置覆盖。
- 并发更新及写失败不能让内存状态先于持久化宣称完成。

### Task 1: Listing提交门禁与来源复核

**Files:** listing-agent/src/listing-agent.js、stages/validate-stage.js、stages/generate-stage.js、types.js；dist/src/dianxiaomi-facts.js；新增listing-agent/test/listing-safety.test.js。

**Interfaces:** validateStage产出blockers；run返回validation及needs_human；publisher只在schemaValid、completeness.ok且无blockers时调用。maxAutoFixRounds为0–3整数，默认3。normalize保留provenance；AI补全不得清除原有复核要求。

- [x] 添加类型错误、复核保留、0次修复、非法轮数、正常提交的行为测试。
- [x] 运行测试，确认错误分支的预期失败。
- [x] 实现最小门禁和来源透传；不放宽Schema硬错误。
- [x] 运行node --test listing-agent/test/*.test.js，预期全部通过。
- [x] 记录验证并提交本任务涉及文件。

### Task 2: 视觉QC与候选隔离

**Files:** agents/ae-product-design/src/qc.js、runner.js；新增dist/test/visual-qc-safety.test.js。

**Interfaces:** composeQcResult聚合已有确定性/视觉判定；buildLocalQc返回局部覆盖结果；isQcDeliverable只接受完整通过。runner复用以上接口，unverified不当passed、不因QC缺覆盖持续重复生图，产物计数只统计合格交付。

- [x] 添加低总分/分项、缺缩略图、本地覆盖不足、尺寸失败、缓存旧误通过和正常通过测试。
- [x] 运行测试，确认当前实现的预期失败。
- [x] 提取并接入判定，两个本地兜底分支共用同一策略；移出未合格候选时修正交付路径。
- [x] 运行node --test dist/test/visual-qc-safety.test.js，预期全部通过。
- [x] 记录验证并提交本任务涉及文件。

### Task 3: 主状态安全保存与恢复

**Files:** 新增dist/src/reliability/json-store.js、dist/test/state-store.test.js；修改dist/src/state-store.js。

**Interfaces:** readCheckedJson(file,{validate})返回{found,value,recovered,preservedPath}；writeCheckedJson(file,value,{validate})执行进程内同路径串行的原子保存和有效快照。StateStore构造可传stateFile用于独立实例；正常调用保持兼容，持久化成功后才更新内存。

- [x] 添加损坏原件保留、有快照恢复、无效结构、并发更新、保存失败内存不前进及正常暂停恢复测试。
- [x] 先在独立目录运行，确认不是由误读真实运行数据产生的失败。
- [x] 实现JSON校验、独占临时文件/文件同步/替换、最后有效快照、串行状态变更。
- [x] 运行node --test dist/test/state-store.test.js，预期全部通过。
- [x] 运行完整根测试及Listing测试，逐项对照既有失败；新增回归必须通过。
- [x] 记录验证并提交本任务涉及文件。

### Task 4: 独立审查与私有交付

**Files:** 本计划进度、私有备份回执、阶段验证报告和package.json的test:reliability检查入口。

**Interfaces:** 审查本分支相对373dbcb的本次修改，不包含用户浏览器适配器改动；固定备份标签不移动。

- [ ] 独立审核首批升级；重要问题按失败测试→修复→验证处理。
- [ ] 确认未修改业务数据、未部署/重启、未推送公开origin。
- [ ] 推送升级分支到已验证的私有仓库，并回读提交。
- [ ] 更新总方案状态，逐项保留后续W3–W9及真实验收门槛。
