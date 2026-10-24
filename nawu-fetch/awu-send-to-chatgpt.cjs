#!/usr/bin/env node
// 纳物采购·每日发送：先重跑采集（纳物两店 + 店小秘三类），再把最新表格作为附件
// 发进 ChatGPT「纳物采购助手」对话，让其生成今天的采购表格。
//
// 用法：
//   node awu-send-to-chatgpt.cjs                 全流程（采集 → 上传 → 发送）
//   node awu-send-to-chatgpt.cjs --no-fetch      跳过采集，直接用现有最新文件（调试/补发）
//   node awu-send-to-chatgpt.cjs --probe         只打开对话确认登录态，不上传
//   node awu-send-to-chatgpt.cjs --upload-only   只上传不发送（验证上传用）
//   node awu-send-to-chatgpt.cjs --new-chat      强制在项目内新开对话发送（并回写 config）
//   node awu-send-to-chatgpt.cjs --resend        绕过幂等守卫，把同一提示词再发一次（同日重跑用）
//
// 目标对话轮换（对话打到长度上限时怎么办）：
//   config.newChatMode = "auto"（默认）沿用 conversationUrl；命中「长度上限」时自动新开
//                       "always"        每次运行都在项目内新开一个新对话
//   config.rotateOnNextRun = true      下一次运行无条件新开（用完自动置回 false）
//   新开对话成功后，脚本会把新对话 URL 回写到 chatgpt-config.json，后续沿用。
//
// 注意：本机 shell 设了 http_proxy，会劫持 localhost 请求，必须在加载任何网络库之前清掉
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const out = require('./lib/output.cjs');
const sender = require('./lib/chatgpt-sender.cjs');

const cfgPath = path.join(__dirname, 'chatgpt-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

function parseArgs(argv) {
  const a = { noFetch: false, probe: false, uploadOnly: false, newChat: false, force: false, resend: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--no-fetch') a.noFetch = true;
    else if (t === '--probe') a.probe = true;
    else if (t === '--upload-only') a.uploadOnly = true;
    else if (t === '--new-chat') a.newChat = true;
    else if (t === '--force') a.force = true; // 跳过新鲜度门禁（仅在明确知道旧数据可用时手动用）
    else if (t === '--resend') a.resend = true; // 绕过幂等守卫，强制把同一提示词再发一次（同日重跑用）
  }
  return a;
}
const argv = parseArgs(process.argv);

function runStep(label, args, log) {
  log.step('--- ' + label + ' ---');
  try {
    execFileSync(process.execPath, args, {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NO_PROXY: '*', http_proxy: '', HTTP_PROXY: '', https_proxy: '', HTTPS_PROXY: '' },
    });
    return true;
  } catch (e) {
    log.error(label + ' 失败：' + (e.message || String(e)).split('\n')[0]);
    return false;
  }
}

// 每个前缀取最新文件：优先 .xlsx，其次 .locked.xlsx（Excel 占用时的兜底名），按 mtime 取新
function resolveUploadFiles(log) {
  const dir = cfg.outputDir;
  const files = [];
  for (const pre of cfg.uploadPrefixes) {
    const cands = [path.join(dir, pre + '.xlsx'), path.join(dir, pre + '.locked.xlsx')].filter((f) => fs.existsSync(f));
    if (!cands.length) { log.warn('缺少文件：' + pre + '（跳过）'); continue; }
    cands.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    files.push(cands[0]);
  }
  return files;
}

// 新鲜度门禁：文件 mtime 必须是今天；纳物文件还须校验内部「导出时间」为今天。
// 防止「某店采集失败 → 旧文件被当成今天的数据发出 → ChatGPT G0-G8 fail-closed 拦截」。
function checkFreshness(files, log) {
  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  const stale = [];
  for (const f of files) {
    const st = fs.statSync(f);
    const m = new Date(st.mtime);
    const mtimeToday = m.toLocaleDateString('sv-SE') === todayStr;
    let internal = null;
    if (/^nawu-/.test(path.basename(f))) {
      try {
        const t = out.readTable(f);
        const vals = [...new Set((t.rows || []).map((r) => r['导出时间']).filter(Boolean))];
        internal = vals;
      } catch (e) { internal = ['(读取失败:' + e.message + ')']; }
    }
    const internalToday = internal ? internal.every((v) => String(v).startsWith(todayStr)) : true;
    if (!mtimeToday || !internalToday) {
      stale.push({ file: path.basename(f), mtime: st.mtime.toISOString(), 导出时间: internal ? internal.join(', ') : '(无内部时间字段)' });
    }
  }
  return { todayStr, stale };
}

