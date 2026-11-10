import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const moduleUrl = new URL("../src/ceo-read-brief.js", import.meta.url);
const cliPath = fileURLToPath(new URL("../../scripts/ceo-read-brief.mjs", import.meta.url));
const now = new Date("2026-10-26T03:00:00.000Z");

function state(overrides = {}) {
  return {
    schema: "system-state/v1", generatedAt: "2026-10-26T02:59:00.000Z", readOnly: true,
    summary: { unitCount: 1, archivedCount: 0, byState: { DONE: 1 }, gateCount: 0, anomalyCount: 0, attentionRequired: 0, healthy: true },
    sources: [{ id: "daily_waiting", ok: true, error: null }],
    units: [{ unitId: "waiting-1", sourceId: "daily_waiting", kind: "EXTERNAL_WAIT", state: "DONE", stateBasis: "原始 status=resolved" }],
    gates: [], caveats: ["Local records do not establish live platform results."],
    ...overrides,
  };
}

async function read(options = {}) {
  const { readCeoBrief } = await import(moduleUrl);
  return readCeoBrief({ now, fetchImpl: async () => new Response(JSON.stringify(state())), ...options });
}

function child(args) {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, args, { cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))), windowsHide: true });
    let stdout = "", stderr = "";
    processHandle.stdout.on("data", bytes => { stdout += bytes; });
    processHandle.stderr.on("data", bytes => { stderr += bytes; });
    processHandle.once("error", reject);
    processHandle.once("close", code => resolve({ code, stdout, stderr }));
  });
}

test("uses_only_GET_system_state with redirect rejection and a bounded signal", async () => {
  const calls = [];
  const brief = await read({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(state()));
  } });
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), "http://127.0.0.1:3000/api/system/state");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.equal(brief.schema, "ceo-brief/v1");
  assert.equal(brief.connection, "VERIFIED");
  assert.equal(brief.readOnly, true);
});

test("sets_an_eight_second_timeout_on_the_request", async t => {
  const original = AbortSignal.timeout;
  const durations = [];
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    durations.push(milliseconds);
    return original(milliseconds);
  });
  await read();
  assert.deepEqual(durations, [8000]);
});

for (const baseUrl of [
  "https://127.0.0.1:3000", "http://example.com:3000", "http://127.0.0.2:3000",
  "http://127.0.0.1", "http://127.0.0.1:0", "http://localhost:65536",
  "http://user:credential-secret@localhost:3000", "http://localhost:3000/write",
  "http://localhost:3000/?action=write", "http://localhost:3000/#write",
  "http://127.1:3000", "http://2130706433:3000", null, 3000,
]) {
  test(`rejects_invalid_base_before_network ${String(baseUrl).replace("credential-secret", "REDACTED")}`, async () => {
    let calls = 0;
    await assert.rejects(() => read({ baseUrl, fetchImpl: async () => { calls++; throw Error("must not call"); } }), error => {
      assert.equal(error.code, "INVALID_BASE_URL");
      assert.doesNotMatch(error.message, /credential-secret|user:/);
      return true;
    });
    assert.equal(calls, 0);
  });
}

test("accepts explicit localhost and standard HTTP ports", async () => {
  for (const [baseUrl, expected] of [
    ["http://localhost:3100/", "http://localhost:3100/api/system/state"],
    ["http://127.0.0.1:80", "http://127.0.0.1/api/system/state"],
  ]) {
    await read({ baseUrl, fetchImpl: async url => {
      assert.equal(String(url), expected);
      return new Response(JSON.stringify(state()));
    } });
  }
});

for (const payload of [
  null, [], state({ schema: "other/v1" }), state({ readOnly: false }),
  state({ sources: null }), state({ units: {} }), state({ summary: null }),
  state({ gates: null }), state({ caveats: "not an array" }), state({ generatedAt: "invalid" }),
  state({ sources: [{ id: "daily_waiting", ok: "true" }] }), state({ units: [{ unitId: "bad", state: null }] }),
]) {
  test(`rejects_invalid_response ${JSON.stringify(payload).slice(0, 70)}`, async () => {
    await assert.rejects(() => read({ fetchImpl: async () => new Response(JSON.stringify(payload)) }), { code: "INVALID_RESPONSE" });
  });
}

test("rejects_non_200_without_echoing_private_response", async () => {
  await assert.rejects(() => read({ fetchImpl: async () => new Response("private server detail secret-value", { status: 503 }) }), error => {
    assert.equal(error.code, "INVALID_RESPONSE");
    assert.doesNotMatch(error.message, /secret-value|private server/);
    return true;
  });
});

test("rejects_malformed_JSON", async () => {
  await assert.rejects(() => read({ fetchImpl: async () => new Response("{broken") }), { code: "INVALID_RESPONSE" });
});

