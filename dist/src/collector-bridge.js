// 采集桥：一跨调 ecom 的 collector 模块（1688 链接 → SKU 表 + 图片 + _URL.txt）。
//
// 为什么又是桥而不是移植：collector/ 是 ecom 已经跑通的采集实现（AliPrice 扩展驱动），
// 包含反爬处理、图片下载、SKU 表双币种归一化（CNY 的「价格」要显式改名「供货价」，
// 否则 src/erp_sku_table 会以双币种冲突拒绝）。重写等于重踩一遍这些坑。
//
// 三个必须踩准的点（都是实测出来的）：
//   1. **必须 bypass 系统代理**：这台机器有 HTTP_PROXY=127.0.0.1:65336，
//      playwright 的 connectOverCDP 会走代理，连 127.0.0.1:9224 直接返回 502。
//      所以要显式设 NO_PROXY。
//   2. **python 用 ecom 的 venv**，cwd 必须是 ecom 根（collector 是包，要能 import）。
//   3. **manifest 是必填入口**：collector 从 manifest 读产品清单，不直接吃 URL。
//      所以这里要把单个 URL 包成一条 manifest 再喂给它。

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ECOM_ROOT = process.env.ECOM_ROOT || 'D:\\ecom-translator';
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;

// 采集独占 9224 浏览器，并发会互相踩标签页；用 promise 链串行，失败也续链。
let gate = Promise.resolve();

/** 从 1688 商品链接里取 product_id。取不到返回空串。 */
export function productIdFromUrl(url) {
  const text = String(url || '');
  const m = text.match(/offer\/(\d{6,})\.html/i) || text.match(/[?&](?:offerId|id)=(\d{6,})/i);
  return m ? m[1] : '';
}

/**
 * 跑一次采集。
 *
 * @param {object} opts
 * @param {string} opts.url          1688 商品链接
 * @param {string} [opts.title]      产品名（manifest 需要；缺省用 product_id 占位，仅影响日志可读性）
 * @param {string} [opts.mode]       none=只采集 / listing=采集+搬运+生成 Listing
 * @param {string} [opts.stagingDir] 采集暂存目录
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.ecomRoot]
 * @returns {Promise<{ok:boolean,status:string,productId:string,stdout:string,error:string,durationMs:number}>}
 */
export async function runCollector(opts = {}) {
  const run = () => runInner(opts);
  const queued = gate.then(run, run);
  gate = queued.then(() => undefined, () => undefined);
  return queued;
}

async function runInner({ url, title = '', mode = 'none', stagingDir, timeoutMs = DEFAULT_TIMEOUT_MS, ecomRoot } = {}) {
  const startedAt = Date.now();
  const done = (status, error, extra = {}) => ({
    ok: false, status, error, productId: '', stdout: '', durationMs: Date.now() - startedAt, ...extra,
  });

  const productId = productIdFromUrl(url);
  if (!productId) return done('INVALID_URL', `无法从链接中提取 1688 商品ID：${url || '(空)'}`);

  const root = path.resolve(ecomRoot || ECOM_ROOT);
  const python = path.join(root, '.venv', 'Scripts', 'python.exe');
  if (!existsSync(python)) return done('PYTHON_MISSING', `找不到 ecom 的 python：${python}`, { productId });
  if (!existsSync(path.join(root, 'collector'))) return done('COLLECTOR_MISSING', `找不到 collector 模块：${root}`, { productId });

  const staging = path.resolve(stagingDir || path.join(root, '_verify', 'collect-staging'));
  await mkdir(staging, { recursive: true });

  // 单条 manifest：collector 只认这个入口
  const manifestPath = path.join(staging, `manifest-${productId}.json`);
  const manifest = {
    generated_at: new Date().toISOString(),
    source_file: '(inline from 一跨)',
    sheet: '',
    column_map: {},
    unmapped_columns: [],
    count: 1,
    skipped: [],
    products: [
      {
        product_id: productId,
        title: String(title || '').trim() || productId,
        package_dir: '',
        product_url: String(url).trim(),
        image_url: '',
        sheet_row: 2,
        fields: {},
      },
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const args = [
    '-m', 'collector.batch',
    '--manifest', manifestPath,
    '--ids', productId,
    '--limit', '1',
    '--mode', mode,
    '--staging', staging,
    '--force',
  ];

  // 关键：让 playwright 连 CDP 时不走系统代理，否则 127.0.0.1:9224 会被代理拦成 502
  const env = Object.assign({}, process.env, {
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const child = spawn(python, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else child.kill('SIGKILL');
      } catch { /* 已退出 */ }

      // collector 用「=== 试跑小结 ===」区块汇报成功/失败计数，按它判结果最准
      const m = stdout.match(/数量：(\d+)\s*成功\s*(\d+)\s*待复核\s*(\d+)\s*失败\s*(\d+)\s*跳过\s*(\d+)/);
      const succeeded = m ? Number(m[2]) : 0;
      const failed = m ? Number(m[4]) : 0;
      const skipped = m ? Number(m[5]) : 0;
      const ok = status === 'OK' && (succeeded > 0 || skipped > 0);

      // 失败原因优先用输出里的真实原因行：「退出码 1」这种只说明进程非零退出，
      // 对排查毫无用处（实测踩到：真因是「未找到下载图片按钮」，却被退出码盖住了）。
      const rawError = error && !/^退出码/.test(error) ? error : '';
      const finalError = ok ? '' : (extractError(stdout, stderr) || rawError || '采集失败（未取到原因行）');

      resolve({
        ok,
        status: ok ? (succeeded > 0 ? 'COLLECTED' : 'SKIPPED_ALREADY')
          : (failed > 0 ? 'COLLECT_FAILED' : status),
        productId,
        counts: m ? { total: Number(m[1]), succeeded, review: Number(m[3]), failed, skipped } : null,
        stdout: stdout.slice(-2000),
        error: finalError,
        durationMs: Date.now() - startedAt,
        mode,
      });
    };

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (e) => finish('SPAWN_FAILED', e.message));
    child.on('close', (code) => finish(code === 0 ? 'OK' : 'EXIT_NONZERO', code === 0 ? '' : `退出码 ${code}`));

    timer = setTimeout(() => finish('TIMEOUT', `超过 ${Math.round(timeoutMs / 1000)}s 未结束`), timeoutMs);
  });
}

