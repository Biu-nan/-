import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ceoContentHash} from './ceo-operating-context.js';

const FILE_LIMIT=10*1024*1024,TOTAL_LIMIT=32*1024*1024;
const inside=(base,file)=>{const relative=path.relative(base,file);return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);};
const scoped=file=>{const stores=[...file.matchAll(/(?:^|[\\/-])store-(\d+)(?=$|[\\/-])/g)].map(m=>m[1]);return stores.length>0&&stores.every(id=>id==='400370');};
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
function localFile(projectRoot,reference){
 if(typeof reference!=='string'||!reference||reference.length>512||/^(?:[\\/]{2}|[A-Za-z][A-Za-z0-9+.-]*:(?![\\/]))/.test(reference)||reference.includes('\0'))throw {code:'UNSUPPORTED_REFERENCE'};
 const parts=reference.replace(/^[A-Za-z]:[\\/]/,'').split(/[\\/]/);
 if(parts.some(p=>p==='..'||p==='.'||/[. ]$/.test(p)||p.includes(':')))throw {code:'UNSUPPORTED_REFERENCE'};
 const root=fs.realpathSync(projectRoot),data=path.join(root,'data'),candidate=path.resolve(root,reference);
 if(!inside(data,candidate)||!scoped(path.dirname(path.relative(data,candidate))))throw {code:'UNSUPPORTED_REFERENCE'};
 // Reject reparse points before opening a file, including a redirected data root.
 let current=root,identity;
 for(const part of path.relative(root,candidate).split(path.sep)){current=path.join(current,part);identity=fs.lstatSync(current,{bigint:true});if(identity.isSymbolicLink())throw {code:'UNSUPPORTED_REFERENCE'};}
 const canonical=fs.realpathSync(candidate);
 if(!inside(data,canonical)||!scoped(path.dirname(path.relative(data,canonical))))throw {code:'UNSUPPORTED_REFERENCE'};
 if(!identity.isFile())throw {code:'UNSUPPORTED_REFERENCE'};
 if(identity.ino===0n)throw {code:'UNREADABLE'};
 if(!sameFile(identity,fs.statSync(canonical,{bigint:true})))throw {code:'CHANGED_DURING_READ'};
 return{file:canonical,identity};
}

// Synchronous and bounded so the acceptance recheck can run inside the existing transaction.
// These are byte-integrity observations, never a business acceptance judgment.
export function checkCeoTaskEvidence({projectRoot,task,now=new Date()}){
 let remaining=TOTAL_LIMIT;
 const evidence=task.receipt?.evidence,files=[];
 if(Array.isArray(evidence)&&evidence.length<=8)for(const entry of evidence){
  const row={reference:entry?.reference??'',expectedSha256:entry?.sha256??'',status:'UNREADABLE'};let fd;
  try{
   if(!/^[a-f0-9]{64}$/.test(entry?.sha256))throw {code:'INVALID_DIGEST'};
   const {file,identity}=localFile(projectRoot,entry.reference);
   fd=fs.openSync(file,fs.constants.O_RDONLY|(process.platform==='win32'?0:fs.constants.O_NOFOLLOW));
   const before=fs.fstatSync(fd,{bigint:true});
   if(!sameFile(before,identity))throw {code:'CHANGED_DURING_READ'};
   if(!before.isFile())throw {code:'UNSUPPORTED_REFERENCE'};
   if(before.size>BigInt(FILE_LIMIT))throw {code:'TOO_LARGE'};
   if(before.size>BigInt(remaining))throw {code:'TOTAL_LIMIT'};
   const hash=createHash('sha256'),buffer=Buffer.alloc(65536);let bytes=0;
   while(true){
    const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,FILE_LIMIT-bytes+1,remaining+1),null);if(!count)break;
    bytes+=count;remaining-=count;
    if(bytes>FILE_LIMIT)throw {code:'TOO_LARGE'};
    if(remaining<0)throw {code:'TOTAL_LIMIT'};
    hash.update(buffer.subarray(0,count));
   }
   const after=fs.fstatSync(fd,{bigint:true}),current=localFile(projectRoot,entry.reference);
   if(before.size!==BigInt(bytes)||after.size!==BigInt(bytes)||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||!sameFile(before,after)||current.file!==file||!sameFile(current.identity,after))throw {code:'CHANGED_DURING_READ'};
   row.bytes=bytes;row.actualSha256=hash.digest('hex');row.status=row.actualSha256===entry.sha256?'MATCH':'MISMATCH';
  }catch(e){row.status=['UNSUPPORTED_REFERENCE','TOO_LARGE','TOTAL_LIMIT','INVALID_DIGEST','CHANGED_DURING_READ'].includes(e?.code)?e.code:['ENOENT','ENOTDIR'].includes(e?.code)?'MISSING':'UNREADABLE';}
  finally{if(fd!==undefined)fs.closeSync(fd);}
  files.push(row);
 }
 const status=!files.length?'NO_EVIDENCE':files.every(f=>f.status==='MATCH')?'MATCH':'FAILED';
 const bound={taskId:task.taskId,taskVersion:task.version,receiptHash:ceoContentHash(task.receipt??null),status,files};
 return{schema:'ceo-evidence-check/v1',readOnly:true,...bound,checkId:ceoContentHash(bound),checkedAt:now.toISOString(),businessAcceptance:'HUMAN_REQUIRED'};
}

export function requireCeoEvidenceCheck({task,args,checkEvidence}){
 if(!task.taskId.startsWith('store-400370-'))return null; // Explicit demo/other tasks do not count as operating progress.
 const fail=code=>{throw Object.assign(new Error(code),{code});};
 if(typeof checkEvidence!=='function')fail('EVIDENCE_CHECK_UNAVAILABLE');
 if(typeof args.evidenceCheckId!=='string'||!/^[a-f0-9]{64}$/.test(args.evidenceCheckId))fail('EVIDENCE_CHECK_REQUIRED');
 const result=checkEvidence(task);
 if(result.status!=='MATCH')fail('EVIDENCE_CHECK_FAILED');
 if(result.checkId!==args.evidenceCheckId)fail('EVIDENCE_CHECK_STALE');
 return result;
}
