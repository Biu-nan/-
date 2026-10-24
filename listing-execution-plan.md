# 一跨而境 · Listing 完整执行方案（v1）

> 生成时间：2026-08-15
> 适用范围：店小秘 Choice 半托管上品 · 跨境电商（乳贴 / 箱包内胆 / 包挂 / 折叠箱包 / 通用品）
> 基础：基于 `F:\yikuaborder-deploy` 当前代码真实状态（双引擎并行）

---

## 0. 一句话结论

我们做 Listing 现在有**两套引擎**，按"单品还是批量、要不要 AI 生图"选型：

| 场景 | 用哪个 | 入口 |
|---|---|---|
| **单品上架**（对话驱动、出草稿或上架） | 新 `listing-agent` 引擎 | `listing-agent/cli.mjs`（port 3200，或复用工作台 3000） |
| **批量上架**（一批产品 xlsx） | 旧工作台 queue 流水线（`yikuaborder-listing-ops`） | `node dist/src/server.js`（port 3000） |
| **需要 AI 重新生成主图/白底图** | 两台都支持 `--mode full` | 同上 |
| **奢侈包内胆 insert** | 旧工作台 `luxury_insert` 流水线 | port 3000 |

> 当前活动品（`run-state.json`）是「肥皂香皂压捏捏乐」——ERP 类目误填为「箱包配件」，引擎已纠偏为玩具（应走 `generic`）。**这是一个反复踩的坑，见 §2。**

---

## 1. 前置环境（每次上架前必查）

| 项 | 要求 | 检查命令 |
|---|---|---|
| 本地 Chrome（已登录） | CDP 端口 `:9223` 开启，且已登录 ChatGPT + 店小秘 | 浏览器启动参数带 `--remote-debugging-port=9223` |
| 引擎探活 | 返回 200/501 即可用 | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/listing/status/probe` |
| 工作台进程 | 未起则起 | `node dist/src/server.js`（默认 127.0.0.1:3000） |
| 独立引擎进程 | 需要隔离时起 | `AGENT_PORT=3200 node listing-agent/src/server.js` |

> ⚠️ **必须在 `F:\yikuaborder-deploy` 根目录执行 `cli.mjs`**（引擎按 `process.cwd()` 解析 schema 与 `当前产品/`）。进 `listing-agent/` 子目录跑会因 cwd 错位报 `ENOENT`。

---

## 2. 类目 profileKey 映射（防错核心）

Lance 三大已知产品线请**显式指定**，绝不依赖 `auto`：

| profileKey | 含义 | 套用规范 |
|---|---|---|
| `ruTie` | 乳贴（nipple） | 套《乳贴必填字段规范 v1》 |
| `xiangBao` | 箱包内胆 / 收纳 insert | 内胆规范 |
| `bagCharm` | 包挂 / 钥匙扣 | 包挂规范 |
| `xiangBaoFold` | 折叠箱包 | 折叠规范 |
| `generic` | **其他任何品类**（3C、家居、玩具、工具…） | 只走通用 product-fact schema |

**铁律**：
1. 引擎 `auto` 现在对未命中已知三系的产品回落 `generic`，**不再静默误判成 ruTie**。
2. 凡用户 ERP 类目与图片事实冲突（如肥皂捏捏乐被填成箱包配件），**以图片事实为准**，强制 `generic`。
3. `generic` 不套用乳贴必填规范（尺寸/海关监管属性/计件单位等不会误报缺项）。

---

## 3. 单品上架标准流程（推荐主流程 · listing-agent）

节奏：**先 validate 体检 → 再 preview 出草稿 → 最后 run 上架**（小步快跑、人工闸门在最后）。

### Phase 1 · validate（无需 Chrome，秒级）
```bash
cd /f/yikuaborder-deploy
node listing-agent/cli.mjs validate \
  --images "F:/绝对路径/Image_01.png" --profile generic
```
- 看三件事：**①识别出的类目对不对** ②`missing` 缺哪些字段 ③`qualityScore`。
- 类目认错 → 改 `--profile` 重跑；缺字段 → 补图或准备 `--override`。

### Phase 2 · preview（需 Chrome，出草稿文案）
```bash
node listing-agent/cli.mjs preview \
  --images "F:/绝对路径/Image_01.png" --profile generic \
  --name "产品包名"
```
- 默认 `listing-only` **不生图**（只出标题/详情/属性，更快更稳），源图自动归档进 `当前产品/<包名>/images/`。
- 要 AI 重生成主图 → 加 `--mode full`（6 张，8–22 分钟，必须 Chrome 在线，有人机验证/限流风险）。
- 产物落盘：`当前产品/<包名>/product-facts.json` + `product-meta.json` + `images/`。
- **回报落盘路径给用户核对**（`savedFiles`）。

### Phase 3 · run --publish（需 Chrome + 已登录店小秘，二次确认后执行）
```bash
node listing-agent/cli.mjs run \
  --images "F:/绝对路径/Image_01.png" --profile generic \
  --publish true --target-store "smtChoice:店铺A"
