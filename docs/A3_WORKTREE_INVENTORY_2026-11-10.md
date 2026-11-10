# A3 工作树盘点（只读扫描，2026-11-10）

> 本文只做盘点与建议，**没有删除、移动、重命名任何东西**。
> 要动哪一个，需要你逐个点头。

## 0. 结论

- 当前 `git worktree list` 一共 **21 条 = 主目录 + 20 个工作树**，合计约 **585 MB**。
- **11 个是完全干净的**（0 未提交），而且它们的提交都在各自分支上、且都打过 tag 或留在分支里
  → 删掉只是删掉一份检出，**不会丢任何提交**。删掉这 11 个，工作树就从 20 降到 9，正好是 A3 的验收线。
- **8 个有未提交改动，共 197 个条目**。这些**绝对不能直接删**，`git worktree remove` 也会拒绝。
- 1 个是 WorkBuddy 自己的外部目录（`C:/Users/User/WorkBuddy/Worktrees/...`），不归本项目管。

另外顺手修正两个认知错误：

1. **A3 其实不依赖 A2。** 板上写着 `blocked:true 依赖 A2`，但 A2 要用的影子根
   `F:/yikuaborder-shadow-merge` **不是工作树**（它不在 `git worktree list` 里，是一份普通目录拷贝）。
   所以 A3 随时可做，只是删除本身需要你授权。
2. **`phase2d-b2-wt` 的"未提交"记录与磁盘事实不符。** 项目记忆里写「2D-B2-A P0 修复未提交」，
   但该工作树现在 `dirty=0`、HEAD 在 `0ae21ce`。修复应该是后来提交了，记忆没跟上。
   这条需要你确认一次，因为它关系到「P0 修复到底有没有落库」。

## 1. 全量清单

「合并进 HEAD」这一列意义有限：主目录 HEAD 停在 `feature/ykb-v1-phase1-identity-state`，
绝大多数分支本来就不会被它包含。**判断能不能删，看的是「未提交改动数」，不是「是否已合并」。**

| # | 工作树 | 分支 | 提交 | 未提交 | 最后提交 | 体积 | 处置建议 |
|---|---|---|---|---:|---|---:|---|
| 1 | `C:/Users/User/WorkBuddy/Worktrees/.../master-9d64c319` | workbuddy/master-9d64c319 | 47bfc93 | 4 | 08-03 | 4 MB | **不动**（外部工具目录） |
| 2 | `.worktrees/ceo-g0-g1-20261105` | feature/ceo-g0-g1 | 052abd7 | **65** | 10-30 | 37 MB | 先看这 65 个是什么 |
| 3 | `.worktrees/ceo-g2a-20261105` | feature/ceo-g2a | db002b0 | 20 | 11-05 | 29 MB | 先看 |
| 4 | `.worktrees/ceo-g2b1-20261105` | feature/ceo-g2b1 | c403c86 | 30 | 11-05 | 28 MB | 先看 |
| 5 | `.worktrees/ceo-read-brief` | upgrade/ceo-read-brief | fed03d3 | 7 | 10-28 | 24 MB | 先看 |
| 6 | `.worktrees/ceo-ui-security-20261106` | feature/ceo-ui-security-gateway | c403c86 | 36 | 11-05 | 25 MB | 先看（与 #4 同 sha，疑似重复检出） |
| 7 | `.worktrees/phase1-baseline` | detached | 8970876 | **0** | 10-29 | 23 MB | **可删** |
| 8 | `.worktrees/phase2-product-workbench` | feature/ykb-v1-phase2b | f16d9fd | 27 | 10-30 | 24 MB | 先看（与 #11 同 sha） |
| 9 | `.worktrees/reliability-phase2` | upgrade/reliability-phase2 | 35291d8 | **0** | 10-25 | 7 MB | **可删** |
| 10 | `.worktrees/workflow-alert-format` | detached | 43a52d4 | **0** | 10-28 | 24 MB | **可删** |
| 11 | `F:/yikuaborder-phase2b-wt` | feature/ykb-v1-phase2b | f16d9fd | **0** | 10-30 | 24 MB | **可删** |
| 12 | `F:/yikuaborder-phase2c-wt` | feature/ykb-v1-phase2c | 12b7d62 | **0** | 10-30 | 24 MB | **可删**（有 tag `phase2c-checkpoint-20261030`） |
| 13 | `F:/yikuaborder-phase2d-a-wt` | feature/ykb-v1-phase2d-a | 9e5a4ac | **0** | 10-30 | 25 MB | **可删**（有 tag `phase2d-a-checkpoint-20261030`） |
| 14 | `F:/yikuaborder-phase2d-b1-wt` | feature/…-b1 | 8ee8f8f | **0** | 10-31 | 25 MB | **可删**（R-01 修复已提交） |
| 15 | `F:/yikuaborder-phase2d-b2-b1-e14-wt` | feature/…-b2-b1-e14 | 3b292aa | **0** | 10-31 | 25 MB | **可删** |
| 16 | `F:/yikuaborder-phase2d-b2-b2-e4-wt` | feature/…-b2-b2-e4 | 6ed0fad | **0** | 11-01 | 96 MB | **可删**（最占地方的一个） |
| 17 | `F:/yikuaborder-phase2d-b2-b3-e5-wt` | feature/…-b2-b3-e5 | b3c0fec | **0** | 11-01 | 25 MB | **可删** |
| 18 | `F:/yikuaborder-phase2d-b2-b3-e6-wt` | feature/…-b2-b3-e6 | b3c0fec | 7 | 11-01 | 25 MB | 先看 |
| 19 | `F:/yikuaborder-phase2d-b2-wt` | feature/…-b2-safety | 0ae21ce | **0** | 10-31 | 25 MB | **可删**，但先确认 §0-2 |
| 20 | `F:/yikuaborder-run` | master | 8970876 | 1 | 10-29 | 56 MB | 先看（master 检出，1 个改动） |

