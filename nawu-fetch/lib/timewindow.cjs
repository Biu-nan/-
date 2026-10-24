// C6R 采购时间窗口（统一 Asia/Shanghai）
// 约定（来自 C6R 升级规格）：
//   - 采购决策日期 = 北京时间当天
//   - 采购数据截止 = 当天 12:00
//   - 销量窗口   = 截至昨天 23:59:59
//   - 出入记录   = 最近 35 个完整自然日（最后 30 日 = P95 正式窗口；最后 7 日 = ADS）
// 本模块为纯函数，无副作用，可离线自测。
'use strict';

const TZ = 'Asia/Shanghai';

function parts(d) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const o = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  return o;
}

// YYYY-MM-DD（Shanghai）
function dateStr(d) {
  const p = parts(d || new Date());
  return `${p.year}-${p.month}-${p.day}`;
}

// YYYYMMDD-HHMMSS（Shanghai）
function stamp(d) {
  const p = parts(d || new Date());
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}

// HHMMSS（Shanghai）
function stampShort(d) {
  const p = parts(d || new Date());
  return `${p.hour}${p.minute}${p.second}`;
}

// 纯日期加减（用 UTC 计算，避免本地时区/DST 干扰）
function addDays(ds, n) {
  const [y, m, d] = ds.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86400000;
  const dt = new Date(t);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 以 endDate 结尾、含 endDate 在内的 n 个连续自然日（升序）
function lastNDays(endDate, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(endDate, -i));
  return out;
}

// 计算一轮采购所需的全部窗口
function purchaseWindows(now) {
  const d = now || new Date();
  const decisionDate = dateStr(d);          // 北京时间当天
  const dataCutoff = `${decisionDate} 12:00:00`;
  const salesEnd = addDays(decisionDate, -1); // 昨天（最后一个完整自然日）
  const last7 = lastNDays(salesEnd, 7);
  const last30 = lastNDays(salesEnd, 30);
  const entryExit = {
    days: 35,
    from: `${addDays(salesEnd, -34)} 00:00:00`,
    to: `${salesEnd} 23:59:59`,
    daysList: lastNDays(salesEnd, 35),
  };
  return {
    tz: TZ,
    decisionDate,
    dataCutoff,
    salesEnd: `${salesEnd} 23:59:59`,
    last7,
    last30,
    entryExit,
    p95WindowDays: 30,
    adsWindowDays: 7,
  };
}

module.exports = { TZ, parts, dateStr, stamp, stampShort, addDays, lastNDays, purchaseWindows };
