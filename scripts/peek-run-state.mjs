import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('F:\\yikuaborder-deploy\\run-state.json', 'utf8'));
const pt = s.planningText || '';
const markers = ['IMAGE_01_PROMPT_START', 'IMAGE_01_PROMPT_END', 'IMAGE_05_PROMPT_START', 'IMAGE_10_PROMPT_END']
  .map((m) => ({ m, c: (pt.match(new RegExp(m.replace(/[.]/g, (s) => s), 'g')) || []).length }));
console.log('planningText length:', pt.length);
console.log('markers:', JSON.stringify(markers));
console.log('stage:', s.stage, 'error:', s.error);
console.log('completedPhase:', s.completedPhase, 'promptPackValid:', s.promptPackValid);
console.log('running:', s.running, 'autoRun:', s.autoRun);
console.log('message:', s.message);
