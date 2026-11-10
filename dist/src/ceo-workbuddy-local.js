/** Native WorkBuddy tool adapter. No caller identity/context arguments and no ordinary-shell fallback. */
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createWorkBuddyToolSession} from './ceo-workbuddy-mcp.js';
export async function runWorkBuddyLocal(argv=process.argv.slice(2)){
 if(argv.length!==1||argv[0]!=='CEO，检查纳物一店最新经营情况，告诉我今天最需要处理的三个问题。')return{isError:true,structuredContent:{status:'FAILED',error:'INVALID_TOOL_ARGUMENTS'}};
 const session=createWorkBuddyToolSession({contextTransport:'NATIVE_TOOL_ENV'});
 try{return await session.call({name:'ceo_operational_analyze',arguments:{question:argv[0]}},process.env.CODEBUDDY_TOOL_CALL_ID??'native-context-missing');}finally{session.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await runWorkBuddyLocal();process.stdout.write(JSON.stringify(result)+'\n');if(result.isError)process.exitCode=1;
}
