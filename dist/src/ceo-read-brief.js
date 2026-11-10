const STATES = new Set(["DRAFT", "READY", "RUNNING", "BLOCKED_NEEDS_HUMAN", "DONE", "FAILED", "CANCELLED"]);

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stateUrl(baseUrl) {
  // Require a literal loopback host and explicit port before URL normalization.
  // WHATWG URL otherwise turns shorthand/numeric hosts into 127.0.0.1.
  if (typeof baseUrl !== "string" || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/?$/i.test(baseUrl)) {
    throw failure("INVALID_BASE_URL", "Use an HTTP loopback address with an explicit port.");
  }
  let base;
  try { base = new URL(baseUrl); } catch { /* handled below */ }
  const explicitPort = Number(baseUrl.match(/:(\d+)\/?$/)?.[1]);
  if (!base || explicitPort < 1 || explicitPort > 65535 || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw failure("INVALID_BASE_URL", "Use an HTTP loopback address with an explicit port.");
  }
  return new URL("/api/system/state", base).href;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validState(data) {
  return record(data) && data.schema === "system-state/v1" && data.readOnly === true
    && typeof data.generatedAt === "string" && Number.isFinite(Date.parse(data.generatedAt))
    && record(data.summary) && typeof data.summary.healthy === "boolean"
    && Array.isArray(data.sources) && data.sources.every(source => record(source) && typeof source.id === "string" && typeof source.ok === "boolean")
    && Array.isArray(data.units) && data.units.every(unit => record(unit) && typeof unit.unitId === "string" && STATES.has(unit.state))
    && Array.isArray(data.gates) && data.gates.every(record)
    && Array.isArray(data.caveats) && data.caveats.every(text => typeof text === "string");
}

/** Read the existing local projection. Does not execute tasks or verify platform effects. */
export async function readCeoBrief({ baseUrl = "http://127.0.0.1:3000", fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const url = stateUrl(baseUrl);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
  } catch {
    throw failure("CONNECTION_FAILED", "Could not read the local OS state.");
  }
  if (response?.status !== 200) {
    throw failure("INVALID_RESPONSE", "The local OS returned an unsupported response.");
  }
  let data;
  try { data = await response.json(); } catch {
    throw failure("INVALID_RESPONSE", "The local OS returned invalid JSON.");
  }
  if (!validState(data)) {
    throw failure("INVALID_RESPONSE", "The local OS state does not match system-state/v1.");
  }
  return {
    schema: "ceo-brief/v1",
    observedAt: now.toISOString(),
    sourceGeneratedAt: data.generatedAt,
    readOnly: true,
    connection: "VERIFIED",
    dataHealth: data.sources.length > 0 && data.sources.every(source => source.ok) && data.summary.healthy ? "OK" : "DEGRADED",
    sources: data.sources,
    summary: data.summary,
    summaryIsSourceProjection: true,
    units: data.units.map(unit => ({
      ...unit, rawState: unit.state,
      businessStatus: unit.state === "DONE" ? "PENDING_VERIFICATION" : unit.state,
      verification: "UNVERIFIED",
    })),
    gates: data.gates,
    caveats: [
      ...data.caveats,
      "系统汇总和原始 DONE 仅为本地投影，不证明外部业务动作已经核验完成。",
      "sourceGeneratedAt 是系统汇总生成时间，不证明平台指标新鲜度或经营目标达成。",
    ],
  };
}
