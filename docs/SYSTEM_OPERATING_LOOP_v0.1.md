# 系统运营闭环 v0.1 · 对话框驱动整个系统

> 2026-10-25 · 基于对 `dist/src` 全量路由与状态文件的实测盘点
> 目标：Lance 通过对话驱动「商品完整生命周期 + 店铺运营周期」全链路闭合

---

## 一、盘点结论：系统不缺口，缺「一层」

实测：`server.js` 暴露 **140+ 路由，覆盖 14 个业务域**。前向链路基本齐全。

| 业务域 | 路由前缀 | 现状 |
|---|---|---|
| 选品发现 | `/api/research/*` | ✅ discover / analyze / import |
| 选品采纳 | `/api/selection/*` | ✅ pool / run / adopt / import-current-chat |
| 产品建档 | `/api/product-profiles/*`、`/api/product/facts` | ✅ |
| Listing 文案 | `/api/run/{seo-listing,planning}`、`/api/charm/run/*` | ✅ |
| 主图生成 | `/api/run/images`、`/api/charm/run/images` | ✅（ChatGPT 网页版，8–22min） |
| 上架店小秘 | `/api/dianxiaomi/*` | ✅ reference / collect / batch-retry / apply-facts |
| 单品审核环 | `/api/listing-jobs/*` | ⚠️ 状态机真、生成能力空（模板拼串） |
| 店铺运营 | `/api/operations/*` | ✅ stores / profiles / listings / tasks / actions / snapshots |
| 每日待办 | `/api/daily/waiting-items`、`/api/today-dashboard` | ⚠️ 只有 7 个任务计数，无经营指标 |
| 队列与任务 | `/api/queue/*`、`/api/task/{pause,rollback,abandon}` | ✅ |
| 事件与指令 | `/api/events`、`/api/action-log`、`/api/commands` | ✅ |
| 秘书 | `/api/secretary/chat` | ⚠️ 只产草稿不执行 |
| P0 协议 | `/api/p0/*` | ✅ L0–L3 风险分级 |
| 多 agent | `/api/agent/*`、`/api/operators` | ✅ 任务认领与回报 |

**所以「驱动」不缺手脚。缺的是三样东西：**

### 缺口 1：缺总账（14 个状态源，没有一个统一点）

状态散在这些地方，互不知情：

```
run-state.json                    ← 当前产品阶段
data/batch-listing-state.json     ← 引用批量上架
data/collect-batch-state.json     ← 采集箱批量上架
商品队列/queue-state.json          ← 队列
operation-actions.json            ← 运营动作
listing-cards.json                ← Listing 卡
daily-waiting-items.json          ← 每日待办
data/command_inbox.jsonl          ← 指令流
event_log                         ← 事件
data/*.db (SQLite)                ← charm 状态机
当前产品/<x>/run-state.json        ← 单品进度
已完成产品/<x>/product-facts.json  ← 已归档产物
```

→ 直接后果：**「现在怎么样 / 卡在哪 / 下一步该干什么」这三个问题，系统回答不了。** 秘书想汇报进度只能靠猜，而"编进度"是最危险的失误。

### 缺口 2：缺推进器（有目标，没有驱动的手）

`operationProfiles` 已有完整的运营周期骨架：

```
product_tier · current_operation_goal · entry_reason · current_strategy
next_review_at · linked_listing_ids · agent_summary
latest_snapshot_id · latest_action_id
```

但**谁去改 `current_operation_goal`？谁去推进 `next_review_at`？谁去写 `agent_summary`？** 目前靠人手填。这是"运营周期"空转的根因——骨架在，肌肉不在。

### 缺口 3：缺后半环（上架之后没有数据回流）

- `createPerformanceSnapshot()` 是**纯手工录入**，必须人传 `listing_id` + 指标。
- 全代码库**没有销售/流量/评价的自动采集管道**。
- `today-dashboard` 只有 `today_task_count`、`qclaw_*`、`pending_review_count` —— **全是任务计数，没有一个经营指标**。

→ **「全链路闭合」目前只能闭到「上架」，闭不到「经营反馈」。** 这一段不是写代码能解决的，需要数据源（见第五节）。

---

## 二、架构：四层，从上往下建

```
                  ┌─────────────────────────┐
                  │   对话入口（你说话/丢图）  │
                  └───────────┬─────────────┘
                     ┌────────┴────────┐
              ┌──────▼──────┐   ┌──────▼──────┐
              │ L2 能力层(写)│   │ L1 总账层(读)│
              │ 15 个业务动词 │   │ 统一状态快照 │
              └──────┬──────┘   └──────┬──────┘
                     └────────┬────────┘
                  ┌───────────▼─────────────┐
                  │ 现有 14 域 · 140+ 路由   │
                  └───────────▲─────────────┘
                              ╎  ← 缺：数据回流管道
                  ┌───────────┴─────────────┐
                  │ L4 经营反馈环（待补）     │
                  └─────────────────────────┘
```

### L1 · 总账层（System Ledger）—— 先做这个

新增 **一个只读聚合接口**：`GET /api/system/state`

返回四块，全部来自现有状态源，**不写任何业务数据**：

```jsonc
{
  "running":  [ /* 在跑什么：run-state + 两个 batch state + queue */ ],
  "waiting":  [ /* 等谁拍板：review-queue + daily waiting + needs_human + qclaw 待审批 */ ],
  "blocked":  [ /* 卡在哪：failed / NEEDS_INPUT / 超时未更新 */ ],
  "lifecycle":[{ /* 每个商品在周期哪一步：product → listed → uploaded → operating */ }],
  "asOf": "2026-10-25T06:12:00Z"
}
```

