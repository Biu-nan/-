// ListingAgentClient：供现有 server.js（或任何调用方）使用的客户端（双形态之「接驳面」）。
// 默认优先 HTTP 调用独立服务（http://localhost:${AGENT_PORT}）；同进程部署或 HTTP 不可达时，
// 回退到进程内直接 import ListingAgent 调用（无需起独立进程）。
import { ListingAgent } from "./listing-agent.js";
import { ChatGptWebProvider } from "./ai/chatgpt-provider.js";
import { DianxiaomiPublisher } from "./publishers/dianxiaomi-publisher.js";

const PORT = Number(process.env.AGENT_PORT || 3200);
const BASE = process.env.AGENT_HTTP_BASE || `http://localhost:${PORT}`;

export class ListingAgentClient {
  /**
   * @param {object} [opts]
   * @param {object} [opts.agent] 注入的 ListingAgent 实例（同进程模式，优先使用）
   * @param {boolean} [opts.useHttp] 强制走 HTTP（默认自动：先 HTTP，失败回退进程内）
   */
  constructor(opts = {}) {
    this.agent = opts.agent || null;
    this.useHttp = opts.useHttp ?? true;
    this._inProcess = null;
  }

  _inProcessAgent() {
    if (!this._inProcess) {
      this._inProcess = new ListingAgent({
        ai: new ChatGptWebProvider(),
        publisher: new DianxiaomiPublisher(),
      });
    }
    return this._inProcess;
  }

  async _post(path, body) {
    if (this.agent) return this._dispatchLocal(path, body);
    if (this.useHttp) {
      try {
        const res = await fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      }
      catch (e) {
        if (this.useHttp && (e.code === "ECONNREFUSED" || /fetch failed/i.test(e.message || ""))) {
          // 回退进程内
          return this._dispatchLocal(path, body);
        }
        throw e;
      }
    }
    return this._dispatchLocal(path, body);
  }

  async _dispatchLocal(path, body) {
    const agent = this.agent || this._inProcessAgent();
    if (path === "/api/listing/validate") return agent.validate(body);
    if (path === "/api/listing/preview") {
      const r = { ...body, options: { ...(body.options || {}), publish: false } };
      return agent.run(r);
    }
    return agent.run(body);
  }

  run(req) { return this._post("/api/listing/run", req); }
  validate(req) { return this._post("/api/listing/validate", req); }
  preview(req) {
    const r = { ...req, options: { ...(req.options || {}), publish: false } };
    return this._post("/api/listing/preview", r);
  }
}
