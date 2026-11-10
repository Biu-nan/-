/** Local signed-process attestation. It is not WorkBuddy cloud-account or Human approval. */
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$/.test(x);
export function readWorkBuddyCallContext({meta,rpcId,host}={}){
 if(host?.status!=='HOST_PROCESS_VERIFIED'||host.signatureValid!==true||host.sameUser!==true||host.ownsMainWindow!==true)fail('WORKBUDDY_HOST_UNAUTHENTICATED');
 const baggage=typeof meta?.baggage==='string'&&meta.baggage.length<=16384?meta.baggage:'';
 const wanted=new Set(['codebuddy.session_id','codebuddy.conversation_request_id','codebuddy.conversation_message_id']),values={};
 for(const entry of baggage.split(',')){
  const at=entry.indexOf('=');if(at<1)continue;const key=entry.slice(0,at).trim();if(!wanted.has(key))continue;
  let value;try{value=decodeURIComponent(entry.slice(at+1).split(';')[0].trim());}catch{fail('WORKBUDDY_CONTEXT_INVALID');}
  if(Object.hasOwn(values,key)&&values[key]!==value)fail('WORKBUDDY_CONTEXT_CONFLICT');values[key]=value;
 }
 const sessionId=values['codebuddy.session_id'],requestId=values['codebuddy.conversation_request_id'];
 if(!idOK(sessionId)||!idOK(requestId)||!(typeof rpcId==='string'||Number.isSafeInteger(rpcId)))fail('WORKBUDDY_CONTEXT_MISSING');
 return Object.freeze({conversationRef:'workbuddy:'+sessionId,sessionId,hostRequestId:requestId,messageId:values['codebuddy.conversation_message_id']??null,transportRequestId:rpcId,metadataSource:'WORKBUDDY_STDIO_META_W3C_BAGGAGE',hostAuthentication:'LOCAL_SIGNED_PROCESS',accountIdentity:'UNVERIFIED_NOT_READ'});
}
/** Native WorkBuddy tool environment: public identifiers only; never enumerate environment or read auth values. */
export function readWorkBuddyNativeContext({host,env=process.env}={}){
 const fields={'codebuddy.session_id':env.CODEBUDDY_SESSION_ID,'codebuddy.conversation_request_id':env.CODEBUDDY_CONVERSATION_REQUEST_ID};
 const toolId=env.CODEBUDDY_TOOL_CALL_ID;
 if(host?.status!=='HOST_PROCESS_VERIFIED'||host.signatureValid!==true||host.sameUser!==true||host.ownsMainWindow!==true)fail('WORKBUDDY_HOST_UNAUTHENTICATED');
 if(!idOK(toolId))fail('WORKBUDDY_CONTEXT_MISSING');
 const meta={baggage:Object.entries(fields).map(([key,value])=>key+'='+encodeURIComponent(value??'')).join(',')};
 const context=readWorkBuddyCallContext({host,meta,rpcId:toolId});
 return Object.freeze({...context,metadataSource:'WORKBUDDY_NATIVE_TOOL_ENV',contextIntegrityStatus:'UNVERIFIED_INHERITED',formalIdentityAuthority:'NONE'});
}
export async function authenticateWorkBuddyHost(){
 if(process.platform!=='win32')fail('WORKBUDDY_WINDOWS_HOST_REQUIRED');
 const pin=JSON.parse(await readFile(new URL('../../config/ceo-workbuddy-host.candidate.v1.json',import.meta.url),'utf8'));
 const script=`[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$p=ConvertFrom-Json ([Console]::In.ReadToEnd());$rows=@();$pidToCheck=[int]$p.pid;$matched=$null;for($i=0;$i -lt 12 -and $pidToCheck -gt 0;$i++){ $v=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidToCheck) -ErrorAction Stop;if(!$v){break};$rows+=@{pid=[int]$v.ProcessId;parent=[int]$v.ParentProcessId;path=[string]$v.ExecutablePath};if([string]::Equals([string]$v.ExecutablePath,[string]$p.executable,[StringComparison]::OrdinalIgnoreCase)){if((Get-Process -Id $v.ProcessId -ErrorAction Stop).MainWindowHandle -ne 0){$matched=$v;break}};$pidToCheck=[int]$v.ParentProcessId };if(!$matched){@{ok=$false;reason='NO_WORKBUDDY_ANCESTOR'}|ConvertTo-Json -Compress;exit};$sig=Get-AuthenticodeSignature -LiteralPath $p.executable;$hash=(Get-FileHash -Algorithm SHA256 -LiteralPath $p.executable).Hash;$owner=(Invoke-CimMethod -InputObject $matched -MethodName GetOwnerSid).Sid;$same=$owner -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$ok=$sig.Status -eq 'Valid' -and $sig.SignerCertificate.Thumbprint -eq $p.signerThumbprint -and $hash -eq $p.sha256 -and $same;@{ok=$ok;pid=[int]$matched.ProcessId;signatureValid=($sig.Status -eq 'Valid');sameUser=$same;ownsMainWindow=$true;executableHash=$hash.ToLower();chain=$rows}|ConvertTo-Json -Depth 5 -Compress`;
 const json=await new Promise((resolve,reject)=>{
  const child=execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:32768},(error,stdout)=>{if(error){reject(Object.assign(new Error('WORKBUDDY_HOST_UNAUTHENTICATED'),{code:'WORKBUDDY_HOST_UNAUTHENTICATED'}));return;}try{resolve(JSON.parse(stdout.replace(/^\uFEFF/,'')));}catch{reject(Object.assign(new Error('WORKBUDDY_HOST_UNAUTHENTICATED'),{code:'WORKBUDDY_HOST_UNAUTHENTICATED'}));}});
  child.stdin.end(JSON.stringify({...pin,pid:process.pid}));
 });
 if(!json.ok)fail('WORKBUDDY_HOST_UNAUTHENTICATED');
 return Object.freeze({status:'HOST_PROCESS_VERIFIED',pid:json.pid,appVersion:pin.version,signatureValid:json.signatureValid,sameUser:json.sameUser,ownsMainWindow:json.ownsMainWindow,executableHash:json.executableHash,processChain:json.chain});
}
