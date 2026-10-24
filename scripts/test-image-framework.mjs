// 回归用例：10 图框架校验器
// 1) 现网真实 planningText 必须通过（防误杀）；
// 2) 坏样本（5 张挂包 + 第3槽非尺寸）必须被拦截；
// 3) 槽位不足必须被拦截；4) 分类器抽查。
// 运行：node scripts/test-image-framework.mjs
import fs from "node:fs/promises";
import { validateImageFramework, classifySlot } from "../dist/src/image-framework.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

let realText = "";
for (const candidate of [
    "run-state.json",
    "已完成产品/未命名产品 (4)/run-state.json"
]) {
    try {
        const state = JSON.parse(await fs.readFile(candidate, "utf8"));
        if (state.planningText) {
            realText = state.planningText;
            break;
        }
    }
    catch { /* try next */ }
}

if (realText) {
    const r = validateImageFramework(realText);
    ok("真实 planningText 通过框架校验", r.ok === true);
    ok("真实：10 个槽位", r.slotCount === 10);
    ok("真实：第 3 槽为尺寸", r.slot3Job === "size");
    ok("真实：使用场景 ≤ 2", r.sceneCount <= 2);
    console.log("  slots:", r.slots.map((s) => `${s.num}:${s.job}`).join(" | "));
}
else {
    console.log("SKIP 真实文本（run-state 无 planningText）");
}

const bad = [
    "## Image 01｜Hero 主图",
    "## Image 02｜挂包场景一",
    "## Image 03｜挂包场景二",
    "## Image 04｜挂包场景三",
    "## Image 05｜材质细节",
    "## Image 06｜场景 A 日常包袋搭配",
    "## Image 07｜场景 B 都市斜挎包搭配",
    "## Image 08｜配件与收到什么",
    "## Image 09｜卖点信息图",
    "## Image 10｜多角度信任收尾"
].join("\n");
const rb = validateImageFramework(bad);
ok("坏样本被拦截", rb.ok === false);
ok("坏样本：第 3 槽非尺寸", rb.violations.some((v) => v.includes("第 3 槽")));
ok("坏样本：使用场景 > 2", rb.violations.some((v) => v.includes("场景槽")));

const short = "## Image 01｜Hero 主图\n## Image 02｜核心特征\n## Image 03｜尺寸比例图";
const rs = validateImageFramework(short);
ok("槽位不足被拦截", rs.ok === false && rs.violations.some((v) => v.includes("槽位标题")));

ok("分类：尺寸", classifySlot("尺寸比例图") === "size");
ok("分类：场景", classifySlot("场景 A 日常包袋搭配") === "scene");
ok("分类：信息图", classifySlot("卖点信息图") === "infographic");
ok("分类：Hero", classifySlot("Hero 主图") === "hero");
ok("分类：包装", classifySlot("配件与收到什么") === "package");

console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
