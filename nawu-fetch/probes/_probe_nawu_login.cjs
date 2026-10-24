// 探针：判断稳卖店铺浏览器是否处于已登录态（访问 GSP 后台看是否被踢回登录页）
delete process.env.http_proxy; delete process.env.HTTP_PROXY;
delete process.env.https_proxy; delete process.env.HTTPS_PROXY;
process.env.NO_PROXY = '*';

const { chromium } = require('playwright-core');
const PORT = process.argv[2] || '14767';
const TARGET = process.argv[3] || 'https://gsp.aliexpress.com/';

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const ctx = browser.contexts()[0];
  const page = await ctx.newPage();
  try {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);
    const r = await page.evaluate(() => ({
      href: location.href,
      title: document.title,
      bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
      hasLoginForm: !!document.querySelector('input[type=password], .login-form, #login-form'),
    }));
    const cookies = await ctx.cookies();
    const dom = (d) => cookies.filter((c) => (c.domain || '').includes(d));
    console.log(JSON.stringify({
      port: PORT,
      target: TARGET,
      finalUrl: r.href,
      title: r.title,
      looksLoggedOut: /login/i.test(r.href) || r.hasLoginForm,
      cookieCount_all: cookies.length,
      cookieCount_aliexpress: dom('aliexpress').length,
      cookieNames_aliexpress: dom('aliexpress').map((c) => c.name).slice(0, 25),
      bodyHead: r.bodyHead,
    }, null, 1));
  } catch (e) {
    console.log('ERR ' + e.message);
  }
  await page.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
