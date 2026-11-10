import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {requireG1FixtureRoot,createMainRuntimeInfo} from '../src/ceo-main-boundary.js';
test('data directory fixture proof does not permit a different PROJECT_ROOT write owner',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'review-roots-')),root=path.join(base,'fixture'),other=path.join(base,'other');await mkdir(root);await mkdir(other);await writeFile(path.join(root,'.ceo-isolated-fixture.json'),'{"synthetic":true}');
 assert.throws(()=>requireG1FixtureRoot({fixtureRoot:root,dataRoot:root,projectRoot:other}),/G1_DEPLOYMENT_NOT_APPROVED/);assert.deepEqual(await readdir(other),[]);
});
test('main release fingerprint changes when a directly imported Listing Agent dependency changes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'review-manifest-')),codeRoot=path.join(root,'code'),dataRoot=path.join(root,'data');await mkdir(codeRoot);await mkdir(dataRoot);
 for(const relative of ['dist/src/server.js','listing-agent/src/agent-client.js','listing-agent/package.json','package.json','package-lock.json','public/index.html','schemas/contract.json','prompts/core.md','config/ceo-capabilities.v1.json']){const f=path.join(codeRoot,relative);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,'fixture');}
 const first=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'same-release'});await writeFile(path.join(codeRoot,'listing-agent/src/agent-client.js'),'changed-import');
 const second=await createMainRuntimeInfo({codeRoot,dataRoot,releaseId:'same-release'});assert.notEqual(first.manifest.fingerprint,second.manifest.fingerprint);
});
