(() => {
  const api = async (url, options = {}) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
    return body;
  };
  const text = (value) => String(value ?? "");
  const escape = (value) => text(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  let latestJobs = [];

  function badge(status) { return `<span class="clw-badge clw-${String(status).toLowerCase()}">${escape(status)}</span>`; }
  function workspace() { return document.getElementById("charmListingWorkspace"); }
  function show(message, kind = "info") {
    const node = document.getElementById("charmListingNotice");
    if (!node) return;
    node.className = `clw-notice ${kind}`;
    node.textContent = message;
  }
  function formValue(id) { return document.getElementById(id)?.value.trim() || ""; }
  function bind(id, event, handler) { document.getElementById(id)?.addEventListener(event, handler); }

  function renderJobs(jobs) {
    const target = document.getElementById("charmListingJobList");
    if (!target) return;
    if (!jobs.length) {
      target.innerHTML = '<div class="clw-empty">还没有包包挂件任务。可新增单品或导入 Excel/CSV。</div>';
      return;
    }
    target.innerHTML = jobs.map((job) => {
      const facts = job.product?.facts || {};
      const missing = job.checkpoint?.validation?.missing || [];
      const event = job.events?.[0]?.type || "-";
      return `<article class="clw-job" data-id="${escape(job.id)}">
        <div class="clw-job-head"><div><strong>${escape(job.product?.name)}</strong><small>${escape(job.product?.subtype)} · ${escape(job.currentStage)}</small></div>${badge(job.status)}</div>
        <div class="clw-job-meta">材质：${escape(facts.material || "待补充")} · 发货内容：${escape(facts.packageContents || "待补充")} · 最近事件：${escape(event)}</div>
        ${missing.length ? `<div class="clw-warning">阻断：${escape(missing.join("、"))}${job.checkpoint?.validation?.risk ? "；检测到IP/品牌风险" : ""}</div>` : ""}
        ${job.draft ? `<div class="clw-draft"><b>草稿标题：</b>${escape(job.draft.content.selectedTitle)}</div>` : ""}
        <div class="clw-actions">
          <button data-action="run">${job.status === "NEEDS_INPUT" ? "检查资料" : "生成审核草稿"}</button>
          ${job.status === "REVIEW_REQUIRED" ? '<button data-action="approve" class="primary">最终批准</button>' : ""}
          ${job.status === "APPROVED" ? '<button data-action="publish" class="primary">创建店小秘发布任务</button>' : ""}
          ${["PUBLISHING", "VERIFYING", "DRIFT"].includes(job.status) ? '<button data-action="receipt">记录发布核对</button>' : ""}
          <button data-action="detail" class="ghost">详情</button>
        </div>
      </article>`;
    }).join("");
    target.querySelectorAll("button[data-action]").forEach((button) => button.addEventListener("click", () => void act(button.closest(".clw-job")?.dataset.id, button.dataset.action)));
  }

  async function refresh() {
    const { jobs } = await api("/api/listing-jobs");
    latestJobs = jobs;
    renderJobs(jobs);
    const counts = jobs.reduce((all, job) => ({ ...all, [job.status]: (all[job.status] || 0) + 1 }), {});
    const metrics = document.getElementById("charmListingMetrics");
    if (metrics) metrics.innerHTML = ["READY", "NEEDS_INPUT", "REVIEW_REQUIRED", "PUBLISHING", "DRIFT", "LIVE"].map((key) => `<span><b>${counts[key] || 0}</b>${key}</span>`).join("");
  }

  async function act(id, action) {
    try {
      const job = latestJobs.find((item) => item.id === id);
      if (!job) return;
      if (action === "run") await api(`/api/listing-jobs/${id}/run`, { method: "POST" });
      if (action === "approve") await api(`/api/listing-jobs/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvedBy: "local-operator" }) });
      if (action === "publish") await api(`/api/listing-jobs/${id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalToken: job.approval?.token }) });
      if (action === "receipt") {
        const externalProductId = window.prompt("填写店小秘/速卖通外部商品ID；留空会标记为 DRIFT", "") ?? "";
        await api(`/api/listing-jobs/${id}/publish-receipt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalProductId, source: "operator_confirmation" }) });
      }
      if (action === "detail") window.alert(JSON.stringify(job, null, 2));
      show("任务状态已更新。", "success");
      await refresh();
    } catch (error) { show(error.message, "error"); }
  }

  function mount() {
    if (workspace()) return;
    const root = document.createElement("section");
    root.id = "charmListingWorkspace";
    root.className = "clw hidden";
    root.innerHTML = `<header class="clw-header"><div><span>ALIEXPRESS · BAG CHARM</span><h2>包包挂件自动化 Listing 工作台</h2><p>单品、批量、审核、店小秘发布任务和异常核对统一管理。</p></div><button id="charmListingClose" class="ghost">关闭</button></header>
      <div id="charmListingNotice" class="clw-notice">已就绪：真实发布必须经最终审核。</div>
      <div id="charmListingMetrics" class="clw-metrics"></div>
      <div class="clw-grid"><form id="charmListingCreate" class="clw-card"><h3>新增单品</h3><label>产品名称<input id="clwName" required placeholder="例如：Plush Bunny Bag Charm"></label><label>子类型<select id="clwSubtype"><option value="plush">毛绒挂件</option><option value="metal">金属挂件</option><option value="acrylic">亚克力挂件</option><option value="beaded">串珠挂件</option></select></label><label>材质<input id="clwMaterial" placeholder="例如：Polyester"></label><label>发货内容<input id="clwPackage" placeholder="例如：1 bag charm"></label><label>挂扣类型<input id="clwAttachment" placeholder="例如：Lobster clasp"></label><label>颜色/款式<input id="clwColors" placeholder="例如：Pink / Blue"></label><button class="primary" type="submit">创建 Listing 任务</button></form>
      <form id="charmListingImport" class="clw-card"><h3>批量导入</h3><p>Excel/CSV 首行可使用：产品名称、子类型、材质、发货内容、挂扣类型、颜色、尺寸、SKU、品牌。</p><input id="clwWorkbook" type="file" accept=".xlsx,.xls,.csv"><button type="submit">导入并创建任务</button><p class="clw-hint">每一行会创建一个独立任务；单个失败不会阻断其他商品。</p></form></div>
      <section class="clw-card clw-list-card"><div class="clw-list-head"><h3>Listing 任务中心</h3><button id="charmListingRefresh">刷新</button></div><div id="charmListingJobList"></div></section>`;
    document.body.appendChild(root);
    const trigger = document.createElement("button");
    trigger.id = "charmListingLauncher";
    trigger.className = "clw-launcher";
    trigger.textContent = "包挂自动化";
    document.body.appendChild(trigger);
    trigger.addEventListener("click", () => { root.classList.remove("hidden"); void refresh().catch((error) => show(error.message, "error")); });
    bind("charmListingClose", "click", () => root.classList.add("hidden"));
    bind("charmListingRefresh", "click", () => void refresh().catch((error) => show(error.message, "error")));
    bind("charmListingCreate", "submit", async (event) => {
      event.preventDefault();
      try {
        await api("/api/listing-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productName: formValue("clwName"), subtype: formValue("clwSubtype"), material: formValue("clwMaterial"), packageContents: formValue("clwPackage"), attachmentType: formValue("clwAttachment"), colors: formValue("clwColors") }) });
        event.target.reset(); show("单品任务已创建。", "success"); await refresh();
      } catch (error) { show(error.message, "error"); }
    });
    bind("charmListingImport", "submit", async (event) => {
      event.preventDefault();
      const file = document.getElementById("clwWorkbook")?.files?.[0];
      if (!file) { show("请先选择Excel或CSV文件。", "error"); return; }
      try { const form = new FormData(); form.append("workbook", file); const result = await api("/api/products/import", { method: "POST", body: form }); show(`已创建 ${result.count} 个任务。`, "success"); await refresh(); }
      catch (error) { show(error.message, "error"); }
    });
  }
  document.addEventListener("DOMContentLoaded", mount);
})();
