# M06 synthetic shadow trace

Current goal: isolated synthetic append-only trace, with existing G1 authorization; no production adapter, DB, services, credentials, task/run mutation or workflow stop.

Changed files: `dist/src/ceo-shadow-trace.js`, `dist/test/ceo-shadow-trace.test.js` only (plus this evidence directory). No staging or commits.

## Interface

`createCeoShadowTrace({filePath, fixtureRoot, governance, now = () => new Date()})` returns frozen `{append, read}`. Construction validates existing root, marker and paths without writing. `filePath` parent must already exist. Root marker `.ceo-isolated-fixture.json` must contain `synthetic: true`; real paths including symlinks and hard-linked leaf files are checked before filesystem operations.

`await append({principal, event})` returns a frozen committed record with `sequence`, `recordedAt`, `actorId`, `contentHash`, `previousHash`, `recordHash`, and frozen `event`. Errors throw and never return a saved result. `await read({principal, storeId})` returns records or `[]` for a missing trace without creating any file or lock.

Event required fields: `type`, `storeId`, `eventId`, `analysisId`, `contextId`, `snapshotId`, `sourceHash` (64 lowercase hex), `policyVersion`, `proposalRef` (explicit null or safe ID). Type is exactly `ANALYSIS`, `HUMAN_FEEDBACK`, `HUMAN_CORRECTION`, `HUMAN_PAUSE`, or `HUMAN_RESUME`. IDs are bounded safe ASCII identifiers; policy version also accepts slash-separated references. ANALYSIS optionally accepts nonblank `decisionSummary` (max 2000 characters). Human events optionally accept `feedbackId` and `note` (max 2000 characters); correction additionally requires `correctsEventId`. Unknown fields, nested payloads, control characters and recognized secret patterns are rejected.

ANALYSIS requires existing governance `analyze`; all Human events require `human.review`; read requires `read`. Raw role/profile objects cannot authorize. Human events must link an existing analysis with identical store, context, snapshot, source hash, policy version and proposal reference. Corrections append a reference to an existing event in the same analysis, leaving original bytes intact. Pause prevents new analyses for this store; duplicate committed analyses and feedback remain allowed; Human resume permits new analyses. No workflow executor exists here.

## Identity and durability

The append-only file rebuilds all state on every operation. Event ID conflicts, analysis ID content conflicts and feedback ID conflicts fail. ANALYSIS logical identity excludes the delivery event ID but includes actor and all other event fields. An exact retry using E2 for an already committed analysis E1 returns the original E1 record. **Only returned `record.event.eventId` is the canonical committed ID. E2 is an uncommitted delivery alias and is not durably reserved. Hosts must retain E1 and use it for corrections/links.**

Independent instances/processes serialize with an exclusive sibling `.lock`, bounded two-second wait and no stale-lock stealing. All permissions are checked before lock creation and again before append. Writes use append flags, file identity validation and fsync; duplicate append also fsyncs the existing file, covering a prior full-line write followed by sync failure. Partial writes are not rolled back or repaired; later operations reject the truncated tail. Hash-chain/schema/sequence validation rejects corruption, invalid UTF-8, empty existing files, malformed lines and inconsistent transitions. Historical bytes are never overwritten.

## Verification

- `python .superpowers/sdd/ceo-g2a-20261105/run.py m06-red node --test dist/test/ceo-shadow-trace.test.js`: exit 1, all 13 original tests failed because feature was absent.
- `m06-sync-retry-red`: captured one expected regression failure for duplicate retry after fsync error.
- `m06-summary-red`: captured one expected failure for missing decisionSummary support.
- `python .superpowers/sdd/ceo-g2a-20261105/run.py m06-green node --test dist/test/ceo-shadow-trace.test.js`: exit 0, 18/18 tests pass.
- `python .superpowers/sdd/ceo-g2a-20261105/run.py m06-governance-regression node --test dist/test/ceo-governance.test.js dist/test/ceo-shadow-trace.test.js`: final result saved alongside logs; covers the unchanged governance contract and M06.
- Tests cover six child processes, parallel instances, restart dedup, forged principals and cross-store denial without mutations, secret/schema rejection, correction links, pause/resume, symlink escapes/swaps, abandoned locks, corruption/truncation, disk-full and partial writes, and sync errors.
- Full repository comparison is coordinated by the parent; this agent did not independently run the full suite.

## Limits and backlog

Synthetic adapter only; no production trace owner was added. Existing trace size is capped at 16 MiB and appends beyond that limit fail. Abandoned locks require owner investigation/removal after proving no writer remains; automatic lock recovery is deliberately absent. Root and OS filesystem are trusted against malicious concurrent filesystem mutations and complete history replacement: a local hash chain detects content inconsistency, but provides no external signature or deletion anchor. Free-text secret rejection recognizes explicit credential patterns, not arbitrary undisclosed secrets. No task/run mutation or actual workflow pause occurs. Production integration, lock recovery policy, external anchoring and retention belong to future authorized work.
