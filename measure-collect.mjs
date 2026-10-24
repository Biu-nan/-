// 测量单品采集箱上架各阶段耗时
import fs from "node:fs";
import http from "node:http";

const BASE = "http://127.0.0.1:3000";

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

const row = {
  packageName: "亮面包包挂件红色",
  category: "xiangBaoFold",
  searchTitle: "亮面",
  enabled: true,
  variantThemeMap: "",
  productTemplate: "箱包配件-包饰",
  logisticsAttribute: "普货",
  material: "金属(Metal)",
  variantOverride: false
};

async function waitIdle() {
  for (let i = 0; i < 60; i++) {
    const s = await req("GET", "/api/dianxiaomi/collect-batch-status");
    if (s.body && !s.body.running) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  await waitIdle();
  const op = "measure-" + Date.now();
  let apply = await req("POST", "/api/dianxiaomi/collect-batch-apply", { operationId: op, rows: [row] });
  if (apply.status === 409) {
    console.log("409 busy, waiting then retry");
    await new Promise((r) => setTimeout(r, 60000));
    apply = await req("POST", "/api/dianxiaomi/collect-batch-apply", { operationId: op, rows: [row] });
  }
  console.log("apply:", apply.status, JSON.stringify(apply.body));

  // 轮询阶段
  const segments = [];
  let last = null; // {name, t}
  const t0 = Date.now();
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
    const it = items.find((x) => x.name === row.packageName);
    if (it && (it.status === "done" || it.status === "failed" || it.status === "skipped")) {
      if (last) segments.push({ name: last.name, detail: last.detail, durMs: now - last.t });
      console.log("FINAL", it.status, it.reason || "");
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const total = Date.now() - t0;
  console.log("\n=== 阶段耗时（测量基准）===");
  for (const seg of segments) console.log((seg.durMs / 1000).toFixed(1).padStart(6) + "s  " + seg.name + (seg.detail ? "  [" + seg.detail + "]" : ""));
  console.log("总耗时(估): " + (total / 1000).toFixed(1) + "s");
  fs.writeFileSync("/f/yikuaborder-deploy/measure-baseline.json", JSON.stringify({ totalMs: total, segments }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
