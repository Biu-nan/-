// C6R 新增页面采集（店小秘）：出入记录窗口采集（单一真相源）/ 采购订单 / 供货商 / 供货关系
// 全部只读；列映射基于 2026-10-11 实测 colid。
'use strict';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 通用：点页签 / 点按钮 ----------
async function clickText(page, text) {
  for (const fn of [
    () => page.getByText(text, { exact: true }).first().click({ timeout: 6000 }),
    () => page.locator(`text=${text}`).first().click({ timeout: 6000 }),
  ]) { try { await fn(); return true; } catch (e) { /* next */ } }
  return false;
}

// ---------- 出入记录：切到「时间=全部」（120天页签内全量，配合倒序早停取窗口）----------
async function setEntryExitAllTime(page, log) {
  const r = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const labels = Array.from(document.querySelectorAll('*')).filter((e) => txt(e) === '时间' && e.children.length === 0);
    for (const lab of labels) {
      let box = lab.parentElement;
      for (let up = 0; up < 4 && box; up++) {
        if (/今天/.test(box.innerText) && /昨天/.test(box.innerText)) {
          const btn = Array.from(box.querySelectorAll('a, span, button, li, label')).find((e) => txt(e) === '全部');
          if (btn) { btn.click(); return 'CLICKED'; }
        }
        box = box.parentElement;
      }
    }
    return 'NOT_FOUND';
  });
  await new Promise((r2) => setTimeout(r2, 6000));
  log && log.info('出入记录 时间=全部 -> ' + r);
  return r === 'CLICKED';
}

// 兜底：自定义日期范围（antd RangePicker，取可见输入框）
async function setEntryExitDateRange(page, fromDate, toDate, log) {
  // 先点「自定义」快捷项（若存在）
  await clickText(page, '自定义').catch(() => {});
  await sleep(1200);
  const set = await page.evaluate(({ f, t }) => {
    const inputs = Array.from(document.querySelectorAll('.ant-picker input, input'));
    const start = inputs.find((i) => (i.getAttribute('placeholder') || '') === '开始日期');
    const end = inputs.find((i) => (i.getAttribute('placeholder') || '') === '结束日期');
    if (!start || !end) return { ok: false, reason: '未找到 开始日期/结束日期 输入框' };
    const setVal = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setVal(start, f); setVal(end, t);
    return { ok: true };
  }, { f: fromDate, t: toDate });
  if (!set.ok) { log && log.warn('设置出入记录时间范围失败：' + set.reason); return false; }
  await sleep(800);
  await page.keyboard.press('Enter').catch(() => {});
  await sleep(1500);
  await clickText(page, '搜索').catch(() => {});
  await sleep(4000);
  log && log.info(`出入记录时间范围已设为 ${fromDate} ~ ${toDate}`);
  return true;
}

// ---------- 出入记录窗口采集（单一真相源）----------
// 背景（2026-10-12 采购门禁 G2 阻塞根因）：出入记录页面「时间」筛选**默认只约 7 天**，
//   直接分页只能拿到 10月5日–10月12日（1070 行），无法支撑 C6R 必需的 30 日 P95 窗口。
// 对策：先显式切「时间=全部」（120 天）→ 再按窗口倒序早停 → 截断到 [fromDate,toDate]。
// 三处防御：①「全部」点不到时回退 antd 自定义日期范围；②早停只在「已进入窗口内」且
//   「再遇到更早记录」时触发（兼容升序表，避免首屏即误停产生空结果）；③到顶未越过窗口则标记 complete=false。
const ENTRYEXIT_COLUMNS = ['时间', '商品信息', '原库存', '变动', '新库存', '仓库', '操作人', '货架位', '区域', '原单价CNY', '入库价CNY', '新单价CNY', '类型', '流水号', '来源单号'];

