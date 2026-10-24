// 登录 + 探索：点稳卖预填的登录按钮，确认登录态，并抓 GSP 导航找「中补货入库」
// 安全约束：只点「登录」；出现验证码/滑块立即停止，不做任何绕过
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const SELLER_LOGIN =
  'https://login.aliexpress.com/user/seller/login?bizSegment=GSP&return_url=http%3A%2F%2Fgsp.aliexpress.com%2F';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const describe = (page) =>
  page.evaluate(() => {
    const b = (document.body.innerText || '').replace(/\s+/g, ' ');
    return {
      href: location.href,
      title: document.title,
      hasPasswordInput: !!document.querySelector('input[type=password]'),
      captcha: !!document.querySelector('#nc_1_wrapper, .nc-container, .baxia-dialog, iframe[src*="punish"], iframe[src*="captcha"]'),
      buttons: [...new Set(Array.from(document.querySelectorAll('button, [role=button], .next-btn, a'))
        .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 16))].slice(0, 20),
      head: b.slice(0, 260),
    };
  });

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();

  console.log('=== 1. 打开卖家登录页 ===');
  await page.goto(SELLER_LOGIN, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(8000);
  console.log(JSON.stringify(await describe(page), null, 1));

  const prefill = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map((i) => ({
      id: i.id, type: i.type, valLen: (i.value || '').length,
    })));
  console.log('预填情况:', JSON.stringify(prefill));

  const acc = prefill.find((x) => x.type === 'text' && x.valLen > 0);
  const pwd = prefill.find((x) => x.type === 'password' && x.valLen > 0);
  if (!acc || !acc.valLen || !pwd || !pwd.valLen) {
    console.log('\n!! 未检测到预填凭据 —— 停止，不做自动登录 !!');
    await page.close();
    process.exit(0);
  }
  console.log('\n凭据已预填 -> 点击「登录」');

  let clicked = false;
  for (const how of [
    () => page.locator('button:visible', { hasText: /^登录$/ }).first().click({ timeout: 8000 }),
    () => page.getByRole('button', { name: '登录', exact: true }).click({ timeout: 8000 }),
    () => page.locator('.fm-button, .next-btn-primary, button[type=submit]').first().click({ timeout: 8000 }),
  ]) {
    try { await how(); clicked = true; break; } catch (e) { /* 试下一种 */ }
  }
  console.log('是否点到登录按钮:', clicked);
  if (!clicked) { await page.close(); process.exit(0); }

  console.log('\n=== 2. 等待登录结果（最多 45s）===');
  for (let i = 1; i <= 9; i++) {
    await sleep(5000);
    const s = await describe(page);
    console.log('[' + i * 5 + 's]', s.href.slice(0, 110));
    if (s.captcha) { console.log('!! 出现验证码/风控，立即停止，不绕过 !!'); await page.close(); process.exit(0); }
    if (s.href.includes('gsp.aliexpress.com') && !s.hasPasswordInput) { console.log('=> 已进入 GSP'); break; }
    if (!/login/i.test(s.href) && !s.hasPasswordInput) { console.log('=> 已离开登录页'); break; }
    if (i === 9) console.log('...超时仍在登录页');
  }

  console.log('\n=== 3. 登录后状态 ===');
  console.log(JSON.stringify(await describe(page), null, 1));

  const cookies = await ctx.cookies();
  const names = cookies.filter((c) => (c.domain || '').includes('aliexpress')).map((c) => c.name);
  const key = ['cookie2', 'sgcookie', '_m_h5_tk', 'xman_us_f', 'intl_common_forever', 'aep_usuc_f', 'x5sec', 'csg'];
  console.log('关键登录 cookie:', JSON.stringify(key.filter((k) => names.includes(k))));
  console.log('cookie 总数:', cookies.length);

  console.log('\n=== 4. 访问 GSP 并抓导航（找「中补货入库」）===');
  try {
    await page.goto('https://gsp.aliexpress.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(12000);
    const gsp = await page.evaluate(() => {
      const navTexts = [...new Set(Array.from(document.querySelectorAll('nav a, .menu a, aside a, [class*=menu] a, [class*=nav] a, li a'))
        .map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 24))].slice(0, 80);
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map((a) => ((a.innerText || '').replace(/\s+/g, ' ').trim()) + ' :: ' + a.getAttribute('href'))
        .filter((t) => /补货|入库|库存|仓|inventory|stock|warehouse/i.test(t)).slice(0, 30);
      return {
        href: location.href, title: document.title,
        nav: navTexts, stockRelated: [...new Set(links)],
        head: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 700),
      };
    });
    console.log(JSON.stringify(gsp, null, 1));
  } catch (e) {
    console.log('GSP 访问失败: ' + e.message);
  }

  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
