// Test infrastructure only. Children inherit these synthetic-root restrictions.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {syncBuiltinESMExports,createRequire} from 'node:module';
const roots=(process.env.CEOG1_ALLOWED_ROOTS??'').split(';').filter(Boolean).map(p=>path.resolve(p).toLowerCase());
if(!roots.length)throw Error('TEST_ROOT_REQUIRED');
const asPath=p=>p instanceof URL?fileURLToPath(p):Buffer.isBuffer(p)?p.toString():p;
const allowed=p=>typeof p==='number'||(typeof asPath(p)==='string'&&roots.some(r=>{const q=path.resolve(asPath(p)).toLowerCase();return q===r||q.startsWith(r+path.sep);}));
const check=p=>{if(!allowed(p))throw Error('TEST_WRITE_OUTSIDE_ISOLATION');};
const methods={writeFile:[0],appendFile:[0],mkdir:[0],rm:[0],rmdir:[0],unlink:[0],rename:[0,1],copyFile:[1],cp:[1],truncate:[0],chmod:[0],chown:[0],utimes:[0],symlink:[1],link:[1]};
for(const [name,positions]of Object.entries(methods))for(const suffix of ['', 'Sync']){
 const key=name+suffix,fn=fs[key];if(typeof fn==='function')fs[key]=function(...args){for(const i of positions)check(args[i]);return fn.apply(this,args);};
}
for(const [name,positions]of Object.entries(methods)){
 const fn=fs.promises[name];if(typeof fn==='function')fs.promises[name]=async function(...args){for(const i of positions)check(args[i]);return fn.apply(this,args);};
}
const writable=flags=>typeof flags==='number'?!!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)):/[wa+]/.test(flags??'r');
for(const key of ['open','openSync','createWriteStream']){const fn=fs[key];fs[key]=function(p,flags,...rest){if(key==='createWriteStream'||writable(flags))check(p);return fn.call(this,p,flags,...rest);};}
const open=fs.promises.open;fs.promises.open=async function(p,flags,...rest){if(writable(flags))check(p);return open.call(this,p,flags,...rest);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let a=Array.isArray(args[0])?args[0]:args;const v=a[0],port=typeof v==='object'?v.port:v,host=(typeof v==='object'?v.host:a[1])??'localhost';
 if(typeof port==='number'||/^\d+$/.test(String(port))){if(!['127.0.0.1','localhost','::1'].includes(host)||[3000,3001,3002,3173,3200,8765,9222,9223,9224].includes(Number(port)))throw Error('TEST_NETWORK_OUTSIDE_ISOLATION');}
 else if(typeof v==='object'&&v.path)check(v.path);
 return connect.apply(this,args);
};
const require=createRequire(import.meta.url),sqlite=require('node:sqlite'),Base=sqlite.DatabaseSync;
sqlite.DatabaseSync=class extends Base{constructor(file,options={}){if(file!==':memory:')check(file);super(file,options);}};
syncBuiltinESMExports();
