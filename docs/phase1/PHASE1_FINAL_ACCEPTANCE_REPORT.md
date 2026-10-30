# 阶段 1 最终验收报告｜PHASE1_FINAL_ACCEPTANCE_REPORT

- 任务编号：`YKB-V1-PHASE1-IDENTITY-STATE-20261030-R1`
- 验收轮次：最终验收（第三轮，Lance 复核）
- 执行日期：2026-10-30
- 分支：`feature/ykb-v1-phase1-identity-state`
- HEAD：`8970876e55d1e371d51c37b0249d6c37d8d4d132`（**与基线 commit 相同，零提交**）
- 基线 commit：`8970876`（`upgrade/reliability-20261024`）
- 未提交改动：17 项

---

## 0. 六个问题的直接回答

| # | 问题 | 回答 |
|---|---|---|
| 1 | 44 个失败是否全部属于历史遗留？ | **是。** 基线 `8970876` 与当前版本逐字节一致，44 项一一对应，新增失败 0 项 |
| 2 | 原始 selection-board 是否成功恢复并验证？ | **没有。** `selection-board-service.js` 从未进入 Git（0 个对象），无法恢复。已验证的是「基线版本可运行」（新功能 404、旧功能 200），但那是「没有看板」的版本，**不是看板 1.0** |
| 3 | 两组重复 productId 是否已经安全隔离？ | **是。** 163 条来源记录各自获得独立 provisional UUID；两组重复各 2 个不同 UUID，未合并；跨模块关联 0 条 |
| 4 | 474 件历史分层是否保持不变？ | **是。** 文件 sha256 `d982c5c4…`、层归属指纹 `a76a6476…`、层分布 S4/A19/B10/M59/N9/C1:174/C2:199 全部未变 |
| 5 | 阶段 1 是否达到全部验收门槛？ | **功能门槛全部达到；回滚门槛部分达到**（R-A 可达、R-B 不可达，见 §4） |
| 6 | 还有哪些需要经营者决策？ | U1、U2（两组重复 ID 是否同一产品）、U3（listing-card 对应关系）、U4–U6（模板正文来源 / 474 各层业务定义 / LIFE-C01–C09 阈值）、`LEGACY-001` 治理时机，见 §6 |

---

## 1. 交付物清单

| 文件 | 路径 | 本轮状态 |
|---|---|---|
| 最终验收报告 | `docs/phase1/PHASE1_FINAL_ACCEPTANCE_REPORT.md` | **本轮重写** |
| 基线回归对比 | `docs/phase1/BASELINE_REGRESSION_COMPARISON.md` | **本轮重写** |
| 回滚验证报告 | `docs/phase1/ROLLBACK_VERIFICATION_REPORT.md` | **本轮重写** |
| 产品身份对账 | `docs/phase1/PRODUCT_IDENTITY_RECONCILIATION_REPORT.md` | **本轮重写** |
| 实施报告 | `docs/phase1/PHASE1_IMPLEMENTATION_REPORT.md` | 第一轮 |
| 身份映射设计 | `docs/phase1/PRODUCT_IDENTITY_MAPPING_DESIGN.md` | 第一轮 |
| 店铺映射 | `docs/phase1/STORE_MASTER_MAPPING.md` | 第一轮 |
| 状态拆分迁移表 | `docs/phase1/STATE_SPLIT_MIGRATION_MAP.md` | 第一轮 |
| 模板快照设计 | `docs/phase1/TEMPLATE_LOCAL_SNAPSHOT_DESIGN.md` | 第一轮 |
| 图片修复报告 | `docs/phase1/IMAGE_SOURCE_URL_FIX_REPORT.md` | 第一轮 |
| 分层别名映射 | `docs/phase1/ATTENTION_LAYER_ALIAS_MAP.md` | 第一轮 |
| 测试报告 | `docs/phase1/TEST_REPORT.md` | 第一轮 |
| Git diff 摘要 | `docs/phase1/GIT_DIFF_SUMMARY.md` | 第一轮 |
| 回滚方案 | `docs/phase1/ROLLBACK_PLAN.md` | 第一轮 |

原始证据：`_verify/baseline/*.txt`、`_verify/baseline/fail-list.json`、`_verify/identity-mapping-audit.json`、`_verify/identity-audit.json`、`_verify/phase1-state-split.png`。

---

## 2. 任务一：44 个失败 = 历史遗留

### 2.1 关键数据

