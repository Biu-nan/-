// 子进程桥：一跨调用 ecom 的 dianxiaomi_draft_executor.mjs 执行上架草稿流程。
//
// 为什么是子进程桥而不是移植代码：
//   ecom 的 tools/dianxiaomi_draft_executor.mjs（932 行）已经跑通完整 SOP ——
//   引用模板 → 填 19 个字段 → 按 sku_plan 勾变种 → 自定义名/SKU图 → 主图/营销图/
//   描述图 → 保存前回读 → （可选）存草稿 + 待发布列表校验。
//   移植它意味着重写 932 行 + 长期双份维护；子进程调用保真度 100% 且零维护成本。
//
// 这个桥只做四件事：拼命令、管并发、收结果、把 audit 读回来。
// 它**不解析 field_plan**，也不做任何字段级决策 —— 那些都在 executor 里。
//
// 红线：executor 文件头明写「can only save or update drafts; it has no publish action」。
// commit 默认 false，即 FILL_VERIFY（只填不保存）。

import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ECOM_ROOT = process.env.ECOM_ROOT || 'D:\\ecom-translator';
const EXECUTOR_REL = path.join('tools', 'dianxiaomi_draft_executor.mjs');
const DEFAULT_CDP = process.env.CDP || 'http://127.0.0.1:9223';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

// 串行闸：executor 独占一个 CDP 浏览器，并发跑会互相抢标签页。
// 用一条模块级 promise 链把调用排队，且**失败也释放**（finally 里续链）。
let gate = Promise.resolve();

/**
 * 跑一次草稿执行。
 *
 * @param {object} opts
 * @param {string} opts.planPath  产品包下的 erp/field_plan.json
 * @param {string} opts.outDir    audit 与失败截图输出目录
 * @param {boolean} [opts.commit] true=存草稿；默认 false=只填不保存
 * @param {string} [opts.editUrl] 更新已有草稿时的编辑页 URL
 * @param {string} [opts.cdpUrl]  CDP 地址，默认 9223
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.ecomRoot] 覆盖 ecom 根目录（测试用）
 * @returns {Promise<{ok:boolean,status:string,steps:Array,attention:Array,error:string,audit:object|null,auditPath:string,durationMs:number}>}
 */
export async function runDraftExecutor(opts = {}) {
  const run = () => runInner(opts);
  const queued = gate.then(run, run);
  // 无论成败都要续链，否则一次失败会把后续调用全部堵死
  gate = queued.then(() => undefined, () => undefined);
  return queued;
}

async function runInner({ planPath, outDir, commit = false, editUrl = '', cdpUrl, timeoutMs = DEFAULT_TIMEOUT_MS, ecomRoot } = {}) {
  const startedAt = Date.now();
  const fail = (status, error, extra = {}) => ({
    ok: false, status, error, steps: [], attention: [], audit: null, auditPath: '', durationMs: Date.now() - startedAt, ...extra,
  });

  if (!planPath) return fail('BRIDGE_INVALID', '缺少 planPath');
  if (!outDir) return fail('BRIDGE_INVALID', '缺少 outDir');

  // 路径必须统一成绝对路径再传给 executor。
  // 踩过：调用方传 Git Bash 风格 '/tmp/xxx' 时，Node 会把它解析成当前盘符根下的
  // \tmp\xxx，而 executor 子进程可能解析到别处 —— 结果 audit 写在一处、桥去另一处读，
  // 表现为「执行成功但 steps=0、auditPath 为空」。两边用同一个 resolve 后的值即可对齐。
  const absPlan = path.resolve(planPath);
  const absOut = path.resolve(outDir);

  const root = ecomRoot || ECOM_ROOT;
  const executor = path.join(root, EXECUTOR_REL);
  if (!existsSync(executor)) return fail('BRIDGE_EXECUTOR_MISSING', `找不到执行器：${executor}`);
  if (!existsSync(absPlan)) return fail('BRIDGE_PLAN_MISSING', `找不到 field_plan：${absPlan}`);

  await mkdir(absOut, { recursive: true });

  const args = [executor, '--plan', absPlan, '--out', absOut];
  if (commit) args.push('--commit');
  if (editUrl) args.push('--edit-url', editUrl);

  const env = Object.assign({}, process.env, { CDP: cdpUrl || DEFAULT_CDP });

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;

    const child = spawn(process.execPath, args, {
      cwd: root,            // executor 内部按相对位置找同目录工具，cwd 必须是 ecom 根
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const finish = async (status, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // executor 会派生 Chrome 交互，单纯 kill 直接子进程会留下孙进程
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else child.kill('SIGKILL');
      } catch { /* 进程可能已退出 */ }

      const auditPath = path.join(absOut, 'draft_execution_audit.json');
      let audit = null;
      try { audit = JSON.parse(await readFile(auditPath, 'utf8')); } catch { /* 没产出就留 null */ }

      // executor 成功时最后一行是 { status, audit, attention, error }
      let tail = null;
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try { tail = JSON.parse(lines[i]); break; } catch { /* 继续往前找 */ }
      }

      const finalStatus = (tail && tail.status) || (audit && audit.status) || status;
      const finalError = error || (tail && tail.error) || (audit && audit.error) || stderr.trim().slice(-800) || '';
      const ok = finalStatus === 'DRAFT_VERIFIED' || finalStatus === 'FILLED_NOT_SAVED'
        || finalStatus === 'DRAFT_REVIEW';

      resolve({
        ok,
        status: finalStatus,
        error: finalError,
        steps: (audit && Array.isArray(audit.steps)) ? audit.steps : [],
        attention: (tail && Array.isArray(tail.attention)) ? tail.attention
          : ((audit && Array.isArray(audit.attention)) ? audit.attention : []),
        audit,
        auditPath: existsSync(auditPath) ? auditPath : '',
        durationMs: Date.now() - startedAt,
        committed: !!commit,
      });
    };

    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });

    child.on('error', (e) => finish('BRIDGE_SPAWN_FAILED', e.message));
    child.on('close', (code) => {
      if (code === 0) finish('OK', '');
      else finish(code === null ? 'BRIDGE_TIMEOUT' : 'BRIDGE_EXIT_NONZERO', `执行器退出码 ${code}`);
    });

    timer = setTimeout(() => finish('BRIDGE_TIMEOUT', `超过 ${Math.round(timeoutMs / 1000)}s 未结束`), timeoutMs);
  });
}
