import XLSX from "xlsx";
const f = "data/batch-listing-create/blc-1785155052946/input.xlsx";
const wb = XLSX.readFile(f);
const ws = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
const header = (aoa[0]||[]).map(h => String(h||"").trim());
console.log("HEADER:", header.map((h,i)=>`${String.fromCharCode(65+i)}=${h}`).join(" | "));
for (let r=1; r<aoa.length; r++){
  const cols = aoa[r]||[];
  console.log(`\nROW ${r}:`, header.map((h,i)=>`${String.fromCharCode(65+i)}=${JSON.stringify(cols[i])}`).join(" | "));
}
// replicate parseRows localImages logic
function col(header, re){ const idx=header.findIndex(h=>re.test(String(h||"").trim())); return idx>=0?idx:-1; }
const idxUrls = col(header, /^(imageUrls|图片链接|图片地址|图片URL|图片网址)$/);
const idxLocal = col(header, /^(localImages|本地图片|本地图|本地路径|本地文件)$/);
const urlCols = header.map((h,i)=>/^imageUrl_\d+$/i.test(String(h||""))?i:-1).filter(i=>i>=0).sort((a,b)=>a-b);
const localCols = header.map((h,i)=>/^localImage_\d+$/i.test(String(h||""))?i:-1).filter(i=>i>=0).sort((a,b)=>a-b);
console.log("\nidxUrls",idxUrls,"idxLocal",idxLocal,"urlCols",urlCols,"localCols",localCols);
for (let r=1; r<aoa.length; r++){
  const cols = aoa[r]||[];
  const urls=[];
  if (idxUrls>=0) urls.push(...String(cols[idxUrls]||"").split(/[,，;；\n]/).map(s=>s.trim()).filter(Boolean));
  for (const c of urlCols){ const v=String(cols[c]||"").trim(); if(v) urls.push(v); }
  const localPaths=[];
  if (idxLocal>=0) localPaths.push(...String(cols[idxLocal]||"").split(/[,，;；\n]/).map(s=>s.trim()).filter(Boolean));
  for (const c of localCols){ const v=String(cols[c]||"").trim(); if(v) localPaths.push(v); }
  console.log(`\nROW ${r} parsed => imageUrls:`, JSON.stringify(urls), "localImages:", JSON.stringify([...new Set(localPaths)]));
}