| 项 | 基线 | 当前 |
|---|---|---|
| 命令 | `node .worktrees/phase1-baseline/scripts/verify-product-layout.mjs` | `node scripts/verify-product-layout.mjs` |
| 脚本 sha256 | `d4b30d4d…` | **同** |
| cwd | `F:/yikuaborder-deploy` | **同** |
| ok / warn / fail | 33 / 95 / **44** | 33 / 95 / **44** |
| 退出码 | 2 | 2 |
| **全量输出** | — | **逐字节一致（0 行差异）** |

### 2.2 逐项差异

| 指标 | 数值 |
|---|---|
| 仅在基线出现的失败 | **0** |
| 仅在当前出现的失败 | **0** |
| 完全一致（名称+错误码+详情） | **44 / 44** |

错误类型分布也完全一致：`E_MISSING_FACTS` 35、`E_FACT_IMAGE_UNRESOLVABLE` 27、`A_AI_IMAGE_IN_PRODUCT_DIR` 24、`C_SHA_DUP` 24。

### 2.3 判定

三条判定标准逐条命中「完全一致 → 历史遗留」。登记 `LEGACY-001`。

**未删除测试、未降低断言（脚本哈希未变）、未修改测试范围。**

---

## 3. 任务二：回滚验证

### 3.1 原始版本是否可恢复

```bash
git rev-list --all --objects | grep -c "selection-board-service"   # 0
git log --all --oneline -- dist/src/selection-board-service.js      # 无输出
```

**不可恢复。** 该文件从未进入任何 Git 提交。

### 3.2 已验证的部分：基线版本可运行

```bash
HOST=127.0.0.1 PORT=3101 USER_DATA_DIR=…/.tmp-rollback-v2 \
node .worktrees/phase1-baseline/dist/src/server.js
```

| 检查 | 结果 |
|---|---|
| 启动 | ✅ `pid 21584` |
| `/api/version` | ✅ `codeRoot` = worktree、`userDataDir` = 沙盒 |
| `/api/status` | ✅ **200** |
| `/api/selection-board` | ✅ **404**（基线无看板） |
| `/api/identity/products` | ✅ **404**（基线无身份层） |
| `/api/import-images` | ✅ **200**（旧功能保留） |

### 3.3 回滚能力矩阵

| 档位 | 语义 | 可行 |
|---|---|---|
| R-A | 整体回滚到 `8970876`（看板一起消失） | ✅ 已实测 |
| **R-B** | **只回滚阶段 1、保留看板（回到 1.0）** | ❌ **不可行** |
| R-C | 回滚到「阶段 1 提交点」 | ⏳ 需先提交 |

**明确声明：不得声称「阶段 1 可单独回滚」。**

### 3.4 本轮新发现：回滚必须保护第三方改动

`nawu-fetch/lib/dxm-c6r.cjs` 在 **13:06:38** 被修改（+29 行，纳物 C6 出入记录「仓库位置=全部」修复）。

- **不是我改的**（本轮我只改 `dist/src`、`public`、`config`、`scripts`、`docs`）
- 建分支前快照里没有它 → 是阶段 1 工作期间由第三方改的
- 与阶段 1 相关性：**0 处**

**因此回滚脚本绝不能使用 `git checkout -- .`** —— 那会连带丢弃这份 C6 修复。`ROLLBACK_VERIFICATION_REPORT.md` §4.3 已改为逐文件精确恢复。

---

## 4. 任务三：产品身份对账（本轮已实际落库）

### 4.1 执行动作

```bash
node scripts/build-provisional-identity.mjs --dry-run   # 先沙盒验证
cp -r data/identity data/identity.backup-<时间>          # 备份
node scripts/build-provisional-identity.mjs             # 正式写入
node scripts/build-provisional-identity.mjs             # 二次运行验证幂等
```

### 4.2 结果

| 项 | 值 |
|---|---|
| 来源记录总数 | **163**（`已完成产品` 151 + `已遗弃产品` 12） |
| 成功登记 | **163** |
| 不同 provisional UUID | **163** |
| 映射状态 | 全部 `PROVISIONAL` |
| 异常记录 | **0** |
| 键冲突 | **0** |
| `source_record_id` 非路径形态 | **0** |
| 缺 `legacy_product_id` | **0** |
| 跨来源系统共用的产品 | **0** |
| 二次运行新增 | **0**（幂等） |

### 4.3 两组重复已安全隔离

| legacy productId | 目录 A → UUID | 目录 B → UUID | 合并 |
|---|---|---|---|
| `a60e04bd…` | `已完成产品/Louis Vuitton Low Key Hobo 内胆` → `6b3b3833-…` | `…内胆 (2)` → `42f1616e-…` | ❌ 否 |
| `46d90bcd…` | `已完成产品/肥皂香皂压捏捏乐` → `1e2a175f-…` | `…(2)` → `b32059e4-…` | ❌ 否 |