```
- `--publish true` 是**后果性操作，执行前务必二次确认**。
- `targetStore` 形如 `"smtChoice:店铺A"`，未给则先问，不默认硬上。

### 常用开关速查
| 开关 | 作用 |
|---|---|
| `--mode full` | 调网页版 ChatGPT 生图（默认 listing-only 不生图） |
| `--name <包名>` | 指定产品包目录名（默认 品牌+标题+日期） |
| `--no-save` | 关闭自动落盘（默认开） |
| `--generate-content false` | 跳过 AI 生成（仅校验/归一化，无需 Chrome） |
| `--override 字段=值` | 人工补字段，如 `--override unit=件 --override hsCode=3` |
| `--overrides-json '{...}'` | 批量覆盖 |
| `--image-out-dir <dir>` | full 模式生图归档目录 |
| `--json` | 打印完整 JSON（调试） |

---

## 4. 乳贴店小秘上架专项（已知缺口 + 修复路线）

来源《乳贴必填字段规范 v1》。引用模式 + 9 必填，数据源决策：引用带入 / 固定常量 / facts 覆盖 / 人工默认。

**当前进度（待修）：**
| Step | 任务 | 状态 | 归属 |
|---|---|---|---|
| Step 2（#25） | 修复主图上传链路：上传成功把文件名写回 `product-facts.json.images.main[]` | 🔴 未修（A5 必填但 facts.images.main=[]） | `uploadProductImages` |
| Step 3（#26） | 扩展 `fillFromFacts`：B 区 11 个类目属性 + 型号 + 计件单位按 facts/默认覆盖 | 🔴 未修（①信息不全/⑤属性不全根因） | `fillFromFacts` |
| Step 4（#27） | 调研 SKU 组合表 DOM，从 `facts.variants.skus[]` 填价格/库存/SKU编码 | 🔴 未修（④无变种 SKU 根因） | 生成 SKU 流程 |
| 品牌 | 乳贴品类无独立 brand 输入框，落不了自定义值（如 RUTIE） | ⚪ 已知边界 | 待确认店小秘后台入口 |

**已填好的：** 店铺名称(洛慈全托管) / 备货类型(国内履约) / 产品分类 / 产品属性模板(ccbodily) / 材质（但当前 facts 材质为"金属链条"需改）。

> 引用模式上品时：产品分类、属性模板、品牌骨架**引用带入、不覆盖**；店铺/备货类型用固定常量；标题/描述/材质/型号/图片/SKU 从 facts 覆盖。

---

## 5. 批量上架流程（旧工作台 queue）

适合"一批产品"场景（非单品对话）：
1. 准备 xlsx（每行一个产品，含图 URL/本地图）。
2. `POST /api/queue/import` → 每行变任务并下载图到 `tasks/<id>/产品图`。
3. `POST /api/queue/start` → `runLoop` 逐任务：`loadTask` 拷图入当前产品 → `automation.runAll()` → `archiveCurrentProduct` + 建档 → 取下一个，直到 `completed`。
4. 当前 `商品队列/queue-state.json` 状态为空（`tasks: []`），可直接导入新批次。

> 单品诉求请用 §3 的 `listing-agent`，不要走批量。

---

## 6. 推荐运营节奏

**晨间（出草稿）：**
- 把当日待上架图按品类分好，`validate` 批量体检 → 核对类目与 `missing`。
- 类目 OK 的进 `preview` 出草稿，落盘 `当前产品/<包名>/` 供你核对。

**上架闸门（后果性）：**
- `run --publish true` 前，我必须二次确认「目标店铺 + 类目 + 草稿已看」。
- 乳贴类上架前额外确认 Step 2–4 是否已修复，否则主图/SKU 会缺。

**晚间复盘（运营中台）：**
- 看 `operation-*` 性能快照（CTR/CVR/ROI/退款率规则建议），把待办写入 `daily-waiting-items.json`。

---

## 7. 风险清单

| 风险 | 说明 | 应对 |
|---|---|---|
| 类目误判 | ERP 类目≠图片事实（肥皂捏捏乐案例） | 显式 `--profile`，冲突以图片为准 |
| Chrome 断连 | CDP :9223 掉线即 PAUSED | 上架前探活，保持登录态 |
| 人机验证/限流 | `--mode full` 生图高风险 | 默认 listing-only；生图分批 |
| 品牌边界 | 乳贴无独立 brand 框 | 记录待确认，不强行填 |
| 主图/SKU 缺失 | 乳贴 Step 2/4 未修 | 上架前确认修复状态 |
| 引用带入旧值 | 引用源产品的标题/型号未覆盖 | `fillFromFacts` 扩展后覆盖 |

---

## 8. 下一步优先级（待办）

- **P0**：修乳贴 Step 2（主图写回）、Step 3（B 区属性覆盖）、Step 4（SKU 组合表）。
- **P1**：类目识别纠偏已落地（`generic` 回落），补一条"ERP 类目 vs 图片事实冲突"的强提示。
- **P2**：运营中台规则引擎自动化（CTR<1%、ROI<1 触发建议动作）、多店铺 Listing 下发。
- **P3**：P0 协议（当前仅静态夹具）、飞书双向（当前仅收命令）扩展为可下发。

---

## 附：最小可执行起点（你现在就能跑）

```bash
# 1) 确认引擎活
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/listing/status/probe

# 2) 拿一张产品图做体检（先不出内容）
cd /f/yikuaborder-deploy
node listing-agent/cli.mjs validate --images "F:/路径/图.png" --profile generic

# 3) 类目对 → 出草稿
node listing-agent/cli.mjs preview --images "F:/路径/图.png" --profile generic --name "测试品"

# 4) 你看过草稿后，再决定要不要 run --publish
```
