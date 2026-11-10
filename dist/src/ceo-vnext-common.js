import {createHash} from 'node:crypto';
export const sha=v=>createHash('sha256').update(v).digest('hex');
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const contentHash=v=>sha(JSON.stringify(canonical(v)));
export const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const fail=code=>{throw Object.assign(new Error(code),{code});};
export const timestamp=s=>typeof s==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s));
export const safeText=s=>typeof s==='string'&&s.trim().length>0&&s.length<=2000&&!/[\x00-\x08]/.test(s);
export const exact=(v,required,optional=[])=>v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
