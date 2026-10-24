// 决定性实测（2026-10-16）：向目标对话真实发送（5 附件 + 提示词），
// 同时抓取后端 POST 响应状态，直接判定「落库 / 被拒」。
// 复用 lib/chatgpt-sender，保证与主管线同一逻辑。会真实发送（不再重复计数）。
const path = require('path');
const fs = require('fs');
const sender = require('../lib/chatgpt-sender.cjs');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chatgpt-config.json'), 'utf8'));

const LOGS = [];
const log = {
  info: (m) => { const s = '[INFO] ' + m; console.log(s); LOGS.push(s); },
  warn: (m) => { const s = '[WARN] ' + m; console.log(s); LOGS.push(s); },
  error: (m) => { const s = '[ERR ] ' + m; console.log(s); LOGS.push(s); },
  step: (m) => { const s = '[STEP] ' + m; console.log(s); LOGS.push(s); },
};

function resolveUploadFiles() {
  const dir = cfg.outputDir;
  const files = [];
  for (const pre of cfg.uploadPrefixes) {
    const cands = [path.join(dir, pre + '.xlsx'), path.join(dir, pre + '.locked.xlsx')].filter((f) => fs.existsSync(f));
    if (!cands.length) continue;
    cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    files.push(cands[0]);
  }
  return files;
}

(async () => {
  const browser = await sender.connect(cfg.cdpUrl, log);
  const page = await sender.openConversation(browser, cfg.conversationUrl, log);

  // 抓取后端 POST（消息提交）与相关响应
  const net = [];
  page.on('response', async (r) => {
    const req = r.request();
    const u = r.url();
    if (req.method() !== 'POST') return;
    if (!/\/backend-api\//.test(u)) return;
    if (!/conversation|stream|f\/conversation|sentinel/.test(u)) return;
    let snip = null;
    try { const t = await r.text(); snip = t.slice(0, 300); } catch (e) {}
    net.push({ url: u.replace(/\?.*/, ''), status: r.status(), snip });
    console.log('[NET] POST ' + u.replace(/\?.*/, '') + ' -> ' + r.status());
  });

  const files = resolveUploadFiles();
  console.log('[INFO] 待发送 ' + files.length + ' 文件：' + files.map((f) => path.basename(f)).join(' | '));

  await sender.clearComposer(page, log);
  await sender.uploadFiles(page, files, log, cfg.attachmentTimeoutMs);

  const dateStr = new Date().toLocaleDateString('sv-SE');
  const prompt = cfg.promptTemplate.replace(/\{date\}/g, dateStr);
  const sent = await sender.sendPrompt(page, prompt, log, { force: true });

  await sender.sleep(8000);

  // 读当前页面 URL（是否新开）
  const curUrl = await sender.currentConversationUrl(page).catch(() => null);
  const draftCheck = await sender.countPromptInConversation(page, prompt).catch(() => null);

  console.log('\n=====RESULT=====');
  console.log(JSON.stringify({
    sent,
    draftCheck,
    curUrl,
    dateStr,
    netPosts: net,
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error('SENDTRACE_FAIL', e.message); process.exit(1); });
