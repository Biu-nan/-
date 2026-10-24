import { DianxiaomiAdapter } from "./dist/src/dianxiaomi-adapter.js";
import fs from "node:fs";

const a = new DianxiaomiAdapter();
await a.connect();
await a.openCollectBox();
await a.searchCollectBox("钥匙扣");
await new Promise(r => setTimeout(r, 3500));
const titles = await a.page.evaluate(() => {
  const trs = Array.from(document.querySelectorAll(".vxe-table--body-wrapper tbody tr")).filter(r => r.querySelector("td"));
  const set = new Set();
  for (const r of trs) {
    const tds = Array.from(r.querySelectorAll("td")).map(td => (td.innerText || "").trim());
    const t = tds.reduce((m, x) => (x.length > m.length ? x : m), "");
    if (t) set.add(t.replace(/\s+/g, " ").trim());
  }
  return Array.from(set);
});
const completedDir = "./已完成产品";
const completed = fs.readdirSync(completedDir).filter(n => {
  try { return fs.statSync(completedDir + "/" + n).isDirectory() && fs.existsSync(completedDir + "/" + n + "/product-facts.json"); } catch { return false; }
});
const matched = [];
for (const t of titles) {
  const base = t.replace(/\s*(红色|粉色|黑色|金色|银色|彩色|蓝色|绿色|紫色|白色|黄色|[A-Z]色)\s*$/i, "").trim();
  const hit = completed.find(c => c === t || c === base || t.includes(c) || c.includes(base) || base.includes(c));
  if (hit) matched.push({ collectTitle: t, factsDir: hit });
}
console.log("采集箱钥匙扣结果行:", titles.length);
console.log("既搜得到又有facts的:", matched.length);
matched.slice(0, 15).forEach(m => console.log(" -", m.collectTitle, "=>", m.factsDir));
process.exit(0);
