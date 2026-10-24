// C6R 数据存储规范
//   <dataRoot>/
//     raw/YYYY-MM-DD/          每轮抓取的原始快照（带时间戳，绝不覆盖）
//     normalized/YYYY-MM-DD/   清洗/派生结果（另存，不动原始文件）
//     master/                  采购主数据（按版本保存）
//     manifests/YYYY-MM-DD.json 每轮 manifest
//     logs/YYYY-MM-DD.log      每轮日志
// 复用 output.cjs 的原子写入；原始文件只增不改。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const out = require('./output.cjs');

function layout(dataRoot) {
  const p = {
    root: dataRoot,
    rawRoot: path.join(dataRoot, 'raw'),
    normalizedRoot: path.join(dataRoot, 'normalized'),
    masterDir: path.join(dataRoot, 'master'),
    manifestDir: path.join(dataRoot, 'manifests'),
    logDir: path.join(dataRoot, 'logs'),
  };
  return p;
}

function dateDir(baseDir, dateStr) {
  const d = path.join(baseDir, dateStr);
  out.ensureDir(d);
  return d;
}

function rawDay(dataRoot, dateStr) { return dateDir(layout(dataRoot).rawRoot, dateStr); }
function normalizedDay(dataRoot, dateStr) { return dateDir(layout(dataRoot).normalizedRoot, dateStr); }
function masterDir(dataRoot) { return out.ensureDir(layout(dataRoot).masterDir); }

// 快照文件名：<prefix>_YYYYMMDD-HHMMSS.<ext>
function snapshotName(prefix, stamp, ext) { return `${prefix}_${stamp}.${ext}`; }

function writeSnapshot(dir, prefix, stamp, rows, sheet, columns) {
  const f = {
    json: path.join(dir, snapshotName(prefix, stamp, 'json')),
    csv: path.join(dir, snapshotName(prefix, stamp, 'csv')),
    xlsx: path.join(dir, snapshotName(prefix, stamp, 'xlsx')),
  };
  out.writeJson(f.json, { source: prefix, capturedAt: new Date().toISOString(), rowCount: rows.length, columns: columns || (rows[0] ? Object.keys(rows[0]) : []), rows });
  out.writeCsv(f.csv, rows, columns);
  const xlsxReal = out.writeXlsx(f.xlsx, rows, (sheet || prefix).slice(0, 31));
  return { files: f, xlsxReal, sha256: sha256File(xlsxReal) };
}

function writeManifest(dataRoot, dateStr, obj) {
  const dir = out.ensureDir(layout(dataRoot).manifestDir);
  const file = path.join(dir, `${dateStr}.json`);
  out.writeJson(file, obj);
  return file;
}

function readManifest(dataRoot, dateStr) {
  const file = path.join(layout(dataRoot).manifestDir, `${dateStr}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function sha256Str(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

// 列出某日 raw 快照（用于幂等/覆盖检查）
function listRawSnapshots(dataRoot, dateStr) {
  const dir = path.join(layout(dataRoot).rawRoot, dateStr);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    return { name: f, path: fp, size: st.size, mtime: st.mtime.toISOString() };
  });
}

module.exports = { layout, rawDay, normalizedDay, masterDir, snapshotName, writeSnapshot, writeManifest, readManifest, sha256File, sha256Str, listRawSnapshots };
