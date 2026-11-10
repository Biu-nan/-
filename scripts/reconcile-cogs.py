#!/usr/bin/env python3
"""C3 · 已售成本对账（只读，不写库）

口径 A（Lance 2026-11-10 指定）：成本仅取采购入库价，**不含**头程 / 包装 / 佣金 / 退款。
因此本脚本输出的是「商品毛利」，不是经营净利——不要把两者混用去核对 ¥12,000 目标。

用法：
  python scripts/reconcile-cogs.py
  python scripts/reconcile-cogs.py --order <订单明细.xlsx> --cost <cost-latest.json> --samples 6

前置：openpyxl。金额币种由订单明细的「币种」列断言，必须全为 CNY 才继续。
"""
import argparse
import collections
import json
import pathlib
import warnings

warnings.filterwarnings("ignore")  # xlsx 无默认样式，openpyxl 会发 UserWarning

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_COST = ROOT / "data/metrics/facts/cost/cost-latest.json"
DEFAULT_ORDER = ROOT / "已完成产品/订单明细20261031174028.xlsx"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cost", default=str(DEFAULT_COST))
    ap.add_argument("--order", default=str(DEFAULT_ORDER))
    ap.add_argument("--samples", type=int, default=6)
    args = ap.parse_args()

    import openpyxl

    fact = json.loads(pathlib.Path(args.cost).read_text(encoding="utf-8"))
    costs = fact["costs"]

    wb = openpyxl.load_workbook(args.order, read_only=True, data_only=True)
    ws = wb.active
    hdr = [c.value for c in next(ws.iter_rows(min_row=1, max_row=1))]
    idx = {h: n for n, h in enumerate(hdr)}
    required = ["sku编码", "商品数量", "成交金额", "取消数量", "币种"]
    missing = [h for h in required if h not in idx]
    if missing:
        raise SystemExit(f"订单明细缺列：{missing}")

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    currencies = collections.Counter(str(r[idx["币种"]]) for r in rows)
    if set(currencies) - {"CNY"}:
        raise SystemExit(f"币种不是纯 CNY，需先换算：{dict(currencies)}")

    revenue = cost_total = gross = 0.0
    matched = unmatched = 0
    conf = collections.Counter()
    tiers = collections.Counter()
    samples = []

    for r in rows:
        sku = str(r[idx["sku编码"]] or "")
        try:
            qty = float(r[idx["商品数量"]])
            amount = float(r[idx["成交金额"]])
        except (TypeError, ValueError):
            continue
        cancel = r[idx["取消数量"]]
        if qty <= 0 or (cancel and float(cancel) > 0):
            continue
        if sku not in costs:
            unmatched += 1
            continue

        c = costs[sku]
        unit_cost = c["price"] * qty
        revenue += amount
        cost_total += unit_cost
        gross += amount - unit_cost
        matched += 1
        conf[c["confidence"]] += 1
        tiers[c["type"]] += 1
        if len(samples) < args.samples:
            samples.append((sku, amount / qty, c["price"], amount / qty - c["price"],
                            c["confidence"], c["type"]))

    print(f"成本事实      : {fact['builtAt']}  skuCount={fact['skuCount']}")
    print(f"成本口径      : {fact['caliber']}")
    print(f"成本告警      : {fact['warnings']}")
    print(f"订单行数      : {len(rows)}   币种: {dict(currencies)}")
    print(f"可匹配有效行  : {matched}   未匹配: {unmatched}   覆盖率: {matched/(matched+unmatched)*100:.1f}%")
    print(f"成交额合计    : ¥{revenue:,.2f}")
    print(f"已售成本合计  : ¥{cost_total:,.2f}  （采购入库价 × 数量）")
    print(f"商品毛利      : ¥{gross:,.2f}   毛利率 {gross/revenue*100:.2f}%")
    print(f"单件毛利      : ¥{gross/matched:.2f}")
    print(f"confidence    : {dict(conf)}")
    print(f"取价来源      : {dict(tiers)}")
    print()
    print("样例（售价 / 入库成本 / 差额，均 CNY）：")
    for sku, unit, c, diff, cf, tp in samples:
        print(f"  {sku[:32]:<32} {unit:>8.2f} {c:>9.3f} {diff:>8.2f}  {cf:<6} {tp}")
    print()
    low = conf.get("low", 0)
    if low:
        print(f"⚠ 数据质量：{low}/{matched} 行（{low/matched*100:.1f}%）的成本来自「商品参考价」兜底，"
              "confidence=low，不能当作已核准成本。")
    if unmatched:
        print(f"⚠ 覆盖缺口：{unmatched} 行 SKU 不在成本表里，未计入本表。")
    print("⚠ 口径限制：本表是【商品毛利】，不含头程/包装/佣金/退款/平台扣款；"
          "不是经营净利，不能直接用于核对 ¥12,000 月净利目标。")


if __name__ == "__main__":
    main()
