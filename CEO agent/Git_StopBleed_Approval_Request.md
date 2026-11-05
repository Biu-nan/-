# Git 止血变更清单（待 Human 批准，尚未执行）

针对提交 `e19e704` 的敏感目录止血。**以下命令均未在主工作区执行**，全部已在隔离副本验证通过。

---

## 变更范围一句话

新增 8 行 `.gitignore` 规则 + 一次只动索引的移除，把 **7,157** 个路径从跟踪中移出，**不动磁盘文件、不动历史、不动源码与交接资料**。

---

## 步骤 0（建议先做，独立提交）

当前主工作区有 5 个本轮新建的未跟踪交付物：

```
CEO agent/CEO_Agent_V1.0_G2B1_Evidence/
CEO agent/CEO_Git_Safety_And_Store_Mapping_Approval.md
CEO agent/Git_StopBleed_Approval_Request.md
CEO agent/WorkBuddy_CEO_G2B1_Handoff_Implementation_Report.md
CEO agent/CEO_Stage_Report_Git_StopBleed_And_Store_Identity.md
```

**为什么先提交它们：** 宿主检查点用 `git add -A`，不先提交就会被卷进下一个自动检查点提交，与止血变更混在一起。

```bash
git add "CEO agent/CEO_Agent_V1.0_G2B1_Evidence" "CEO agent/CEO_Git_Safety_And_Store_Mapping_Approval.md" "CEO agent/Git_StopBleed_Approval_Request.md" "CEO agent/WorkBuddy_CEO_G2B1_Handoff_Implementation_Report.md" "CEO agent/CEO_Stage_Report_Git_StopBleed_And_Store_Identity.md"
git commit -m "docs(ceo): archive G2-B1 handoff report, git safety review and evidence"
```

---

## 步骤 1：`.gitignore` 追加 8 行

在文件末尾追加（当前文件 112 行，追加后 120 行）：

```gitignore

# ── 浏览器用户档案（登录态/会话/缓存，绝不入库）──
.chrome-cdp-9223/

# ── 临时验证与产物 ──
_verify/
_shortlist_result.json
*.bak-*
```

| 规则 | 覆盖对象 | 依据 |
|---|---|---|
| `.chrome-cdp-9223/` | 整个浏览器用户档案，7,137 文件 / 681.6 MB | 含 Cookies / Login Data / Web Data / Local State，12 个 HIGH 风险文件 |
| `_verify/` | 18 个内部验证产物 | 代码中为**输出目录**（`collector-bridge.js` 的 staging、`audit-product-identity.mjs` 的输出），非输入 |
| `_shortlist_result.json` | 1 个临时结果 | 全仓无代码引用 |
| `*.bak-*` | 1 个源码备份 | `nawu-fetch/lib/nawu-inventory.cjs.bak-20261101`，无引用 |

**未加入忽略的（故意保留跟踪）：** `config/market-scan.json`（被 4 个脚本读取，是输入不是产物）、`docs/**`、`dist/**`、`public/**`、`nawu-fetch/lib/**`、`CEO agent/**`。

---

## 步骤 2：仅操作索引的移除

```bash
git rm -r --cached .chrome-cdp-9223 _verify _shortlist_result.json nawu-fetch/lib/nawu-inventory.cjs.bak-20261101
```

- `--cached` 只改索引，**不删磁盘文件**
- `--r` 递归；不带 `-f`，若索引与工作树不一致会拒绝执行（安全默认）

数量核对（已 dry-run 实测）：

| 路径 | 移除数量 |
|---|---:|
| `.chrome-cdp-9223` | 7,137 |
| `_verify` | 18 |
| `_shortlist_result.json` | 1 |
| `nawu-fetch/lib/nawu-inventory.cjs.bak-20261101` | 1 |
| **合计** | **7,157** |

完整 7,157 条路径清单：`CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-removal-list.txt`

---

## 步骤 3：单次提交

```bash
git commit -m "chore(git): stop tracking browser profile and generated verification outputs"
```

---

## 步骤 4：验收断言

| 断言 | 期望值 |
|---|---|
| `git ls-files \| wc -l` | **1,080**（当前 8,237） |
| `git ls-files \| grep -c '^CEO agent/'` | **398**（不变） |
| `git ls-files \| grep -c '^dist/'` | **127**（不变） |
| `git ls-files \| grep -c '^docs/'` | **220**（不变） |
| `git ls-files \| grep -c '^\.chrome-cdp-9223/'` | **0** |
| `.chrome-cdp-9223/Default/Network/Cookies` 存在且大小 73,728 B | 是 |
| `git status --porcelain` | 仅干净，无 `?? .chrome-cdp-9223/` |
| `git check-ignore -v .chrome-cdp-9223/Default/Network/Cookies` | 命中 `.gitignore` |

---

## 隔离副本中的实测结果（已通过）

在 `git clone --shared --no-checkout` 副本中按上述步骤执行，结果：

| 验证项 | 结果 |
|---|---|
| 移除后 7 个凭证文件仍在磁盘、Cookies 哈希不变 | ✅ PASS |
| 止血提交后树内 `CEO agent/` = 398、`dist/src/` = 83 | ✅ PASS |
| 新增写入 `Cookies-journal` + `_verify/new-artifact.json` + 改 `README.md` 后执行 `git add -A` | ✅ 暂存区**只有 README.md**，敏感路径 0 |
| `git clean -fdn`（模拟 discard 策略） | ✅ 输出为空，浏览器目录与 `_verify` 均不在清理列表 |
| `git check-ignore` 判定 | ✅ 命中 |

详见 `CEO agent/CEO_Agent_V1.0_G2B1_Evidence/git-safety/stop-bleed-verification.json`

---

## 明确不做的事

| 不做 | 原因 |
|---|---|
| `git reset` / `revert` | 会丢交接资料或让凭据 blob 继续留在历史里 |
| `git clean` | 会删浏览器数据 |
| `git gc` | 属历史净化，单独审批 |
| `git push` / `fetch` | 处置完成前禁止推送该分支 |
| 历史重写（filter-repo / rebase） | 单独审批事项 |
| 删除 `.chrome-cdp-9223/` 任何文件 | 明确禁止；本方案只改索引 |
| 修改 `store-profiles.json` / 生产配置 | 不在本轮范围 |

---

## 回滚方式

```bash
git reset --soft HEAD~1     # 撤销止血提交，保留索引变更在工作区可查看
# 或逐条恢复跟踪（不删文件）：
git add .chrome-cdp-9223 _verify _shortlist_result.json nawu-fetch/lib/nawu-inventory.cjs.bak-20261101
```

磁盘文件在任何情况下都不会因本方案丢失。