**为什么先做它**：只读、零业务风险、不动任何现有逻辑，但立刻解锁三件事——
1. 我能准确回答「现在怎么样」（不再猜、不再编）
2. 「卡在哪」可枚举 → 我才知道该修什么
3. 它是 L2 的前置条件：**没有总账，任何"推进"都是盲动**

### L2 · 能力层（Capability Layer）—— 按动词封装，不按端点

**关键设计：我不直接调 140 个路由。** 140 个端点 = 140 个隐患。收敛成 15 个业务动作，每个动作内部编排若干路由：

| # | 动词 | 内部编排 | 风险 |
|---|---|---|---|
| 1 | 选品发现 | research/discover → analyze | L1 |
| 2 | 选品采纳 | selection/adopt → 建档 | L2 |
| 3 | 产品建档 | product-profile + facts 校验 | L1 |
| 4 | 出文案 | run/seo-listing → 校验 → 自纠错 | L1 |
| 5 | 出主图 | run/images（8–22min，异步） | L2 |
| 6 | 打包上架 | dianxiaomi reference/collect | **L3** |
| 7 | 审核放行 | listing-jobs approve | **L3** |
| 8 | 改价改信息 | dianxiaomi apply-facts / operations | **L3** |
| 9 | 查状态 | L1 总账 | L0 |
| 10 | 暂停 / 恢复 | run/pause · queue/pause | L2 |
| 11 | 回滚 / 放弃 | task/rollback · task/abandon | **L3** |
| 12 | 配店铺 | operations/stores | L2 |
| 13 | 排今日待办 | daily/waiting-items | L1 |
| 14 | 记经营快照 | operations/snapshots | L1 |
| 15 | 出日报 | dashboard + 总账聚合 | L0 |

每个动词必须有五样东西（缺一不可）：

```
入参 schema · 风险等级 · 前置条件 · 幂等键 · 执行回执
```

**风险分级复用已有的 P0 协议**（L0–L3 + `requires_confirmation`），不新造一套。硬规则：

- **L3 一律必停**：上架、发布、删除、清空、改价、回滚 —— 必须你点头
- **L2 需播报**：批量、上传、调整 —— 我可以做，但做完要报
- **L0/L1 静默执行**：查询、校验、建档、出草稿

### L3 · 闭环层（Loop Closure）—— 动作必须留痕

每个能力执行前后写一对事件到现有 `event_log` / `action-log`：

```
intent   → 你说了什么、我理解成什么（可核对）
action   → 实际调了哪些路由、参数是什么
result   → 成功/失败、产物路径、耗时
verify   → 回读校验（文件在不、字段全不全、网页可见否）
```

这样「做了没有 / 做成了没有」永远可查。这是 **No Evidence No Done 的系统化**，不是新增流程。

### L4 · 经营反馈环 —— 缺数据源，先占位

`performanceSnapshot` 表结构已经在，缺的是**自动填充**。数据源三选一（见第五节）。在此之前，L4 只做「手工录入 + 趋势展示」，不假装自动。

---

## 三、三条铁律（不遵守就会退化成平行真相）

1. **网页是唯一显性化界面。** 我在对话里跑的每个 job，必须能在网页上看见、能审、能操作。做不到的路径一律不开——那是平行真相。
2. **执行权单点。** 只有我执行，网页只负责看和审。网页秘书保持「只产草稿不执行」，避免双大脑。
3. **长任务必须抗重启。** watchdog 每 15s 探活，server 被重启是常态。job 状态必须落盘（复用 `charm_listing_jobs` 的 SQLite），否则 20 分钟白跑。

---

## 四、落地顺序（按 ROI，不按完整性）

| 阶段 | 内容 | 风险 | 产出 |
|---|---|---|---|
| **P0** | L1 总账接口 + 用它对一次全系统体检 | 只读，零风险 | 一份真实的"系统现在什么样" |
| **P1** | L2 前 8 个动词（选品→建档→文案→上架→审核） | 中，L3 项全停 | 能对话跑完一个完整商品 |
| **P2** | L3 留痕 + 网页可见性（给 listing-jobs 挂 tab） | 低 | 每个动作可追溯、可审 |
| **P3** | L4 经营反馈（前提：数据源确定） | 取决于数据源 | 闭环收紧 |

**先做 P0 的理由**：不到 200 行代码，只读聚合，不动业务。但它会暴露所有真实故障点——而且做完之后，你问「现在什么情况」，我第一次能给你准确答案而不是猜。

---

## 五、待你决策

### D1 · 经营数据从哪来（决定 L4 能不能做）

| 选项 | 可行性 | 说明 |
|---|---|---|
| 店小秘后台抓取 | 待验证 | 已有 CDP 9223 + 店小秘 adapter，复用成本最低 |
| 速卖通商家后台 / 开放平台 API | 需申请 | 最规范，但要 App Key 与授权 |
| 手工/Excel 录入 | 立刻可做 | `createPerformanceSnapshot` 已支持，但靠人，闭环不真 |

### D2 · 运营周期的「日期锚」

`next_review_at` 靠什么驱动？
- 固定节奏（每 7 天复盘）
- 事件驱动（销量下滑 / 库存告警 / 差评出现）
- 混合

### D3 · P0 是否现在动手

环境已确认安全：`run-state` 空闲、两个批量 state 均 `running=false`、3000 仅 PID 19084 监听、CDP 9223 在线。
改后端需重启 server（会中断手上任何正在跑的任务，当前无）。
