// 稳卖浏览器 本地 API 客户端
// 实测结论（2026-09-29）：
//   - 地址 http://localhost:3980，POST + JSON，method 字段分发
//   - 本机壳版本只支持 /queryEnv /openEnv /closeEnv /deleteEnv
//     文档中的 /queryEnvV2 /createEnv /modifyEnv /bindEnvDevice /clearEnvCache /queryListV2 在本机全部 404
//   - 接口限流 0.5s/次，这里统一加节流
//   - 必须绕过 http_proxy：本机 shell 设了代理，会把 localhost 请求劫持走代理
//     这里直接用 node:http 打到 127.0.0.1，天然不吃代理环境变量
const http = require('http');

let lastCallAt = 0;
let chain = Promise.resolve();

function throttle(minIntervalMs) {
  chain = chain.then(async () => {
    const wait = lastCallAt + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  return chain;
}

function post(apiBase, pathName, body, timeoutMs) {
  const u = new URL(apiBase);
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: u.port || 80,
        path: pathName,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          Host: 'localhost:' + (u.port || 80),
        },
        timeout: timeoutMs || 90000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} ${pathName} -> ${text.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(text));
          } catch (e) {
            reject(new Error(`非 JSON 响应 ${pathName} -> ${text.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('请求超时 ' + pathName)));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

class WenmaiApi {
  constructor(apiBase, minIntervalMs) {
    this.apiBase = apiBase || 'http://127.0.0.1:3980';
    this.minIntervalMs = minIntervalMs || 600;
  }

  async call(pathName, body) {
    await throttle(this.minIntervalMs);
    return post(this.apiBase, pathName, body, 90000);
  }

  // 店铺查询（pageSize 上限 100，超了会直接报错）
  async queryEnv(pageNum, pageSize) {
    const res = await this.call('/queryEnv', {
      method: 'queryEnv',
      pageNum: pageNum || 1,
      pageSize: Math.min(pageSize || 100, 100),
    });
    const r = res && res.response;
    if (!r || r.code !== 200) {
      throw new Error('queryEnv 失败: ' + JSON.stringify(res).slice(0, 300));
    }
    return r; // { code, msg, total, page, pageTotal, envs:[{id,name,platform}] }
  }

  // 拉全量店铺（自动翻页）
  async listAllStores() {
    const first = await this.queryEnv(1, 100);
    const envs = first.envs ? first.envs.slice() : [];
    const pageTotal = first.pageTotal || 1;
    for (let p = 2; p <= pageTotal; p++) {
      const nxt = await this.queryEnv(p, 100);
      if (nxt.envs) envs.push(...nxt.envs);
    }
    return { total: first.total || envs.length, envs };
  }

  // 启动店铺 -> 返回 { pid, cdpPort, selenium, webdriverPath }
  async openEnv(id, option) {
    const res = await this.call('/openEnv', {
      method: 'openEnv',
      id,
      option: option || 'default',
    });
    const r = res && res.response;
    if (!r || r.code !== 200) {
      throw new Error(`openEnv(${id}) 失败: ` + JSON.stringify(res).slice(0, 300));
    }
    const m = String(r.selenium || '').match(/:(\d+)/);
    return {
      pid: r.pid,
      selenium: r.selenium,
      cdpPort: m ? Number(m[1]) : null,
      webdriverPath: r.webdriverPath,
      raw: r,
    };
  }

  async closeEnv(id) {
    try {
      const res = await this.call('/closeEnv', { method: 'closeEnv', id });
      return res;
    } catch (e) {
      return { error: e.message };
    }
  }

  // 连通性自检：顺带确认哪些接口在本机可用（壳版本会变）
  async selfCheck() {
    const out = { reachable: false, endpoints: {}, stores: null, error: null };
    try {
      const r = await this.queryEnv(1, 1);
      out.reachable = true;
      out.endpoints['/queryEnv'] = { ok: true, total: r.total };
    } catch (e) {
      out.error = e.message;
      return out;
    }
    // 只探路由存在性，不产生副作用（用不存在的 id）
    for (const [p, method] of [['/openEnv', 'openEnv'], ['/closeEnv', 'closeEnv'], ['/deleteEnv', 'deleteEnv']]) {
      try {
        const res = await this.call(p, { method, id: 99999999 });
        out.endpoints[p] = { ok: true, sample: JSON.stringify(res).slice(0, 120) };
      } catch (e) {
        out.endpoints[p] = { ok: false, error: e.message.slice(0, 120) };
      }
    }
    return out;
  }
}

module.exports = { WenmaiApi };
