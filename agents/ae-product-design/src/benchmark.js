// agents/ae-product-design/src/benchmark.js
// 上线后真实数据回填：唯一经营结果是「每千次曝光成交单量 = 1000 × CTR × CVR」。
// 图好不好不由我们自己说了算，由这条曲线说了算。

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export const BENCHMARK_FILE = "benchmark.jsonl";

export function computeMetrics({ impressions, clicks, orders }) {
  if (!(impressions > 0)) throw new Error("impressions 必须 > 0");
  if (clicks < 0 || clicks > impressions) throw new Error("clicks 必须在 0..impressions 之间");
  if (orders < 0 || orders > clicks) throw new Error("orders 必须在 0..clicks 之间");
  const ctr = clicks / impressions;
  const cvr = clicks > 0 ? orders / clicks : 0;
  return {
    ctr: Number(ctr.toFixed(5)),
    cvr: Number(cvr.toFixed(5)),
    ordersPer1000Exposures: Number((1000 * ctr * cvr).toFixed(4)),
  };
}

export async function recordBenchmark(dir, payload) {
  const metrics = computeMetrics(payload);
  const baseline = payload.baseline
    ? {
        ...payload.baseline,
        ...computeMetrics(payload.baseline),
      }
    : null;
  const record = {
    recordedAt: new Date().toISOString(),
    runId: payload.runId ?? null,
    slotId: payload.slotId ?? null,
    country: payload.country ?? null,
    trafficSource: payload.trafficSource ?? null,
    priceBand: payload.priceBand ?? null,
    impressions: payload.impressions,
    clicks: payload.clicks,
    orders: payload.orders,
    ...metrics,
    baseline,
    deltaVsBaseline: baseline
      ? {
          ctr: Number((metrics.ctr - baseline.ctr).toFixed(5)),
          cvr: Number((metrics.cvr - baseline.cvr).toFixed(5)),
          ordersPer1000Exposures: Number(
            (metrics.ordersPer1000Exposures - baseline.ordersPer1000Exposures).toFixed(4),
          ),
        }
      : null,
    note: payload.note ?? null,
  };
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, BENCHMARK_FILE), JSON.stringify(record) + "\n", "utf8");
  return record;
}

/** 每个槽位取最近一条，供 design-report 直接展示"有没有真的跑赢基线" */
export async function loadBenchmark(dir) {
  const file = path.join(dir, BENCHMARK_FILE);
  const raw = await readFile(file, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const latest = new Map();
  for (const line of raw.trim().split("\n")) {
    try {
      const record = JSON.parse(line);
      latest.set(record.slotId ?? "unknown", record);
    } catch {
      /* 跳过坏行 */
    }
  }
  return {
    file,
    slots: Object.fromEntries(
      [...latest.entries()].map(([slotId, r]) => [
        slotId,
        {
          ordersPer1000Exposures: r.ordersPer1000Exposures,
          ctr: r.ctr,
          cvr: r.cvr,
          deltaVsBaseline: r.deltaVsBaseline,
          recordedAt: r.recordedAt,
        },
      ]),
    ),
  };
}
