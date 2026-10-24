# 纳物侧库存采集（P1）

每天从速卖通全托管后台（"纳物"店铺）导出**品仓维度实时库存明细**，落盘到 `F:\yikuaborder-deploy\纳物采购最新数据\`。

## 快速开始

```bash
cd F:\yikuaborder-deploy\nawu-fetch
set NODE_PATH=F:\yikuaborder-deploy\node_modules
node nawu-daily-fetch.cjs                          # 全量（自动筛出名字含「纳物」的店铺）
node nawu-daily-fetch.cjs --store 416488           # 只跑指定店铺
node nawu-daily-fetch.cjs --store 400370,416488    # 只跑这两家
```

### 调试开关

| 参数 | 作用 |
|---|---|
| `--probe` | 只打开门户/库存页并 dump 元信息，**不导出、不落盘** |
| `--probe-export` | 只走到导出提交并点消息中心下载，**不落盘** |
| `--keep-open` | 跑完不关闭店铺浏览器实例（调试用） |
| `--fallback-dom` | 导出失败时降级为按页抓 DOM（仅品维度，无分仓拆分） |

## 它做了什么

```
稳卖本地 API(localhost:3980)
  ├─ POST /queryEnv  取店铺清单 → 筛出纳物店铺
  └─ POST /openEnv   启动店铺 → 返回 CDP 端口
       └─ playwright-core connectOverCDP
            ├─ 登录态探针：访问 csp.aliexpress.com，未登录则用稳卖预填凭据点「登录」
            ├─ 打开 dchain-web …/inventory_distribution_details_management
            ├─ 切到「实时库存明细」标签
            ├─ 点「导出数据」→ 选「品仓维度 → 所有数据」（提交异步导出任务）
            ├─ 到消息中心点最新一条「导出 实时库存数据」的「下载文件」
            ├─ 解析 xlsx（50 列）
            └─ POST /closeEnv 关闭店铺