function dayOf(v) { const m = String(v || '').match(/(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ''; }

async function collectEntryExitWindow(page, opts, log) {
  const { fromDate, toDate, extractor, goNextPage, sleep, maxPages = 120, waitAfterNextMs = 2500 } = opts;
  if (typeof extractor !== 'function' || typeof goNextPage !== 'function') throw new Error('collectEntryExitWindow 缺少 extractor / goNextPage');

  // ① 时间筛选：优先「全部」；失败回退自定义范围（保证能翻到窗口起点之前）
  let filterMode = 'ALL';
  const allOk = await setEntryExitAllTime(page, log).catch(() => false);
  if (!allOk) {
    filterMode = 'RANGE';
    const ok = await setEntryExitDateRange(page, fromDate, toDate, log).catch(() => false);
    log && log.warn(`「时间=全部」不可用 → 回退自定义日期范围：${ok ? '已设置' : '设置失败（仍按页面默认筛选，可能覆盖不足）'}`);
  }

  // ② 翻页 + 方向感知的安全早停
  //   ⚠ 早停必须知道表是升序还是降序，否则升序表会在「边界页」被误停（实测：只拿到 3 天）。
  const all = [];
  let pageNo = 1, complete = true, reachedBoundary = false, dir = null;
  while (true) {
    const rows = (await extractor(page)) || [];
    all.push(...rows);
    const ds = rows.map((r) => dayOf(r['时间'])).filter(Boolean);
    if (!dir && ds.length >= 2) {
      let inc = 0, dec = 0;
      for (let i = 1; i < ds.length; i++) { if (ds[i] > ds[i - 1]) inc++; else if (ds[i] < ds[i - 1]) dec++; }
      dir = inc > dec ? 'asc' : (dec > inc ? 'desc' : null);
      if (dir) log && log.info(`出入记录时间序=${dir === 'desc' ? '倒序(新→旧)' : '升序(旧→新)'}（据首屏判定）`);
    }
    if (dir === 'desc') {
      // 倒序：本页出现早于窗口起点的记录 ⇒ 已越过窗口起点（该页更早的行必在窗外）→ 可停
      if (ds.some((d) => d < fromDate)) { reachedBoundary = true; break; }
    } else if (dir === 'asc') {
      // 升序：本页已全部晚于窗口终点 ⇒ 后续只会更晚，窗内数据已取完 → 可停
      if (ds.length && ds.every((d) => d > toDate)) { reachedBoundary = true; break; }
    }
    // dir 未判定（如每页仅 1 行）→ 不早停，安全退化为全量翻页
    if (pageNo >= maxPages) { complete = false; log && log.warn('达到 maxPages 上限，未取到窗口边界'); break; }
    const nx = await goNextPage(page, log);
    if (nx !== 'CLICKED') break;
    await sleep(waitAfterNextMs + 1500);
    pageNo++;
  }

  // ③ 截断到窗口
  const rows = all.filter((r) => { const d = dayOf(r['时间']); return d >= fromDate && d <= toDate; });
  const coveredDays = [...new Set(rows.map((r) => dayOf(r['时间'])).filter(Boolean))].sort();
  return { rows, coveredDays, scanned: all.length, reachedBoundary, complete, pages: pageNo, filterMode };
}

// ---------- 采购订单行解析 ----------
// 实测结构：每单 = 2 行（表头行 + 明细行）；colid 随页面变化（col_40.. / col_123..），
// 故运行时按表头文本建立「角色 -> colid」映射，再按单聚合。
function extractPurchaseOrderRows(page) {
  return page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const H = {};
    for (const c of document.querySelectorAll('.vxe-header--column')) {
      const t = txt(c); const id = c.getAttribute('colid');
      if (!id) continue;
      if (/商品信息/.test(t)) H.info = id;
      else if (/付款详情/.test(t)) H.pay = id;
      else if (/^物流/.test(t)) H.logi = id;
      else if (/^时间/.test(t)) H.time = id;
      else if (/^状态/.test(t)) H.status = id;
    }
    const out = [];
    let cur = null;
    for (const row of document.querySelectorAll('.vxe-body--row')) {
      const get = (cid) => { if (!cid) return ''; const e = row.querySelector(`[colid="${cid}"]`); return e ? txt(e) : ''; };
      const info = get(H.info), pay = get(H.pay), logi = get(H.logi), time = get(H.time), status = get(H.status);
      const om = info.match(/^(PO[A-Z0-9]{4,})/i);
      if (om) {
        if (cur) out.push(cur);
        cur = {
          采购单号: om[1], 供货商: pay.replace(/^供货商[:：]\s*/, ''), 仓库: '', 采购员: '',
          商品种类: '', 采购数量: '', 货款: '', 到货货款: '', 物流: logi,
          创建时间: '', 到货时间: '', 更新时间: '', 状态: status,
        };
        const wm = status.match(/仓库[:：]\s*([^|]+?)\s*\|?\s*采购员[:：]\s*(\S+)/);
        if (wm) { cur.仓库 = wm[1].trim(); cur.采购员 = wm[2].trim(); }
      } else if (cur) {
        const n = info.match(/商品种类[:：]\s*(\d+)/); if (n) cur.商品种类 = n[1];
        const q = info.match(/采购数量[:：]\s*(\d+)/); if (q) cur.采购数量 = q[1];
        const pm = pay.match(/货款[:：]\s*￥?\s*([\d.]+)/); if (pm) cur.货款 = pm[1];
        const am = pay.match(/到货货款[:：]\s*￥?\s*([\d.]+)/); if (am) cur.到货货款 = am[1];
        if (logi) cur.物流 = (cur.物流 ? cur.物流 + ' ' : '') + logi;
        const cm = time.match(/创建[:：]\s*([\d\-: ]+?)(?:\s|$)/); if (cm) cur.创建时间 = cm[1].trim();
        const rm = time.match(/到货[:：]\s*([\d\-: ]+?)(?:\s|$)/); if (rm) cur.到货时间 = rm[1].trim();
        const um = time.match(/更新[:：]\s*([\d\-: ]+?)(?:\s|$)/); if (um) cur.更新时间 = um[1].trim();
        if (status) cur.状态 = status;
      }
    }
    if (cur) out.push(cur);
    return out;
  });
}

