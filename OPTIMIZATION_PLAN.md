# 一跨而境工作台 · 仓库结构优化方案

> 基线快照：`git tag v1.0.0-baseline`（优化前 118 个跟踪文件，可随时 `git checkout` 回滚）
> 状态：✅ 已完成（本回合基于真实 git 树重新校准后执行）

---

## 0. 关键校准结论（与最初设想不同）

最初方案曾怀疑根目录 7 个 JSON 是「冗余配置」、并假设存在 `src/`、`scripts/`、
`requirements.txt` 等。经核对 **git 实际跟踪的 118 个文件** 后修正：

- 根目录 JSON（`operators` / `store-profiles` / `listing-cards` / `listing-sku-mappings`
  / `operation-profiles` / `operation-actions` / `operation-rules`）**是服务端运行态业务数据，
  由 `dist/src/config.js` 加载、运行时读写，并非可合并的冗余配置 → 保留，仅在 README 文档化。**
- 仓库**无 `src/`、无 `tsconfig.json`、无 `requirements.txt`**，直接提交编译后的 `dist/` 作为源码。
- 真正的「死代码/噪音」集中在：个人调试脚本 + `package.json` 中指向不存在路径的失效脚本。

---

## 1. 清理死代码 / 调试脚本  ✅

| 文件 | 判定 | 动作 |
|------|------|------|
| `_test_env.js` | 仅 `console.log` 打印 config，无任何引用 | `git rm` |
| `_run_lance.ps1` | 硬编码 `F:\yikuaborder-deploy` 路径的个人启动脚本，与 `start-lance.bat` 功能重复 | `git rm` |

> 浏览器画像（`.chrome-profile/`）、用户数据（`users/`、`data/`、`当前产品/`…）已被 `.gitignore`
> 排除，本就不入库，无需处理。

## 2. 配置文件整理  ✅

- 根 JSON 业务数据：保留，在 `README.md` 中明确「运行态业务数据，请勿手动删除」。
- `package.json` 脚本修正（见下）。

## 3. package.json 失效脚本修正  ✅

移除指向不存在资源的脚本：

- `dev` → `tsx watch src/server.ts`（无 `src/`，必失败）
- `build` → `tsc`（无 `tsconfig`，必失败）
- `local:install` → `sh scripts/install-launch-agent.sh`（无 `scripts/`）
- `local:start` / `local:stop` → macOS `launchctl gui/501`（非 Windows 部署目标）

保留并修正：

- `start` → `node dist/src/server.js`
- `start:test` → `PORT=3101 node dist/src/server.js`
- `test` → `node --test dist/test/*.test.js`（原先 `npm run build && …` 因 build 失败而整体失败）

## 4. 依赖管理复核  ✅（无需改动）

- `package.json` 是**唯一**依赖清单（无 `requirements.txt` / `yarn.lock` / `pnpm-lock.yaml`）。
- 运行时依赖全部被 `dist/src` 实际引用：`express` `multer` `ajv-formats` `jsonrepair`
  `playwright-core` `xlsx`（`ajv` 经 `ajv-formats` 间接使用）。
- `devDependencies`（`typescript` `tsx` `@types/*`）当前为「孤儿」——无 `src/` 可编译。
  **决策：保留不动**，避免破坏 `package-lock.json` 与部署；仅作为后续建议（恢复 `src/` 后启用，
  或同步 lock 后移除）。

## 5. .gitignore 与根 README  ✅

- `.gitignore` 已覆盖：依赖 / 用户数据 / 运行态 / 日志 / 浏览器画像 / 敏感目录 / 旧备份 —— 良好，沿用。
- 新增 `README.md`：目录结构、运行方式、根 JSON 业务数据说明、依赖与忽略规则。

## 6. 最终交付  ✅

- `OPTIMIZATION_REPORT.md`：变更清单、前后文件统计、后续建议。