test("connection_failure_is_bounded_to_one_attempt_and_sanitized", async () => {
  let attempts = 0;
  await assert.rejects(() => read({ fetchImpl: async () => {
    attempts++;
    throw new Error("backend credential-secret private-stack");
  } }), error => {
    assert.equal(error.code, "CONNECTION_FAILED");
    assert.doesNotMatch(error.message, /credential-secret|private-stack/);
    return true;
  });
  assert.equal(attempts, 1);
});

test("preserves_unhealthy_sources_even_when_summary_claims_healthy", async () => {
  const payload = state({ sources: [{ id: "daily_waiting", ok: false, error: "FILE_NOT_FOUND" }] });
  const brief = await read({ fetchImpl: async () => new Response(JSON.stringify(payload)) });
  assert.equal(brief.dataHealth, "DEGRADED");
  assert.equal(brief.sources[0].ok, false);
  assert.equal(brief.sources[0].error, "FILE_NOT_FOUND");
  assert.equal(brief.summary.healthy, true);
  assert.equal(brief.summaryIsSourceProjection, true);
});

test("does_not_call_business_healthy_when_source_summary_reports_anomalies", async () => {
  const brief = await read({ fetchImpl: async () => new Response(JSON.stringify(state({ summary: { ...state().summary, healthy: false, anomalyCount: 1 } }))) });
  assert.equal(brief.dataHealth, "DEGRADED");
});

test("empty_sources_do_not_establish_data_health", async () => {
  const brief = await read({ fetchImpl: async () => new Response(JSON.stringify(state({ sources: [] }))) });
  assert.equal(brief.dataHealth, "DEGRADED");
});

test("resolved_is_not_verified_business_completion and cannot spoof verification", async () => {
  const payload = state();
  payload.units[0].verification = "VERIFIED";
  payload.units[0].businessStatus = "COMPLETE";
  const brief = await read({ fetchImpl: async () => new Response(JSON.stringify(payload)) });
  assert.equal(brief.units[0].state, "DONE");
  assert.equal(brief.units[0].rawState, "DONE");
  assert.equal(brief.units[0].businessStatus, "PENDING_VERIFICATION");
  assert.equal(brief.units[0].verification, "UNVERIFIED");
  assert.equal(brief.summary.byState.DONE, 1);
  assert.equal(brief.summaryIsSourceProjection, true);
});

test("active_units_preserve_their_original_status_without_claiming_verification", async () => {
  const payload = state({ units: [{ unitId: "task-2", state: "RUNNING", sourceId: "batch_listing" }] });
  const brief = await read({ fetchImpl: async () => new Response(JSON.stringify(payload)) });
  assert.equal(brief.units[0].rawState, "RUNNING");
  assert.equal(brief.units[0].businessStatus, "RUNNING");
  assert.equal(brief.units[0].verification, "UNVERIFIED");
});

test("does_not_claim_platform_metrics_freshness_from_system_timestamp", async () => {
  const brief = await read();
  assert.equal(brief.observedAt, "2026-10-26T03:00:00.000Z");
  assert.equal(brief.sourceGeneratedAt, "2026-10-26T02:59:00.000Z");
  assert.equal(brief.metricsFresh, undefined);
  assert.ok(brief.caveats.some(text => /平台.*新鲜|platform.*fresh/i.test(text)));
  assert.ok(brief.caveats.includes("Local records do not establish live platform results."));
});

test("CLI_import_has_no_network_or_output_side_effect", async () => {
  const script = `globalThis.fetch=async()=>{throw Error('unexpected network')};await import(${JSON.stringify(new URL("../../scripts/ceo-read-brief.mjs", import.meta.url).href)});console.log('IMPORTED');`;
  const result = await child(["--input-type=module", "-e", script]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.trim(), "IMPORTED");
  assert.equal(result.stderr, "");
});

test("CLI_emits_one_JSON_brief_and_error_arguments_do_not_leak", async () => {
  const bootstrap = `globalThis.fetch=async(url,opts)=>{if(String(url)!=='http://127.0.0.1:3000/api/system/state'||opts.method!=='GET')throw Error('unexpected request');return new Response(${JSON.stringify(JSON.stringify(state()))});};`;
  const result = await child(["--import", `data:text/javascript,${encodeURIComponent(bootstrap)}`, cliPath]);
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).schema, "ceo-brief/v1");
  assert.equal(result.stderr, "");
  const invalid = await child([cliPath, "--base-url", "http://user:credential-secret@localhost:3000"]);
  assert.equal(invalid.code, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /INVALID_BASE_URL/);
  assert.doesNotMatch(invalid.stderr, /credential-secret|user:|at .*\.mjs/);
});

test("CLI_rejects_unknown_or_incomplete_arguments", async () => {
  for (const args of [["--base-url"], ["--unknown"], ["--base-url", "http://localhost:3000", "extra"]]) {
    const result = await child([cliPath, ...args]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /INVALID_ARGUMENTS/);
  }
});
