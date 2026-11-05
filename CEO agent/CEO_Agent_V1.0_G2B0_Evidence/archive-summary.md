# G2-B0 synthetic full report archive

Scope: only `dist/src/ceo-report-archive.js`, `dist/test/ceo-report-archive.test.js`, and this task's isolated evidence. No production files, services, credentials, real DB, staging or commits. Existing residues are preserved; test fixtures remain under the synthetic temporary root.

## Host API

`createCeoReportArchive({fixtureRoot,directory,governance,resolveVersions,traceReader,now})`

- `fixtureRoot` must already exist with regular single-link `.ceo-isolated-fixture.json` containing `synthetic:true`. `directory` must be strictly inside it. Constructor is read-only.
- `governance` is the existing G1 governance instance. Every operation uses an issued principal; object-shaped principal imitations fail. `prepare` requires `analyze`; if `correctsReportId` is supplied it requires `human.review`. `read` requires `read`. `confirmTrace` requires `analyze` or `human.review`. Authorization occurs before lock/filesystem mutation.
- `resolveVersions({context,report})` is a mandatory synchronous trusted host callback. Required return fields: `runtimeVersion`, `runtimeHash`, `knowledgeVersion`, `knowledgeHash`, `dictionaryVersion`, `dictionaryHash`, `sourcePolicyVersion`, `sourcePolicyHash`, `packageHash`. All `*Hash` fields are lowercase SHA-256. Caller-supplied versions must exactly content-match this host result. Context/report version linkage is checked, including context `sourcePolicyHash` when present.
- `traceReader({principal,storeId})` is the trusted existing shadow trace `read`, returning only verified durable records. It is required to confirm or read any COMPLETE archive. A supplied trace record is compared against that durable source; it cannot create authority.
- `prepare({principal,requestId,context,report,evidence,versions,taskSnapshot,workflowState,correctsReportId:null})` writes durable request intent, all complete content objects, and immutable manifest. Returns PREPARED. Evidence is an array of `{path,content,sha256?}`; exact UTF-8 bytes are stored. All context `sourceRefs` must match archived evidence SHA-256. Report task/workflow snapshot fields, when present, must match archived snapshots. Input objects are snapshotted synchronously before waiting for the filesystem lock.
- `confirmTrace({principal,reportId,traceRecord,storeId:'400370'})` requires a durable ANALYSIS event whose `reportId`, `analysisId`, `contextId`, `storeId`, `sourceHash=contentHash(context.sourceRefs)`, `snapshotId=taskSnapshot.snapshotId`, governance `policyVersion`, and first proposal reference match the manifest. The content-addressed report ID binds full Context/report/evidence/snapshots/versions; the durable receipt links its manifestHash and versionsHash to traceRecordHash. Only after receipt publication does status become COMPLETE.
- `read({principal,reportId,storeId:'400370'})` returns full Context, report, exact evidence contents, versions, snapshots and immutable receipt/manifest metadata. COMPLETE reads re-read and verify the trace; a corrupt/missing trace fails closed.
- `recover({principal,requestId,storeId:'400370'})` explicitly completes an interrupted durable request intent, reusing verified exact objects. For an already committed manifest, it verifies all objects and never reconstructs or overwrites corrupt/missing committed history. Normal same-request prepare retry also completes pending intent safely.
- `recoverLock({principal,storeId:'400370'})` only recovers a validated lock owned by a provably nonexistent PID. It renames that lock to an `.abandoned-<uuid>` evidence file. It never deletes abandoned lock metadata. Active, unreadable, empty, malformed or ambiguous locks fail closed.

Result includes `reportId`, `manifestHash`, `versionsHash`, object SHA/byte descriptors, full data, `correctsReportId`, `revision`, `status` and `traceRecordHash`. Human corrections create a new immutable archive with a different analysis ID, link the completed original, and increment revision. The original report bytes remain unchanged. The trusted host may subsequently commit the new ANALYSIS using its existing shadow principal; the archive does not impersonate either identity.

## Persistence and limits

Content objects are full UTF-8 JSON output or exact raw evidence, addressed by SHA-256. Request intents persist complete object bytes (base64) so recovery needs no client resubmission. Each committed manifest is itself content-bound; a separate receipt marks trace association. Same requestId in a store has one stable reportId, including across processes and restarts. Different content or actor for the same ID conflicts. Cooperative archive processes serialize through an exclusive lock; writes go to new exclusive temporary files, fsync, then rename. Existing committed files are never replaced. Failed temporary writes remain as preserved orphans.

Bounds: 8 MiB total input object/evidence bytes per report, 1 MiB per raw evidence, 1000 evidence items, 50 JSON depth, 100,000 JSON nodes. Objects/manifests/intents are bounded on read. Symlink/hardlink/ancestor escapes and unsafe evidence paths fail closed. Typical credential-bearing text patterns are rejected in full objects and raw evidence. This is a bounded pattern guard, not a general secret classifier; production data remains outside the authorized scope.

On Windows, file fsync and atomic file rename are used; directory fsync is unavailable and is skipped. This validates process/retry durability behavior, not a power-loss/filesystem hardware certification. Cooperative lock holders share a 3-second bounded wait. A PID that is still live (including PID reuse) is deliberately treated as active. Malformed crash-window locks require manual inspection; recovery never guesses ownership. The archive adapter is synthetic-only and is not registered in production routes.

## Executed validation

Commands executed through the task's isolated Python wrapper:

`python .superpowers/sdd/ceo-g2b0-20261105/run.py archive-red node --test dist/test/ceo-report-archive.test.js`

Initial RED: 9 failures, all `full archive feature missing` before implementation. Subsequent targeted attempts recorded Windows readonly-fsync incompatibility (fixed by opening the existing file writable without append/truncate), and the pending trace reportId dependency before the parent added that optional field.

`archive-lock-red`: 12 passed / 2 failed for the missing explicit lock recovery API before implementation.

Final fresh check:

`python .superpowers/sdd/ceo-g2b0-20261105/run.py archive-green-final node --test dist/test/ceo-report-archive.test.js`

Result: **14 passed, 0 failed**, command exitCode 0. Coverage includes full-data restart reads, trusted trace receipts, G1 permission/version binding, concurrency and conflicts, forged receipts, Human correction history, corrupt/missing objects, injected fsync failure/retry, evidence hashes/secrets/paths/limits, hardlinks, explicit pending recovery, postcompletion trace corruption, three concurrent child processes, dead-lock evidence preservation and active lock rejection. No full historical suite was run by this subtask.

Per-file no-index diffs and SHA-256 are in `ceo-report-archive.js.no-index.diff`, `ceo-report-archive.test.js.no-index.diff`, and `archive-files.json`. No shared Git index changes were made.

## Remaining boundaries

Parent integration supplies the actual host runtime/package resolver and durable trace reader, and produces synthetic end-to-end artifacts. Real production binding remains UNVERIFIED. Crash/power-loss faults beyond the tested injected write failures and process-level cooperative locking are not certified. No task/executor, production route, real dataset or credential source was added.
