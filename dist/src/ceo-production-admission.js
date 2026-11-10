// CEO 主运行时的「生产准入」判定（A2c）
//
// 为什么需要单独一层
// ------------------
// 原来的准入只有一个开关：`requireG1FixtureRoot` 要求数据根里放一个
// `.ceo-isolated-fixture.json`，内容 `{"synthetic":true}`。这等于**要求生产谎称自己是一份合成夹具**
// 才能启动。而在单根部署里它还有第二个硬伤：`createRuntimeManifest` 要求 codeRoot ⊥ dataRoot，
// 而 `requireG1FixtureRoot` 要求 dataRoot == projectRoot == codeRoot，两条约束直接矛盾，
// 实测报 `CODE_DATA_OVERLAP`（见 docs/A2_PREREQ_BINDING_2026-11-10.md §10.1）。
//
// 所以生产需要的不是"更宽松的校验"，而是**另一类证据**：
//   - 结构上：代码根与数据根必须真的分离（run 目录 + deploy 目录就是这种形态）
//   - 身份上：不能靠 `synthetic:true` 自证，要靠一份绑定了 manifest 指纹的批准记录
//   - 目的上：批准必须明确写着 PRODUCTION_READINESS，影子启动的批准不能顺延给生产
//
// 这一层只回答一个问题：「这份代码 + 这份数据，现在允许以生产身份运行吗？」
// 它**不回答**「谁来调用 API」「凭据从哪来」——那是鉴权层的事（A2d）。
// 也就是说：admitted:true 只表示"准入通过"，不表示"网关可以开"。刻意不做成同一件事，
// 否则又会变成"通过一次准入就等于全权放开"。
//
// 失败全部 fail-closed，原因码有界（^[A-Z_0-9:]+$），可直接进 /healthz 的 reasons。

import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {verifyBindingApproval} from './ceo-binding-approval.js';

export const PRODUCTION_ADMISSION_SCHEMA = 'ceo-production-admission/v1';

/** 生产准入必须用这个 purpose 的批准；影子启动的批准不算数。 */
export const PRODUCTION_APPROVAL_PURPOSE = 'PRODUCTION_READINESS';

/** 夹具标记文件名。它出现在数据根 = 这份数据是合成夹具，生产准入必须拒绝。 */
export const SYNTHETIC_FIXTURE_MARKER = '.ceo-isolated-fixture.json';

const REASON = /^[A-Z_0-9:]+$/;

const within = (root, target) => {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

const deny = (reason, checked) =>
  Object.freeze({ schema: PRODUCTION_ADMISSION_SCHEMA, admitted: false, reason, approval: null, checked: Object.freeze(checked) });

const allow = (approval, checked) =>
  Object.freeze({ schema: PRODUCTION_ADMISSION_SCHEMA, admitted: true, reason: null, approval, checked: Object.freeze(checked) });

async function hasSyntheticMarker(dataRoot) {
  const marker = path.join(dataRoot, SYNTHETIC_FIXTURE_MARKER);
  try {
    const raw = await readFile(marker, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.synthetic === true;
  } catch {
    // 读不到 / 不是 JSON / 没有 synthetic:true —— 都算"没有夹具标记"。
    // 注意这里不能反过来：标记缺失不是错误，生产本来就不该有它。
    return false;
  }
}

/**
 * 判定生产准入。
 *
 * @param {object}   options
 * @param {object}   options.manifest      createRuntimeManifest 的产物（mode 必须是 PRODUCTION）
 * @param {string?}  options.approvalPath  批准记录路径；默认 <dataRoot>/.ceo-binding-approval.json
 * @param {Date|string} [options.now]      注入当前时间，便于测试过期分支
 * @returns {Promise<{schema,admitted,reason,approval,checked}>}
 */
export async function assessProductionAdmission({ manifest, approvalPath = null, now = new Date() } = {}) {
  if (!manifest || manifest.schema !== 'ceo-runtime-manifest/v1') {
    return deny('ADMISSION_MANIFEST_UNAVAILABLE', {});
  }

  const { codeRoot, dataRoot } = manifest;
  const checked = { codeRoot: codeRoot ?? null, dataRoot: dataRoot ?? null, approvalPath: approvalPath ?? null };

  if (typeof codeRoot !== 'string' || typeof dataRoot !== 'string' || !path.isAbsolute(codeRoot) || !path.isAbsolute(dataRoot)) {
    return deny('ADMISSION_MANIFEST_UNAVAILABLE', checked);
  }

  // ① 形状先于证据：先在结构上确认"这是不是一个可以谈生产准入的部署"。
  //    顺序刻意放在查批准之前——单根部署里就算批准齐全也不该放行，
  //    否则会给出"补个批准就能上"的错误暗示。
  if (manifest.mode !== 'PRODUCTION') {
    return deny('ADMISSION_MANIFEST_NOT_PRODUCTION', checked);
  }

  let realCode, realData;
  try {
    realCode = await realpath(codeRoot);
    realData = await realpath(dataRoot);
  } catch {
    return deny('ADMISSION_MANIFEST_UNAVAILABLE', checked);
  }
  // ② 代码根与数据根必须真分离且互不包含 —— 这是 production 模式的结构前提。
  if (
    realCode.toLowerCase() === realData.toLowerCase() ||
    within(realCode, realData) ||
    within(realData, realCode)
  ) {
    return deny('PRODUCTION_REQUIRES_SPLIT_ROOTS', { ...checked, codeRoot: realCode, dataRoot: realData });
  }
  checked.codeRoot = realCode;
  checked.dataRoot = realData;

  // ③ 生产不得跑在合成夹具上。这一条是"诚实性"的具体落点：
  //    上一版让生产放一个 synthetic:true 才能启动，等于鼓励它撒谎；现在反过来，撒谎会被拒。
  if (await hasSyntheticMarker(realData)) {
    return deny('PRODUCTION_ON_SYNTHETIC_FIXTURE', checked);
  }

  // ④ 批准记录：绑定 manifest 指纹、落在数据根内、未过期。细节全在 ceo-binding-approval.js。
  const binding = await verifyBindingApproval({ manifest, approvalPath, now });
  if (!binding.confirmed) {
    // 透传原原因码。verifyBindingApproval 的失败码本来就全部以 BINDING_ 打头，
    // 这里再统一加前缀会拼出 BINDING_BINDING_APPROVAL_MISSING 这种重复码。
    return deny(binding.reason, checked);
  }

  // ⑤ purpose 必须对得上。verifyBindingApproval 只校验 purpose 是否在合法集合内，
  //    不校验"是不是本次想要的用途"——SHADOW_BOOT 的批准同样能通过它。
  //    这一步补上，否则影子启动的批准会顺延成生产准入。
  if (binding.approval.purpose !== PRODUCTION_APPROVAL_PURPOSE) {
    return deny('PRODUCTION_APPROVAL_PURPOSE_MISMATCH', checked);
  }

  return allow(binding.approval, checked);
}

/** 原因码能否安全放进 /healthz 的 reasons（与 runtimeHealth 用同一规则再挡一次）。 */
export const isAdmissionReason = (value) => typeof value === 'string' && REASON.test(value);
