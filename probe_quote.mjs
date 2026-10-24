import { importLocalImagePaths } from "./dist/src/image-files.js";
const quoted = [
  '"F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_08.jpg"',
  '"F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_01.jpg"',
  '"F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_03.jpg"'
];
const r = await importLocalImagePaths(quoted, "F:/yikuaborder-deploy");
console.log("QUOTED-PATH TEST => imported:", r.imported.length, "rejected:", r.rejected.length, "skipped:", r.skippedDuplicates.length);
console.log("imported names:", r.imported.map(x=>x.originalname));
