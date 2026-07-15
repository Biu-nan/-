# 一跨而境工作台 (chatgpt-listing-mvp)

AI 跨境电商「视觉生成 + Listing 自动化」工作台服务端。提供商品识别、视觉规划、
SEO 关键词、Listing 文案生成、奢侈品类插入、运营动作编排等能力，并通过本地 HTTP
服务暴露管理与看板界面。

> **部署形态说明**：本仓库直接提交 `dist/`（已编译的 ESM JS）作为源码，**没有 `src/` 目录**，
> 也没有 `tsconfig.json`。运行时依赖 `node dist/src/server.js`。因此 `npm` 脚本只包含
> `start` / `start:test` / `test`，不提供 `dev` / `build`（避免指向不存在的源码树）。

---

## 目录结构

```
一跨而境工作台/
├── dist/                      # 已编译的 ESM 源码（项目真实源码，入库）
│   ├── src/                   # 服务端实现（server.js 为入口）
│   └── test/                  # 编译后的测试，npm test 直接运行
├── public/                    # 前端静态资源（index.html / app.js / styles.css 等）
├── prompts/                   # 7 个 Prompt 模板（研究/视觉规划/SEO/文案/奢侈插入…）
├── schemas/                   # JSON Schema（product-profile.schema.json）
├── *.json                     # 运行态业务数据（见下）
├── start-windows.bat          # Windows 通用启动（PORT 3000）
├── start-unix.sh              # Unix/Linux/macOS 启动
├── start-lance.bat            # Lance 操作员实例（users/lance, 3001）
├── start-laodu.bat            # 老杜操作员实例（users/laodu, 3002）
├── start-workbench.vbs        # 登录时静默拉起看门狗
├── watchdog.js                # 看门狗：健康检查 + 自动重启
├── package.json               # 唯一依赖清单（无 requirements.txt）
└── .gitignore                 # 已覆盖 node_modules / 用户数据 / 运行态 / 敏感目录
```

---

## 运行方式

| 场景 | 命令 |
|------|------|
| 本地开发/调试（默认 3000） | `start-windows.bat` 或 `npm start` |
| 指定操作员实例 | `start-lance.bat` / `start-laodu.bat` |
| Unix 环境 | `bash start-unix.sh` |
| 开机自启（静默守护） | 登录时执行 `start-workbench.vbs`（拉起 `watchdog.js`） |
| 跑测试 | `npm test`（直接运行 `dist/test/*.test.js`） |

服务默认以 `HOST=0.0.0.0` 绑定，支持局域网多设备访问。多操作员通过 `USER_DATA_DIR`
与 `PORT` 环境变量区分（见各 `start-*.bat`）。

---

## 根目录 JSON 文件 = 运行态业务数据（**请勿手动删除**）

这些文件由服务端在运行时读写，是真实业务状态，**不是可合并的冗余配置**：

| 文件 | 用途 |
|------|------|
| `operators.json` | 操作员档案（lance / anna 等，含角色、颜色） |
| `store-profiles.json` | 店铺档案（平台、Hitoor 环境、角色） |
| `listing-cards.json` | Listing 卡片（商品↔店铺↔SKU 映射） |
| `listing-sku-mappings.json` | Listing 与平台 SKU 的映射关系 |
| `operation-profiles.json` | 商品运营档案（层级、目标、策略、复盘时间） |
| `operation-actions.json` | 运营动作记录（测图、优化等流水） |
| `operation-rules.json` | 自动判定规则与阈值规则 |

生产运行态数据（`users/`、`data/`、`当前产品/`、`商品队列/`、`已完成产品/`、
`已遗弃产品/`、`run-state.json` 等）已被 `.gitignore` 排除，不入库。

---

## 依赖

- 运行时：`express` `multer` `ajv` `ajv-formats` `jsonrepair` `playwright-core` `xlsx`
- `package.json` 是唯一的依赖清单（无 `requirements.txt`、无 `yarn.lock`/`pnpm-lock.yaml`）。
- 注：`typescript` / `tsx` / `@types/*` 仍列于 `devDependencies`，但当前仓库没有 `src/`
  与 `tsconfig`，构建工具链实际处于「孤儿」状态——若后续恢复 `src/` 源码树再启用，
  否则可考虑从清单移除（需同步 `package-lock.json`）。

---

## 忽略规则（.gitignore 要点）

- `node_modules/`：依赖，可 `npm install` 还原
- `users/` `data/` `当前产品/` `商品队列/` `已完成产品/` `已遗弃产品/`：业务数据与生成产物
- `run-state.json` `*.log` `*.out.log` 等：运行态与日志
- `.chrome-profile/` `.workbuddy/`：浏览器画像与敏感/机器相关目录
- `dist.old/`：旧备份
