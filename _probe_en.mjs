const text = `Some preamble text.
AEO Structured Bullet Points
✅ Product Type Realistic Food Model
✅ Featured Design Croissant
Core Selling Points here.
Q And A section.
WARM NOTE: handle with care.
Product Detail Page
Product Overview add a playful food inspired detail...
long prose that should NOT be included in detail.`;
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
  return section.length >= 30 ? section : "";
}
const r = extractDetailLocal(text);
console.log("len:", r.length);
console.log("head:", JSON.stringify(r.slice(0,120)));
console.log("tail:", JSON.stringify(r.slice(-80)));
console.log("contains 'Product Overview' (should be false):", r.includes("Product Overview"));