// ---------- 供货商行解析（col_17..col_27）----------
function extractSupplierRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      const txt = (id) => { const e = row.querySelector(`[colid="${id}"]`); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : ''; };
      const name = txt('col_18');
      if (!name) continue;
      const timeRaw = txt('col_26');
      const cm = timeRaw.match(/创建[:：]\s*([\d\-: ]+)/);
      const um = timeRaw.match(/更新[:：]\s*([\d\-: ]+)/);
      out.push({
        供货商名称: name,
        结算方式: txt('col_19'),
        延时率: txt('col_20'),
        补货率: txt('col_21'),
        退货率: txt('col_22'),
        换货率: txt('col_23'),
        次品率: txt('col_24'),
        供货时效: txt('col_25'),
        创建时间: cm ? cm[1].trim() : '',
        更新时间: um ? um[1].trim() : '',
      });
    }
    return out;
  });
}

// ---------- 供货关系行解析（col_6..col_17）----------
function extractSupplyRelationRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      const txt = (id) => { const e = row.querySelector(`[colid="${id}"]`); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : ''; };
      const name = txt('col_7');
      if (!name) continue;
      out.push({
        供货商名称: name,
        供货商品数: txt('col_8'),
        采购次数: txt('col_9'),
        延时率: txt('col_10'),
        补货率: txt('col_11'),
        退货率: txt('col_12'),
        换货率: txt('col_13'),
        次品率: txt('col_14'),
        供货时效: txt('col_15'),
        最近交易时间: txt('col_16'),
      });
    }
    return out;
  });
}

