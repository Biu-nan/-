// 验证「删除双重纠错循环」后的单品采集箱上架耗时（自动探测一个真实草稿）
import fs from "node:fs";
import http from "node:http";
import { DianxiaomiAdapter } from "./dist/src/dianxiaomi-adapter.js";

const BASE = "http://127.0.0.1:3000";
const COMPLETED = "./已完成产品";

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(BASE + path, { method, headers: { "Content-Type": "application/json", ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); } catch (e) { resolve({ status: res.statusCode, body: buf }); } });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function probeDraftTitle() {
  const a = new DianxiaomiAdapter();
  await a.connect();
  await a.openCollectBox();
  await new Promise((r) => setTimeout(r, 1500));
  const titles = await a.page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll(".vxe-table--body-wrapper tbody tr")).filter((r) => r.querySelector("td"));
    return trs.slice(0, 12).map((r) => {
      const tds = Array.from(r.querySelectorAll("td")).map((td) => (td.innerText || "").trim());
      return tds.reduce((m, t) => (t.length > m.length ? t : m), "");
    }).filter((t) => t.length > 2);
  });
  await a.disconnect?.().catch(() => {});
  return titles;
}

async function waitIdle() {
  for (let i = 0; i < 60; i++) {
    const s = await req("GET", "/api/dianxiaomi/collect-batch-status");
    if (s.body && !s.body.running) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  const titles = await probeDraftTitle();
  if (!titles.length) { console.log("no collect-box drafts found"); process.exit(1); }
  const T = titles[0];
  const searchKeyword = T.length > 4 ? T.slice(0, 3) : T;
  console.log("probed draft:", JSON.stringify(T), "searchKeyword:", JSON.stringify(searchKeyword));

  // 临时 facts（从同类产品复制，仅用于计时验证；测完即删）
  const src = "./已完成产品/字母蛇纹C钥匙扣/product-facts.json";
  const dir = COMPLETED + "/" + T;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dir + "/product-facts.json");

  const row = {
    packageName: T,
    category: "xiangBaoFold",
    searchTitle: searchKeyword,
    enabled: true,
    variantThemeMap: "",
    productTemplate: "箱包配件-包饰",
    logisticsAttribute: "普货",
    material: "金属(Metal)",
    variantOverride: false
  };

  await waitIdle();
  const op = "verify-" + Date.now();
  let apply = await req("POST", "/api/dianxiaomi/collect-batch-apply", { operationId: op, rows: [row] });
  if (apply.status === 409) {
    await new Promise((r) => setTimeout(r, 60000));
    apply = await req("POST", "/api/dianxiaomi/collect-batch-apply", { operationId: op, rows: [row] });
  }
  console.log("apply:", apply.status, JSON.stringify(apply.body));

  const segments = [];
  let last = null;
  const t0 = Date.now();
  let fillSeg = null;
  for (let i = 0; i < 600; i++) {
    const s = await req("GET", "/api/dianxiaomi/collect-batch-status");
    const st = (s.body && s.body.dianxiaomiStage) || { name: "?", detail: "", since: Date.now() };
    const now = Date.now();
    if (!last) last = { name: st.name, t: now, detail: st.detail };
    else if (st.name !== last.name) {
      segments.push({ name: last.name, detail: last.detail, durMs: now - last.t });
      last = { name: st.name, t: now, detail: st.detail };
    }
    const items = (s.body && s.body.items) || [];
    const it = items.find((x) => x.name === T);
    if (it && (it.status === "done" || it.status === "failed" || it.status === "skipped")) {
      if (last) segments.push({ name: last.name, detail: last.detail, durMs: now - last.t });
      console.log("FINAL", it.status, it.reason || "");
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const total = Date.now() - t0;
  console.log("\n=== 优化后阶段耗时 ===");
  for (const seg of segments) console.log((seg.durMs / 1000).toFixed(1).padStart(6) + "s  " + seg.name + (seg.detail ? "  [" + seg.detail + "]" : ""));
  console.log("总耗时: " + (total / 1000).toFixed(1) + "s");

  // 清理临时 facts 目录（草稿已上传至待发布，facts 副本不再需要）
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  fs.writeFileSync("./measure-optimized.json", JSON.stringify({ totalMs: total, segments }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
