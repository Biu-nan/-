// 回归用例：ecom → 一跨而境 契约转换 + 连接器（幂等/冲突）
// 运行：node scripts/test-ecom-connector.mjs
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildHandoff, importHandoff, sanitizeProductName, readLedger } from "../dist/src/ecom-connector.js";
import { parseLengthCm, toDimensionsCm } from "../dist/src/ecom-contract.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

const fixture = path.resolve("scripts/fixtures/ecom/sample-product");
const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "yikuaborder-import-"));
const ledgerPath = path.join(targetRoot, ".workbuddy", "ecom-handoffs", "ledger.json");

// 1) 契约转换
const handoff = await buildHandoff(fixture);
ok("productId 非空", Boolean(handoff.productId));
ok("gaps 被携带（诚实规则）", (handoff.provenance.gaps ?? []).length > 0);
ok("未知轴向不组合 → dimensionsCm 为空", Object.keys(handoff.facts.dimensionsCm ?? {}).length === 0);
ok("reviewRequired 被标记", handoff.provenance.reviewRequired === true);
ok("产物含契约与图片", handoff.artifacts.length >= 4 && handoff.artifacts.some((a) => a.kind === "source"));
ok("listing 产物被识别", handoff.artifacts.some((a) => a.name === "04_LISTING_CONTENT.md"));

const handoff2 = await buildHandoff(fixture);
ok("operationId 稳定", handoff.operationId === handoff2.operationId);

// 2) 首次导入
const r1 = await importHandoff({ handoff, targetRoot, ledgerPath });
ok("首次导入 IMPORTED", r1.status === "IMPORTED");
const facts1 = JSON.parse(await fs.readFile(path.join(r1.targetDir, "product-facts.json"), "utf8"));
ok("导入后 facts 含 provenance.gaps", (facts1.meta?.provenance?.gaps ?? []).length > 0);
ok("产品图目录已建", await fs.access(path.join(r1.targetDir, "产品图")).then(() => true).catch(() => false));
ok("ecom-handoff 清单已写", await fs.access(path.join(r1.targetDir, "ecom-handoff.json")).then(() => true).catch(() => false));
ok("output 目录已建", await fs.access(path.join(r1.targetDir, "output")).then(() => true).catch(() => false));

// 3) 幂等
const r2 = await importHandoff({ handoff, targetRoot, ledgerPath });
ok("重复导入 SKIPPED（幂等）", r2.status === "SKIPPED");
const ledger = await readLedger(ledgerPath);
ok("台账只记一条", ledger.entries.length === 1);

// 4) 冲突（目标被改动）
await fs.writeFile(path.join(r1.targetDir, "product-facts.json"), JSON.stringify({ mutated: true }) + "\n", "utf8");
const r3 = await importHandoff({ handoff, targetRoot, ledgerPath });
ok("目标被改动 → CONFLICT", r3.status === "CONFLICT");
ok("冲突落 incoming 目录", r3.targetDir.includes(".incoming-"));

// 5) 工具函数
ok("parseLengthCm: 20cm", parseLengthCm("20cm") === 20);
ok("parseLengthCm: 200mm", parseLengthCm("200mm") === 20);
ok("parseLengthCm: 非法 → null", parseLengthCm("约20") === null);
ok("toDimensionsCm 三轴齐全", JSON.stringify(toDimensionsCm([
    { axis: "length", value: "20cm" }, { axis: "width", value: "100mm" }, { axis: "height", value: "0.05m" }
])) === JSON.stringify({ length: 20, width: 10, height: 5 }));
ok("sanitizeProductName 去 _images", !sanitizeProductName("abc_images").endsWith("_images"));

await fs.rm(targetRoot, { recursive: true, force: true });
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
