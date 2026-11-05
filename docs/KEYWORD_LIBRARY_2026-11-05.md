# 关键词库 + 上品埋词接入（交付）

- 日期：2026-11-05
- 目标：把"让模型猜关键词"替换为"从实测词库选词"，作用于标题与 listing 埋词
- 状态：**已实现并通过 19 条离线验收；代码已落盘，需重启服务生效**
- 花费：新增 **60 积分**（箱包 12426 + 内衣 12686 各一次关键词榜），今日累计 428 / 5000

---

## 0. 结论先行

1. **改造前的真实状态**：`mainKeyword` 是 LLM 按 prompt 里写死的示例（`如 Bag Charm`）**编出来的一个字符串**，唯一用途是填"型号/类型"两个属性（`dianxiaomi-adapter.js:3313`）；`listing-engine.js` 里**没有任何关键词逻辑**。等于整条上品链没有一个词有数据来源。
2. **现在有两个可追溯的词源**，且严格分级：
   - **官方词库**（keyword_rank）：有周搜索量、转化率、竞争指数 → 可作**依据**
   - **竞品标题词**（product_rank 标题 n-gram）：只有"多少竞品在用 + 这些竞品的周期销量" → 只作**候选**
3. **选词器是 fail-closed 的**：产品形态在库里找不到强相关词时返回 `NO_KEYWORD_MATCH` 并**不注入任何内容**，宁可让原有 prompt 跑，也不塞一个高分但无关的词（那只是换一种猜法）。
4. **实测效果（用你仓库里真实产品）**：青蛙骨架钥匙扣 → 类目 12426 → 主词 `key chain`（周搜索 17,251｜转化 1.17%｜竞争 0.63）。竞争 0.63 在箱包类目属于极低，转化 1.17% 是全类目最高档。
5. **内胆这条线官方词库没有覆盖**（25900 关键词榜返回 0 条），所以自动降级到竞品标题词，并在 prompt 里**显式声明"没有搜索量数据"**，避免模型把它当需求证据。

---

## 1. 词库现状

`data/keywords/library.json`（官方）＋ `title-keywords.json`（标题）＋ `brand-blocklist.json` ＋ `category-rules.json`

| 类目 | 官方词 | A 主推 | B 流量 | C 红海 | X 品牌(排除) |
|---|---|---|---|---|---|
| 箱包 12426 | 51 | 8 | 15 | 6 | 11 |
| 内衣/家居服 12686 | 46 | 6 | 19 | 1 | 13 |
| 功能腰包 17870 | 40 | 11 | 0 | 0 | 3 |
| **合计** | **131 条 / 90 个唯一词** | 25 | 34 | 7 | 27 |

分层规则（可解释，非黑箱）：
```
score = 100 × (0.35 × 竞争优势 + 0.35 × 转化优势 + 0.30 × 需求规模)
  竞争优势 = 1 − min(竞争指数/45, 1)
  转化优势 = min(转化率/0.008, 1)
  需求规模 = log10(周搜索+1) / log10(200001)
A 主推：转化 ≥ 0.4% 且 竞争 ≤ 12   → 进标题 / 型号
B 流量：搜索 ≥ 2 万 且 竞争 ≤ 20    → 进描述 / 属性
C 红海：竞争 ≥ 25                 → 只监测，且写入"禁止使用"
X 品牌：黑名单命中                → 永不进候选（侵权风险）
```

箱包 A 层实样：`key chain`(1.17%)、`cardholder`(0.85%)、`makeup bag`(0.77%)、`photocard holder`(0.65%)、`ita bag`(0.53%)、`pouch`(0.48%)
内衣 A 层实样：`women's panties`(0.88%)、`leg warmers`(1.38%)、`stockings`(1.39%)、`waist trainers`(0.46%)

> ⚠️ 内衣 A 层里**没有** nipple covers / pasties —— 说明 12686 一级类目的词池覆盖不到乳贴这个细分。乳贴目前只能走"竞品标题词"或后续补抓更细类目。这是已知缺口，不藏。

---

## 2. 选词器（`dist/src/keyword-library.js`）

三段式严格匹配，任一成立才算命中：