## 2. 建议的执行顺序（分三批，不一次做完）

**第一批（11 个干净检出，约 322 MB，零提交风险）**
#7 #9 #10 #11 #12 #13 #14 #15 #16 #17 #19

```bash
git worktree remove "<路径>"      # 不加 --force；有未提交它会自己拒绝
```
删完剩 9 个 → 达到 A3 的「降到个位数」。

**第二批（8 个有未提交改动的，共 197 条）** —— 逐个先出清单再定：
#2(65) #3(20) #4(30) #5(7) #6(36) #8(27) #18(7) #20(1)

对每一个只有三种处置，没有第四种：① 那是要留的工作 → 提交到分支；② 那是垃圾 → 确认后丢弃；
③ 不确定 → 打包成 patch 存到 `F:/yikuaborder-backups/` 之后再删工作树。

**第三批** #1 不动。

## 3. 为什么我没直接动手

删除工作树对项目目录来说不属于「个人文件」，但它同样是**不可逆**的：一个 `git worktree remove --force`
就能把 65 个未提交文件变成不存在。所以本文停在「清单 + 建议」，等你按批次点头。

真要做的时候我会：每删一个先记录 `git -C <wt> status --porcelain` 的完整输出到备份目录 →
再删 → 再核对剩余数量。**先取证，再删除**，顺序不反。

## 4. 执行结果（2026-11-10 14:45 已执行第一批）

**20 → 9 个工作树**，删除 11 个，回收约 **323 MB**（按 §1 表体积相加）。

| 步骤 | 结果 |
|---|---|
| 逐项取证 | 11 份 `evidence/<名称>.txt`（分支、提交、`status --porcelain`、`status --ignored`、含此提交的分支），另存 `worktree-list-BEFORE.txt` |
| 唯一产物拷出 | `b2-e4` 的 `当前产品/` 5 个文件 → 备份目录，**逐文件 sha256 与源一致** |
| `git worktree remove`（不加 `--force`） | **11/11 成功**，没有一个被 git 拒绝（说明确实都干净） |
| 提交完整性 | `0ae21ce` `8ee8f8f` `9e5a4ac` `12b7d62` `f16d9fd` `8970876` 全部仍在；tag `phase2c-checkpoint-20261030`、`phase2d-a-checkpoint-20261030` 仍在 |
| 目录残留 | 7 个目录的**文件全部删净**，但留下了空壳（见 §4.1），已按类型精确清理 |
| `:3000` | 全程 PID 18656 LISTENING，未受影响 |

备份在 `F:/yikuaborder-backups/2026-11-10_a3-worktrees/`（17 个文件：11 份证据 + BEFORE 快照 + 5 个拷出产物）。

### 4.1 ⚠️ 一个差点炸掉生产的发现：worktree 的 `node_modules` 是指向主目录的符号链接

`git worktree remove` 删完文件后，7 个目录仍存在。查下来剩下的都是同一个东西：

```
lrwxrwxrwx node_modules -> /f/yikuaborder-deploy/node_modules
```

**这些工作树的 `node_modules` 不是副本，是指向主目录 `node_modules` 的符号链接。** 也就是说：

- 任何**会跟随符号链接**的删除方式（某些 `rm -rf` 变体、`rd /s`、部分 CP 工具、`rsync --delete`）
  在这 7 个目录上执行，删掉的会是**主目录的依赖**，而 `:3000` 一重启就会因为缺包起不来。
- 这次没有出事，原因是 `git worktree remove` 只删链接本身不跟随；清理残留时我用的是
  `find -maxdepth 1 -type l -delete` + `rmdir`，只摘链接。事后体检主目录 `node_modules`：
  `express` / `multer` / `playwright-core` 都在，629 个文件。

