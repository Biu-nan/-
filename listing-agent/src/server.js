// Listing Agent 独立 HTTP 服务入口（双形态之一）。
// 使用 Node 内置 http，不引入 Express，保持包依赖最小。
// 提供：POST /api/listing/run | /api/listing/validate | /api/listing/preview，GET /api/listing/status/:jobId。
//
// AI 与上架默认用「网页版」实现（ChatGptWebProvider / DianxiaomiPublisher），均为懒加载，
// 服务启动不要求 Chrome 在线；真正请求时才连接。可在进程内通过 agent-client 直接 import，
// 也可作为独立进程经 HTTP 调用（端口 AGENT_PORT，默认 3200）。
import http from "node:http";
import { ListingAgent } from "./listing-agent.js";
import { ChatGptWebProvider } from "./ai/chatgpt-provider.js";
import { DianxiaomiPublisher } from "./publishers/dianxiaomi-publisher.js";

const PORT = Number(process.env.AGENT_PORT || 3200);
const ai = new ChatGptWebProvider();
const publisher = new DianxiaomiPublisher();
const agent = new ListingAgent({ ai, publisher });
const statusStore = new Map();

function sendJson(response, code, body) {
  const data = JSON.stringify(body);
  response.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  response.end(data);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let buf = "";
    request.on("data", (c) => (buf += c));
    request.on("end", () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); }
      catch (e) { reject(new Error("请求体不是合法 JSON: " + e.message)); }
    });
    request.on("error", reject);
  });
}

async function handleRun(request, response, forcePreview) {
  try {
    const raw = await readBody(request);
    if (forcePreview && raw.options) raw.options.publish = false;
    const result = await agent.run(raw);
    if (result.publish && result.publish.jobId) {
      statusStore.set(result.publish.jobId, { status: result.status, at: Date.now() });
    }
    sendJson(response, 200, result);
  }
  catch (e) {
    sendJson(response, 400, { error: e && e.message ? e.message : String(e) });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  try {
    if (request.method === "POST" && pathname === "/api/listing/run") {
      return await handleRun(request, response, false);
    }
    if (request.method === "POST" && pathname === "/api/listing/validate") {
      const raw = await readBody(request);
      const r = await agent.validate(raw);
      return sendJson(response, 200, r);
    }
    if (request.method === "POST" && pathname === "/api/listing/preview") {
      return await handleRun(request, response, true);
    }
    if (request.method === "GET" && pathname.startsWith("/api/listing/status/")) {
      const jobId = decodeURIComponent(pathname.split("/").pop());
      const s = statusStore.get(jobId) || { status: "unknown" };
      return sendJson(response, 200, s);
    }
    sendJson(response, 404, { error: "not found", path: pathname });
  }
  catch (e) {
    sendJson(response, 500, { error: e && e.message ? e.message : String(e) });
  }
});

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  server.listen(PORT, () => {
    console.log(`[listing-agent] HTTP 服务已启动: http://localhost:${PORT}`);
  });
}

export { server, agent };