/** 从 collector 输出里挑出最像失败原因的一行。 */
function extractError(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 优先取明细行「→ 失败：xxx」——汇总行「数量：1 成功 0 … 失败 1」也含「失败」，
  // 但它只说明有几个失败，不说明为什么失败，对排查没用（实测踩过两次）。
  const detail = [...lines].reverse().find((l) => /→\s*失败\s*[：:]/.test(l));
  if (detail) return detail.replace(/^.*?→\s*失败\s*[：:]\s*/, '').slice(0, 500);

  const hit = [...lines].reverse().find((l) => /Error|错误|未找到|拒绝|超时/.test(l));
  return (hit || '').slice(0, 500) || '采集失败（未取到原因行）';
}

/**
 * 把暂存区里通过自检的产品包搬进 input/，并（可选）接续流水线。
 *
 * collector 的 --promote 语义：先搬运，再按 --mode 提交给 ecom 控制台(8765)。
 *   mode='none'    只搬不提交（安全的搬运验证）
 *   mode='listing' 搬运 + 原图导入 + 生成 Listing（不翻译）
 * collector 的 mode 只有 none/listing/full_original/full 这几档，**没有「只到 ERP 计划」**，
 * 所以「生成 Listing 后停下等人确认」需要分两次提交（见 server 侧）。
 *
 * @returns {Promise<{ok:boolean,status:string,moved:string[],skipped:Array,stdout:string,error:string,durationMs:number}>}
 */
export async function promoteStaging({ stagingDir, mode = 'none', timeoutMs = 60 * 60 * 1000, ecomRoot } = {}) {
  const startedAt = Date.now();
  const root = path.resolve(ecomRoot || ECOM_ROOT);
  const python = path.join(root, '.venv', 'Scripts', 'python.exe');
  const fail = (status, error) => ({ ok: false, status, moved: [], skipped: [], stdout: '', error, durationMs: Date.now() - startedAt });

  if (!stagingDir) return fail('INVALID_ARGS', '缺少 stagingDir');
  if (!existsSync(python)) return fail('PYTHON_MISSING', `找不到 ecom 的 python：${python}`);
  const staging = path.resolve(stagingDir);
  if (!existsSync(staging)) return fail('STAGING_MISSING', `暂存区不存在：${staging}`);

  const args = ['-m', 'collector.batch', '--promote', '--mode', mode, '--staging', staging];
  const env = Object.assign({}, process.env, {
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const child = spawn(python, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else child.kill('SIGKILL');
      } catch { /* 已退出 */ }

      const moved = [];
      for (const m of stdout.matchAll(/^\s*✓\s+(.+)$/gm)) moved.push(m[1].trim());
      const skipped = [];
      for (const m of stdout.matchAll(/^\s*-\s*跳过\s+(.+?)：(.+)$/gm)) skipped.push({ package: m[1].trim(), reason: m[2].trim() });

      const submitted = /已提交控制台/.test(stdout);
      const ok = status === 'OK' && (moved.length > 0 || submitted);
      const rawError = error && !/^退出码/.test(error) ? error : '';
      const finalError = ok ? '' : (extractPipelineError(stdout, stderr) || rawError || '搬运失败（未取到原因行）');

      resolve({
        ok,
        status: ok ? (submitted ? 'SUBMITTED' : 'PROMOTED') : 'PROMOTE_FAILED',
        moved,
        skipped,
        submitted,
        mode,
        stdout: stdout.slice(-2500),
        error: finalError,
        durationMs: Date.now() - startedAt,
      });
    };

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (e) => finish('SPAWN_FAILED', e.message));
    child.on('close', (code) => finish(code === 0 ? 'OK' : 'EXIT_NONZERO', code === 0 ? '' : `退出码 ${code}`));
    timer = setTimeout(() => finish('TIMEOUT', `超过 ${Math.round(timeoutMs / 1000)}s 未结束`), timeoutMs);
  });
}

