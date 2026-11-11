#!/usr/bin/env node
// 把 2026-11-11 CEO 路线图（G–L 共 34 卡）并入 docs/dev-board.html
//
// 背景：docs/CEO_SYSTEM_DEVELOPMENT_BACKLOG_2026-11-11.json 的「本轮范围」写明
// 要把 34 卡并入开发看板，但看板当时未接。本脚本按 JSON 生成卡面，**不改动既有 A–F 卡**。
//
// 原则：
//   · 幂等——已含 G 组则直接退出，不重复追加
//   · 只做规划呈现——全部标注 executionAuthorized=false，状态照抄 JSON（wait/idle）
//   · 可复跑——JSON 改了就重跑（先手工删掉旧 G–L 组，或加 --replace）
//   · 写盘前后各校验一次 LINES 数组可解析，校验失败不写盘
//
// 用法：
//   node scripts/apply-ceo-roadmap-board.mjs --dry-run     # 只打印将追加的分组与卡数
//   node scripts/apply-ceo-roadmap-board.mjs               # 追加（幂等）
//   node scripts/apply-ceo-roadmap-board.mjs --replace     # 先移除已有 G–L 组再重建

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOARD = path.join(ROOT, 'docs', 'dev-board.html');
const BACKLOG = path.join(ROOT, 'docs', 'CEO_SYSTEM_DEVELOPMENT_BACKLOG_2026-11-11.json');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const REPLACE = argv.includes('--replace');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 从 HTML 中切出 LINES 数组源码片段与边界 */
function sliceArray(html) {
  const marker = html.indexOf('const LINES =');
  if (marker < 0) throw new Error('找不到 `const LINES =`');
  const start = html.indexOf('[', marker);
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0 && c === ']') return { marker, start, end: i + 1 };
    }
  }
  throw new Error('LINES 数组未闭合');
}

const parseArray = (src) => new Function(`return ${src}`)();

/** 一张卡面：只呈现目标/验收/依赖/授权状态，不夹带任何"已开工"暗示 */
function cardOf(t, phaseById) {
  const bits = [];
  bits.push(`<b>${esc(t.priority)} · ${esc(phaseById[t.id] ?? '')} · 未授权</b>（<code>executionAuthorized=false</code>）`);
  if (t.objective) bits.push(`<b>目标</b>：${esc(t.objective)}`);
  if (t.acceptance?.length) {
    bits.push(`<b>验收</b>：${t.acceptance.map((a, i) => `${'①②③④⑤'[i] ?? i + 1 + '.'}${esc(a)}`).join('　')}`);
  }
  if (t.dependencies?.length) bits.push(`<b>依赖</b>：${t.dependencies.map(esc).join('、')}`);
  else bits.push('<b>依赖</b>：无');
  if (t.files?.length) bits.push(`<b>涉及</b>：${t.files.slice(0, 3).map((f) => `<code>${esc(f)}</code>`).join(' ')}${t.files.length > 3 ? ` 等 ${t.files.length} 项` : ''}`);
  if (t.approval) bits.push(`<b>授权</b>：${esc(t.approval)}`);
  if (t.risks) bits.push(`<b>风险</b>：${esc(t.risks)}`);
  if (t.blocked) bits.push('<b>当前：已被前置门阻塞</b>');
  return `    {id:${JSON.stringify(t.id)}, t:${JSON.stringify(t.title)}, s:${JSON.stringify(t.status)}, m:${JSON.stringify(bits.join('　·　'))}}`;
}

function main() {
  const backlog = JSON.parse(fs.readFileSync(BACKLOG, 'utf8'));
  const html = fs.readFileSync(BOARD, 'utf8');
  const { start, end } = sliceArray(html);
  const arrSrc = html.slice(start, end);
  const LINES = parseArray(arrSrc);
  const beforeCount = LINES.flatMap((g) => g.tasks).length;

  const existingGL = LINES.filter((g) => /^[G-L]\s/.test(g.key));
  if (existingGL.length && !REPLACE) {
    console.log(`已存在 ${existingGL.length} 个 G–L 组，无需追加（如需重建请加 --replace）`);
    process.exit(0);
  }

  const phaseById = {};
  for (const m of backlog.milestones ?? []) for (const id of m.tasks ?? []) phaseById[id] = m.id;

  const groups = (backlog.groups ?? []).map((g) => {
    const prefix = g.key.trim()[0];
    const tasks = (backlog.tasks ?? []).filter((t) => t.id.startsWith(prefix));
    return {
      key: g.key,
      note: `${g.phase ?? ''} · ${g.note ?? ''}`.replace(/^ · /, ''),
      tasks: tasks.map((t) => cardOf(t, phaseById)),
    };
  });
  const addCount = groups.reduce((s, g) => s + g.tasks.length, 0);

  console.log(`既有分组 ${LINES.length} 个 / 任务 ${beforeCount} 个`);
  console.log(`将追加 ${groups.length} 个分组 / ${addCount} 张卡：`);
  for (const g of groups) console.log(`  ${g.key}  (${g.tasks.length} 卡)  ${g.note}`);

  if (DRY) {
    console.log('\n[dry-run] 未写盘');
    process.exit(0);
  }

  const groupSrc = groups.map((g) =>
    `  {key:${JSON.stringify(g.key)}, note:${JSON.stringify(g.note)}, tasks:[\n${g.tasks.join(',\n')},\n  ]}`
  ).join(',\n');

  let newArrSrc;
  if (REPLACE && existingGL.length) {
    // 去掉已有的 G–L 组（按 key 前缀匹配整段对象）
    const kept = LINES.filter((g) => !/^[G-L]\s/.test(g.key));
    const keptSrc = arrSrc.trim().replace(/^\[/, '[').replace(/\]\s*$/, ']');
    // 用序列化后的既有组重建，避免手工切片
    const rebuilt = kept.map((g) => '  ' + JSON.stringify(g)).join(',\n');
    newArrSrc = `[\n${rebuilt}${kept.length ? ',\n' : ''}${groupSrc}\n]`;
    console.log(`\n[--replace] 移除既有 ${existingGL.length} 个 G–L 组后重建`);
  } else {
    newArrSrc = `${arrSrc.replace(/\]\s*$/, '')},\n${groupSrc}\n]`;
  }

  // 写盘前校验
  const check = parseArray(newArrSrc);
  const afterCount = check.flatMap((g) => g.tasks).length;
  if (afterCount !== (REPLACE ? beforeCount - existingGL.reduce((s, g) => s + g.tasks.length, 0) : beforeCount) + addCount) {
    throw new Error(`卡数校验不符：期望 ${beforeCount + addCount}，实得 ${afterCount}`);
  }
  for (const g of check) {
    for (const t of g.tasks) {
      if (!t.id || !t.t || !t.s) throw new Error(`卡面字段缺失: ${JSON.stringify(t).slice(0, 80)}`);
    }
  }

  const out = html.slice(0, start) + newArrSrc + html.slice(end);
  fs.writeFileSync(BOARD, out, 'utf8');
  console.log(`\n✅ 已写入 ${path.relative(ROOT, BOARD)}：分组 ${check.length} 个 / 任务 ${afterCount} 个`);
}

try { main(); } catch (e) { console.error('失败：', e.message); process.exit(1); }
