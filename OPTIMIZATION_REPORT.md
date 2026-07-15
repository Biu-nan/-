# 一跨而境工作台 · 仓库结构优化报告

- **基线**：`git tag v1.0.0-baseline`（优化前 118 个跟踪文件）
- **执行时间**：2026-07-15
- **结论**：在不触碰任何运行态业务数据、不破坏部署的前提下，移除 2 个死代码/调试脚本，
  修正 `package.json` 中 5 个指向不存在资源的失效脚本，新增根 `README.md`。
  跟踪文件 **118 → 116**。

---

## 一、做了什么

### 1. 移除死代码 / 调试脚本（2 个）
| 文件 | 原因 | 引用情况 |
|------|------|----------|
| `_test_env.js` | 仅 `console.log` 打印 config 值，无任何功能 | 全仓零引用 |
| `_run_lance.ps1` | 硬编码 `F:\yikuaborder-deploy` 路径的个人启动脚本，与 `start-lance.bat` 功能重复且不可移植 | 全仓零引用（仅历史分析文档提过） |

通过 `git rm` 从版本控制移除（可从 `v1.0.0-baseline` 随时恢复）。

### 2. 修正 `package.json` 失效脚本
原脚本指向不存在的 `src/`、`scripts/`、`tsconfig`，以及 macOS `launchctl`：

```diff
   "scripts": {
-    "dev": "tsx watch src/server.ts",
-    "build": "tsc",
     "start": "node dist/src/server.js",
     "start:test": "PORT=3101 node dist/src/server.js",
-    "local:install": "sh scripts/install-launch-agent.sh",
-    "local:start": "launchctl kickstart -k gui/501/com.lance.chatgpt-listing-mvp",
-    "local:stop": "launchctl kill SIGTERM gui/501/com.lance.chatgpt-listing-mvp",
-    "test": "npm run build && node --test dist/test/*.test.js"
+    "test": "node --test dist/test/*.test.js"
   },
```

修正后 `npm test` 不再因失败的 `build` 而整体失败，可直接运行已编译的 `dist/test/*.test.js`。

### 3. 新增根 `README.md`
说明目录结构、4 种运行方式（bat / sh / vbs 看门狗 / npm）、以及**根目录 7 个 JSON 是运行态
业务数据（operators / stores / listings / rules）而非冗余配置——请勿手动删除**。

---

## 二、明确「不做」的事项（避免误伤）

- **根目录 JSON 配置**：经核对 `dist/src/config.js`，这些文件由服务端运行时加载读写，是真实
  业务状态。**保留不动**，仅文档化。
- **`dist/` 编译产物**：本仓库以 `dist/` 作为源码提交（无 `src/`），属于项目约定，保留。
- **`.map` 源映射文件（43 个）**：随 `dist/` 提交，保留以维持可调试性（如需瘦身可在后续单独评估）。
- **`users/` `data/` `当前产品/` 等产品目录**：已被 `.gitignore` 排除，本就不入库。
- **`devDependencies`（typescript / tsx / @types）**：当前为「孤儿」（无 `src/` 可编译），
  **保留不动**以免破坏 `package-lock.json` 与部署，仅作后续建议（见下）。

---

## 三、前后对比

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 跟踪文件数 | 118 | 116 |
| `package.json` 可用脚本 | `start` `start:test`（其余 5 个必失败） | `start` `start:test` `test`（全部可用） |
| 死代码脚本 | 2 | 0 |
| 根 README | 无 | 有 |
| 业务数据安全性 | — | 未触碰，文档化说明 |

---

## 四、后续可选建议（未执行，需你确认）

1. **孤儿 dev 工具链**：若确认不再恢复 `src/` 源码树，可从 `package.json` 移除
   `typescript` / `tsx` / `@types/*` 并同步 `package-lock.json`（需 `npm install` 重新生成 lock）。
2. **恢复源码树**：若希望走 `tsx`/`tsc` 开发流程，应补回 `src/` + `tsconfig.json`，再恢复 `dev`/`build` 脚本。
3. **`.map` 瘦身**：如不需要源码级调试，可 `git rm dist/**/*.map` 并加入 `.gitignore`。
4. **启动脚本收敛**：`start-lance.bat` / `start-laodu.bat` 仅 env 不同，可合并为带参的单一脚本，
   降低维护面（涉及生产部署，建议谨慎评估后再做）。

---

## 五、回滚方式

```bash
git checkout v1.0.0-baseline -- .      # 整体回滚到基线
git checkout v1.0.0-baseline -- _run_lance.ps1 _test_env.js   # 仅恢复被删脚本
```
