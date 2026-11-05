# M04 task read model

Current goal: synthetic-only, offline SQLite task snapshot with no initialization or business writes.

Completed: new readCeoTaskSnapshot in dist/src/ceo-task-read-model.js; 17 tests in dist/test/ceo-task-read-model.test.js. No existing production module changed, no dependencies installed, no staging/commit, no production DB/service/credential access.

Interface:
readCeoTaskSnapshot({dbPath, fixtureRoot, offlineSnapshot: true, storeId: '400370', now: new Date()}) -> Promise<{schema:'ceo-task-snapshot/v1',storeId,snapshotId,capturedAt,tasks,events,readOnlyBusiness:true}>.
fixtureRoot is absolute; it must contain .ceo-isolated-fixture.json with synthetic:true, and dbPath must be below it. All source path components and marker refuse symlinks. offlineSnapshot:true is mandatory and is a host ownership assertion, not an authentication mechanism.

Implementation: bounded SQLite header/sidefile checks before open; refuse WAL header even with absent sidefiles and any -wal/-shm/-journal; DatabaseSync({readOnly:true,enableExtensionLoading:false}), query_only/trusted_schema connection settings, one BEGIN/COMMIT transaction for schema, task and event reads. No CREATE/INSERT/UPDATE/migration/init/immutable URI. Task contentHash recomputed over existing G1 binding; row identity/version, all sequential event versions and latest state/attempt/time checked. Stable snapshot identity covers projected content and store, excludes capture time. Output explicitly whitelists task/definition/receipt/approval/verification/blocker fields and events; arbitrary unknown columns/credentials are excluded. Events add eventId from the row. Historical previousTask remains projected and checked.

Explicit failures: OFFLINE_SNAPSHOT_REQUIRED, INVALID_FIXTURE_ROOT, SYNTHETIC_FIXTURE_REQUIRED, INVALID_DB_PATH, UNSAFE_DB_PATH, INVALID_TIME, STORE_MISMATCH, TASK_DB_NOT_FOUND, SNAPSHOT_COPY_REQUIRED, TASK_DB_CORRUPT, TASK_SCHEMA_MISSING, TASK_DATA_INVALID, TASK_VERSION_MISMATCH, TASK_CONTENT_MISMATCH, TASK_SOURCE_LIMIT, TASK_READ_FAILED.

Bounds: DB 64 MiB, each JSON payload 256 KiB, leaf text 8000 characters, depth 16, 100 keys/object, 1000 array entries, 1000 tasks, 20000 events; known fields have narrower checks.

Validation commands and actual child exits (runner itself always exits 0):
- python .superpowers/sdd/ceo-g2a-20261105/run.py m04-red node --test dist/test/ceo-task-read-model.test.js: exitCode 1, 15 expected missing-module failures.
- python .superpowers/sdd/ceo-g2a-20261105/run.py m04-hardening-red node --test dist/test/ceo-task-read-model.test.js: exitCode 1, 16 pass/1 expected failure for nested object in allowed scalar field.
- python .superpowers/sdd/ceo-g2a-20261105/run.py m04-green node --test dist/test/ceo-task-read-model.test.js: exitCode 0, 17 pass/0 fail, stderr empty.

Evidence: m04-*.stdout.log/.stderr.log/.result.json; untracked new file patch m04-new-files.diff. Tests cover actual G1 task workspace import/command history, unchanged SHA256 for all offline DB/directory files, missing DB/tables, malformed/corrupt data, mixed store, task/event version disagreement and orphan chains, stable/changed snapshot IDs, WAL header without sidefiles, active WAL/rollback refusal, symlink confinement, required marker/offline declaration, bounds and safe projection. On Windows an active writer makes SHM or main DB unreadable (EBUSY): active-writer tests hash readable files and compare locked-file size/mtime plus unchanged directory names. They do not claim a hash of locked files.

Risk / pending confirmation: supported ONLY for host-owned synthetic offline copies. A directory marker and boolean do not prove quiescence; host must prevent concurrent mode switches/path swaps. Preflight is not a race-free filesystem lock and no active-database guarantee is claimed. Unknown fields are deliberately omitted, including evidenceIntegrity details; arbitrary text in supported task notes remains task text and is not a credential detector. Full repository regression is delegated to parent session and was not run by M04.

Backlog: production adapter, live-WAL snapshot/copy authorization and production compatibility are outside G2-A. No production integration performed.

Execution note: the first GREEN attempt had 13 pass/2 fail from Windows EBUSY while hashing locked active-writer files and cleaning up an open DB. Test-only capture now records locked-file metadata and closes writers in finally; final GREEN is 17/17. Six synthetic m04-fixture-* directories left by earlier failed cleanup remain. Automatic approval review rejected the bounded recursive cleanup command (reason returned: blocked by policy); no cleanup was executed after rejection. These directories contain generated synthetic test databases only.
