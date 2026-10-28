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

  function setBadge(text, kind) {
    badge.textContent = text;
    badge.style.opacity = '1';
    badge.dataset.kind = kind || '';
    if (kind === 'busy') badge.style.color = 'var(--warning, #d99)';
    else if (kind === 'ok') badge.style.color = 'var(--success, #6c6)';
    else if (kind === 'bad') badge.style.color = 'var(--danger, #f66)';
    else badge.style.color = '';
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
      const val = s.value == null ? '' : `<span style="opacity:.7;">${esc(JSON.stringify(s.value).slice(0, 90))}</span>`;
      const why = s.reason ? `<div style="opacity:.75;margin-left:20px;">${esc(s.reason)}</div>` : '';
      return `<div style="padding:3px 0;">${icon} <strong>${esc(s.name)}</strong> ${val}${why}</div>`;
    }).join('');

    const attRows = attention.length
      ? `<div style="margin-top:12px;"><div style="opacity:.8;margin-bottom:4px;">需人工复核（${attention.length}）</div>${
          attention.map((a) => `<div style="opacity:.8;padding:2px 0;">• ${esc(a)}</div>`).join('')
        }</div>`
      : '';

    const errBox = res.error
      ? `<div style="margin-top:12px;color:var(--danger,#f66);">失败原因：${esc(res.error)}</div>`
      : '';

    result.innerHTML = `
      <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:baseline;margin-bottom:10px;">
        <strong style="font-size:1.05em;color:${ok ? 'var(--success,#6c6)' : 'var(--danger,#f66)'};">${esc(statusText)}</strong>
        <span style="opacity:.7;">${steps.length} 步 · 用时 ${Math.round((res.durationMs || 0) / 1000)}s</span>
        <span style="opacity:.7;">${res.committed ? '已写草稿' : '未保存'}</span>
        ${res.auditPath ? `<span style="opacity:.6;font-size:.9em;">audit: ${esc(res.auditPath)}</span>` : ''}
      </div>
      ${errBox}
      <div style="max-height:420px;overflow:auto;border-top:1px solid rgba(128,128,128,.25);padding-top:10px;font-size:.92em;">
        ${stepRows || '<div style="opacity:.6;">没有步骤记录（可能执行器未产出 audit）</div>'}
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
      result.innerHTML = `<div style="color:var(--danger,#f66);">请求失败：${esc(e && e.message ? e.message : e)}</div>`;
    } finally {
      fillBtn.disabled = false;
      commitBtn.disabled = false;
    }
  }

  fillBtn.addEventListener('click', () => run(false));
  commitBtn.addEventListener('click', () => run(true));
})();
