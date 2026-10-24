import fs from 'node:fs';
const path = 'F:\\yikuaborder-deploy\\run-state.json';
const s = JSON.parse(fs.readFileSync(path, 'utf8'));
const text = s.planningText || '';
console.log('planningText length:', text.length);
const markers = ['IMAGE_01_PROMPT_START', 'IMAGE_01_PROMPT_END', 'IMAGE_10_PROMPT_END', 'IMAGE_10_PROMPT_START', 'IMAGE_PROMPT_START', 'IMAGE_PROMPT_END', '第 1 部分', '第 1部分', 'A. 产品视觉情报报告', 'B. 10', 'C. Image', 'Prompt Pack'];
for (const m of markers) {
  const c = (text.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  console.log(c.toString().padStart(4), m);
}
console.log('---first 800---');
console.log(text.slice(0, 800));
console.log('---last 600---');
console.log(text.slice(-600));
console.log('---responseText boundary markers---');
const rt = s.responseText || '';
['IMAGE_01_PROMPT_START', 'IMAGE_10_PROMPT_END', '<<<IMAGE', '第 1 部分', 'Prompt Pack'].forEach(m => {
  console.log(((rt.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length).toString().padStart(4), m);
});
console.log('responseText length:', rt.length);