(async () => {
  const log = out.makeLogger(path.join(cfg.outputDir, 'logs'));
  const startedAt = new Date();
  log.step('=== 纳物采购·发送到 ChatGPT 开始 ' + startedAt.toISOString() + ' ===');

  // 1. 采集（可选）
  if (!argv.noFetch) {
    runStep('纳物两店采集', ['nawu-daily-fetch.cjs'], log);
    runStep('店小秘·仓库清单', ['dxm-fetch.cjs', '--target', 'warehouseProduct'], log);
    runStep('店小秘·商品管理', ['dxm-fetch.cjs', '--target', 'product'], log);
    runStep('店小秘·出入记录', ['dxm-fetch.cjs', '--target', 'entryExit'], log);
  } else {
    log.info('--no-fetch：跳过采集，直接用现有最新文件');
  }

  // 2. 解析待上传文件
  const files = resolveUploadFiles(log);
  log.info('待上传 ' + files.length + ' 个文件：' + files.map((f) => path.basename(f)).join(' | '));
  if (!files.length) { log.error('没有任何可上传文件，终止'); log.flush(); process.exit(1); }

  // 2b. 新鲜度门禁（--force 可跳过；--probe 不校验）
  if (argv.force) {
    log.warn('--force：已跳过新鲜度门禁');
  } else if (!argv.probe) {
    const { todayStr, stale } = checkFreshness(files, log);
    if (stale.length) {
      log.error('❌ 新鲜度门禁：以下文件不是今天(' + todayStr + ')的数据，已阻止发送（避免把旧数据当成今天上传）：');
      for (const s of stale) log.error('  - ' + s.file + ' | mtime=' + s.mtime + ' | 内部导出时间=' + s.导出时间);
      log.error('请先重跑采集修复失败的店铺；若确认旧数据可用，再加 --force 手动发送。');
      log.flush();
      process.exit(3);
    }
    log.info('新鲜度门禁通过：' + files.length + ' 个文件均为今天(' + todayStr + ')数据');
  }

  // 3. 驱动 ChatGPT
  const browser = await sender.connect(cfg.cdpUrl, log);
  let page = await sender.openConversation(browser, cfg.conversationUrl, log);

  if (argv.probe) { log.info('[probe] 仅确认对话可用，不上传'); log.flush(); process.exit(0); }

  // 3b. 判断是否需要在项目内新开对话（对话已达长度上限时）
  const mode = cfg.newChatMode || 'auto';
  let rotate = false;
  if (argv.newChat) { rotate = true; log.warn('--new-chat：强制在项目内新开对话'); }
  else if (cfg.rotateOnNextRun) { rotate = true; log.warn('config.rotateOnNextRun=true：本次强制在项目内新开对话'); }
  else if (mode === 'always') { rotate = true; log.info('newChatMode=always：每次运行均在项目内新开对话'); }
  else if (await sender.isConversationFull(page)) { rotate = true; log.warn('检测到目标对话已达长度上限，自动在项目内新开对话'); }

  if (rotate) {
    page = await sender.openProjectNewChat(browser, cfg.projectUrl, log);
  }

  // 先清空可能的残留草稿，再上传附件（顺序不能反，否则会连附件一起清掉）
  await sender.clearComposer(page, log);
  await sender.uploadFiles(page, files, log, cfg.attachmentTimeoutMs);

  if (argv.uploadOnly) {
    log.warn('[upload-only] 已上传但未发送；附件仍留在输入框，请刷新页面清理');
    log.flush();
    process.exit(0);
  }

  // 4. 发送提示词
  const dateStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地时区）
  const prompt = cfg.promptTemplate.replace(/\{date\}/g, dateStr);
  const sent = await sender.sendPrompt(page, prompt, log, { force: argv.resend || rotate });
  if (sent && sent.ok === false) { log.error('发送校验未通过：既未发出消息、composer 也有残留，请检查'); log.flush(); process.exit(2); }
  if (sent && sent.ok && sent.skipped) log.info('（已确认此前已发送过同一提示词，本次未重复推送）');

  // 4b. 新开对话成功后，把新 URL 回写 config，后续沿用
  if (rotate) {
    let newUrl = null;
    for (let i = 0; i < 10 && !newUrl; i++) {
      newUrl = await sender.currentConversationUrl(page);
      if (!newUrl) await sender.sleep(3000);
    }
    if (newUrl && newUrl !== cfg.conversationUrl) {
      cfg.conversationUrl = newUrl;
      if (mode !== 'always') cfg.rotateOnNextRun = false;
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
      log.step('已回写新对话 URL 到 chatgpt-config.json：' + newUrl);
    } else if (newUrl) {
      log.info('新对话 URL 与 config 一致，无需回写：' + newUrl);
      if (mode !== 'always' && cfg.rotateOnNextRun) { cfg.rotateOnNextRun = false; fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n'); }
    } else {
      log.warn('未能取到新对话 URL（页面未跳转 /c/<id>），config 未更新；下次运行仍会新开对话');
    }
  }

  log.step('=== 发送完成（' + files.length + ' 个附件，日期 ' + dateStr + '，目标对话 ' + (rotate ? '新开' : '沿用') + '）===');
  log.flush();
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
