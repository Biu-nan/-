// 回归用例：verify-then-commit（产物断言）
// 背景：曾出现"MVP5 状态 COMPLETED，但 product-facts.json 缺失 / 04_LISTING 内容空"。
// 锁定的行为：
//   checkArtifacts —— 文件存在且达到最小长度才算通过（短/缺失都失败）；
//   checkFactsReady —— product-facts 的标题/详情/主图三必填项缺一不可（与 server 口径一致）。
// 运行：node scripts/test-verify-commit.mjs
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkArtifacts, checkFactsReady } from "../dist/src/automation-service.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

const dir = await mkdtemp(path.join(tmpdir(), "verify-commit-"));

const good = path.join(dir, "good.md");
await writeFile(good, "x".repeat(600), "utf8");
ok("artifacts: 达标文件通过", (await checkArtifacts([{ path: good, minLength: 500 }])).length === 0);

const short = path.join(dir, "short.md");
await writeFile(short, "x".repeat(10), "utf8");
ok("artifacts: 内容过短失败", (await checkArtifacts([{ path: short, minLength: 500 }])).length === 1);

ok("artifacts: 文件缺失失败", (await checkArtifacts([{ path: path.join(dir, "nope.md"), minLength: 500 }])).length === 1);

ok("facts: 三项齐全通过", checkFactsReady({ title: { en: "T" }, description: { pc: "D" }, images: { main: ["a.jpg"] } }).ok === true);
ok("facts: 缺标题失败", checkFactsReady({ title: {}, description: { pc: "D" }, images: { main: ["a.jpg"] } }).ok === false);
ok("facts: 缺详情失败", checkFactsReady({ title: { en: "T" }, description: {}, images: { main: ["a.jpg"] } }).ok === false);
ok("facts: 缺主图失败", checkFactsReady({ title: { en: "T" }, description: { pc: "D" }, images: { main: [] } }).ok === false);

const nullCheck = checkFactsReady(null);
ok("facts: null 报三项缺失", nullCheck.ok === false && nullCheck.missing.length === 3);

await rm(dir, { recursive: true, force: true });
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
