/* 控制塔 · 显性逻辑大盘
 * 复用现有只读端点，无需后端改动；纯静态，express.static 直接服务 /tower.html。
 * 对应逻辑图「显性逻辑」四块：①实时任务轨迹 ②SOP 资产索引 ③店铺经营对账 ④审计&运行轨迹
 * 底部「隐性逻辑」为静态引擎说明（Phase 4 接入）。 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  async function getJSON(url, timeoutMs) {
    timeoutMs = timeoutMs || 4000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function setLive(ok) {
    const dot = $("liveDot");
    const txt = $("liveText");
    if (!dot || !txt) return;
    dot.className = ok ? "ok" : "err";
    txt.textContent = ok ? "实时连接正常" : "连接异常，重试中…";
  }

  const STATUS_CLASS = { running: "run", done: "done", failed: "fail", pending: "pend", skipped: "skip", idle: "pend" };
  function statusClass(s) { return STATUS_CLASS[s] || "pend"; }
  function pct(n) { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function tz(ts) {
    if (ts == null) return "";
    let d;
    if (typeof ts === "number") d = new Date(ts < 1e12 ? ts * 1000 : ts);
    else d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    const p = (x) => String(x).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  function pickTs(o) { return o ? (o.ts ?? o.timestamp ?? o.created_at ?? o.time ?? o.at) : null; }
  function short(v) { const s = typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 60 ? s.slice(0, 60) + "…" : s; }

  // ---- ① 实时任务轨迹 ----
  async function pollTrajectory() {
    try {
      const [b, c] = await Promise.all([
        getJSON("/api/dianxiaomi/batch-status").catch(() => ({ ok: false })),
        getJSON("/api/dianxiaomi/collect-batch-status").catch(() => ({ ok: false }))
      ]);
      setLive(true);
      const root = $("batchList");
      if (!root) return;
      root.innerHTML = "";
      root.appendChild(batchBlock("引用批量上架", b));
      root.appendChild(batchBlock("采集箱批量上架", c));
    } catch (e) {
      setLive(false);
    }
  }

  function batchBlock(title, data) {
    const wrap = el(`<div class="batch-block"><h3>${esc(title)}</h3></div>`);
    if (!data || data.ok === false || !data.items) {
      wrap.appendChild(el(`<div class="overall">暂无运行数据</div>`));
      return wrap;
    }
    const op = pct(data.overallProgress);
    wrap.appendChild(el(`<div class="overall">总进度 ${op}% · ${data.running ? "运行中" : "空闲"}${data.jobId ? " · job " + esc(data.jobId) : ""}</div>`));
    (data.items || []).forEach((it) => {
      const sc = statusClass(it.status);
      const p = pct(it.progress);
      wrap.appendChild(el(`<div class="item">
        <div class="item-top"><span>${esc(it.name || "—")}</span><span class="tag ${sc}">${esc(it.status || "—")}</span></div>
        <div class="bar ${sc}"><i style="width:${p}%"></i></div>
      </div>`));
    });
    return wrap;
  }

  // ---- 系统状态条 ----
  async function pollSys() {
    try {
      const d = await getJSON("/api/status");
      const s = d.state || {};
      const q = d.queue || [];
      const pp = d.productProfile || {};
      const st = d.dianxiaomiStage || {};
      const chips = [];
      chips.push({ txt: "运行态: " + (s.running ? "运行中" : (s.autoRun ? "自动" : "空闲")), cls: (s.running || s.autoRun) ? "warn" : "" });
      chips.push({ txt: "系统唤醒: " + (d.systemAwake ? "是" : "否"), cls: d.systemAwake ? "" : "warn" });
      chips.push({ txt: "店小秘: " + (st.name || "idle"), cls: "" });
      chips.push({ txt: "队列: " + (Array.isArray(q) ? q.length : 0) + " 项", cls: "" });
      chips.push({ txt: "当前产品: " + (pp.name || pp.title || "无"), cls: "" });
      const strip = $("sysStrip");
      if (strip) strip.innerHTML = chips.map((c) => `<span class="chip ${c.cls}">${esc(c.txt)}</span>`).join("");
    } catch (e) { /* 静默，轨迹面板已管连接态 */ }
  }

  // ---- ④ 审计 & 运行轨迹 ----
  async function pollAudit() {
    try {
      const [ev, ac, fs] = await Promise.all([
        getJSON("/api/events").catch(() => ({ events: [] })),
        getJSON("/api/action-log").catch(() => ({ actions: [] })),
        getJSON("/api/connectors/feishu/status").catch(() => ({ enabled: false }))
      ]);
      const rows = [];
      (ev.events || []).forEach((e) => rows.push({ ts: pickTs(e), type: "event:" + (e.type || "?"), raw: e }));
      (ac.actions || []).forEach((a) => rows.push({ ts: pickTs(a), type: "action:" + (a.type || "?"), raw: a }));
      rows.sort((a, b) => (pickTs(b.raw) || 0) - (pickTs(a.raw) || 0));
      const list = $("auditList");
      if (!list) return;
      list.innerHTML = "";
      const feishu = fs.enabled
        ? `<span class="chip">飞书授权: 已启用</span>`
        : `<span class="chip warn">飞书授权: 未启用</span>`;
      list.appendChild(el(`<div style="margin-bottom:8px">${feishu}</div>`));
      if (!rows.length) {
        list.appendChild(el(`<div class="overall">暂无事件 / 操作记录</div>`));
        return;
      }
      rows.slice(0, 25).forEach((r) => {
        const summary = summarize(r.raw);
        list.appendChild(el(`<div class="audit-item"><span class="t">${esc(tz(pickTs(r.raw)))}</span><span class="type">${esc(r.type)}</span> ${esc(summary)}</div>`));
      });
    } catch (e) { /* 静默 */ }
  }

  function summarize(o) {
    if (!o) return "";
    if (o.payload && typeof o.payload === "object") {
      const keys = Object.keys(o.payload);
      if (keys.length) return keys.slice(0, 3).map((k) => `${k}=${short(o.payload[k])}`).join(" · ");
    }
    if (o.summary) return short(o.summary);
    if (o.note) return short(o.note);
    return "";
  }

  // ---- ② SOP 资产索引（显性化 v0.1，Phase 4 接 personal_os.db 版本化）----
  const SOPS = [
    { name: "Listing 制作流程 MVP1→MVP5", cat: "生成", desc: "大纲→规划→作图→SEO→facts 桥接" },
    { name: "店小秘上品 · 引用(reference)", cat: "上架", desc: "模板→固定字段→facts 填充→保存待审" },
    { name: "店小秘上品 · 采集箱(collect)", cat: "上架", desc: "保留源变种/图，半托管上架" },
    { name: "批量任务状态自愈 normalize", cat: "运维", desc: "running 卡死自动复位 / 重启恢复" },
    { name: "00_Kernel 行为规则 B01–B07", cat: "治理", desc: "Goal Lock / Draft First / Evolution Loop" },
    { name: "00_Kernel 信任规则 T01–T09", cat: "治理", desc: "单一真相 / No Evidence No Done / Fail Closed / 幂等" }
  ];

  // ---- 隐性逻辑（静态引擎说明，Phase 4 接入）----
  const IMPLICIT = [
    { name: "上下文管理", desc: "记忆蒸馏·压缩·NL→动作路由" },
    { name: "授权与信任裁决", desc: "Fail Closed·动作分级·飞书人工审批" },
    { name: "自成长回路 B07", desc: "经验→(你批准)→SOP/Skill" },
    { name: "事实源裁决", desc: "本地记录 vs 店小秘参照·对账" }
  ];

  function renderStatic() {
    const sop = $("sopList");
    if (sop) {
      sop.innerHTML = "";
      SOPS.forEach((s) => {
        sop.appendChild(el(`<div class="sop"><div class="sop-top"><span class="sop-name">${esc(s.name)}</span><span class="sop-cat">${esc(s.cat)}</span></div><div class="sop-desc">${esc(s.desc)}</div></div>`));
      });
    }
    const imp = $("implicitStrip");
    if (imp) {
      imp.innerHTML = "";
      IMPLICIT.forEach((i) => {
        imp.appendChild(el(`<div class="imp"><div class="imp-name">${esc(i.name)}</div><div class="imp-desc">${esc(i.desc)}</div></div>`));
      });
    }
    const recon = $("reconBox");
    if (recon) {
      recon.innerHTML = `
        <span class="badge">未连接 · Phase 2 店小秘 Open API</span>
        <div>本地上架态已就绪，待接入店铺经营数据做对账：</div>
        <ul class="recon-list">
          <li>订单 / 销售 / 库存（店小秘 Open API）</li>
          <li>本地上架态（引用 / 采集箱批量）</li>
          <li>差异对账：以谁为准 / 缺口标红</li>
        </ul>
        <div style="margin-top:10px;font-size:12px;color:#9A6B3E">注：当前店小秘为纯浏览器自动化，读不到经营数据；接入 Open API 后本面板激活。</div>`;
    }
  }

  function start() {
    renderStatic();
    pollTrajectory();
    pollSys();
    pollAudit();
    setInterval(pollTrajectory, 1500);
    setInterval(pollSys, 6000);
    setInterval(pollAudit, 3000);
  }

  if (document.readyState !== "loading") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
