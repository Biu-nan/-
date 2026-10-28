// 上架资料面板：① 采集原始资料 ② 生成上架信息并自动填充 ③ 可选写草稿
//
// 关键认知（2026-10-28 由 Lance 纠正）：这一步**不生成 Listing**。
// Listing 由前面的 tab（商品事实/市场调研/Listing/作图）产出，本面板只把它
// 变成「店小秘上架信息」(erp/field_plan.json)，然后自动填入店小秘、不保存。
// 之前写成 mode=listing 等于把前面做完的 Listing 又跑一遍，是错的。

(function () {
  const $ = (id) => document.getElementById(id);
  const badge = $('dossierBadge');
  const result = $('dossierResult');
  const urlInput = $('dossierUrl');
  const titleInput = $('dossierTitle');
  const collectBtn = $('dossierCollectButton');
  const pkgSel = $('dossierPackageSelect');
  const storeSel = $('dossierStoreSelect');
  const tplSel = $('dossierTemplateSelect');
  const prepareBtn = $('dossierPrepareButton');
  const commitBtn = $('draftCommitButton');
  if (!badge || !result || !collectBtn) return;

  const BADGE = {
    busy: { bg: '#fef3c7', fg: '#b45309' },
    ok: { bg: '#ecfdf5', fg: '#059669' },
    bad: { bg: '#fef2f2', fg: '#dc2626' },
    idle: { bg: '#f1f5f9', fg: '#64748b' },
  };
  function setBadge(text, kind) {
    const c = BADGE[kind] || BADGE.idle;
    badge.textContent = text;
    badge.style.background = c.bg;
    badge.style.color = c.fg;
  }
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const show = (html) => { result.style.display = 'block'; result.innerHTML = html; };
  const errBox = (title, detail) =>
    `<div style="color:#dc2626;font-weight:500;margin-bottom:6px;">${esc(title)}</div>`
    + (detail ? `<div style="color:#dc2626;">${esc(detail)}</div>` : '');

  function fillSelect(sel, items, placeholder) {
    if (!sel) return;
    sel.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = '';
    o0.textContent = placeholder;
    sel.appendChild(o0);
    for (const it of items) {
      const o = document.createElement('option');
      o.value = it.value;
      o.textContent = it.label;
      sel.appendChild(o);
    }
  }

  async function loadOptions() {
    try {
      const [c, p] = await Promise.all([
        fetch('/api/dossier/config').then((r) => r.json()),
        fetch('/api/dossier/packages').then((r) => r.json()),
      ]);
      if (c.ok) {
        fillSelect(storeSel, (c.stores || []).map((x) => ({ value: x.id, label: x.label })), '请选择店铺');
        fillSelect(tplSel, (c.templates || []).map((x) => ({ value: x.id, label: x.label })), '请选择引用模板');
        if ((c.stores || []).length === 1) storeSel.value = c.stores[0].id;
        if ((c.templates || []).length === 1) tplSel.value = c.templates[0].id;
      } else {
        fillSelect(storeSel, [], '控制台未就绪');
        fillSelect(tplSel, [], '控制台未就绪');
      }
      if (p.ok) {
        const list = p.packages || [];
        fillSelect(pkgSel, list.map((x) => ({
          value: x.relPath,
          label: `${x.name}${x.hasPlan ? '（已有计划）' : ''} · ${x.where}`,
        })), list.length ? '请选择产品包' : '没有已完成 Listing 的产品包');
        if (list.length) pkgSel.value = list[0].relPath;   // 默认选最新的一个
      } else {
        fillSelect(pkgSel, [], '读取失败');
      }
    } catch (e) {
      show(errBox('加载店铺/模板/产品包失败', e && e.message ? e.message : String(e)));
    }
  }
  loadOptions();

  // ① 采集
  collectBtn.addEventListener('click', async () => {
    const url = (urlInput.value || '').trim();
    if (!url) { window.alert('请先填写 1688 商品链接'); urlInput.focus(); return; }
    if (!/^https?:\/\/([a-z0-9-]+\.)*1688\.com\//i.test(url)) {
      window.alert('只接受 1688 商品链接（*.1688.com）');
      return;
    }
    setBadge('COLLECTING', 'busy');
    collectBtn.disabled = true;
    show('<div style="color:#475569;">正在采集…（打开 1688 页面 + 下载图片 + 归一化 SKU 表，通常 30 秒–3 分钟）</div>');
    try {
      const r = await fetch('/api/collect/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, title: (titleInput.value || '').trim(), mode: 'none' }),
      });
      const d = await r.json();
      if (d.ok) {
        const c = d.counts || {};
        setBadge('COLLECTED', 'ok');
        show(`<div style="color:#059669;font-weight:500;margin-bottom:6px;">采集成功 · ${esc(d.productId)}</div>
          <div style="color:#475569;">成功 ${c.succeeded || 0} · 待复核 ${c.review || 0} · 失败 ${c.failed || 0} · 用时 ${Math.round((d.durationMs || 0) / 1000)}s</div>
          <div style="color:#64748b;margin-top:6px;">下一步：先到前面 tab 完成 Listing，再回来做第 ② 步。</div>`);
        loadOptions();
      } else {
        setBadge('FAILED', 'bad');
        show(errBox(`采集失败 · ${d.status || ''}`, d.error));
      }
    } catch (e) {
      setBadge('REQUEST FAILED', 'bad');
      show(errBox('请求失败', e && e.message ? e.message : String(e)));
    } finally {
      collectBtn.disabled = false;
    }
  });

  // ② 生成上架信息并自动填充（不保存）
  prepareBtn.addEventListener('click', async () => {
    const pkg = (pkgSel.value || '').trim();
    const storeId = (storeSel.value || '').trim();
    const templateId = (tplSel.value || '').trim();
    if (!pkg) { window.alert('请选择产品包（需已完成 Listing）'); pkgSel.focus(); return; }
    if (!storeId || !templateId) { window.alert('请选择店铺与引用模板'); return; }
    if (!window.confirm(`将生成「${pkg}」的店小秘上架信息，然后自动填入店小秘（不保存）。\n\n填充约 2 分钟，期间请不要关闭页面。确认继续？`)) return;

    setBadge('GENERATING', 'busy');
    prepareBtn.disabled = true;
    show('<div style="color:#475569;">正在生成上架信息（ERP 计划）…</div>');
    try {
      const r = await fetch('/api/dossier/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageName: pkg, storeId, templateId }),
      });
      const d = await r.json();
      if (!d.ok) {
        setBadge('BLOCKED', 'bad');
        show(errBox(`未生成 · ${d.step || ''}`, d.error));
        return;
      }

      const runId = d.runId;
      let ticks = 0;
      while (ticks < 240) {
        ticks += 1;
        await new Promise((res) => setTimeout(res, 5000));
        const s = await (await fetch(`/api/dossier/status?runId=${encodeURIComponent(runId)}`)).json();
        if (!s.ok) { setBadge('STATUS LOST', 'bad'); show(errBox('状态查询失败', s.error)); return; }

        if (s.phase === 'plan') {
          setBadge('PLANNING', 'busy');
          show('<div style="color:#475569;">正在生成上架信息…</div>');
          continue;
        }
        if (s.phase === 'filling') {
          setBadge('FILLING', 'busy');
          show('<div style="color:#475569;">上架信息已生成，正在填入店小秘（不保存）…</div>');
          continue;
        }
        if (s.phase === 'ready' || s.phase === 'failed') {
          const f = s.fill || {};
          const steps = (f.steps || []).map((x) => {
            const icon = x.status === 'SUCCESS' ? '✅' : (x.status === 'ATTENTION' ? '⚠️' : '❌');
            const val = x.value == null ? '' : `<span style="color:#64748b;">${esc(JSON.stringify(x.value).slice(0, 70))}</span>`;
            const why = x.reason ? `<div style="color:#b45309;margin-left:20px;">${esc(x.reason)}</div>` : '';
            return `<div style="padding:2px 0;">${icon} <strong>${esc(x.name)}</strong> ${val}${why}</div>`;
          }).join('');
          const att = (f.attention || []).map((a) => `<div style="color:#64748b;">• ${esc(a)}</div>`).join('');
          if (s.phase === 'ready') {
            setBadge('FILLED · 未保存', 'ok');
            show(`<div style="color:#059669;font-weight:500;margin-bottom:8px;">已生成上架信息并填入店小秘（未保存）</div>
              <div style="color:#475569;">${(f.steps || []).length} 步 · 用时 ${Math.round((f.durationMs || 0) / 1000)}s</div>
              <div style="max-height:340px;overflow:auto;border-top:1px solid #eef2f7;margin-top:10px;padding-top:8px;font-size:.92em;">${steps || '<div style="color:#94a3b8;">无步骤记录</div>'}</div>
              ${att ? `<div style="margin-top:10px;">${att}</div>` : ''}
              <div style="color:#64748b;margin-top:10px;">确认无误后，可用第 ③ 步把它保存为草稿。</div>`);
          } else {
            setBadge('FAILED', 'bad');
            const reasons = (s.reasons || []).map((x) => `<div style="color:#b45309;">• [${esc(x.stage)}] ${esc(x.reason)}</div>`).join('');
            show(`${errBox('未完成', f.error || s.error)}
              ${reasons}
              ${steps ? `<div style="max-height:240px;overflow:auto;margin-top:8px;font-size:.92em;">${steps}</div>` : ''}`);
          }
          return;
        }
      }
      setBadge('TIMEOUT', 'bad');
      show('<div style="color:#b45309;">轮询超时（20 分钟），任务可能仍在后台运行，请到 8765 控制台查看。</div>');
    } catch (e) {
      setBadge('REQUEST FAILED', 'bad');
      show(errBox('请求失败', e && e.message ? e.message : String(e)));
    } finally {
      prepareBtn.disabled = false;
    }
  });

  // ③ 写草稿（可选，明确是另一步）
  if (commitBtn) {
    commitBtn.addEventListener('click', async () => {
      const pkg = (pkgSel.value || '').trim();
      if (!pkg) { window.alert('请先在 ② 选中产品包'); return; }
      if (!window.confirm(`将把「${pkg}」保存为一条店小秘草稿（不发布）。确认继续？`)) return;
      setBadge('SAVING', 'busy');
      commitBtn.disabled = true;
      show('<div style="color:#475569;">正在写草稿并核对是否落库…（约 2–3 分钟）</div>');
      try {
        const r = await fetch('/api/draft/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageName: pkg, commit: true }),
        });
        const d = await r.json();
        if (d.ok) {
          setBadge(d.status || 'SAVED', 'ok');
          show(`<div style="color:#059669;font-weight:500;">草稿已保存 · ${esc(d.status || '')}</div>
            <div style="color:#475569;margin-top:6px;">已核对待发布列表，用时 ${Math.round((d.durationMs || 0) / 1000)}s。</div>`);
        } else {
          setBadge('FAILED', 'bad');
          show(errBox('写草稿失败', d.error));
        }
      } catch (e) {
        setBadge('REQUEST FAILED', 'bad');
        show(errBox('请求失败', e && e.message ? e.message : String(e)));
      } finally {
        commitBtn.disabled = false;
      }
    });
  }
})();
