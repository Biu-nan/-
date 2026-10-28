// 草稿执行面板：在 queue 视图里调 /api/draft/execute。
//
// 这个面板本身不含任何上架逻辑 —— 它只负责把产品包名 POST 给后端，
// 后端再交给 ecom 的 dianxiaomi_draft_executor.mjs。这样做是为了让
// 「上架流程」永远只有一份实现（在 ecom），一跨这边只做入口和展示。
//
// 默认按钮是「只填不保存」（FILL_VERIFY）；「写草稿」必须二次确认，
// 且执行器本身没有发布能力，所以不存在误发风险。

(function () {
  const $ = (id) => document.getElementById(id);
  const badge = $('draftStatusBadge');
  const input = $('draftPackageInput');
  const fillBtn = $('draftFillButton');
  const commitBtn = $('draftCommitButton');
  const result = $('draftResult');
  if (!badge || !input || !fillBtn || !commitBtn || !result) return;

  const STEP_ICON = { SUCCESS: '✅', ATTENTION: '⚠️', ERROR: '❌' };
  const STATUS_TEXT = {
    FILLED_NOT_SAVED: '已填未保存',
    DRAFT_VERIFIED: '草稿已落库（已验证）',
    DRAFT_REVIEW: '草稿已落库（有需复核项）',
    ERROR: '失败',
  };

  // 页面是浅色主题：状态徽章用 pill 底色 + 深色文字，别用深色系的半透明。
  function setBadge(text, kind) {
    const MAP = {
      busy: { bg: '#fffbeb', fg: '#b45309' },
      ok: { bg: '#ecfdf5', fg: '#059669' },
      bad: { bg: '#fef2f2', fg: '#dc2626' },
      idle: { bg: '#f1f5f9', fg: '#64748b' },
    };
    const c = MAP[kind] || MAP.idle;
    badge.textContent = text;
    badge.style.background = c.bg;
    badge.style.color = c.fg;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(res) {
    result.style.display = 'block';
    const ok = !!res.ok;
    const steps = Array.isArray(res.steps) ? res.steps : [];
    const attention = Array.isArray(res.attention) ? res.attention : [];
    const statusText = STATUS_TEXT[res.status] || res.status || (ok ? '完成' : '失败');

    const stepRows = steps.map((s) => {
      const icon = STEP_ICON[s.status] || '·';
      const color = s.status === 'ERROR' ? '#dc2626' : (s.status === 'ATTENTION' ? '#b45309' : '#334155');
      const val = s.value == null ? '' : `<span style="color:#64748b;">${esc(JSON.stringify(s.value).slice(0, 90))}</span>`;
      const why = s.reason ? `<div style="color:#b45309;margin-left:20px;">${esc(s.reason)}</div>` : '';
      return `<div style="padding:3px 0;color:${color};">${icon} <strong>${esc(s.name)}</strong> ${val}${why}</div>`;
    }).join('');

    const attRows = attention.length
      ? `<div style="margin-top:12px;"><div style="color:#475569;margin-bottom:4px;">需人工复核（${attention.length}）</div>${
          attention.map((a) => `<div style="color:#64748b;padding:2px 0;">• ${esc(a)}</div>`).join('')
        }</div>`
      : '';

    const errBox = res.error
      ? `<div style="margin-top:12px;color:#dc2626;">失败原因：${esc(res.error)}</div>`
      : '';

    result.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;margin-bottom:10px;">
        <strong style="font-size:1.05em;color:${ok ? '#059669' : '#dc2626'};">${esc(statusText)}</strong>
        <span style="color:#64748b;">${steps.length} 步 · 用时 ${Math.round((res.durationMs || 0) / 1000)}s</span>
        <span style="color:#64748b;">${res.committed ? '已写草稿' : '未保存'}</span>
        ${res.auditPath ? `<span style="color:#94a3b8;font-size:.9em;">audit: ${esc(res.auditPath)}</span>` : ''}
      </div>
      ${errBox}
      <div style="max-height:420px;overflow:auto;border-top:1px solid #e2e8f0;padding-top:10px;font-size:.92em;">
        ${stepRows || '<div style="color:#94a3b8;">没有步骤记录（可能执行器未产出 audit）</div>'}
      </div>
      ${attRows}
    `;
  }

  async function run(commit) {
    const packageName = (input.value || '').trim();
    if (!packageName) {
      window.alert('请先填写产品包名（已完成产品/ 下的一级目录名）');
      input.focus();
      return;
    }
    if (commit && !window.confirm('将真实写入一条店小秘草稿（不发布）。确认继续？')) return;

    setBadge(commit ? 'RUNNING · 写草稿' : 'RUNNING · 只填', 'busy');
    fillBtn.disabled = true;
    commitBtn.disabled = true;
    result.style.display = 'block';
    result.textContent = commit
      ? '正在写草稿…（引用模板/填字段/上传图片通常 40–90 秒）'
      : '正在填表…（引用模板/填字段/上传图片通常 40–90 秒）';

    try {
      const resp = await fetch('/api/draft/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName, commit }),
      });
      const data = await resp.json();
      render(data);
      if (data.ok) setBadge(commit ? 'DONE · 已存草稿' : 'DONE · 已填未存', 'ok');
      else setBadge('FAILED', 'bad');
    } catch (e) {
      setBadge('REQUEST FAILED', 'bad');
      result.innerHTML = `<div style="color:#dc2626;">请求失败：${esc(e && e.message ? e.message : e)}</div>`;
    } finally {
      fillBtn.disabled = false;
      commitBtn.disabled = false;
    }
  }

  fillBtn.addEventListener('click', () => run(false));
  commitBtn.addEventListener('click', () => run(true));
})();

// ── 来源 URL 采集面板 ────────────────────────────────────────────────────
// 独立 IIFE：草稿面板那边有 `if (!badge ...) return` 的守卫，
// 塞进同一个闭包会被它拦掉（两个面板的元素不一定同时存在）。
(function () {
  const $ = (id) => document.getElementById(id);
  const badge = $('dossierBadge');
  const urlInput = $('dossierUrl');
  const titleInput = $('dossierTitle');
  const btn = $('dossierCollectButton');
  const result = $('dossierResult');
  if (!badge || !urlInput || !btn || !result) return;

  const MAP = {
    busy: { bg: '#fef3c7', fg: '#b45309' },
    ok: { bg: '#ecfdf5', fg: '#059669' },
    bad: { bg: '#fef2f2', fg: '#dc2626' },
    idle: { bg: '#f1f5f9', fg: '#64748b' },
  };

  function setBadge(text, kind) {
    const c = MAP[kind] || MAP.idle;
    badge.textContent = text;
    badge.style.background = c.bg;
    badge.style.color = c.fg;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  btn.addEventListener('click', async () => {
    const url = (urlInput.value || '').trim();
    if (!url) {
      window.alert('请先填写 1688 商品链接');
      urlInput.focus();
      return;
    }
    if (!/^https?:\/\/([a-z0-9-]+\.)*1688\.com\//i.test(url)) {
      window.alert('只接受 1688 商品链接（*.1688.com）');
      return;
    }

    setBadge('COLLECTING', 'busy');
    btn.disabled = true;
    result.style.display = 'block';
    result.innerHTML = '<div style="color:#475569;">正在采集…（打开 1688 页面 + 下载图片 + 归一化 SKU 表，通常 30 秒–3 分钟）</div>';

    try {
      const resp = await fetch('/api/collect/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: (titleInput.value || '').trim(), mode: 'none' }),
      });
      const d = await resp.json();

      if (d.ok) {
        setBadge('COLLECTED', 'ok');
        const c = d.counts || {};
        result.innerHTML = `
          <div style="color:#059669;font-weight:500;margin-bottom:8px;">采集成功 · 商品ID ${esc(d.productId)}</div>
          <div style="color:#475569;">成功 ${c.succeeded || 0} · 待复核 ${c.review || 0} · 失败 ${c.failed || 0} · 跳过 ${c.skipped || 0} · 用时 ${Math.round((d.durationMs || 0) / 1000)}s</div>
          <div style="color:#94a3b8;font-size:.9em;margin-top:6px;">产物已落采集暂存区，下一步可在 ecom 侧 promote 进 input/ 后继续 Listing。</div>`;
      } else {
        setBadge('FAILED', 'bad');
        const c = d.counts || {};
        result.innerHTML = `
          <div style="color:#dc2626;font-weight:500;margin-bottom:8px;">采集失败 · ${esc(d.status)}</div>
          ${d.productId ? `<div style="color:#475569;">商品ID ${esc(d.productId)}</div>` : ''}
          <div style="color:#dc2626;margin-top:6px;">${esc(d.error || '未取到原因')}</div>
          ${c.total ? `<div style="color:#64748b;margin-top:6px;">成功 ${c.succeeded || 0} · 失败 ${c.failed || 0} · 用时 ${Math.round((d.durationMs || 0) / 1000)}s</div>` : ''}
          <div style="color:#94a3b8;font-size:.9em;margin-top:8px;">若是「未找到下载图片按钮」，说明 9224 采集浏览器里的 AliPrice 扩展未加载。</div>`;
      }
    } catch (e) {
      setBadge('REQUEST FAILED', 'bad');
      result.innerHTML = `<div style="color:#dc2626;">请求失败：${esc(e && e.message ? e.message : e)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  // ── ② 生成上架资料：把暂存区搬进 input/ 并提交 8765 生成 Listing ──
  // 只开放 mode=none|listing（两个都不写草稿）。full_original 会一路写到
  // ERP_DRAFT（真建草稿），与「先生成资料、人工确认再上架」的意图不符。
  const genBtn = $('dossierGenerateButton');
  if (genBtn) {
    genBtn.addEventListener('click', async () => {
      const ok = window.confirm(
        '将把暂存区的产品包搬入 ecom 的 input/，然后依次生成 Listing 与 ERP 计划。\n\n'
        + '这是长任务（Listing 可能数分钟），期间请不要关闭页面。确认继续？'
      );
      if (!ok) return;

      setBadge('GENERATING', 'busy');
      genBtn.disabled = true;
      result.style.display = 'block';
      result.innerHTML = '<div style="color:#475569;">正在搬运并校验主图…</div>';

      try {
        const resp = await fetch('/api/dossier/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const d = await resp.json();

        if (!d.ok) {
          setBadge('BLOCKED', 'bad');
          const chk = (d.checked || []).map((x) => `<div style="color:#64748b;">${esc(x.name)}：主图 ${x.mains} 张</div>`).join('');
          result.innerHTML = `
            <div style="color:#dc2626;font-weight:500;margin-bottom:8px;">未提交 · ${esc(d.step || '')}</div>
            <div style="color:#dc2626;">${esc(d.error || '未取到原因')}</div>
            ${chk ? `<div style="margin-top:8px;">${chk}</div>` : ''}`;
          return;
        }

        // 提交成功 → 轮询状态（listing → plan → done）
        const runId = d.runId;
        let ticks = 0;
        while (ticks < 240) {
          ticks += 1;
          await new Promise((r) => setTimeout(r, 5000));
          const r2 = await fetch(`/api/dossier/status?runId=${encodeURIComponent(runId)}`);
          const s = await r2.json();
          if (!s.ok) {
            setBadge('STATUS LOST', 'bad');
            result.innerHTML = `<div style="color:#dc2626;">${esc(s.error || '状态查询失败')}</div>`;
            return;
          }
          const phaseText = { listing: '生成 Listing', plan: '生成 ERP 计划', done: '已完成', failed: '失败' }[s.phase] || s.phase;
          const stageText = (s.pipeline && s.pipeline.currentStage) ? ` · 当前阶段 ${esc(s.pipeline.currentStage)}` : '';
          setBadge(phaseText, s.phase === 'failed' ? 'bad' : (s.phase === 'done' ? 'ok' : 'busy'));
          const reasonRows = (s.reasons || [])
            .map((r) => `<div style="color:#b45309;margin-top:4px;">• [${esc(r.stage)}] ${esc(r.reason)}</div>`)
            .join('');
          const movedNote = (s.locations || []).some((l) => l.where === 'failed')
            ? '<div style="color:#b45309;margin-top:8px;">包已被流程移入「未成功上架产品」，补上资料后可重新发起。</div>'
            : '';
          result.innerHTML = `
            <div style="color:#334155;font-weight:500;">${esc(phaseText)}${stageText}</div>
            <div style="color:#64748b;margin-top:6px;">流水线状态 ${esc((s.pipeline && s.pipeline.status) || '-')} · job ${esc(s.jobId || '-')}</div>
            ${s.plansReady && s.plansReady.length ? `<div style="color:#059669;margin-top:6px;">✓ 已产出计划 ${s.plansReady.length} 个</div>` : ''}
            ${reasonRows}
            ${movedNote}
            ${s.error ? `<div style="color:#dc2626;margin-top:6px;">${esc(s.error)}</div>` : ''}`;

          if (s.phase === 'done' || s.phase === 'failed') {
            if (s.phase === 'done') {
              result.innerHTML += '<div style="color:#475569;margin-top:8px;">上架资料已生成。可以用下方 ③ 填充店小秘草稿（包在「已完成产品」或 ecom 的 output/ 下）。</div>';
            }
            return;
          }
        }
        setBadge('TIMEOUT', 'bad');
        result.innerHTML = '<div style="color:#b45309;">轮询超时（20 分钟），任务可能仍在后台运行，请到 8765 控制台查看。</div>';
      } catch (e) {
        setBadge('REQUEST FAILED', 'bad');
        result.innerHTML = `<div style="color:#dc2626;">请求失败：${esc(e && e.message ? e.message : e)}</div>`;
      } finally {
        genBtn.disabled = false;
      }
    });
  }
})();
