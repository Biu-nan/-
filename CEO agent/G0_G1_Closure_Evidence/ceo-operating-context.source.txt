import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const digest = v => createHash('sha256').update(v).digest('hex');
const integer = v => Number.isSafeInteger(v) && v >= 0;
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (object(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const ceoContentHash = value => digest(JSON.stringify(canonical(value)));
export function ceoContextId(context) {
  const { goal, observations, sourceManifest, dictionaryHash, resourceProposal } = context;
  // Capture-time diagnostics are evaluated on every load, independently of source identity.
  const immutableObservations = observations.map(o => ({...o,issues:o.issues.filter(issue=>issue!=='CAPTURE_FROM_FUTURE')}));
  return `context-${ceoContentHash({ goal, observations:immutableObservations, sourceManifest, dictionaryHash, resourceProposal })}`;
}
function fail(code) { const e = new Error(code); e.code = code; throw e; }
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const timestamp = s => text(s) && /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
function validateConfig(c) {
  const g = c?.goal;
  if (c?.schema !== 'ceo-store-config/v1' || !object(g) || g.schema !== 'ceo-goal/v1'
    || !text(g.goalId) || !integer(g.version) || !g.version
    || g.storeRef?.platform !== 'aliexpress-choice' || g.storeRef?.environmentId !== '400370'
    || !date(g.period?.fromDate) || !date(g.period?.toDate) || g.period.fromDate > g.period.toDate
    || !text(g.period.timeZone) || !Array.isArray(g.targets) || g.targets.length !== 2
    || !g.targets.every(t => object(t) && text(t.targetId) && typeof t.value === 'number' && Number.isFinite(t.value) && t.value > 0
      && (t.caliber === null || text(t.caliber)) && text(t.unit) && ['DAY','MONTH'].includes(t.window) && ['PENDING','VERIFIED'].includes(t.metricStatus))
    || new Set(g.targets.map(t => t.targetId)).size !== 2
    || !g.targets.some(t => t.targetId === 'daily-paid-items' && t.unit === '件' && t.window === 'DAY')
    || !g.targets.some(t => t.targetId === 'monthly-operating-profit-ex-quality-penalty' && t.unit === 'CNY' && t.window === 'MONTH')
    || !(g.capacityMinutes === null || integer(g.capacityMinutes)) || !(g.bufferMinutes === null || integer(g.bufferMinutes))
    || (g.capacityMinutes !== null && g.bufferMinutes !== null && g.bufferMinutes > g.capacityMinutes)
    || !(g.deadline === null || timestamp(g.deadline))
    || c.resourceProposal?.status !== 'PROPOSED_SCENARIO' || c.resourceProposal.operators !== 1
    || !integer(c.resourceProposal.capacityMinutes) || !integer(c.resourceProposal.bufferMinutes)
    || c.resourceProposal.bufferMinutes > c.resourceProposal.capacityMinutes) fail('INVALID_CONFIG');
  try { new Intl.DateTimeFormat('en',{timeZone:g.period.timeZone}).format(); }
  catch { fail('INVALID_CONFIG'); }
}

export async function loadCeoOperatingContext({ projectRoot, now = new Date() }) {
  if (!text(projectRoot) || !(now instanceof Date) || !Number.isFinite(now.getTime())) fail('INVALID_CONFIG');
  const root = await realpath(projectRoot);
  const manifest = [];
  async function safePath(relative) {
    const full = await realpath(path.join(root, relative));
    const diff = path.relative(root, full);
    if (diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) fail('UNSAFE_SOURCE');
    return full;
  }
  async function readBounded(relative, limit, code) {
    const full = await safePath(relative), info = await stat(full);
    if (!info.isFile()) fail(code);
    if (info.size > limit) fail('SOURCE_LIMIT');
    const bytes = await readFile(full);
    if (bytes.length > limit) fail('SOURCE_LIMIT');
    return bytes;
  }
  let config, dictionary, dictionaryBytes;
  try {
    config = JSON.parse((await readBounded('config/ceo-store-400370.json', 65536, 'INVALID_CONFIG')).toString('utf8'));
    dictionaryBytes = await readBounded('config/metrics-schema.json', 1048576, 'INVALID_CONFIG');
    dictionary = JSON.parse(dictionaryBytes.toString('utf8'));
  } catch (e) { if (['UNSAFE_SOURCE','SOURCE_LIMIT'].includes(e.code)) throw e; fail('INVALID_CONFIG'); }
  validateConfig(config);
  if (!object(dictionary?.calibers)) fail('INVALID_CONFIG');
  let files = [];
  const dir = 'data/metrics/facts/aliexpress';
  try { files = (await readdir(await safePath(dir))).filter(f => f.endsWith('.jsonl')).sort(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (files.length > 100) fail('SOURCE_LIMIT');
  const latest = new Map();
  let totalBytes = 0, count = 0;
  for (const name of files) {
    if (!date(name.slice(0,-6))) fail('INVALID_SOURCE');
    const relative = `${dir}/${name}`;
    const bytes = await readBounded(relative, 1048576, 'INVALID_SOURCE');
    totalBytes += bytes.length;
    if (totalBytes > 5 * 1048576) fail('SOURCE_LIMIT');
    const sha256 = digest(bytes);
    manifest.push({ path: relative, sha256, bytes: bytes.length });
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (const [index,line] of lines.entries()) {
      if (!line.trim()) continue;
      if (++count > 10000) fail('SOURCE_LIMIT');
      let r;
      try { r = JSON.parse(line); } catch { fail('INVALID_SOURCE'); }
      if (!object(r) || r.source !== 'aliexpress' || !text(r.storeId) || !text(r.caliber)
        || !text(r.subject) || !text(r.window) || !date(r.statDate)
        || !(r.value === null || (typeof r.value === 'number' && Number.isFinite(r.value)))
        || (r.revision !== undefined && (!integer(r.revision) || !r.revision))) fail('INVALID_SOURCE');
      if (r.storeId !== 'env:400370') continue;
      const key = JSON.stringify([r.source,r.storeId,r.caliber,r.subject,r.window,r.statDate]);
      const revision = r.revision ?? 1, previous = latest.get(key), issues = ['PERIOD_AND_COVERAGE_UNVERIFIED'];
      if (!dictionary.calibers[r.caliber]) issues.push('UNKNOWN_CALIBER');
      if (!text(r.unit)) issues.push('UNIT_UNVERIFIED');
      if (!timestamp(r.capturedAt)) issues.push('CAPTURE_TIME_UNVERIFIED');
      else if (Date.parse(r.capturedAt) > now.getTime()) issues.push('CAPTURE_FROM_FUTURE');
      if (previous && (revision < previous.revision || (revision === previous.revision && ceoContentHash(r) !== previous.recordHash))) issues.push('SOURCE_REVISION_CONFLICT');
      if (previous?.issues.includes('SOURCE_REVISION_CONFLICT')) issues.push('SOURCE_REVISION_CONFLICT');
      latest.set(key, { key, revision, source:r.source, storeRef:config.goal.storeRef, caliber:r.caliber,
        value:r.value, unit:r.unit ?? null, subject:r.subject, window:r.window, statDate:r.statDate,
        capturedAt:r.capturedAt ?? null, meta:r.meta ?? null, recordHash:ceoContentHash(r),
        quality:'PENDING_VERIFICATION', issues:[...new Set(issues)], provenance:{path:relative,sha256,line:index+1} });
    }
  }
  const observations = [...latest.values()].sort((a,b)=>a.key.localeCompare(b.key));
  const gaps = new Set(['METRIC_DEFINITIONS_UNVERIFIED','COSTS_UNRECONCILED']);
  if (!observations.length) gaps.add('NO_LOCAL_FACTS');
  if (config.goal.capacityMinutes === null || config.goal.bufferMinutes === null) gaps.add('CAPACITY_UNCONFIRMED');
  for (const observation of observations) for (const issue of observation.issues) gaps.add(issue);
  const context = {schema:'ceo-operating-context/v1',loadedAt:now.toISOString(),goal:config.goal,facts:[],observations,
    sourceManifest:manifest,dictionaryHash:digest(dictionaryBytes),gaps:[...gaps].sort(),resourceProposal:config.resourceProposal};
  return {...context,contextId:ceoContextId(context)};
}