**结论：以后清理工作树，只能用 `git worktree remove`，不许用任何递归删除命令。** 这条已写进红线。

### 4.2 保留的 9 个及去向

| # | 工作树 | 未提交 | 去向 |
|---|---|---:|---|
| 1 | `C:/Users/User/WorkBuddy/Worktrees/.../master-9d64c319` | 4 | 外部工具目录，不归本项目管，**不动** |
| 2 | `.worktrees/ceo-g0-g1-20261105` | 65 | 待处置：先看这 65 个是什么 |
| 3 | `.worktrees/ceo-g2a-20261105` | 20 | 待处置 |
| 4 | `.worktrees/ceo-g2b1-20261105` | 30 | 待处置 |
| 5 | `.worktrees/ceo-read-brief` | 7 | 待处置 |
| 6 | `.worktrees/ceo-ui-security-20261106` | 36 | 待处置（与 #4 同 sha，疑似重复检出） |
| 7 | `.worktrees/phase2-product-workbench` | 27 | 待处置 |
| 8 | `F:/yikuaborder-phase2d-b2-b3-e6-wt` | 7 | 待处置 |
| 9 | `F:/yikuaborder-run` | 1 | master 检出，待确认是否还要留着跑 |

共 **197 条未提交**，第二批处理；每个只有三种去向（提交 / 确认丢弃 / 打 patch 存档后删）。

## 5. 第二批：剩下 8 个工作树的 197 条改动已定性

只读扫描，**没有改动任何一个**。结论比预想的重要：这里面藏着一份**未完成的、已暂存的回退**，
以及一份**只此一份的生产启动器**。

| 工作树 | 未提交构成 | 性质 | 建议 |
|---|---|---|---|
| `ceo-g0-g1-20261105` | 60 新增（config 1 / dist 52 / public 1 / schemas 2 / scripts 4）+ 5 改动 | 一整套功能未提交 | 提交到分支或打 patch 存档 |
| `ceo-g2a-20261105` | 13 新增 + 6 改动（含 schemas 3 改动） | 同上 | 同上 |
| `ceo-g2b1-20261105` | 24 未跟踪（dist 19 / config 1 / docs 3 / integrations 1）+ 5 改动 | 同上 | 同上 |
| `ceo-ui-security-20261106` | 31 未跟踪（dist 25 / config 2 / docs 3 / integrations 1）+ 5 改动 | 与上一行**同 sha `c403c86`**，内容高度重叠 → 疑似 g2b1 的副本+额外文件 | 先比对两者再决定，别当两份活 |
| `ceo-read-brief` | 7 个 `.test-*` 目录（每个 92~207 个 `hidden-data-loop-*` 临时目录，合计 7MB） | **纯测试残留，没有任何工作内容** | **可直接删** |
| **`phase2-product-workbench`** | 27 条**全部已在暂存区**：删 `listing-worker-{child,host,ipc}.js` 3 个、改 8 个 dist、删 12 份 `docs/phase2b-prelive-audit/` 文档、删 2 个 `scripts/verify-phase2b-*`、并从 `.gitignore` 移除 4 条 `!/scripts/verify-*` 白名单 | **这是一次针对 phase2b「worker 进程隔离（WS-CRIT-1）」的回退，做了一半没提交** | **停下来问你**：有意回退还是误操作？被删文件在 `HEAD` 里都还在（已逐个验证），一条 `git restore --staged .` 就能退 |
| `yikuaborder-phase2d-b2-b3-e6-wt` | 未跟踪：`dist/src/notebooklm-cdp-session.js` + 4 个 `scripts/e6-*.mjs`；改 2 个 | E6 实验代码 | 打 patch 存档 |
| `yikuaborder-run` | 未跟踪：**`启动一跨.bat`** | **生产一键启动器，未入版本库，全盘只此一份** | **立刻保下来**（已拷到备份目录，sha256 `64f037b7…`） |

### 5.1 两个必须单独说的

**① `phase2-product-workbench` 里那份回退，方向是把 WS-CRIT-1 拆掉。**
WS-CRIT-1（独立 Worker 进程隔离）是根治「跨产品污染」的 P0 修复。现在这个工作树里，
`listing-worker-child.js` / `-host.js` / `-ipc.js` 三个文件被删、`listing-worker.js` 被改回单体，
连 12 份审计文档和 2 个校验脚本也一起删了——这不是随手改的，是一次**成体系的回退**。
它停在暂存区、没有提交，所以既没生效也没丢。**要不要退、为什么退，我判断不了，需要你说。**

