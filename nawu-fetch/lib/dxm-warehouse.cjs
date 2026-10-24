// 店小秘 仓库清单 抓取（CDP :9223 已登录 Chrome，vxe-table DOM 解析）
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 浏览器接入 ----------
async function connectDxm(cdpUrl, log) {
  // 浏览器已在运行，做指数退避重试（新拉起时端口未必就绪）
  let lastErr = null;
  for (let i = 0; i < 12; i++) {
    try {
      const browser = await chromium.connectOverCDP(cdpUrl);
      const ctx = browser.contexts()[0] || (await browser.newContext());
      log.info(`已接入店小秘 Chrome CDP ${cdpUrl}（第 ${i + 1} 次）`);
      return { browser, ctx };
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error('connectOverCDP 多次重试失败: ' + (lastErr && lastErr.message ? lastErr.message.slice(0, 120) : String(lastErr)));
}

// ---------- 登录态检查（通用：可指定任意店小秘页面 URL）----------
async function ensureLoggedInAt(page, url, log) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(9000);
  const st = await page.evaluate(() => ({
    href: location.href,
    hasLogin: !!document.querySelector('input[type=password], .login-form, [class*=login]'),
    bodyHasTable: /商品信息|出入|库存/.test(document.body.innerText || ''),
  }));
  if (st.hasLogin || !/dianxiaomi\.com\/web\//.test(st.href)) {
    return { ok: false, reason: '店小秘未登录或已跳登录页（请在本地 Chrome 先登录店小秘）' };
  }
  log.info('店小秘 页面已加载（登录态 ok）：' + url);
  return { ok: true };
}

// 兼容旧调用（仓库清单）
async function ensureLoggedIn(page, log) {
  return ensureLoggedInAt(page, 'https://www.dianxiaomi.com/web/warehouse/warehouseProduct', log);
}

// 等待 vxe 表格渲染
async function waitForTable(page, log, timeoutMs = 30000) {
  await page.waitForSelector('.vxe-body--row', { timeout: timeoutMs }).catch(() => {});
  await sleep(1500);
}

// ---------- 解析当前页所有行 ----------
function extractRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      const c = row.children;
      if (c.length < 8) continue;
      const info = c[1];
      const q = (sel) => info.querySelector(sel);
      const sku = (q('.product-sku a') || {}).innerText || '';
      const name = (q('.product-name .name') || {}).innerText || '';
      const codeRaw = (q('.product-skuCode .skuCode span') || {}).innerText || '';
      const code = (codeRaw.split('[')[0] || '').trim();
      const cat = (codeRaw.match(/\[(.*)\]/) || [])[1] || '';
      const source = (q('.product-source a') || {}).innerText || '';
      const txt = (el) => (el && el.innerText ? el.innerText.replace(/\s+/g, ' ').trim() : '');
      const wh = txt(c[2]);
      const shelf = txt(c[3]);
      const stock = Array.from(c[4].querySelectorAll('.td-item span')).map((s) => s.innerText.trim());
      const [safe, transit, unsent, occupied, available, total] = stock;
      const price = txt(c[5]);
      const totalPrice = txt(c[6]);
      const timeText = txt(c[7]);
      out.push({
        来源: source,
        商品SKU: sku.trim(),
        商品名称: name.trim(),
        商品编码: code,
        分类: cat,
        仓库位置: wh,
        货架位: shelf,
        安全库存: safe || '',
        在途: transit || '',
        未发: unsent || '',
        占用: occupied || '',
        可用: available || '',
        总量: total || '',
        单价CNY: price,
        总价CNY: totalPrice,
        时间: timeText,
      });
    }
    return out;
  });
}

// ---------- 分页信息 ----------
async function getPagination(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || '';
    const m = t.match(/共\s*([\d,]+)\s*条记录/);
    const total = m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
    // vxe 当前页码
    const cur = (document.querySelector('.vxe-pager--current-page, .vxe-pager .vxe-pager--num-item.is--active') || {}).innerText || '';
    return { total, currentPageText: cur };
  });
}

// ---------- 翻到下一页 ----------
async function goNextPage(page, log) {
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('.vxe-pager--next-btn') ||
      Array.from(document.querySelectorAll('button, i, [class*=btn]')).find((e) => /下一页|next/i.test(e.innerText || e.getAttribute('title') || e.className || ''));
    if (!btn) return 'NO_BTN';
    if (btn.classList && btn.classList.contains('is--disabled')) return 'DISABLED';
    btn.click();
    return 'CLICKED';
  });
  return clicked;
}

