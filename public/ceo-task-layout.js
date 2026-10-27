// Static, trusted layout only. All runtime/user values are rendered with textContent.
const layout = `<p data-ceo="identity" class="connection-status">尚未连接经营空间</p><p class="notice">此工作页与对话命令共用同一任务库。当前仅支持人工调查任务，店铺发布、调价、采购尚未接入。</p>
<section data-ceo="login" class="card"><h2>连接工作空间</h2><p>输入本机访问凭证。经营者负责审批与核验，CEO 入口负责领作与回执。</p><form data-ceo="login-form"><label>访问凭证<input data-ceo="token" type="password" autocomplete="off" required></label><button type="submit">连接</button></form></section>
<div data-ceo="workspace" hidden><section class="metrics"><article class="card"><span>首店目标 · 2026 年 12 月</span><strong>每日支付 ≥ 200 件</strong><small>月经营净利润 ≥ ¥12,000 · 品质罚款单列</small></article><article class="card"><span>每日常规容量</span><strong data-ceo="capacity">—</strong><small>另留 60 分钟处理突发事项</small></article><article class="card"><span>任务执行 / 经营效果</span><strong data-ceo="counts">—</strong><small>任务完成后，经营效果仍需另行观察</small></article></section>
<section class="card toolbar"><div><h2>今日任务</h2><p data-ceo="gaps">正在读取上下文</p></div><div class="buttons"><button data-ceo="refresh" class="secondary">刷新</button><button data-ceo="logout" class="secondary">退出</button></div></section>
<section data-ceo="plan-area" class="card"><h2>已存档计划</h2><p>草案转为任务后仍需具体审批；延期与受阻项目继续保留在计划中。</p><div data-ceo="plans"></div></section>
<div class="layout"><section data-ceo="task-list" class="card"><p>尚无任务</p></section><section data-ceo="detail" class="card"><h2>任务详情</h2><p>从左侧选择一项任务，查看依据、验收和执行记录。</p></section></div></div>
<p data-ceo="message" role="status" aria-live="polite"></p>`;
export function createCeoTaskLayout(root) {
 const template=root.ownerDocument.createElement('template');
 template.innerHTML=layout;
 root.append(template.content.cloneNode(true));
}
