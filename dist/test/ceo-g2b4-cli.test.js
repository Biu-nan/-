import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const script=new URL('../src/ceo-conversation-cli.js',import.meta.url);
test('operator entry exposes instructions without opening backend or starting a service',()=>{const r=spawnSync(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1'),'--help'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0);assert.match(r.stdout,/CEO/);assert.doesNotMatch(r.stdout,/Bearer [A-Za-z0-9]{20}/);});
test('operator entry rejects unapproved questions before any runtime setup',()=>{const r=spawnSync(process.execPath,[script.pathname.replace(/^\/([A-Za-z]:)/,'$1'),'execute business'],{encoding:'utf8',windowsHide:true});assert.equal(r.status,2);assert.match(r.stderr,/INVALID_CONVERSATION_REQUEST/);});
