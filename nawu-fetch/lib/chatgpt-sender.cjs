// ChatGPT 对话驱动（CDP 已登录 Chrome）：打开目标对话 / 上传附件 / 发送提示词
// 依据 2026-09-29 实测选择器：
//   composer     = div.ProseMirror[contenteditable="true"]（aria="询问 ChatGPT"）
//   composer 表单 = 包含该 composer 的 <form>
//   文件输入     = form 内 input[type=file]:not([accept])（通用文档上传；accept 为空的那个）
//   附件 chip    = [class*="composer-attachment-surface"]
//   发送按钮     = #composer-submit-button / button[data-testid="send-button"]（空输入时不存在→回退 Enter）
const { chromium } = require('playwright-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMPOSER = 'div.ProseMirror[contenteditable="true"]';
const ATTACH = '[class~="group/composer-attachment"]'; // 每个附件 1 个

async function visibleComposer(page) {
  const all = page.locator(COMPOSER);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const c = all.nth(i);
    if (await c.isVisible().catch(() => false)) return c;
  }
  return all.first();
}

// ChatGPT 会渲染成对的「可见真身 + 0×0 隐藏镜像」，必须点有实际尺寸那个
async function clickFirstVisible(page, selector, log) {
  const loc = page.locator(selector);
  const n = await loc.count();
  if (log) log.info(`[send] 候选按钮数=${n}`);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    const box = await el.boundingBox().catch(() => null);
    const en = await el.isEnabled().catch(() => false);
    if (log) log.info(`[send] 候选#${i} box=${box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'null'} enabled=${en}`);
    if (box && box.width >= 2 && box.height >= 2 && en) {
      try { await el.click({ timeout: 8000 }); return true; }
      catch (e) { try { await el.click({ timeout: 5000, force: true }); return true; } catch (e2) { /* next */ } }
    }
  }
  return false;
}

