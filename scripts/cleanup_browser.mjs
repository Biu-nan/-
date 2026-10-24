// 清理浏览器：只保留一个标签页并导航到采集箱draft页
import { chromium } from "playwright-core";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const pages = context.pages();
  console.log("before:", pages.map(p => p.url()));
  for (let i = 1; i < pages.length; i++) {
    await pages[i].close().catch(() => {});
  }
  const page = context.pages()[0];
  await page.goto("https://www.dianxiaomi.com/web/smtChoice/draft", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  console.log("after:", context.pages().map(p => p.url()));
  await browser.close().catch(() => {});
}
main().catch(e => { console.error(e); process.exit(1); });