**② `启动一跨.bat` 只存在于一个工作树里，而且没进 git。**
这个文件的内容是「先 `taskkill` 掉占 3000 的进程，再调 `start-windows-run.bat` 从 `F:/yikuaborder-run`
加载锁定版本代码启动」。也就是说它是**生产的第二套启动路径**（见 A2 文档 §12）。
它现在只躺在一个未跟踪的工作树文件里——如果第二批按「确认丢弃」处理这个工作树，它就没了。
我已把它复制到 `F:/yikuaborder-backups/2026-11-10_a3-worktrees/`，但**正确的做法是让它进版本库**。

### 5.2 建议的处置顺序

1. **`启动一跨.bat` 先入版本库**（或至少确认备份可用）——这是唯一不可再生的东西。
2. `ceo-read-brief` 的 7 个 `.test-*` 直接删（无工作内容），删完这个工作树就干净了。
3. `phase2-product-workbench` 等你判断回退意图，再决定「提交成分支」还是「`git restore --staged .` 撤销」。
4. 4 个 `ceo-*` 工作树 + `b2-b3-e6`：打 patch 存到备份目录，然后删工作树（patch 比工作树省事且可重放）。
5. 全部处理完，工作树应降到 2～3 个（外部目录 + `yikuaborder-run`）。

## 6. 第二批执行结果（2026-11-10 15:00，Lance 三项裁决后）

### ① 「有意回退」→ 落成提交，而不是留在暂存区

```
fe3ec16  revert(phase2b): 有意撤销 WS-CRIT-1 独立 Worker 进程隔离
         (新分支 revert/ws-crit-1-20261110，父提交 f16d9fd)
```

27 文件、+117 / **−5148** 行。刻意做了两件事：

- **新建分支而不是在原分支上提交**：`feature/ykb-v1-phase2b-listing-executor` 仍停在 `f16d9fd`，
  历史没被改写，回退是一个「可取舍的提交」而不是既成事实。
- **提交信息里写明审计文档与校验脚本是随实现一起移除的，不是丢失**，并注明原实现在 `f16d9fd`
  及其祖先里可恢复。否则半年后有人看到 `docs/phase2b-prelive-audit/` 整目录消失，会当成事故。

### ② 「进版本库」→ 已提交

```
40a46a3  feat(ops): 补入一键启动入口 启动一跨.bat   (master, yikuaborder-run)
```

工作树随之变干净（`status` 0 条），这个文件不再是「只此一份的裸文件」。

### ③ 「打 patch 存档后删」→ 5 个全部完成

| 工作树 | 未提交条目 | patch 里文件数 | 插入行 | 大小 |
|---|---:|---:|---:|---:|
| `ceo-g0-g1-20261105` | 65 | 195 | 164,514 | 12.9 MB |
| `ceo-g2a-20261105` | 20 | 169 | 55,470 | 4.0 MB |
| `ceo-g2b1-20261105` | 30 | 155 | 16,124 | 1.3 MB |
| `ceo-ui-security-20261106` | 36 | 39 | 1,982 | 212 KB |
| `yikuaborder-phase2d-b2-b3-e6-wt` | 7 | 7 | 517 | 26 KB |
| **合计** | **158** | **565** | **238,607** | **19 MB** |

两个细节值得记：

- **patch 里的文件数普遍远多于 `status` 条目数**（65 → 195）。原因是 `git status` 会把整个未跟踪
  目录折叠成一行，而 `add -A` 会展开成逐个文件。所以「按 status 条目数判断有没有漏」是会漏的。
- 五个 patch 全部用 `git apply --stat` 验证过结构可解析（不是零字节、不是半截文件）才执行删除。
  恢复方式：`git apply --binary <patch>`（须在该工作树的 `base` 提交上）。

### ④ 结果：20 → 4

| 剩余工作树 | 状态 |
|---|---|
| `C:/Users/User/WorkBuddy/Worktrees/.../master-9d64c319` | 外部工具目录，不动 |
| `F:/yikuaborder-deploy/.worktrees/ceo-read-brief` | 7 个 `.test-*` 测试残留（7MB）还在，**等你一句即可清** |
| `F:/yikuaborder-deploy/.worktrees/phase2-product-workbench` | 已在 `revert/ws-crit-1-20261110`、工作树干净；**回退内容已落库，这个检出要不要留**等你一句 |
| `F:/yikuaborder-run` | 生产第二套启动入口，留着 |

### ⑤ 一个清不掉的空壳（不影响任何东西）

`ceo-g2b1-20261105` 的文件已删净（文件数 0）、git 也已注销该工作树，但目录本身删不掉：
`文件"…ceo-g2b1-20261105"正由另一进程使用`。是某个 node 进程或索引器持着句柄。**目录是空的、
git 已不认识它**，不影响任何行为；等句柄释放后再 `rmdir` 一次即可。