async function connect(cdpUrl, log) {
  let lastErr = null;
  for (let i = 0; i < 15; i++) {
    try {
      const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
      log.info(`已接入 Chrome CDP ${cdpUrl}（第 ${i + 1} 次）`);
      return browser;
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error('connectOverCDP 失败：' + (lastErr && lastErr.message ? lastErr.message.slice(0, 120) : ''));
}

async function openConversation(browser, url, log) {
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await page.waitForSelector(COMPOSER, { timeout: 60000 });
  await sleep(3000);
  const composerOk = await page.$(COMPOSER);
  const loginBtn = await page.$('a[href*="auth/login"], button[data-testid="login-button"]');
  if (!composerOk || loginBtn) throw new Error('ChatGPT 未登录或输入框不可用（请在本机 Chrome 先登录 ChatGPT）');
  log.info('ChatGPT 对话已就绪：' + (await page.title()));
  return page;
}

// 在项目页开启一个全新对话（composer 即新对话入口），返回该 page
async function openProjectNewChat(browser, projectUrl, log) {
  if (!projectUrl) throw new Error('缺少 config.projectUrl，无法在项目内新开对话');
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = ctx.pages().find((p) => /chatgpt\.com/.test(p.url()));
  if (!page) page = await ctx.newPage();
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.bringToFront().catch(() => {});
  await page.waitForSelector(COMPOSER, { timeout: 60000 });
  await sleep(4000);
  const composerOk = await page.$(COMPOSER);
  const loginBtn = await page.$('a[href*="auth/login"], button[data-testid="login-button"]');
  if (!composerOk || loginBtn) throw new Error('项目页输入框不可用（ChatGPT 未登录？）');
  log.info('已在项目内开启新对话：' + (await page.title()));
  return page;
}

// 读取当前 URL 里的对话 id（/c/<uuid>）；项目页未发送时无 id → 返回 null
async function currentConversationUrl(page) {
  const u = page.url();
  return /\/c\/[0-9a-fA-F-]{36}/.test(u) ? u.split('?')[0] : null;
}

// 是否出现「已达长度上限」提示。best-effort：超长对话的 DOM 可能没渲染到底部而漏判，
// 因此脚本侧另有 rotateOnNextRun / --new-chat 作为确定性兜底。
async function isConversationFull(page) {
  return page
    .evaluate(() => {
      const RE = /长度上限|length limit for this conversation|Start a new chat to continue/i;
      const seen = new Set();
      let hit = false;
      const walk = (root, depth) => {
        if (hit || !root || depth > 10) return;
        let all;
        try { all = root.querySelectorAll('*'); } catch (e) { return; }
        for (const el of all) {
          if (seen.has(el)) continue;
          seen.add(el);
          const t = el.textContent || '';
          if (t.length < 300 && RE.test(t)) { hit = true; return; }
          if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        }
      };
      walk(document, 0);
      return hit;
    })
    .catch(() => false);
}

async function uploadFiles(page, filePaths, log, timeoutMs = 150000) {
  const form = page.locator('form').filter({ has: page.locator(COMPOSER) }).first();
  const input = form.locator('input[type=file]:not([accept])').first();
  if (!(await input.count())) throw new Error('未找到 composer 的通用文件输入 input[type=file]:not([accept])');
  log.info(`上传 ${filePaths.length} 个文件：` + filePaths.map((f) => require('path').basename(f)).join(' | '));
  // before 基线（2026-10-13 增）：若上传前 composer 已有残留 chip，目标数须含它们，
  // 否则「n >= target」会被旧 chip 提前满足，导致新文件没传完就进入发送。
  // 关键：before 必须在 setInputFiles 之前统计——放后面会立刻抓到刚渲染的新 chip，
  // 把 target 撑成 before+新旧全部，永远等不到（2026-10-13 实测 150s 超时 FATAL）。
  const before = await page.locator(ATTACH).count().catch(() => 0);
  await input.setInputFiles(filePaths, { timeout: 60000 });
  const target = before + filePaths.length;
  const deadline = Date.now() + timeoutMs;
  let n = 0;
  while (Date.now() < deadline) {
    n = await page.locator(ATTACH).count();
    if (n >= target) break;
    await sleep(2000);
  }
  log.info(`附件 chip 就绪：${Math.max(0, n - before)}/${filePaths.length}（页面 chip 总数 ${n}，上传前已有 ${before}）`);
  if (n < target) throw new Error(`附件未全部就绪（${n - before}/${filePaths.length}），中止发送`);
  return n;
}

// 发送按钮：本版 aria-label="发送"（无 data-testid），需显式点击；Enter 在部分版本不发
const SEND_BTN = 'form[data-chatgpt-composer] button[aria-label="发送"], form[data-chatgpt-composer] button[aria-label="Send"], button[data-testid="send-button"], #composer-submit-button';

// 清空残留草稿（ChatGPT 会跨刷新保留未发送草稿）——务必在上传附件之前调用
async function clearComposer(page, log) {
  const composer = await visibleComposer(page);
  await composer.click({ timeout: 15000 });
  await sleep(200);
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Backspace').catch(() => {});
  await sleep(300);
  const left = await composer.innerText().catch(() => '');
  if ((left || '').trim().length) { await page.keyboard.press('Backspace').catch(() => {}); await sleep(200); }
  // 2026-10-13 增：附件 chip 是 ProseMirror 原子节点，Backspace 可能删不掉（发送失败
  // 会残留 chip + 草稿）。残留 chip 会让下次上传的计数/内容叠加，必须逐个清掉。
  // 关键：chip 的「移除」按钮未 hover 时不可交互（pointer-events 被遮），直接 click 会
  // 超时（2026-10-13 实测 12 次全超时）——必须先 hover 对应 chip 再点。
  const chipSel = '[class~="group/composer-attachment"]';
  const rmSel = 'button[aria-label^="移除 "], button[aria-label^="Remove "]';
  for (let i = 0; i < 15; i++) {
    const n = await page.locator(chipSel).count().catch(() => 0);
    if (!n) break;
    await page.locator(chipSel).first().hover({ timeout: 5000 }).catch(() => {});
    await sleep(150);
    await page.locator(rmSel).first().click({ timeout: 8000 }).catch(() => {});
    await sleep(400);
  }
  const leftChips = await page.locator(chipSel).count().catch(() => -1);
  log.info('已清空 composer 草稿（剩余长度 ' + (left || '').trim().length + '，残留 chip=' + leftChips + '）');
}

// 插入文本：必须触发 beforeinput/input，React 才会更新内部状态（CDP insertText 不触发→发送键一直禁用）
async function typeComposer(page, text, log) {
  const r = await page.evaluate((t) => {
    const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
    const ed = eds.find((e) => e === document.activeElement) || eds.find((e) => e.getBoundingClientRect().width > 0) || eds[0];
    if (!ed) return { ok: false, reason: 'no editor' };
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('insertText', false, t);
    return { ok, len: (ed.innerText || '').length };
  }, text);
  log.info('execCommand insertText => ' + JSON.stringify(r));
  return r;
}

// 统计提示词在「对话消息区」里出现的次数（用户消息已渲染才算真发送）
// 注意 1：不能用 composer 残留判断发送成功 —— 发送瞬间会残留一个旧 ProseMirror 节点，
//         visibleComposer() 取到的是它，会造成「已发送却判失败」的假阴性（2026-10-08 实测）。
// 注意 2（2026-10-09 修）：必须先剔除 composer / form / contenteditable 再计数。
//         composer 就在 <main> 内，输入草稿后 main.innerText 会包含草稿文本，
//         导致幂等守卫把「刚输入的草稿」误判为「已发送的消息」→ 每次都跳过发送，
//         表现为 exit=0 假成功但 ChatGPT 侧根本没收到数据（2026-10-09 实测）。
async function countPromptInConversation(page, text) {
  return page
    .evaluate((key) => {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const countIn = (s) => {
        if (!s) return 0;
        return (s.match(new RegExp(esc(key), 'g')) || []).length;
      };

      const main = document.querySelector('main');
      const root = main || document.body;
      // 克隆后剔除 composer 相关节点，得到「纯消息区」
      const clone = root.cloneNode(true);
      clone.querySelectorAll('div.ProseMirror[contenteditable="true"]').forEach((n) => n.remove());
      clone.querySelectorAll('[contenteditable="true"]').forEach((n) => n.remove());
      clone.querySelectorAll('form').forEach((n) => n.remove());
      const sentMessages = countIn(clone.innerText || '');

      const eds = Array.from(document.querySelectorAll('div.ProseMirror[contenteditable="true"]'));
      const draftLen = eds.reduce((s, e) => s + ((e.innerText || '').trim().length), 0);
      return { sentMessages, draftLen };
    }, text.slice(0, 40))
    .catch(() => ({ sentMessages: 0, draftLen: -1 }));
}

async function sendPrompt(page, text, log, opts = {}) {
  // 幂等守卫（2026-10-09 调整位置）：必须在「输入草稿之前」判断。
  // 若放在输入之后，composer 里的草稿文本会进入 main.innerText 被当成已发送 → 永远跳过。
  // 2026-10-10 增 opts.force：用户明确要求「重新执行」时绕过守卫（--resend）；
  //   同时「新开对话(rotate)」也须绕过 —— 全新对话不可能已含本提示词，但项目页会渲染
  //   最近对话预览，会让守卫误判「已存在」而跳过发送（2026-10-10 --new-chat 实测踩到）。
  const pre = await countPromptInConversation(page, text);
  const base = pre.sentMessages;
  if (!opts.force && base >= 1) {
    log.warn(`检测到对话中已存在同文本提示词（${base} 次），跳过发送避免重复`);
    return { ok: true, skipped: true, verified: pre };
  }
  if (opts.force && base >= 1) log.warn(`绕过幂等守卫：基线已有 ${base} 次同文本，本次将再发一次`);
  // 草稿残留清理：仅在确认「未发送」时进行，且只清 composer，绝不碰消息区
  if (pre.draftLen > 0) {
    log.warn(`发送前发现 composer 有 ${pre.draftLen} 字草稿残留，先清空再输入`);
    await clearComposer(page, log);
  }

  const composer = await visibleComposer(page);
  await composer.click({ timeout: 15000 });
  await sleep(300);
  await typeComposer(page, text, log);
  await sleep(500);

  let typedLen = (((await composer.innerText().catch(() => '')) || '') + '').length;
  log.info('composer 已输入长度=' + typedLen);
  if (typedLen < text.length * 0.5) {
    log.warn('execCommand 输入不足，回退 pressSequentially');
    await composer.click({ timeout: 15000 });
    await composer.pressSequentially(text, { delay: 15 }).catch((e) => log.warn('pressSequentially: ' + e.message));
    typedLen = (((await composer.innerText().catch(() => '')) || '') + '').length;
    log.info('回退后 composer 长度=' + typedLen);
  }

  // 等发送按钮启用（React 状态就绪后才可点）。
  // 2026-10-13 修：附件 chip 视觉就绪 ≠ 服务端解析完成——xlsx 解析期发送按钮禁用，
  // 实测禁用可超过 12s（旧版 12×1s 放弃后 ~15-30s 按钮又恢复；Enter 回退因焦点/禁用
  // 同样无效 → 草稿卡死 exit=2）。等待上限提高到 45s，且 Enter 回退后必须再回按钮重试。
  let clicked = false;
  for (let i = 0; i < 30 && !clicked; i++) {
    clicked = await clickFirstVisible(page, SEND_BTN);
    if (!clicked) await sleep(1500);
  }
  if (clicked) log.info('已点击发送按钮提交');
  else {
    log.warn('发送按钮 45s 内不可用，回退 Enter 并继续重试点击');
    await composer.click({ timeout: 15000 }).catch(() => {});
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(2000);
    for (let i = 0; i < 20 && !clicked; i++) {
      clicked = await clickFirstVisible(page, SEND_BTN);
      if (!clicked) await sleep(1500);
    }
    if (clicked) log.info('Enter 回退后按钮恢复，已点击发送按钮提交');
    else log.warn('发送按钮最终不可用（Enter 回退也无效）');
  }

  // 校验（最多 6 轮，兼顾流式渲染延迟）：必须「超过发送前基线 base」才算真发送，
  // 否则同日重跑时旧的同文本会立刻满足「>=1」造成假成功。
  let v = { sentMessages: base, draftLen: -1 };
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    v = await countPromptInConversation(page, text);
    if (v.sentMessages > base) break;
  }
  const ok = v.sentMessages > base || (base === 0 && v.draftLen >= 0 && v.draftLen < 5);
  log.info(
    '发送校验：' + JSON.stringify(v) + '（基线 ' + base + '，' +
      (ok ? '已发送=成功' : '未发送且草稿残留=失败') + '）'
  );
  return { ok, skipped: false, verified: v, baseline: base };
}

// 读取最后一条 assistant 回复文本（可选，用于“抓回本地”场景；本项目用户选择不落盘）
async function readLastAssistantText(page) {
  return page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    return msgs.length ? (msgs[msgs.length - 1].innerText || '').trim() : '';
  });
}

module.exports = {
  connect,
  openConversation,
  openProjectNewChat,
  currentConversationUrl,
  isConversationFull,
  clearComposer,
  uploadFiles,
  sendPrompt,
  countPromptInConversation,
  readLastAssistantText,
  sleep,
  COMPOSER,
};