/** 搬运/提交流程的错误行（和采集的「→ 失败」格式不同）。 */
function extractPipelineError(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const hit = [...lines].reverse().find((l) => /\[错误\]|\[警告\]|控制台不可用|PipelineError|失败/.test(l));
  return (hit || '').replace(/^\[(错误|警告)\]\s*/, '').slice(0, 500);
}

/**
 * 提交一个流水线任务给 ecom 控制台（异步：提交即返回 job_id，任务在 8765 后台跑）。
 *
 * 用 python -c 走 collector.pipeline.submit_task 而不是自己拼 HTTP：
 * 那里已经处理了 store_id/template_id 默认值、探活、错误翻译。
 * 代码通过 stdin 传入（`python -`），避免中文路径在命令行上被编码破坏。
 *
 * acknowledge_blocking 默认 true：台账里的复发项多是本地模型类（O-049/O-100），
 * 与纯计划阶段无关；放行会记入任务日志。要更严格就传 false。
 */
export async function submitPipelineTask({
  packageDirs = [], mode = 'erp_plan', acknowledgeBlocking = true,
  timeoutMs = 120000, ecomRoot,
} = {}) {
  const startedAt = Date.now();
  const root = path.resolve(ecomRoot || ECOM_ROOT);
  const python = path.join(root, '.venv', 'Scripts', 'python.exe');
  const fail = (status, error) => ({ ok: false, status, jobId: '', error, durationMs: Date.now() - startedAt });

  if (!Array.isArray(packageDirs) || !packageDirs.length) return fail('INVALID_ARGS', '缺少 packageDirs');
  if (!existsSync(python)) return fail('PYTHON_MISSING', `找不到 ecom 的 python：${python}`);

  const script = [
    'import json',
    'from collector.pipeline import submit_task',
    `dirs = ${JSON.stringify(packageDirs)}`,
    `r = submit_task(dirs, mode=${JSON.stringify(mode)}, acknowledge_blocking=${acknowledgeBlocking ? 'True' : 'False'})`,
    "resp = r.get('response') or {}",
    "print('__RESULT__' + json.dumps({'job_id': resp.get('job_id', ''), 'mode': resp.get('mode', '')}))",
  ].join('\n');

  const env = Object.assign({}, process.env, {
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
    PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8',
  });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const child = spawn(python, ['-'], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    const finish = (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else child.kill('SIGKILL');
      } catch { /* 已退出 */ }

      const line = stdout.split(/\r?\n/).find((l) => l.startsWith('__RESULT__'));
      let jobId = '';
      if (line) { try { jobId = JSON.parse(line.slice('__RESULT__'.length)).job_id || ''; } catch { /* ignore */ } }

      const ok = status === 'OK' && Boolean(jobId);
      resolve({
        ok,
        status: ok ? 'SUBMITTED' : 'SUBMIT_FAILED',
        jobId,
        stdout: stdout.slice(-1500),
        error: ok ? '' : (extractPipelineError(stdout, stderr) || error || '提交失败（未取到原因）'),
        durationMs: Date.now() - startedAt,
      });
    };

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (e) => finish('SPAWN_FAILED', e.message));
    child.on('close', (code) => finish(code === 0 ? 'OK' : 'EXIT_NONZERO', code === 0 ? '' : `退出码 ${code}`));

    try { child.stdin.write(script); child.stdin.end(); } catch { /* 已退出 */ }
    timer = setTimeout(() => finish('TIMEOUT', `超过 ${Math.round(timeoutMs / 1000)}s 未结束`), timeoutMs);
  });
}

/**
 * 读 ecom 的任务状态（直接读状态文件，不必走 HTTP）。
 * 注意状态文件里的 status 只有 RUNNING/PAUSED/INTERRUPTED/COMPLETED/ERROR 这几种，
 * 面板上那个「RUNNING + 可能已过期」来自另一个文件 runtime_status.json，别读错。
 */
export async function readPipelineJobState({ ecomRoot } = {}) {
  const root = path.resolve(ecomRoot || ECOM_ROOT);
  const statePath = path.join(root, 'work', 'operations', 'job_state.json');
  try {
    const raw = await readFile(statePath, 'utf8');
    const s = JSON.parse(raw);
    const stages = Array.isArray(s.stages) ? s.stages : [];
    return {
      ok: true,
      status: String(s.status || ''),
      jobId: String(s.job_id || ''),
      mode: String(s.mode || ''),
      currentStage: String(s.current_stage || ''),
      stages: stages.map((x) => ({ stage: x.stage, status: x.status, reason: x.reason || '' })),
      productDirs: Array.isArray(s.product_dirs) ? s.product_dirs : [],
      updatedAt: String(s.started_at || ''),
    };
  } catch (e) {
    return { ok: false, status: '', jobId: '', mode: '', currentStage: '', stages: [], productDirs: [], error: e.message };
  }
}