// ---------- 商品管理 解析（dxmCommodityProduct/index）----------
// 列：col_8 来源/图片, col_9 商品信息(SKU/名称/编码/分类), col_10 参考价,
//     col_11 重量, col_12 尺寸, col_13 状态, col_14 时间, col_15 操作
function extractProductRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      const cell = (colid) => row.querySelector(`[colid="${colid}"]`);
      const txt = (colid) => { const e = cell(colid); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : ''; };
      const c9 = cell('col_9');
      if (!c9) continue;
      const source = txt('col_8');
      const skuEl = c9.querySelector('a');
      const sku = skuEl ? (skuEl.innerText || '').replace(/\s+/g, ' ').trim() : '';
      const ps = Array.from(c9.querySelectorAll('p'));
      let name = '', code = '', cat = '';
      for (const p of ps) {
        const t = (p.innerText || '').replace(/\s+/g, ' ').trim();
        const mm = t.match(/\[([^\]]+)\]\s*\[([^\]]*)\]/);
        if (mm) { code = mm[1].trim(); cat = mm[2].trim(); }
        else if (!name) { name = t; }
      }
      const price = txt('col_10');
      const weight = txt('col_11');
      const size = txt('col_12');
      const status = txt('col_13');
      const timeRaw = txt('col_14');
      const createM = timeRaw.match(/创建[:：]\s*([\d\-: ]+)/);
      const updateM = timeRaw.match(/更新[:：]\s*([\d\-: ]+)/);
      out.push({
        来源: source,
        商品SKU: sku,
        商品名称: name,
        商品编码: code,
        分类: cat,
        参考价CNY: price,
        重量g: weight,
        尺寸cm: size,
        状态: status,
        创建时间: createM ? createM[1].trim() : '',
        更新时间: updateM ? updateM[1].trim() : '',
      });
    }
    return out;
  });
}

// ---------- 自营仓库 出入记录 解析（privateWarehouse/entryAndExitRecordList）----------
// 结构特殊：每条记录 = 主行(col_10~col_22, 13 格) + 紧跟的明细行(cellCount=1,
//   仅 col_13 含「附加信息：流水号:XX 查看更多」)。主行 col_10/11/12 有 rowspan=2。
// 列：col_11 时间, col_12 商品信息, col_13 原库存, col_14 变动, col_15 新库存,
//     col_16 仓库/操作人, col_17 货架位/区域, col_18 原单价, col_19 入库价,
//     col_20 新单价, col_21 类型, col_22 操作
function extractEntryExitRows(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.vxe-body--row'));
    const out = [];
    for (const row of rows) {
      const hasPrimary = row.querySelector('[colid="col_12"]');
      if (hasPrimary) {
        const cell = (colid) => row.querySelector(`[colid="${colid}"]`);
        const txt = (colid) => { const e = cell(colid); return e ? (e.innerText || '').replace(/\s+/g, ' ').trim() : ''; };
        const time = txt('col_11');
        const product = txt('col_12');
        const oldStock = txt('col_13');
        const change = txt('col_14');
        const newStock = txt('col_15');
        const whRaw = txt('col_16');
        const whM = whRaw.match(/^(.*?)\s*操作人[:：]\s*(.*)$/);
        const warehouse = whM ? whM[1].trim() : whRaw;
        const operator = whM ? whM[2].trim() : '';
        const locRaw = txt('col_17');
        const locM = locRaw.match(/^(.*?)\s*拣货区\s*(.*)$/);
        const shelf = locM ? locM[1].trim() : locRaw;
        const zone = locM ? (locM[2].trim() || '拣货区') : '';
        out.push({
          时间: time,
          商品信息: product,
          原库存: oldStock,
          变动: change,
          新库存: newStock,
          仓库: warehouse,
          操作人: operator,
          货架位: shelf,
          区域: zone,
          原单价CNY: txt('col_18'),
          入库价CNY: txt('col_19'),
          新单价CNY: txt('col_20'),
          类型: txt('col_21'),
          流水号: '',
          来源单号: '',
        });
      } else {
        // 明细行：提取流水号 + 来源单号，挂到上一条主记录
        // 实测文本：附加信息： 流水号:IN0016711630016124 来源单号:PO1JZZU005390 查看更多 >>
        const c13 = row.querySelector('[colid="col_13"]');
        if (c13) {
          const t = (c13.innerText || '').replace(/\s+/g, ' ').trim();
          const mNo = t.match(/流水号[:：]?\s*(\S+)/);
          const mSrc = t.match(/来源单号[:：]?\s*(\S+)/);
          if (out.length) {
            if (mNo) out[out.length - 1].流水号 = mNo[1];
            if (mSrc) out[out.length - 1].来源单号 = mSrc[1];
          }
        }
      }
    }
    return out;
  });
}

module.exports = { connectDxm, ensureLoggedIn, ensureLoggedInAt, waitForTable, extractRows, extractProductRows, extractEntryExitRows, getPagination, goNextPage, sleep };
