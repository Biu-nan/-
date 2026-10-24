import { importLocalImagePaths } from "./dist/src/image-files.js";
import { readdir } from "node:fs/promises";
const jobDir = "F:/yikuaborder-deploy";
const row2 = [
  "F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_08.jpg",
  "F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_01.jpg",
  "F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_03.jpg"
];
const DIR = "当前产品/产品图";
try {
  const before = await readdir(DIR).catch(() => []);
  console.log("before:", before.length, before.slice(0,5));
  const r = await importLocalImagePaths(row2, jobDir);
  console.log("RESULT:", JSON.stringify({ imported: r.imported.length, rejected: r.rejected.length, skipped: r.skippedDuplicates.length }));
  console.log("imported names:", r.imported.map(x => x.name || x.originalname));
  console.log("rejected:", r.rejected.slice(0,5));
  const after = await readdir(DIR).catch(() => []);
  console.log("after:", after.length, after.slice(0,8));
} catch (e) {
  console.log("THREW:", e.message);
}
