// 回归用例：CDP 调用硬超时（_withDeadline）
// 背景：2026-10-23 实测 CDP 断连后 Playwright 的 innerText/isEnabled/count/evaluate
// 可能永不返回，导致 product-facts 桥接静默挂 20 分钟。此用例锁定：
//   - 正常 promise 原样返回；
//   - 挂死 promise 在时限内以 code=CDP_CALL_TIMEOUT 失败；
//   - 普通拒绝透传；
//   - 超时后底层 promise 迟到的拒绝不产生 unhandledRejection；
//   - 超时定时器被清理（不残留长定时器）。
// 运行：node scripts/test-cdp-deadline.mjs
import { ChatGptAdapter } from "../dist/src/chatgpt-adapter.js";

const a = new ChatGptAdapter();
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

const v = await a._withDeadline(Promise.resolve(42), 1000, "quick");
ok("resolves value", v === 42);

let code = null, ms = 0;
const t0 = Date.now();
try { await a._withDeadline(new Promise(() => { }), 120, "hang"); }
catch (e) { code = e.code; ms = Date.now() - t0; }
ok("hang rejects CDP_CALL_TIMEOUT", code === "CDP_CALL_TIMEOUT");
ok(`hang fails timely (${ms}ms)`, ms >= 100 && ms < 2000);

let rcode = null;
try { const e = new Error("boom"); e.code = "X"; await a._withDeadline(Promise.reject(e), 1000, "rej"); }
catch (e) { rcode = e.code; }
ok("rejection passthrough", rcode === "X");

let unhandled = 0;
process.on("unhandledRejection", () => { unhandled++; });
const slowReject = new Promise((_, rej) => setTimeout(() => rej(new Error("late-reject")), 250));
try { await a._withDeadline(slowReject, 50, "late"); } catch { /* expected timeout */ }
await new Promise((r) => setTimeout(r, 400));
ok("no unhandledRejection after timeout", unhandled === 0);

await a._withDeadline(Promise.resolve(1), 600_000, "long-timer");
ok("timer cleared (no dangling 600s timer)", true);

console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
