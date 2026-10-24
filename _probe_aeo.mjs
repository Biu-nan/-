import { readFile } from "node:fs/promises";

const file = "已完成产品/食物玩具模型挂件/output/04_LISTING_CONTENT.md";
const text = await readFile(file, "utf8");

// --- replicate extractAeoSection (automation-service.js:89) ---
function extractAeoSection(listingText) {
  if (!listingText) return "";
  const startMatch = listingText.match(/3\.2\s*[\s\S]*?(?:AEO\s*结构化五点描述|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i);
  if (!startMatch) return "";
  const startIndex = startMatch.index + startMatch[0].length;
  const remainder = listingText.slice(startIndex);
  const endMatch = remainder.match(/\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+)/i);
  const endIndex = endMatch ? endMatch.index : remainder.length;
  return remainder.slice(0, endIndex).trim();
}

// --- NEW extractDetailLocal (fixed: extract 3.2 AEO -> 3.3 between content) ---
function extractDetailLocal(listingText) {
  if (!listingText) return "";
  const startMatch = listingText.match(
    /(?:3\.2\s*[\s\S]*?)?(?:AEO\s*结构化五点描述|AEO Structured Bullet Points|Bullet Points And Q(?:\s*&\s*|\s+And\s+)A|Bullet Points And Q And A)[\s\S]*?\n/i
  );
  if (!startMatch) return "";
  const remainder = listingText.slice(startMatch.index + startMatch[0].length);
  const endMatch = remainder.match(
    /\n\s*(?:3\.\d+\s+|Step\s+\d+\s*\||#{1,6}\s+3\.\d+|#{1,6}\s+Step\s+\d+|商品详情页内容|商品详情页|Product Detail Page)/i
  );
  const endIndex = endMatch ? endMatch.index : remainder.length;
  const section = remainder.slice(0, endIndex).trim();
  if (section.length >= 30) return section;
  return "";
}

const aeo = extractAeoSection(text);
const det = extractDetailLocal(text);

console.log("==== extractAeoSection (AI bridge) ====");
console.log("len:", aeo.length);
console.log("head:", JSON.stringify(aeo.slice(0, 160)));
console.log("tail:", JSON.stringify(aeo.slice(-120)));
console.log("");
console.log("==== extractDetailLocal (fallback) ====");
console.log("len:", det.length);
console.log("head:", JSON.stringify(det.slice(0, 160)));
console.log("tail:", JSON.stringify(det.slice(-120)));