| 规则 | 作用 | 防的是什么 |
|---|---|---|
| (a) 整词压平后出现在产品名里 | `key chain` → `keychain` | 拼写合并导致的漏配 |
| (b) ≥2 个有效词重合，且至少 1 个非泛化词 | `organizer bag` 命中内胆 | **`women's bag` 因只重合 `bag`（泛化词）被拒** |
| (c) 单词 ≥5 字符作为子串出现 | `cardholder` | 复合词漏配 |

泛化词表：`bag / bags / women / men / item / gift / set / piece...` —— 只有这些词重合不算命中。这是本次最关键的一条修正：第一版把"Felt Insert Bag Organizer"匹配成了 `women's bag`，只是换了个方式的猜。

---

## 3. 接入点（唯一一处，改动可回滚）

`dist/src/automation-service.js` → SEO 关键词 prompt 拼装处（原 `const seoPrompt`，现 `let seoPrompt`）：

```js
if (process.env.KEYWORD_LIBRARY_INJECT !== "0") {
  try {
    const kw = buildKeywordPromptBlockFromProductFacts(PRODUCT_FACT_FILE);
    if (kw.block) { seoPrompt = `${seoPrompt}\n\n${kw.block}`; ... }
    else { console.log(`[keywords] 未注入：${kw.meta.reason}`); }
    await this.store.update({ keywordLibrary: kw.meta });   // 写进 run-state 可追溯
  } catch (e) { console.warn("[keywords] 注入失败（忽略）：", e.message); }
}
```

- **只改 SEO 一步**：SEO 词 → 标题 → 描述 → 属性，是链式传导，改一处全链生效。
- **失败 fail-open**：注入异常绝不影响上品主流程。
- **内容 fail-closed**：没把握就不注入。
- **回滚**：`KEYWORD_LIBRARY_INJECT=0`（无需改代码）。
- **可追溯**：`run-state.json` 会记 `keywordLibrary: {categoryId, source, primary, reason}`。

### 注入后的 prompt 长这样（官方源）
```
【关键词库·官方实测数据（必须优先采用）】
主关键词：key chain  （周搜索 17,251｜转化 1.17%｜竞争 0.63｜区域 ALL）
规则：标题必须包含主关键词原词（不可改写单复数、不可同义替换）；辅助词只用于描述与属性；下列红海词不得使用。
数据来源：IXSPY 速卖通关键词周榜（真实搜索量/转化/竞争度）。
```

### 降级源（内胆）长这样
```
【竞品标题用词参考（降级来源，仅供措辞参考）】
参考词组：organizer bag  （4 个竞品在用｜这些竞品周期销量合计 224｜3 家店）
注意：本组词没有搜索量、转化率、竞争度数据，只能用于竞品措辞参考，不得据此断言搜索需求。
```

---

## 4. 验收（19 条全绿，0 积分可复跑）

```
node scripts/build-keyword-library.mjs      # 生成官方词库
node scripts/build-title-keywords.mjs       # 生成竞品标题词库
node scripts/suggest-keywords.mjs --self-test   # 选词器 10 条
node scripts/verify-keyword-injection.mjs      # 注入层 9 条
```

关键反向用例（防"换一种猜法"回归）：
| 用例 | 断言 |
|---|---|
| 内胆丢进箱包一级库 | 必须 `matched=false`，不得硬套 |
| 品牌词 zara 在库里 | 必须被拦，不得进候选 |
| `tote bag` / `shoulder bag`（竞争 34–44） | 只能进 avoid，不得进候选 |
| 不可归类产品（水槽滤网） | 空块 + `NO_CATEGORY_RULE` |
| 降级来源块 | 内部不得出现"周搜索"字样（禁止混算） |

---

## 5. 已知限制（诚实清单）

| # | 限制 | 影响 | 下一步 |
|---|---|---|---|
| L1 | 官方关键词只有**一级类目**覆盖（12426 / 12686 有 5,000+ 条；25900 返回 0） | 细分产品（内胆）只能降级 | 补抓二级/叶子类目关键词，或改用 ISXPY 产品搜索框关键词由标题反推 |
| L2 | 词库只有 **3 个类目**、131 条、单周快照 | 覆盖不了全部在售 474 品 | 按 `config/market-scan.json` 扩类目，周更累积 |
| L3 | 乳贴（nipple covers）在 12686 A 层无对应词 | 乳贴线目前仍靠降级词 | 需找到乳贴真实叶子类目 ID 后单独抓 |
| L4 | 类目映射靠 `category-rules.json` 关键词规则（6 条） | 新产品形态可能归不到类 | 归不到就 `NO_CATEGORY_RULE`（安全失败），后续补规则 |
| L5 | 关键词榜比产品榜**晚一周**；日榜有 7 天空洞 | 词库不是"本周数据" | 已在 rank-dates.json 标注；周更即可 |
| L6 | 未做 A/B：还没证明"换成库选词后转化率变好" | 只有"有依据"≠"更有效" | 重启后跑 1 个单品，与历史 listing 对比（见下） |

