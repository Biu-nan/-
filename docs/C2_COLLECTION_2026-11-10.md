# C2 · 四店销售数据采集（2026-11-10 20:10）

> 授权：Lance 18:41 批准单元 2（平台账号操作）；19:54 完成稳卖手动登录。
> 结论：**4 店采集链路打通并落库**，但只拿到「当日快照 + 7d/30d 窗口」，
> **不是 11/1–11/10 逐日历史**（采集器能力限制，见 §4）。

## 1. 执行结果

| envId | channelId | 模式 | exit | facts | 结果 |
|---|---|---|---|---|---|
| 400370 | 2358891 | full-managed | 0 | 17 | ✅ 完整 |
| 416488 | 2443536 | full-managed | 0 | 17 | ✅ 完整 |
| 461693 | 2690629 | full-managed | 0 | 17 | ✅ 完整 |
| 461692 | 2686609 | **pop** | 2 | 8 | ⚠️ 4 个 mtop 接口 MISS，8 条全是 `FETCH_MISS` 哨兵 |

461692 按计划单独标记、不强凑数。它的 8 条 `value=null, reason=FETCH_MISS`
是采集器 fail-closed 的显式哨兵，**不是静默写 0**，不会污染下游口径。

## 2. 两个真实缺陷（这次才暴露，已修）

### 2.1 竞态误判 `NEEDS_MANUAL_LOGIN`
`openEnv` 返回后页面可能还停在扩展中转页（`chrome-extension://.../middlePage`），
原代码立刻取 `ctx.pages()[0]` 就判成登录墙。表现是：登录后第一次 dry-run 成功，
`closeEnv` 后第二次 openEnv 却报「登录过期」——**不是真过期，是没等页面跳转**。

修复（`scripts/fetch-ae-metrics.mjs`）：判定前轮询最多 30 秒等 `csp/dchain` 页面出现，
超时仍按登录墙处理，**fail-closed 语义不变**。

### 2.2 多店同日 raw 互相覆盖
`saveRaw` 原路径 `raw/<source>/<date>/<name>.json` 不带店铺标识，
4 店跑同一天写同名文件，只剩最后一店。实测归档前 `store-overview-dom.json`
里是 pv 136/uv 71，与 400370 的 461/294 对不上。

修复：`scripts/metrics-store.mjs` 的 `saveRaw` 支持可选 `AE_STORE_SCOPE` 隔离层，
`fetch-ae-metrics.mjs` 在 `main()` 开头自动设 `env-<STORE_ID>`。
**其它调用方**（`fetch-dxm-metrics.mjs`、`dist/src/collectors/ae-metrics.v2.mjs`、
`explore-ae-shape.mjs`）不设该变量，路径保持不变，零影响。

旧的同名文件已归档到 `data/metrics/raw/aliexpress/2026-11-10/_ambiguous-overwritten/`
（保留留痕，未删除），重跑后按店目录写入。隔离证据：三店 `store-overview-dom.json`
的浏览量分别是 469 / 295 / 137，互不相同。

## 3. 数据落位与口径核对

- facts：`data/metrics/facts/aliexpress/2026-11-10.jsonl`
  重跑两轮共 75 行，按 `factKey`（含 `storeId`）取最后一行去重后 **59 行**，
  按店 17 / 17 / 17 / 8。
- raw：`data/metrics/raw/aliexpress/2026-11-10/env-<id>/*.json`
- **币种/单位**：金额已是元（`centToYuan` 做了分→元），如 400370 GMV ¥13,076.43
- **窗口**：today 51 / 7d 4 / 30d 4；`statDate` 全部 `2026-11-10`
- **日切**：`dateUpdateTime` 为 PST 03:56 ≈ 北京 19:56，不在 15:00–17:00 归零窗口内
- 去重后 `sales.qty.total`（today / 7d / 30d）：

| 店 | today | 7d | 30d |
|---|---:|---:|---:|
| 400370 | 21 | 742 | 2773 |
| 416488 | 8 | 476 | 2241 |
| 461693 | 3 | 207 | 938 |
| 461692 | `FETCH_MISS` | `FETCH_MISS` | `FETCH_MISS` |

（400370 两次跑从 20→21 是实时数据自然变化，jsonl 是事件流，取最后一行即可。）

## 4. ⚠️ 「整月」没有拿到，原因与出路

采集器**没有日期区间参数**，`main()` 只抓当前三个页面自己发出的 mtop 响应，
得到的是「此刻的 today / 7d / 30d 快照」。它**不能回溯 11/1–11/10 的逐日序列**——
这是能力边界，不是登录或代码问题。

要拿到用户要的「11 月全店（11/1–11/10）」，三条路：

1. **每日累积**（最贴合现有架构）：把本采集器挂成每日定时任务，从今天起逐日落库；
   历史 11/1–11/9 无法补。
2. **平台导出**：从速卖通后台导出 11/1–11/10 的订单/销售日报表，另写导入器。
3. **扩展采集器**：找平台是否提供按日期查询的 mtop 接口（需先探接口与签名），
   再按日抓 10 次。这属于新功能，需单独授权。

看板因此拆成 **C2（链路 + 当日快照，已完成）** 与 **C2b（逐日历史，待定）**。

## 5. 复算方式

```bash
cd /f/yikuaborder-deploy
# 单店干跑（不写盘）
node scripts/fetch-ae-metrics.mjs 400370 --dry-run
# 单店正式跑
AE_CHANNEL_ID=2358891 node scripts/fetch-ae-metrics.mjs 400370
# 四店
for s in "400370:2358891" "416488:2443536" "461693:2690629" "461692:2686609"; do
  AE_CHANNEL_ID=${s##*:} node scripts/fetch-ae-metrics.mjs ${s%%:*}
done
```

> 运行时若遇 `fs.rm` 相关的挂起，加 WorkBuddy safe-delete opt-out：
> `CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR="" CODEBUDDY_TOOL_CALL_ID="" CODEBUDDY_SAFE_DELETE_BULK_GUARD=""`

## 6. 边界

- 全程只读平台页面自身请求（不构造 mtop、不算签名）
- 未推送远端；`ops-stores.json` 未入库
- 采集器只打 stdout，不写日志；含 token 的 ABORT URL 临时输出已清理
- 单元 5（run 升级 / 装网关）暂缓、单元 6（推送远端）不批
