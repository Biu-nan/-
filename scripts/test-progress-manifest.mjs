// 回归用例：幂等进度 manifest（C 硬化）
// 锁定行为：
//   recordArtifact → verifyStep 通过；loadVerifiedText 返回原文；
//   产品 key 不同 → 视为无 manifest（防串档）；
//   文件被篡改 → checksum-mismatch；文件删除 → file-missing；未知 step → no-step；
//   写入新 key 会重置 steps（不继承上一个产品的进度）。
// 运行：node scripts/test-progress-manifest.mjs
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordArtifact, verifyStep, loadVerifiedText, productKeyOf, readManifest } from "../dist/src/progress-manifest.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

const dir = await mkdtemp(path.join(tmpdir(), "manifest-"));
const manifestPath = path.join(dir, "progress-manifest.json");
const fileA = path.join(dir, "a.md");
await writeFile(fileA, "hello world content", "utf8");

const key = productKeyOf({ objectiveInfo: "产品X 10x10", imageNames: ["a.jpg", "b.jpg"] });
const key2 = productKeyOf({ objectiveInfo: "产品Y 20x20", imageNames: ["c.jpg"] });

await recordArtifact({ manifestPath, productKey: key, step: "step_a", filePath: fileA });
let v = await verifyStep(manifestPath, key, "step_a");
ok("record → verify ok", v.ok === true);

const txt = await loadVerifiedText(manifestPath, key, "step_a");
ok("loadVerifiedText 返回原文", txt === "hello world content");

// 子目录产物（output/ 场景）——回归：曾因只存 basename 导致 verify 报 file-missing
const subDir = path.join(dir, "output");
await mkdir(subDir, { recursive: true });
const fileSub = path.join(subDir, "03_SEO_KEYWORDS.md");
await writeFile(fileSub, "seo keyword report content", "utf8");
await recordArtifact({ manifestPath, productKey: key, step: "step_sub", filePath: fileSub });
const vSub = await verifyStep(manifestPath, key, "step_sub");
ok("子目录产物 verify ok（相对路径）", vSub.ok === true);
const mSub = await readManifest(manifestPath);
ok("manifest 存相对路径 output/...", mSub.steps.step_sub.file.replace(/\\/g, "/") === "output/03_SEO_KEYWORDS.md");

v = await verifyStep(manifestPath, key2, "step_a");
ok("不同 productKey → no-manifest", v.ok === false && v.reason === "no-manifest");

await writeFile(fileA, "tampered content", "utf8");
v = await verifyStep(manifestPath, key, "step_a");
ok("文件被篡改 → checksum-mismatch", v.ok === false && v.reason === "checksum-mismatch");

await rm(fileA);
v = await verifyStep(manifestPath, key, "step_a");
ok("文件删除 → file-missing", v.ok === false && v.reason === "file-missing");

await writeFile(fileA, "hello world content", "utf8");
v = await verifyStep(manifestPath, key, "nope");
ok("未知 step → no-step", v.ok === false && v.reason === "no-step");

await recordArtifact({ manifestPath, productKey: key2, step: "step_b", filePath: fileA });
const m = await readManifest(manifestPath);
ok("新 key 重置 steps（不继承旧档）", m.productKey === key2 && !("step_a" in (m.steps || {})) && "step_b" in m.steps);

await rm(dir, { recursive: true, force: true });
console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
