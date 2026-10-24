import { stat, readFile } from "node:fs/promises";
import path from "node:path";
function extOf(buf){
  if (buf.length>=3 && buf[0]===0xFF && buf[1]===0xD8 && buf[2]===0xFF) return "jpg";
  if (buf.length>=8 && buf[0]===0x89 && buf[1]===0x50 && buf[2]===0x4E && buf[3]===0x47) return "png";
  if (buf.length>=12 && buf[0]===0x52 && buf[1]===0x49 && buf[2]===0x46 && buf[3]===0x46 && buf[8]===0x57 && buf[9]===0x45 && buf[10]===0x42 && buf[11]===0x50) return "webp";
  return null;
}
const rows = {
  "悍匪毛绒钥匙扣": ["17","F:/yikuaborder-deploy/已完成产品/悍匪毛绒钥匙扣/O1CN01WvK3gH1NboUxFB5O5_!!2215036111589-0-cib.jpg","F:/yikuaborder-deploy/已完成产品/悍匪毛绒钥匙扣/Video_01.mp4"],
  "万圣节自封袋": ["F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_08.jpg","F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_01.jpg","F:/yikuaborder-deploy/已完成产品/万圣节自封袋/Detail_03.jpg"]
};
const base="F:/yikuaborder-deploy";
for (const [name, paths] of Object.entries(rows)){
  console.log(`\n=== ${name} ===`);
  let imp=0, rej=0;
  for (const raw of paths){
    const abs = path.isAbsolute(raw) ? raw : path.resolve(base, raw);
    try {
      const info = await stat(abs);
      if (!info.isFile()) { console.log("  REJECT(not file):", raw.slice(-40)); rej++; continue; }
      const buf = await readFile(abs);
      const ext = extOf(buf);
      if (!ext) { console.log(`  REJECT(not image, ${buf.length}B):`, raw.slice(-40)); rej++; }
      else { console.log(`  IMPORT(${ext}, ${buf.length}B):`, raw.slice(-40)); imp++; }
    } catch(e){ console.log("  ERROR:", raw.slice(-40), e.message); rej++; }
  }
  console.log(`  -> importable=${imp} rejected=${rej}`);
}
