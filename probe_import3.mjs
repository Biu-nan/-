import { importLocalImagePaths } from "./dist/src/image-files.js";
import { readdir } from "node:fs/promises";
const jobDir = "F:/yikuaborder-deploy";
const row1 = [
  "17",
  "F:/yikuaborder-deploy/已完成产品/悍匪毛绒钥匙扣/O1CN01WvK3gH1NboUxFB5O5_!!2215036111589-0-cib.jpg",
  "F:/yikuaborder-deploy/已完成产品/悍匪毛绒钥匙扣/Video_01.mp4"
];
try {
  const r = await importLocalImagePaths(row1, jobDir);
  console.log("ROW1 RESULT:", JSON.stringify({ imported: r.imported.length, rejected: r.rejected.length, skipped: r.skippedDuplicates.length }));
  console.log("imported:", r.imported.map(x => x.name || x.originalname));
  console.log("rejected:", r.rejected);
  const after = await readdir("当前产品/产品图").catch(()=>[]);
  console.log("产品图 after:", after.length, after);
} catch (e) {
  console.log("THREW:", e.message);
}
