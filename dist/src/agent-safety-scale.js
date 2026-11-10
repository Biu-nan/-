// dist/src/agent-safety-scale.js
// 副作用分级 P0–P6 的唯一权威实现。依据：docs/SYSTEM_FRAMEWORK_v1.0.md §4.3。
//
// ─────────────────────────────────────────────────────────────
// 为什么需要这个文件（真实踩过的坑）
//
// agents/_shared/permissions.js 里也有一套 P 标号，但那是**另一个轴**：
//     FS_READ:"P1"  NET_READ:"P2"  FS_WRITE:"P3"  MODEL_CALL:"P4"
//     DATA_EGRESS:"P5"  DESTRUCTIVE:"P6"
// 它描述的是"碰了什么资源"，不是"副作用有多危险"。框架 §4.3 描述的是后者：
//     P0 纯读 / P1 写本地事实 / P2 生成本地文件 / P3 改平台草稿 /
//     P4 改价改库存 / P5 发布上架 / P6 删除清空
//
// 后果：如果拿 _shared 的 FS_WRITE("P3") 当"写本地文件"用，
// 就会把框架里的 P3「改平台草稿态」当成"随便写"，正好放行最该拦的动作。
// 两套标号字面相同、含义不同 —— 这正是"同一句话两个意思"型事故的温床。
//
// 结论：副作用门只认这个文件。_shared/permissions.js 可以继续用于路径守卫
// （assertWithin）和敏感键剥离（sanitizeFacts），但**不许**用它判副作用等级。
// ─────────────────────────────────────────────────────────────

/** 框架 §4.3 的七级，顺序即严重度。 */
export const SIDE_EFFECTS = Object.freeze({
  P0: Object.freeze({ level: "P0", name: "纯读", approval: "auto", reversible: true }),
  P1: Object.freeze({ level: "P1", name: "写本地事实/草稿", approval: "auto", reversible: true }),
  P2: Object.freeze({ level: "P2", name: "生成本地文件", approval: "auto", reversible: true }),
  P3: Object.freeze({ level: "P3", name: "改平台草稿态数据", approval: "human", reversible: true }),
  P4: Object.freeze({ level: "P4", name: "改价/改库存", approval: "human+amountCap", reversible: true }),
  P5: Object.freeze({ level: "P5", name: "发布/上架（不可逆外部动作）", approval: "human-click", reversible: false }),
  P6: Object.freeze({ level: "P6", name: "删除/清空/回滚", approval: "per-action", reversible: false }),
});

export const SIDE_EFFECT_ORDER = Object.freeze(["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);

export class PermissionDenied extends Error {
  constructor(level, ceiling, detail = "") {
    super(`副作用等级 ${level} 超出上限 ${ceiling}${detail ? `：${detail}` : ""}`);
    this.name = "PermissionDenied";
    this.code = "PERMISSION_DENIED";
    this.level = level;
    this.ceiling = ceiling;
  }
}

export function isSideEffect(level) {
  return Object.hasOwn(SIDE_EFFECTS, level);
}

export function rank(level) {
  const index = SIDE_EFFECT_ORDER.indexOf(level);
  if (index < 0) throw new Error(`未知副作用等级：${level}`);
  return index;
}

/** level 是否不高于 ceiling（P0 最低，P6 最高）。 */
export function atMost(level, ceiling) {
  return rank(level) <= rank(ceiling);
}

/** 越级直接抛 PERMISSION_DENIED，不做"降级继续"。 */
export function assertAtMost(level, ceiling, detail = "") {
  if (!isSideEffect(level)) throw new Error(`未知副作用等级：${level}`);
  if (!isSideEffect(ceiling)) throw new Error(`未知副作用上限：${ceiling}`);
  if (!atMost(level, ceiling)) throw new PermissionDenied(level, ceiling, detail);
  return true;
}

/** 需要人批的最低级；≥ 此级必须过 Gate。 */
export const HUMAN_APPROVAL_FROM = "P3";

export function requiresHumanApproval(level) {
  return rank(level) >= rank(HUMAN_APPROVAL_FROM);
}

/** 不可逆的动作（P5/P6），Gate 必须逐次确认，不许批量放行。 */
export function isIrreversible(level) {
  return SIDE_EFFECTS[level]?.reversible === false;
}

/**
 * 把 agents/_shared/permissions.js 的资源轴常量翻成框架等级。
 * 只有语义明确对应的才给映射；其余直接抛错，**不猜**。
 *
 * 故意留空的部分（MODEL_CALL）：调外部模型有成本但无业务副作用，
 * 框架七级里没有对等项。硬映射会制造一个看似权威的错答案。
 */
export const LEGACY_RESOURCE_AXIS = Object.freeze({
  FS_READ: "P0",
  NET_READ: "P0",
  FS_WRITE: "P2",
  DATA_EGRESS: "P5",
  DESTRUCTIVE: "P6",
});

export function fromLegacyResource(constant) {
  const mapped = LEGACY_RESOURCE_AXIS[constant];
  if (!mapped) {
    throw new Error(
      `_shared/permissions.js 的 ${constant} 在框架 P0–P6 里没有对等项（它描述资源，不是副作用严重度），拒绝猜测映射`,
    );
  }
  return mapped;
}
