// 落盘工具：原子写入 + CSV + XLSX + 运行日志 + meta
// 原则：先写 .tmp 再原子替换；任一环节失败都不破坏旧数据
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function atomicWrite(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data);
  // 重试：目标可能被 Excel / 杀软短暂占用
  for (let attempt = 0; attempt <= 6; attempt++) {
    try {
      fs.renameSync(tmp, filePath);
      return filePath;
    } catch (e) {
      if (attempt === 6) break;
      const t0 = Date.now(); while (Date.now() - t0 < 1200) { /* busy-wait 1.2s */ }
    }
  }
  // 仍失败：目标大概率被 Excel 占用锁定，写到不被锁的新文件名，绝不丢数据
  const ext = path.extname(filePath) || '.bin';
  const fb = filePath.replace(/(\.xlsx|\.xls|\.csv|\.json)$/i, '') + '.locked' + ext;
  try { fs.renameSync(tmp, fb); } catch (_) { fs.writeFileSync(fb, data); }
  return fb;
}

function writeJson(filePath, obj) {
  return atomicWrite(filePath, JSON.stringify(obj, null, 2));
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // 防止 Excel 把长数字串转成科学计数法
  if (/^\d{12,}$/.test(s)) s = '\t' + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  const cols = columns && columns.length ? columns : Object.keys(rows[0] || {});
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return '\ufeff' + lines.join('\r\n'); // BOM 让 Excel 正确识别 UTF-8
}

function writeCsv(filePath, rows, columns) {
  return atomicWrite(filePath, toCsv(rows, columns));
}

function writeXlsx(filePath, rows, sheetName) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'data').slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return atomicWrite(filePath, buf);
}

function makeLogger(logDir) {
  ensureDir(logDir);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const file = path.join(logDir, `fetch-${stamp}.log`);
  const lines = [];
  const push = (level, msg) => {
    const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
    lines.push(line);
    console.log(line);
  };
  return {
    file,
    lines,
    info: (m) => push('INFO', m),
    warn: (m) => push('WARN', m),
    error: (m) => push('ERR ', m),
    step: (m) => push('STEP', m),
    flush() {
      fs.appendFileSync(file, lines.join('\n') + '\n', 'utf8');
      return file;
    },
  };
}

// 读取导出的原始文件（xlsx / xls / csv 都支持）
function readTable(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return { sheetName: wb.SheetNames[0], rows, sheetNames: wb.SheetNames };
}

module.exports = {
  ensureDir,
  atomicWrite,
  writeJson,
  writeCsv,
  writeXlsx,
  toCsv,
  makeLogger,
  readTable,
};
