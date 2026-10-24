// 一次性恢复脚本：把规划 Prompt Pack 的实际内容（之前被截断）从 ChatGPT 会话里抓回来，
// 写回 run-state.json，让 MVP4 能正常 extractImagePrompt(... Image 1) 拿到 prompt，
// 用户随后点「继续当前上品流程」即接 MVP4 generateImages()。
//
// 用法：
//   1) 确认 Chrome 已带 --remote-debugging-port=9223 启动并打开目标 chatUrl 会话
//   2) node scripts/recover-planning-pack.mjs [--dry-run]
//   3) 若 success=true 且 ready=true：用户点工作台「继续」即可进入生图
//      若 success=false：原因多为 ChatGPT 还在生成中，等 ChatGPT 完成后再跑一次

import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const CDP_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9223';
const RUN_STATE = 'F:\\yikuaborder-deploy\\run-state.json';
const DRY_RUN = process.argv.includes('--dry-run');

const USER_FINGERPRINTS = ['Single Image Prompt Pack', '视觉规划自动补全指令'];
const NEEDED_MARKERS = (() => {
  const m = [];
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(2, '0');
    m.push(`<<<IMAGE_${n}_PROMPT_START>>>`);
    m.push(`<<<IMAGE_${n}_PROMPT_END>>>`);
  }
  return m;
})();

function log(...args) { console.log('[recover-planning]', ...args); }

async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('CDP 没有可用 context（Chrome 可能未完成会话恢复）');
  return { browser, ctx };
}

// 提取页面上所有 [user|assistant] 消息的有序序列
async function getSequence(page) {
  const handles = await page.locator(
    '[data-message-author-role="user"], [data-message-author-role="assistant"]'
  ).elementHandles();
  const out = [];
  for (const h of handles) {
    const role = await h.getAttribute('data-message-author-role').catch(() => null);
    if (role !== 'user' && role !== 'assistant') continue;
    // 读完整文本（含 markdown 渲染后的纯文本）
    const text = await h.evaluate((el) => el.innerText || el.textContent || '').catch(() => '');
    if (!text) continue;
    out.push({ role, text });
  }
  return out;
}

// 给定序列 + 用户消息 index，返回它之后全部 assistant 文本拼接
function assistantResponseAfter(sequence, userIndex) {
  const parts = [];
  for (let i = userIndex + 1; i < sequence.length; i++) {
    const m = sequence[i];
    if (m.role === 'assistant' && m.text) {
      // 同一个 fingerprint 再发一次的情况，要把同一 prompt 后所有的 assistant 都收
      parts.push(m.text);
    }
  }
  return parts.length ? parts.join('\n\n').trim() : '';
}

// 检查文本中 20 个 marker 是否齐全
function checkMarkers(text) {
  const missing = NEEDED_MARKERS.filter((m) => !text.includes(m));
  return { ok: missing.length === 0, missing };
}

async function pickTargetPage(ctx) {
  // 优先选 url 命中 chatgpt.com/c/<id> 的页面；都没有就回退到第一个 chatgpt 页面
  const pages = ctx.pages();
  let target = pages.find((p) => /chatgpt\.com\/c\//.test(p.url()));
  if (!target) target = pages.find((p) => /chatgpt\.com/.test(p.url()));
  return target;
}

async function main() {
  log('CDP:', CDP_URL, 'dry-run:', DRY_RUN);
  let browser, ctx;
  try {
    ({ browser, ctx } = await connect());
  } catch (e) {
    log('FAIL: 连不上 CDP —', e.message);
    process.exit(2);
  }
  const page = await pickTargetPage(ctx);
  if (!page) {
    log('FAIL: Chrome 内没有 chatgpt.com 页面');
    process.exit(3);
  }
  log('当前页面 URL:', page.url());

  const sequence = await getSequence(page);
  log(`捕获消息数: ${sequence.length}（user=${sequence.filter(m => m.role === 'user').length}, assistant=${sequence.filter(m => m.role === 'assistant').length}）`);

  // 先看每个用户消息的 fingerprint 与对应长度
  const userFps = sequence
    .map((m, i) => ({ i, role: m.role, fp: USER_FINGERPRINTS.find((f) => m.text.includes(f)) || null, len: m.text.length }))
    .filter((m) => m.role === 'user' && m.fp);

  log('匹配到的用户 fingerprint:');
  userFps.forEach((m) => log('  idx=', m.i, 'fp=', m.fp, 'msgLen=', m.len));

  // 策略：以最后一个匹配的 fingerprint 为锚点，把它之后所有 assistant 文本拼起来
  // 如果锚点是「视觉规划自动补全指令」或「Single Image Prompt Pack」最近一次，都 OK
  let anchorIdx = -1;
  let anchorFp = null;
  for (let i = sequence.length - 1; i >= 0; i--) {
    const m = sequence[i];
    if (m.role !== 'user') continue;
    const fp = USER_FINGERPRINTS.find((f) => m.text.includes(f));
    if (fp) {
      anchorIdx = i;
      anchorFp = fp;
      break;
    }
  }
  if (anchorIdx === -1) {
    log('FAIL: 找不到任何匹配 fingerprint 的用户消息');
    process.exit(4);
  }
  log('锚点:', anchorFp, 'idx=', anchorIdx);

  const recovered = assistantResponseAfter(sequence, anchorIdx);
  log(`拼接后回复长度: ${recovered.length} 字符`);

  const ck = checkMarkers(recovered);
  if (!ck.ok) {
    log('FAIL: 拼接结果缺 marker：', ck.missing.slice(0, 5).join(' / '), ck.missing.length > 5 ? `…(+${ck.missing.length - 5})` : '');
    log('诊断信息写入 run-state.json.lastPlanRecover.log（不覆盖状态）');
    try {
      fs.writeFileSync(
        path.join(path.dirname(RUN_STATE), 'run-state.lastPlanRecover.json'),
        JSON.stringify({ at: new Date().toISOString(), anchorFp, recoveredLen: recovered.length, missing: ck.missing, recoveredHead: recovered.slice(0, 800) }, null, 2),
        'utf8'
      );
    } catch (_) {}
    process.exit(5);
  }

  log('OK: 20 个 marker 完整，准备写回 run-state.json');

  const runStateRaw = fs.readFileSync(RUN_STATE, 'utf8');
  const runState = JSON.parse(runStateRaw);
  if (DRY_RUN) {
    log('DRY RUN：', { recoveredLen: recovered.length, missing: ck.missing });
    process.exit(0);
  }

  // 写回：清 error / stage=READY / completedPhase=MVP3 / promptPackValid=true
  runState.planningText = recovered;
  runState.promptPackValid = true;
  runState.completedPhase = 'MVP3';
  runState.error = undefined;
  runState.interruptedStage = undefined;
  runState.stage = 'READY';
  runState.running = false;
  runState.autoRun = false;
  runState.pauseRequested = false;
  runState.message = '已从 ChatGPT 会话补齐 Prompt Pack，可点击「继续当前上品流程」进入生图阶段';
  runState.updatedAt = new Date().toISOString();

  // 用 Project 的写入 helper（避免直接覆写踩 json-write-queue 信号），这里走两步：临时文件 + rename
  const tmp = RUN_STATE + '.recover.tmp';
  fs.writeFileSync(tmp, JSON.stringify(runState, null, 2), 'utf8');
  fs.renameSync(tmp, RUN_STATE);
  log('run-state.json 已更新。restored size:', recovered.length);
  process.exit(0);
}

main().catch((e) => {
  log('UNCAUGHT:', e?.stack || e?.message || String(e));
  process.exit(99);
});
