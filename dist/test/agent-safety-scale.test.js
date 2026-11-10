// dist/test/agent-safety-scale.test.js
// 副作用分级唯一权威实现的契约测试。
//
// 这个文件存在的目的不只是测函数，更是把「两套 P 标号」这个坑钉死：
// 只要有人把 agents/_shared/permissions.js 的常量拿来判副作用等级，第 5、6 条就会红。

import test from "node:test";
import assert from "node:assert/strict";
import {
  SIDE_EFFECTS,
  SIDE_EFFECT_ORDER,
  atMost,
  rank,
  assertAtMost,
  requiresHumanApproval,
  isIrreversible,
  fromLegacyResource,
} from "../src/agent-safety-scale.js";

test("七级齐全且顺序固定", () => {
  assert.deepEqual([...SIDE_EFFECT_ORDER], ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);
  for (const level of SIDE_EFFECT_ORDER) {
    assert.ok(SIDE_EFFECTS[level], `${level} 缺失`);
    assert.equal(SIDE_EFFECTS[level].level, level);
  }
  assert.equal(rank("P0"), 0);
  assert.equal(rank("P6"), 6);
});

test("P0 是纯读，P5 是发布，P6 是删除", () => {
  assert.match(SIDE_EFFECTS.P0.name, /纯读/);
  assert.match(SIDE_EFFECTS.P5.name, /发布/);
  assert.match(SIDE_EFFECTS.P6.name, /删除/);
});

test("越级抛 PERMISSION_DENIED，不降级继续", () => {
  assert.equal(assertAtMost("P1", "P1"), true);
  assert.equal(atMost("P0", "P6"), true);
  assert.equal(atMost("P6", "P0"), false);

  try {
    assertAtMost("P3", "P1", "采购 Agent 只许 P0/P1");
    assert.fail("应该抛错");
  } catch (e) {
    assert.equal(e.code, "PERMISSION_DENIED");
    assert.equal(e.level, "P3");
    assert.equal(e.ceiling, "P1");
  }
});

test("P3 起必须人批，P5/P6 不可逆", () => {
  assert.equal(requiresHumanApproval("P2"), false);
  assert.equal(requiresHumanApproval("P3"), true);
  assert.equal(requiresHumanApproval("P5"), true);

  assert.equal(isIrreversible("P4"), false);
  assert.equal(isIrreversible("P5"), true);
  assert.equal(isIrreversible("P6"), true);
});

test("资源轴常量必须翻成框架等级，不能直接当等级用", () => {
  // _shared/permissions.js 的字面值：FS_WRITE = "P3"
  // 但框架里 P3 是「改平台草稿态数据」。直接把 "P3" 当等级用 = 放行改平台。
  // 正确映射是 P2（生成本地文件）。
  assert.equal(fromLegacyResource("FS_WRITE"), "P2");
  assert.notEqual(fromLegacyResource("FS_WRITE"), "P3", "FS_WRITE 绝不能映射成 P3");

  assert.equal(fromLegacyResource("FS_READ"), "P0", "纯读在框架里是 P0，不是 _shared 的 P1");
  assert.equal(fromLegacyResource("DESTRUCTIVE"), "P6");
});

test("没有对等项的资源常量拒绝猜测（MODEL_CALL）", () => {
  assert.throws(() => fromLegacyResource("MODEL_CALL"), /没有对等项/);
  assert.throws(() => fromLegacyResource("NOT_A_THING"), /没有对等项/);
});

test("对照实证：两套标号在同一个字母上含义不同", async () => {
  const legacy = await import("../src/agent-shared/permissions.js");
  // 字面相同
  assert.equal(legacy.RESOURCE_AXIS.FS_WRITE, "P3");
  // 含义不同：框架 P3 不是"写本地文件"
  assert.doesNotMatch(SIDE_EFFECTS.P3.name, /本地文件/);
  assert.match(SIDE_EFFECTS.P3.name, /平台/);
  // 若真按字面放行，就会把一个改平台的动作当成写文件
  assert.equal(atMost("P3", "P3"), true, "字面比较会放行");
  assert.equal(atMost(fromLegacyResource("FS_WRITE"), "P1"), false, "按正确映射后会被拦");
});
