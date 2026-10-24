const fs = require("fs");
const p = "data/collect-batch-state.json";
if (!fs.existsSync(p)) { console.log("no file"); process.exit(0); }
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const arr = Array.isArray(j.items) ? j.items : (j.items && Object.values(j.items));
const items = (arr || []).slice(-10).map((it) => ({
  n: it.productName ? String(it.productName).slice(0, 50) : "",
  s: it.status,
  st: it.currentStage,
  vtm: it.variantThemeMap || null,
  rowVtm: it.row?.variantThemeMap || null,
  reason: String(it.reason || "").slice(0, 200)
}));
console.log(JSON.stringify(items, null, 2));
