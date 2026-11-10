/** Presentation only. The full brief and its snapshot keep their original semantics. */
export function buildLegacyCeoView({brief,contextSnapshot,priorities=[]}){
 if(brief?.readOnly!==true||typeof contextSnapshot?.contextId!=='string'||!Array.isArray(priorities))throw Object.assign(new Error('INVALID_LEGACY_VIEW'),{code:'INVALID_LEGACY_VIEW'});
 return{schema:'ceo-legacy-view/v1',brief:structuredClone(brief),contextSnapshot:structuredClone(contextSnapshot),priorities:structuredClone(priorities.slice(0,3)),businessWriteAllowed:false};
}