---

## 6. 生效与验证步骤（需要你确认后执行）

代码已落盘，但 Node 进程仍是旧代码。按项目既定流程：

```bash
# 1. 确认没在跑上品（run-state.stage = READY_FOR_LOGIN 时安全）
curl -s http://127.0.0.1:3000/api/status

# 2. 结束进程，watchdog 15s 内自动拉起
taskkill /PID 18656 /F

# 3. 等 20s 后确认新代码生效
curl -s http://127.0.0.1:3000/api/status
```

验证方法（不改数据）：
1. 用**下一个待上品的新品**跑一次，看 `server.log` 是否出现 `[keywords] 已注入 category=... primary=...`；
2. 查 `run-state.json` 的 `keywordLibrary` 字段；
3. 对比生成的 `03_SEO_KEYWORDS.md` 与历史同款：**主词是否等于库里的 A 层词**、是否包含"必须优先采用"痕迹。

回滚：`KEYWORD_LIBRARY_INJECT=0` 重启即可，无需改代码。

---

## 7. 落地上线前补的两件事（2026-11-05 11:40 追加）

### 7.1 历史 mainKeyword 体检：不是理论风险，是已发生的事实

`node scripts/audit-mainkeyword.mjs`（0 积分、只读）跑 132 个已完成产品的 `product-facts.json`：

| 项 | 数量 | 占比 |
|---|---|---|
| `mainKeyword = "Nipple Covers"` | **89** | 67.4% |
| `mainKeyword` 为空 | 22 | 16.7% |
| 是自己的词 | **21** | 15.9% |
| 可确证错配（有英文标题且标题不含 nipple） | **75** | 56.8% |

典型错配：`3D耗材温湿度收纳袋` → `Nipple Covers`；`世界杯解压足球捏捏乐` → `Nipple Covers`。
这个值会被 `dianxiaomi-adapter.js:3313` 写进店小秘的**型号(Model Number)** 与**类型**字段。

### 7.2 分档注入（避免"用一个粗词换掉一个好词"）

回溯发现：如果一律用库词覆盖，**69/74 个产品都会被统一成 `key chain`** —— 因为 12426 一级词库只有 51 个词、A 层 8 个，粒度不足以区分"钥匙扣/挂件/卡包/包带/链条"。直接替换会把 LLM 更细的正确词（如 `keyboard fidget keychain`）冲掉。

因此改为分档：

| 档 | 判定 | 动作 | 132 品中 |
|---|---|---|---|
| **override** | 历史词为空 / 是 `Nipple Covers` / 与标题零交集 | 库词接管主词，块内写"必须优先采用" | **57** |
| **supplement** | 历史词能在标题/类目里找到词元（自洽） | **保留**历史词，库词只作辅助埋词，块内写"不得覆盖" | **18** |
| 不注入 | 47 个无类目规则 + 9 个无词匹配 + 1 个无标题 | 保持原逻辑 | **57** |

结论：**没有任何一个产品的好词会因此丢失**；被改写的 57 个，改动方向都是"从错的/空的 → 类目实测高频词"。

### 7.3 验收 36 条全绿

```
verify-market-scan.mjs       14 passed
suggest-keywords --self-test 10 passed
verify-keyword-injection.mjs 12 passed   （含 K10-K12 分档用例）
```

### 7.4 仍待补

- 47 个产品 `NO_CATEGORY_RULE`（3D 耗材袋、露营灯、积木、Coach/Cuyana/Goyard 内胆…）→ 需要补 `category-rules.json`，或先补这些产品的 `category` 字段（多数是空的）。
- 9 个 `NO_KEYWORD_MATCH` → 需补抓更细子类目关键词。