```

## 产物

目录：`F:\yikuaborder-deploy\纳物采购最新数据\`

| 文件 | 内容 |
|---|---|
| `nawu-1店-inventory-latest.{json,csv,xlsx}` | **纳物-箱包全托1店（400370）** 单独一套，以「几店」命名 |
| `nawu-2店-inventory-latest.{json,csv,xlsx}` | **纳物-箱包全托2店（416488）** 单独一套 |
| `nawu-inventory-latest.{json,csv,xlsx}` | 全店**合并汇总**（含 `店铺` 列），便于总览 |
| `fetch-meta.json` | 采集时间、各店行数、成功/失败、耗时、`alerts[]` |
| `logs/fetch-YYYYMMDD.log` | 运行日志（含菜单项 dump、失败截图） |
| `_raw/` | 浏览器下载的原始导出文件，留档 |

> **命名规则**：每家店从店名提取「几店」（正则 `/(\d+)\s*店/`，如「纳物-箱包全托1店」→ `nawu-1店`），分店各落一套 `json/csv/xlsx`，表格文件名即可区分店号；另保留一套全店合并文件。

**核心列（品仓维度）**：货品ID / 货品编码 / 货品名称 / 关联商品ID / 关联SKUID /
仓类型 / 仓Code / **仓名称** / 区域 / 货品经营状态 / 备货模式 / 周转天数 /
总库存件数 / 在仓总库存件数 / 在仓良品可售库存件数 / 在仓不可售库存件数 /
已收货待上架件数 / 残品库存件数 / 总占用库存件数（销售·调拨·退仓·报废·盘点·货权转移）/
在途总库存件数（总补货在途 / 已下单待确认 / 已确认待发货 / 已发货待到货 / 销售在途 / 调拨在途 / 销售退货在途）/
昨日·近7天·近14天·近30天销售出库件数 / 可退仓件数

## 不破坏旧数据的保证

- 先写 `.tmp` 再原子替换正式文件
- **所有店铺都失败时直接退出，不覆盖旧数据**（仅更新 `fetch-meta.json` 记录失败原因）
- 单店失败不影响其它店；失败会存页面截图到 `logs/`

## 已知坑（都已在代码里处理）

1. **本机 `http_proxy` 会劫持 localhost 请求** → 入口文件在任何网络库加载前就清掉代理环境变量。
2. **稳卖壳版本比官方文档旧**：只有 `/queryEnv` `/openEnv` `/closeEnv` `/deleteEnv` 可用；`/queryEnvV2` 等新版接口在本机全部 404。改版时先跑自检看日志里的 `稳卖 API 自检`。
3. **`openEnv` 返回的 `selenium` 字段其实是原生 CDP 端口**，不是 WebDriver（`/status` 404 属正常）。
4. **新拉起的浏览器 CDP 端口未必立刻就绪** → `connectStore` 做指数退避重试（最多 12 次）。
5. **channelId 是店铺级参数**：`pageUrl` 里写死别家的 channelId 会被 DChain 踢回独立登录墙。现在用 `channelIdMap` 显式配置 + 从门户落地 URL 自动解析兜底（见 config.json）。
6. **DChain SSO 必须经 csp SPA 路由预热**：直接深链 `dchain-web` 没有 partner SSO 上下文，会停在独立 Sign in 页。修复：先走 `portalInventoryUrl`（csp 路由，内嵌 iframe 会 `basic_login_proxy?autoLoginFast=true` 自动登录），等 iframe src 变成真实库存页后再深链 `dchain-web` 跑导出。新店首次采集必经此路径；老店（浏览器已攒下 DChain SSO cookie）直接深链也能通，但统一走预热更稳。
7. **导出不是弹窗，是 Fusion 下拉菜单**，且是**异步任务** —— 选完菜单项只是提交，产物要去消息中心点「下载文件」。
8. **登录页凭据由稳卖预填**，脚本直接点「登录」；出现验证码/滑块一律中止，不绕过。

## 店小秘侧（P2）— 三类清单采集

店小秘不走稳卖 API，而是驱动**你本地已登录的 Chrome（CDP `:9223`）**。三类清单都是 vxe-table（Vue 网格），走 **DOM 抓取全页累计**（原生「导入/导出」是异步任务中心，盲驱动不稳，故用确定性更高的 DOM 解析）。

统一入口 `dxm-fetch.cjs`，用 `--target` 切换三类清单：

```bash
cd F:\yikuaborder-deploy\nawu-fetch
set NODE_PATH=F:\yikuaborder-deploy\node_modules
node dxm-fetch.cjs --target warehouseProduct   # 仓库清单（1796 条）
node dxm-fetch.cjs --target product            # 商品管理（1796 条）
node dxm-fetch.cjs --target entryExit          # 自营仓库出入记录（最近 35 个完整自然日窗口，~5.8k 条）
node dxm-fetch.cjs --target product --probe    # 只抓第 1 页看样例，不落盘
node dxm-fetch.cjs --target entryExit --pages 3 # 只跑前 3 页（调试：跳过窗口采集，按页面原样分页）
```

> ⚠ **出入记录必须走窗口采集**：店小秘出入记录页面「时间」筛选**默认只约 7 天**，直读默认视图只能拿到 ~1070 条（10月5日–10月12日），无法支撑采购侧必需的 **30 日 P95 窗口**，会触发 G2「数据时效与覆盖」门禁 fail-closed 阻塞（2026-10-12 实际发生）。`--target entryExit` 现自动执行：切「时间=全部」→ 倒序早停 → 截断到最近 35 个完整自然日（覆盖所需 30 日）。逻辑单一真相源在 `lib/dxm-c6r.cjs` 的 `collectEntryExitWindow()`，C6R `task05` 亦复用同一函数。

> 旧入口 `dxm-daily-fetch.cjs` 仅覆盖 warehouseProduct，已被 `dxm-fetch.cjs --target warehouseProduct` 取代，仍可运行。

落盘文件（在 `纳物采购最新数据/` 下，与纳物侧区分前缀）：

| target | 文件前缀 | 行数 | 列数 |
|---|---|---|---|
| `warehouseProduct` | `dxm-warehouseProduct-latest.{json,csv,xlsx}` | 1796 | 16 |
| `product` | `dxm-product-latest.{json,csv,xlsx}` | 1796 | 11 |
| `entryExit` | `dxm-entryexit-latest.{json,csv,xlsx}` | ~5.8k（35 天窗口） | 15 |

列说明：

- **仓库清单（16 列）**：`来源 / 商品SKU / 商品名称 / 商品编码 / 分类 / 仓库位置 / 货架位 / 安全库存 / 在途 / 未发 / 占用 / 可用 / 总量 / 单价CNY / 总价CNY / 时间`。其中「安全/在途/未发/占用/可用/总量」是页面「库存情况」列的 6 个子值，按序拆出。
- **商品管理（11 列）**：`来源 / 商品SKU / 商品名称 / 商品编码 / 分类 / 参考价CNY / 重量g / 尺寸cm / 状态 / 创建时间 / 更新时间`。`商品信息` 列拆成 SKU（`<a>` 文本）、名称（首个非 `[..]` 的 `<p>`）、编码/分类（从 `[编码] [分类]` 解析）。**注意：约 667/1796 行在店小秘里本身就没有商品名称（`title=""`），导出如实留空，不臆造**。
- **出入记录（15 列）**：`时间 / 商品信息 / 原库存 / 变动 / 新库存 / 仓库 / 操作人 / 货架位 / 区域 / 原单价CNY / 入库价CNY / 新单价CNY / 类型 / 流水号 / 来源单号`。**结构特殊**：每条记录 = 主行（`col_10`~`col_22`，13 格，其中 col_10/11/12 带 `rowspan=2`）+ 紧跟的明细行（只有 1 格，含「附加信息：流水号:XX 来源单号:PO… 查看更多」）。解析时只取主行，并把明细行的 `流水号 / 来源单号` 挂回上一条主记录；`货架位/区域` 从「无货架位 拣货区」这类文本拆出。**只输出落在窗口内的行**（最近 35 个完整自然日）。

店小秘侧已知坑：

1. **店小秘用 vxe-table 虚拟网格**，行选择器是 `.vxe-body--row`，单元格是 `.vxe-cell`；`tbody tr` 抓不到。
2. **工具栏那个「仓库清单」按钮是 `<a href=本页>` 的导航链接，不是导出**；真正的导出在「导入/导出」主按钮（异步任务中心）。本采集器不依赖它，直接抓表。
3. **`http_proxy` 同样会劫持 localhost**，入口已先清代理。
4. 店小秘若未登录会跳登录页 → 采集器直接报错退出，需先在本地 Chrome 登好店小秘。
5. **出入记录的 `rowspan=2` 行配对** 已在 `extractEntryExitRows` 内处理（主行 + 明细行），翻页按「下一页可用即续」，不依赖每页 100 的假设。
7. **出入记录「时间」筛选默认只约 7 天**（`--target entryExit` 会自动切「全部」再按 35 天窗口截断；若「全部」点不到，回退 antd 自定义日期范围）。早停已做**方向感知**：仅当判定为倒序（新→旧）时，「出现早于窗口起点的记录」才停；升序表改按「越过窗口终点」停（否则会在边界页误停、只拿到 3 天）。
6. **xlsx 被 Excel 占用时会写失败（EPERM）** → `output.cjs` 的原子写入会重试 6 次，仍失败则自动另存为 `<前缀>.locked.xlsx` 并在日志告警。关闭 Excel 里的旧表后重跑对应 `--target` 即可覆盖原文件名。

## 每日发送到 ChatGPT「纳物采购助手」（P3）

每天 11:00 先重跑采集，再把最新表格作为附件发送到 ChatGPT 项目「纳物-速卖通」下的对话，让其生成当天采购表格。

```bash
cd F:\yikuaborder-deploy\nawu-fetch
node awu-send-to-chatgpt.cjs               # 全流程：采集 → 上传 → 发送
node awu-send-to-chatgpt.cjs --no-fetch    # 跳过采集，用现有最新文件
node awu-send-to-chatgpt.cjs --probe       # 只打开对话确认登录态
node awu-send-to-chatgpt.cjs --upload-only # 只上传不发送（调试）
node awu-send-to-chatgpt.cjs --new-chat    # 强制在项目内新开一个对话再发（并回写 config）
```

- **目标对话**：`chatgpt-config.json` 的 `conversationUrl`。
- **上传附件**：`nawu-1店 / nawu-2店 / dxm-warehouseProduct / dxm-product / dxm-entryexit` 的 xlsx（每个前缀取最新，`.locked.xlsx` 兜底）。
- **定时**：WorkBuddy 自动化「纳物采购·每日发送到ChatGPT (11:00)」；系统级可选 `F:\yikuaborder-deploy\send-purchase-to-chatgpt.bat`（配任务计划，见下）。
- **前提**：本机 Chrome（CDP 9223）运行中且已登录 ChatGPT / 店小秘。

### 对话打满长度上限后怎么轮换（2026-10-01 新增）

ChatGPT 单个对话有长度上限，满了之后必须换新对话。脚本内置三种轮换方式：

| 方式 | 说明 |
|---|---|
| `newChatMode: "auto"`（默认） | 沿用 `conversationUrl`；命中页面「长度上限」提示时自动在项目内新开对话 |
| `newChatMode: "always"` | 每次运行都在项目内新开一个对话 |
| `rotateOnNextRun: true` | 下一次运行**无条件**新开一个对话，用完自动置回 `false`（已知当前对话已满时的确定性开关） |
| `--new-chat` | 命令行临时强制新开，不改配置 |

新开对话依赖 `projectUrl`（项目页的 composer 就是「新对话」入口）。**发送成功后脚本会把新对话 URL 自动回写到 `chatgpt-config.json` 的 `conversationUrl`**，后续运行即沿用；若取不到 `/c/<id>`（页面没跳转），会告警且不覆写配置，下次运行仍会新开。

> ⚠️ 注意：`isConversationFull` 的文本检测是 best-effort。**超长对话的 DOM 往往只渲染部分消息、读不到底部的横幅**（实测滚到底也抓不到），因此批量轮换请用 `rotateOnNextRun: true` 或 `--new-chat` 这种确定性开关，别只依赖自动检测。


### ChatGPT 侧选择器（2026-09-29 实测，易变，出问题先看这里）
| 元素 | 选择器 |
|---|---|
| 输入框 | `div.ProseMirror[contenteditable="true"]`（**有可见真身 + 0×0 隐藏镜像**，须取可见的）|
| 上传输入 | `form[data-chatgpt-composer] input[type=file]:not([accept])`（通用文档；accept=null 那个）|
| 附件 chip | `[class~="group/composer-attachment"]`（每个附件 1 个）|
| 发送按钮 | `button[aria-label="发送"]`（也有 0×0 隐藏镜像，须取 bbox>0 那个）|
| 已发送附件 | 用户消息内 `button[aria-label$=".xlsx"]`（ChatGPT 会加 `(n)` 去重后缀）|

坑：
1. **输入文本必须触发 React**：CDP `keyboard.insertText` 不触发 input 事件 → 发送按钮一直禁用、Enter 无效。改用 `document.execCommand('insertText')`（本实现已用）。
2. **ChatGPT 跨刷新保留未发送草稿**，但上传的附件不保留；发送前先清空草稿——且必须**先清草稿、再上传附件**（顺序反了会把附件一起清掉）。
3. **成对元素（真身 + 0×0 隐藏镜像）**：composer 与发送按钮都要按 boundingBox/可见性挑真实的那个。
4. 发送成功判据：发送后 composer 残留长度 < 5。

## 目录结构

```
nawu-fetch/
├─ config.json              【纳物侧】配置
├─ dxm-config.json          【店小秘侧】配置（CDP 地址、输出前缀、三类 targets）
├─ nawu-daily-fetch.cjs     【纳物侧】入口 / 编排
├─ dxm-fetch.cjs            【店小秘侧】统一入口（--target warehouseProduct|product|entryExit）
├─ dxm-daily-fetch.cjs      【店小秘侧】旧入口（仅 warehouseProduct，已被取代）
├─ chatgpt-config.json      【发送侧】目标对话 / 提示词 / 待传附件前缀
├─ awu-send-to-chatgpt.cjs  【发送侧】入口：采集 → 上传 → 发送到「纳物采购助手」
├─ lib/
│   ├─ wenmai-api.cjs       稳卖本地 API 客户端（含节流、自检）
│   ├─ nawu-inventory.cjs   【纳物】登录探针 / SSO 预热 / 库存页 / 导出 / 字段映射
│   ├─ dxm-warehouse.cjs    【店小秘】CDP 接入 / 登录检查 / vxe 行解析（仓库清单+商品管理+出入记录）/ 翻页
│   ├─ chatgpt-sender.cjs   【发送】ChatGPT 打开对话 / 清草稿 / 传附件 / 发提示词
│   └─ output.cjs           原子写入 / CSV / XLSX / 日志（两侧共用）
└─ probes/                  本轮逆向用的探针脚本，排障时可复用
```

上级目录另有 `send-purchase-to-chatgpt.bat`（系统任务计划用启动器，纯 ASCII 路径）。

---

# C6R 采购数据升级（2026-10-11）

为 C6R 动态分级采购模型提供 7 项数据。**只读铁律**：仅导航 + 导出 + 读取；不创建采购单、不改库存、不取消订单、不签收到货、不付款。

## 入口

```bash
bash scripts/run-pipeline.sh                  # 原全流程（采集+发送 ChatGPT），不变
node procurement-fetch.cjs                    # 【新增】C6R 七任务采集 + 结构化落盘 + manifest + 门禁
node procurement-fetch.cjs --dry              # 只算时间窗口，不采集
node procurement-fetch.cjs --tasks 05,06,07   # 只跑指定任务
node procurement-fetch.cjs --no-nawu          # 跳过纳物侧（无稳卖时）
node procurement-fetch.cjs --no-dxm           # 跳过店小秘侧（无 CDP 时）
```

## 七项任务与页面路径（2026-10-11 实测）

| # | 任务 | 来源 / 真实路径 | 输出 |
|---|---|---|---|
| 01 | 纳物1店官方仓 | 稳卖 openEnv → dchain-web 实时库存明细（品仓维度） | `nawu-1店-inventory-latest_<stamp>.xlsx` |
| 02 | 纳物2店官方仓 | 同上（channelId 2443536 / 2358891） | `nawu-2店-inventory-latest_<stamp>.xlsx` |
| 03 | 店小秘仓库清单 | `/web/warehouse/warehouseProduct` | `dxm-warehouseProduct-latest_<stamp>.xlsx` |
| 04 | 店小秘商品管理 | `/web/dxmCommodityProduct/index` | `dxm-product-latest_<stamp>.xlsx` |
| 05 | 店小秘出入记录(35天) | `/web/privateWarehouse/entryAndExitRecordList` → 时间=全部 + 倒序早停 | `dxm-entryexit-35d_<stamp>.xlsx` |
| 06 | 店小秘采购订单 | `/web/purchasing/order/*`（waitAudit / waitArrival / draft/manualPurchasing / draft/aliPurchasing / complete / cancel） | `dxm-purchaseOrders-open_<stamp>.xlsx` |
| 07 | SKU/供货商主数据 | `/web/supply/supplier` + `/web/supply/supplyRelation` | `master/nawu-supplier_<stamp>.xlsx`、`master/nawu-supply-relation_<stamp>.xlsx` |

## 时间窗口（Asia/Shanghai，决策日=北京时间当天）

- 数据截止：当天 12:00
- 销量窗口：截至昨天 23:59:59；**ADS = 最近 7 个完整自然日**；**P95 = 最近 30 个完整自然日**
- 出入记录：最近 **35 个完整自然日**（决策日 2026-10-11 → `2026-09-06 00:00:00 ~ 2026-10-10 23:59:59`）

计算见 `lib/timewindow.cjs`（纯函数，可离线自测）。

## 目录规范（历史快照绝不覆盖）

```
纳物采购最新数据/
├─ raw/YYYY-MM-DD/          带时间戳的原始快照（每轮新增，不覆盖）
├─ normalized/YYYY-MM-DD/   清洗/派生结果（另存）
├─ master/                  主数据（供货商/供货关系，按版本）
├─ manifests/YYYY-MM-DD.json 每轮 manifest（含 hash、行数、窗口、门禁）
└─ logs/                    运行日志
```

legacy `*-latest.{json,csv,xlsx}` 仍保留在根目录，供 ChatGPT 上传路径沿用（单一真相，不并行）。

## 质量门禁 C1–C6

| 码 | 名称 | 判据 |
|---|---|---|
| C1 | 文件完整性 | 必采任务均有成功记录 + 有效表头 + 抓取时间 |
| C2 | 数据行完整性 | 分页完成、记录数与页面总数一致、零/负库存保留 |
| C3 | 销量覆盖 | 最近 30 自然日覆盖完整；缺日 → `SALES_WINDOW_INCOMPLETE` |
| C4 | 采购订单核验 | 未结采购单全覆盖、采购单号可追溯、SKU 级未到货明细 |
| C5 | SKU 映射 | 精确优先、别名允许、异常独立成表 |
| C6 | 不执行业务写操作 | 本轮写操作必须为 0 |

已知缺口（记为 WARN，不静默通过）：**C4 的 SKU 级未到货数量**当前只有整单级，
需从采购详情/采购跟单（`/web/purchasingFollow/list`，含缺货量/在途量/待到货）补充。

## 缺口 2–4 优化（2026-10-11 第二轮）

详见 `docs/缺口2-4-优化方案.md`。要点：

- **缺口3（已落地）**：仓库清单 DOM 无「商品类型/商品状态」。现改为
  ①与商品管理按 `商品SKU` **join**（实测 1888/1888 命中）补齐 商品状态/1688配对状态/参考价/重量；
  ②点商品管理**类型页签**（`全部/单品/组合/多变种/加工/有异常`）枚举商品类型。
  新增产出（全部**另存**，原始文件零改动）：
  `raw/<日期>/dxm-product-type_*.xlsx`、`dxm-warehouseProduct-enriched_*.xlsx`、`dxm-warehouse-sku-unmatched_*.xlsx`。
  纪律：类型页签采集失败 → 商品类型记 `UNKNOWN`，**不默认成「单品」**。
- **缺口2（分层）**：①**1688配对状态**已从商品管理「状态」文本派生（`在售 「已配对」`）；
  ②**组合BOM** 走组合行「组合详情」（仅 146 条）；③**首选供应商/来源URL** 需商品详情，
  建议只对采购候选池按需取。实测「导入/导出」菜单**没有字段选择项**，导出拿不到这些列。
- **缺口4（脚手架已交付）**：本地采购主数据（资金层级 A–E / 采购模式 / LT1 / BOM / 新旧SKU映射）。

## 采购主数据（缺口4）

```bash
node scripts/master-import.cjs --init                     # 生成填空模板 master/sku-master.template.{csv,xlsx}
node scripts/master-import.cjs --file master/sku-master.csv --version v1 --by Lance --note "首次录入"
node scripts/master-validate.cjs                          # 只读校验，输出 VERDICT: PASS/FAIL
```

- 版本归档：`master/versions/sku-master.<version>.json`（**不可变**）；`master/sku-master.json` 为当前指针。
- ERROR（层级不在 A–E / 模式不在 STOCK·ORDER·LIGHT_STOCK / LT1 非正整数 / SKU 重复 / BOM 环）→ **拒绝导入**。
- **推断后门 = DISABLED**：不会用历史销量补齐层级/交期/BOM。填写说明见 `docs/采购主数据填写说明.md`。

## 只读复核

```bash
node tests/c6r-core.selftest.cjs    # 时间窗口/门禁/规范化 离线自测（30 项）
node tests/c6r-gap34.selftest.cjs   # 缺口3 属性补齐 + 缺口4 主数据校验 离线自测（30 项）
```


新增页面采集器（采购订单/供货商/供货关系）的列映射基于实测 colid，运行时按表头动态解析，
采购订单为「两行一单」结构（表头行 + 明细行）。