// ---------- 商品管理：类型页签（全部/单品/组合/多变种/加工/有异常）----------
// 缺口3 关键：仓库清单无「商品类型」列，但商品管理页有互斥类型页签，点一下即可枚举该类 SKU。
// 实测（2026-10-11）：全部(1888) 单品(1739) 组合(146) 多变种(3) 加工(0) 有异常(7)。
//
// ⚠ 两类单元格形态（实测）：
//   单品/组合： `WDZAI37-Variant 8 复古磁带… [63002026] [未分类] 库存明细|组合详情`
//              -> 首个非纯数字 <a> 即 SKU；编码在 [] 内
//   多变种  ： `100004 分类：未分类 已有变种：1 变种详情`
//              -> **没有 SKU 文本**，首个 <a> 是「商品编码」（纯数字）
// 因此本解析统一返回 { 商品SKU, 商品编码 }，由上层用「编码→SKU」回填多变种。
async function readProductTypeTabs(page) {
  return page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const out = {};
    for (const e of document.querySelectorAll('div,span,li,a,label')) {
      if (!vis(e)) continue;
      const m = txt(e).match(/^(全部|单品|组合|多变种|加工|有异常)\s*\((\d+)\)$/);
      if (m) out[m[1]] = Number(m[2]);
    }
    return out;
  });
}

// 当前页「共 N 条记录」
async function readTableTotal(page) {
  return page.evaluate(() => {
    const m = (document.body.innerText || '').match(/共\s*([\d,]+)\s*条记录/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : -1;
  });
}

// 当前页商品行（兼容两种形态 + 树形子行）
// ⚠ 实测：多变种子行走的是**另一段 colid**（col_66..col_74 / col_38.. / col_52..），
//   根本没有 col_9 → 故不能写死 col_9，必须按「单元格内容」定位商品信息。
function extractProductTypeRows(page) {
  return page.evaluate(() => {
    const ACT = /^(组合详情|变种详情|库存明细|查看更多|编辑|删除|更多)$/;
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      // 树形父行（如多变种的 10000x，无真实 SKU）跳过 —— 真实 SKU 在其展开的子行上
      if (/is--expand-row/.test(String(row.className))) continue;
      // 主列表行有 col_9；树形子行没有 -> 才按内容定位
      let target = row.querySelector('[colid="col_9"]');
      if (!target) {
        for (const c of Array.from(row.querySelectorAll('[colid]'))) {
          const t = txt(c);
          if (!t) continue;
          const hasBracketCode = /\[\d{6,}\]/.test(t);
          const hasSkuAnchor = Array.from(c.querySelectorAll('a')).some((a) => { const at = txt(a); return at && !/^\d+$/.test(at) && !ACT.test(at); });
          if (hasBracketCode || hasSkuAnchor) { target = c; break; }
        }
      }
      if (!target) continue; // 纯父行（10000x，无 SKU）-> 跳过
      const full = txt(target);
      const anchors = Array.from(target.querySelectorAll('a')).map(txt).filter(Boolean);
      const bracketCode = (full.match(/\[(\d{6,})\]/) || [])[1] || '';
      const numAnchor = anchors.find((a) => /^\d{5,}$/.test(a)) || '';
      const skuAnchor = anchors.find((a) => a && !/^\d+$/.test(a) && !ACT.test(a)) || '';
      const sku = skuAnchor || '';
      const code = bracketCode || numAnchor;
      if (!sku && !code) continue;
      out.push({
        商品SKU: sku,
        商品编码: code,
        形态: /组合详情/.test(full) ? '组合' : (/变种详情/.test(full) || /变种/.test(full) ? '多变种' : ''),
        有组合详情: /组合详情/.test(full) ? 'Y' : '',
      });
    }
    return out;
  });
}

async function clickProductTab(page, name) {
  return page.evaluate((name) => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const re = new RegExp('^' + name + '\\s*\\(\\d+\\)$');
    const el = Array.from(document.querySelectorAll('div,span,li,a,label')).filter((e) => vis(e) && re.test(txt(e))).pop();
    if (!el) return 'NOT_FOUND';
    el.click();
    return 'CLICKED';
  }, name);
}

