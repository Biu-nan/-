import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,appendFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRuntimeManifest,verifyRuntimeManifest} from '../src/ceo-runtime-manifest.js';
import * as cli from '../src/ceo-conversation-cli.js';
import * as entry from '../src/ceo-conversation-entry.js';
test('candidate manifest binds the common validation code and dependency lock',async()=>{
 assert.ok(cli.CEO_CONVERSATION_FILES?.code.includes('dist/src/ceo-vnext-common.js'));
 assert.ok(cli.CEO_CONVERSATION_FILES?.code.includes('package-lock.json'));
 const root=await mkdtemp(path.join(os.tmpdir(),'g2b4-binding-')),code=path.join(root,'code'),data=path.join(root,'data');await mkdir(code);await mkdir(data);
 for(const name of Object.values(cli.CEO_CONVERSATION_FILES).flat()){const target=path.join(code,name);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.resolve(name),target);}
 const manifest=await createRuntimeManifest({codeRoot:code,dataRoot:data,files:cli.CEO_CONVERSATION_FILES,releaseId:'g2b4-binding-test'});
 assert.equal((await verifyRuntimeManifest(manifest)).ok,true);await appendFile(path.join(code,'dist/src/ceo-vnext-common.js'),'\n// isolated binding mutation\n');assert.deepEqual(await verifyRuntimeManifest(manifest),{ok:false,reason:'RELEASE_BYTES_CHANGED'});
});
test('actual external client/store dependencies contribute to the entry integration fingerprint',()=>{
 assert.equal(typeof entry.bindCeoConversationVersion,'function');
 const x={fingerprint:'a'.repeat(64),releaseId:'test',externalDependencies:{mainClient:{sha256:'b'.repeat(64)},metricsStore:{sha256:'c'.repeat(64)}}};
 const a=entry.bindCeoConversationVersion(x),b=entry.bindCeoConversationVersion({...x,externalDependencies:{...x.externalDependencies,mainClient:{sha256:'d'.repeat(64)}}});assert.notEqual(a.integrationFingerprint,b.integrationFingerprint);assert.equal(a.externalDependencies.metricsStore.sha256,'c'.repeat(64));
});