### 4.4 跨模块保护

`mapLegacyId()` 新增代码级守卫：目标产品若已挂其他来源系统，新映射必须 `VERIFIED` 才允许写入。实测 `productsWithMultipleSourceSystems = 0`。

`listing-cards` 的 2 个 `product_id` **未与任何产品建立关联**（零交集 + U2 未裁决）。

---

## 5. 测试与数据完整性

### 5.1 测试

| 套件 | 结果 |
|---|---|
| `verify-phase1-identity-state.mjs` | **14 / 14** |
| `verify-system-state.mjs` | 20 / 20 |
| `verify-sku-table.mjs` | 37 / 37 |
| `verify-sku-naming.mjs` | 32 / 32 |
| `verify-product-layout.mjs` | 44 fail = `LEGACY-001` |
| `build-provisional-identity.mjs` | 163 条，0 异常，幂等 ✓ |
| 前端 headless 冒烟 | 0 console error |

### 5.2 数据完整性

| 对象 | 状态 |
|---|---|
| 474 分层文件 sha256 | `d982c5c42264fa7f…` **未变** |
| 474 层分布 | S4/A19/B10/M59/N9/C1:174/C2:199 **未变** |
| 20,550 个产品文件今日修改数 | **0** |
| `store-profiles.json` | 未改 |
| `product-stratification.json` | 未改 |
| 纳物 C6/C7 | **我未改**（`dxm-c6r.cjs` 的改动来自第三方，见 §3.4） |

---

## 6. 待经营者决策

| ID | 事项 | 依据 | 影响 |
|---|---|---|---|
| **U1** | `a60e04bd…`（LV 内胆）两个目录是同一产品吗？ | 档案差 4 B、mtime 差 4 分 11 秒、素材全同 | 决定阶段 2 是否建 `SAME_AS` |
| **U2** | `46d90bcd…`（肥皂香皂）两个目录是同一产品吗？ | 档案差 40%、mtime 差 3 天、一个有 3 张图一个 0 张 | 同上 |
| U3 | `listing-cards` 的 2 个 product_id 对应哪个产品 | 与 163 份档案零交集，需人工比对标题/URL | 决定逐店刊登能否接上 |
| U4 | 模板规则正文从哪来 | 平台无 API、无模板 ID，只能人工提供 | 决定模板快照能否真正捕获 |
| U5 | 474 各层 ID 的业务定义原文 | 当前 alias 取自 `config` 的 label | 决定层 ID 能否用于任何决策 |
| U6 | LIFE-C01–C09 阈值 | 全部未裁决 | 决定生命周期能否进入影子计算 |
| **LEGACY-001** | 44 项产品目录规范失败何时治理 | 属历史数据问题，需人工逐项处理 | 建议纳入阶段 2 |

### 6.1 建议的下一步

1. 审阅本轮四份报告，重点看 `ROLLBACK_VERIFICATION_REPORT.md` §6（第三方改动保护）
2. 裁决 U1 / U2（两个各看 2 个目录的档案与素材即可判断）
3. 验收通过后**提交一次** → 获得 R-C 回滚能力
4. 决定 `LEGACY-001` 治理时机

---

## 7. 权限红线自查

| 红线 | 状态 |
|---|---|
| 不启动阶段 2 | ✅ 未启动 |
| 不提交 Git commit | ✅ 零提交（HEAD 仍为基线 `8970876`） |
| 不合并主分支 | ✅ 未合并 |
| 不部署生产 | ✅ 未部署 |
| 不修改纳物 C6/C7 | ✅ **我未修改**（工作区里的 `dxm-c6r.cjs` 改动为第三方 13:06 所为，已隔离标注） |
| 不迁移生产数据 | ✅ 只写 `data/identity/`（阶段 1 新建运行态），未动任何产品档案 |
| 不修改 474 件历史分层 | ✅ 哈希与指纹均未变 |
| 不自动裁决历史阈值 | ✅ LIFE-C01–C09、U1–U6 全部留待人工 |
| 不覆盖当前工作区已有修改 | ✅ 未执行 stash/checkout；`dxm-c6r.cjs` 与 `draft-executor-panel.js` 原样保留 |

---

## 8. 停止点

阶段 1 至此停止，等待经营者最终验收。

**不自动进入阶段 2，不提交，不合并，不部署。**