// 多变种是树形且**默认折叠**：父行(10000x，无 SKU) + 子行(真实变种 SKU)。
// 需点每个父行的「变种详情」展开后，子行才会带 SKU 渲染出来（截图实测）。
async function expandVariantDetails(page) {
  const n = await page.evaluate(() => {
    const txt = (e) => ((e && e.innerText) || '').replace(/\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a')).filter((e) => txt(e) === '变种详情' && e.getBoundingClientRect().width > 0);
    links.forEach((e) => e.click());
    return links.length;
  });
  if (n) await sleep(5000);
  return n;
}

// 采集类型映射
// 返回 { counts, lists, declared, collected, complete }
//   complete=false 表示「声明数 != 实得数」——上层据此拒绝把剩余 SKU 默认成单品（不猜）。
async function collectProductTypeMap(page, pageUrl, log) {
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(9000);
  await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});
  await sleep(1200);
  const counts = await readProductTypeTabs(page);
  const spec = ['组合', '多变种', '加工', '有异常'];
  const lists = {};
  const declared = {};
  for (const t of spec) {
    const want = counts[t] || 0;
    declared[t] = want;
    if (!want) { lists[t] = []; continue; }
    // 实测坑（2026-10-11）：店小秘前端在「先点组合、再点多变种」时，页签虽激活（activeTab 正确）
    // 但表格渲染 0 行且无分页器 —— 属前端缺陷。对策：该页签采不到行时**重新加载页面**再点（新加载即为首操作，实测可出 3 行）。
    let rows = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        log && log.warn(`商品类型[${t}] 未渲染出行 → 重新加载页面后重试`);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
        await sleep(9000);
        await page.waitForSelector('.vxe-body--row', { timeout: 20000 }).catch(() => {});
        await sleep(1500);
      }
      await clickProductTab(page, t);
      // 多变种是**树形**结构（父行 10000x 无 SKU + 子行有 SKU），且子行**延迟渲染**；
      // 故先固定等 10s，展开变种详情，再等行数稳定（连续两次不变）才读。
      await sleep(10000);
      if (t === '多变种') {
        const n = await expandVariantDetails(page);
        log && log.info(`多变种：展开变种详情 ${n} 个父行`);
      }
      let last = -1, stable = 0;
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        await sleep(1500);
        const r = await extractProductTypeRows(page);
        if (r.length > 0) rows = r;
        if (r.length > 0 && r.length === last) { stable++; if (stable >= 2) break; }
        else { stable = 0; last = r.length; }
      }
      if (rows.length > 0) break;
    }
    // 需要时翻页取全
    let pageNo = 1;
    while (rows.length > 0 && rows.length < want && pageNo < 60) {
      const nx = await page.evaluate(() => {
        const b = document.querySelector('.vxe-pager--next-btn');
        if (!b) return 'NO_BTN';
        if (b.classList && b.classList.contains('is--disabled')) return 'DISABLED';
        b.click(); return 'CLICKED';
      });
      if (nx !== 'CLICKED') break;
      await sleep(2600); pageNo++;
      rows.push(...(await extractProductTypeRows(page)));
    }
    // 去重
    const seen = new Set();
    lists[t] = rows.filter((r) => { const k = r.商品SKU || r.商品编码; if (!k || seen.has(k)) return false; seen.add(k); return true; });
    log && log.info(`商品类型[${t}] 采集 ${lists[t].length} 行（页面声明 ${want}）`);
  }
  const collected = Object.fromEntries(spec.map((t) => [t, lists[t].length]));
  const complete = spec.every((t) => (lists[t].length === declared[t]));
  return { counts, lists, declared, collected, complete };
}

module.exports = { clickText, setEntryExitAllTime, setEntryExitDateRange, ENTRYEXIT_COLUMNS, dayOf, collectEntryExitWindow, extractPurchaseOrderRows, extractSupplierRows, extractSupplyRelationRows, readProductTypeTabs, readTableTotal, extractProductTypeRows, clickProductTab, collectProductTypeMap };
