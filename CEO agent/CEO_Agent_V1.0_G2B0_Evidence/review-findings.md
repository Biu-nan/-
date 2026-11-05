# CEO G2-B0 independent review

## Final scoped disposition

**APPROVED for the reviewed synthetic-only G2-B0 scope: all 3 Important findings closed; no remaining Critical/Important finding in this scoped follow-up.** This is not approval for real source integration, production adoption, executor activity, or operating-data writes.

- Finding 1 closed by the domain-local strict timestamp validator (`dist/src/ceo-payment-domain.js:5-8,21,33-34`), including explicit calendar roundtrip, clock components and UTC offset checks. Invalid dates no longer enter aggregation or accepted approval.
- Finding 2 closed by correction replay checks for the saved parent, durable feedback note and authenticated Human actor (`dist/src/ceo-payment-loop.js:42`), plus an actor/parent/note/question signature on concurrent in-process corrections (`:49-53`).
- Finding 3 closed by supplying the host requestId as optional requestRef to report identity (`dist/src/ceo-payment-loop.js:30`; `dist/src/ceo-vnext-analysis.js`), with the report schema updated. Calls that omit requestRef keep that field absent.
- Approval-provenance observation closed: `approval.synthetic.json` now saves the source approval, fact approvals and policy hash (`dist/src/ceo-payment-domain.js:45-47`); Context.reviewHash binds the fact-approval list. Both raw snapshot and approval evidence are passed through the full archive.

Follow-up verification was **static only**. I inspected the relevant code, regression assertions and coordinator-generated `review-fixes-green.result.json`/stdout/stderr: the saved command exited 0, 20 tests passed, 0 failed. Its coverage now includes HTTP roundtrip, pending trace failure/recovery, version bindings, approval evidence, same-clock requests, correction target/note replay conflicts and impossible dates. I did not independently rerun those tests or start a service. The results apply to that recorded run; later code edits require the coordinator's final targeted verification.

The original findings below remain as the immutable review history of the first reviewed snapshot.

Verdict at the reviewed snapshot: **CHANGES REQUIRED — 3 Important findings, 0 Critical**. This records the original reviewed source; coordinator fixes made afterward require their own verification and do not retroactively change this verdict.

Scope: read-only source/diff/plan review and two pure in-memory checks. No test suite rerun, production reads, credentials, service startup, database/log writes, executor, or source edits. This findings file is the sole review artifact written. Pending HTTP roundtrip and package-binding tests are not counted as completed.

## Important 1: reject nonexistent calendar dates before counting payment facts

- Location: `dist/src/ceo-payment-domain.js:27-29` (permissive helper: `dist/src/ceo-vnext-common.js:6`).
- Trigger: use a correctly approved synthetic complete snapshot with period `2026-03-01` through `2026-03-03`, `Asia/Shanghai`; exportedAt `2026-03-04T00:00:00Z`; reviewedAt `2026-03-04T00:10:00Z`; now `2026-03-04T00:30:00Z`; one row whose paidAt is `2026-02-30T00:00:00Z`, itemCount 2, amount 12.34 CNY. Recompute the approval's snapshotHash and periodHash.
- Actual: `Date.parse` silently normalizes the nonexistent February 30 to March 2. The adapter counts the row within March and returns all three facts **VERIFIED**, values `[1,2,12.34]`, without a payment-time gap. This was reproduced using only the exported adapter and synthetic in-memory objects.
- Impact: invalid source payment timestamps produce verified period totals; approval/content binding does not repair invalid event semantics.
- Required: strictly validate the timestamp's calendar/time components, including offset, before comparing the event to export time and period. Reject or degrade impossible timestamps. Add a synthetic regression for invalid payment/export/review calendar dates. A local domain validator can preserve the original G2-A helper's scope.

## Important 2: bind correction retries to the original correction intent

- Location: `dist/src/ceo-payment-loop.js:39-47`, especially recovery at line 42; `dist/src/ceo-report-archive.js:113,127-129`.
- Trigger: complete correction request `R` for original report A with note N under Human H. Resubmit `R` for report B, or with a different note, or under a different same-store Human principal.
- Actual: `correct()` recovers solely by requestId and returns COMPLETE before checking this request's correctsReportId, note, or Human actor. `recover()` authorizes the caller's profile but does not compare the actor to the stored intent. The normal archive.prepare content/actor conflict check is bypassed. The caller receives the old correction as successful even though the current correction was neither recorded nor applied.
- Impact: false successful correction, lost Human intent, and attribution crossing for same-store Human identities. There is no cross-store data leak claim.
- Required: persist and validate correction intent/feedback identity, actor, target and note before replay success. Mismatches must conflict. Coordinate concurrent correction attempts as well as restarted retries.

## Important 3: distinct requests can collide on analysis identity and remain unfinishable

- Location: `dist/src/ceo-payment-loop.js:16-18,21-31,37`; `dist/src/ceo-vnext-analysis.js:28-29` in the reviewed snapshot; archive request identity `dist/src/ceo-report-archive.js:113`; trace uniqueness `dist/src/ceo-shadow-trace.js:37-47`.
- Trigger: analyze two different request IDs with the same input/snapshots and same millisecond clock. A frozen fixture clock makes this deterministic; simultaneous requests with a shared clock tick can do it naturally.
- Actual: assemble() ignores requestId when constructing report identity. Both reports have identical analysisId, while archive reportId differs because requestId is included in its logical hash. Trace uniqueness is by analysisId; the second ANALYSIS has a different reportId/eventId and thus a different digest, producing TRACE_CONFLICT. Its durable manifest remains PREPARED; retries recover that same conflicting report and cannot complete it.
- Evidence: pure in-memory calls to buildCeoShadowReport with identical arguments and clock yielded the same analysisId. The different archive hash and deterministic trace conflict follow directly from the cited source paths; no filesystem/service repro was run.
- Required: bind the distinct host request intent to new report analysis identity, while preserving same-request immutable replay and unchanged G2-A behavior where no new binding is supplied. Add a fixed-clock two-request regression.

## Nonblocking observation / Backlog

The raw snapshot is archived, but the trusted source-approval envelope (reviewerId/reviewedAt/snapshotHash/periodHash) is not in saved evidence or the reduced Context facts. If reproducing the approval decision after restart belongs to the accepted meaning of full evidence, persist that synthetic approval envelope too. This is recorded as an acceptance clarification, not a fourth blocking defect.

No claim is made that file hashes are OS tamperproof, that Windows directory fsync occurs, or that real source/store/taskboard/log/identity contracts have been verified.
