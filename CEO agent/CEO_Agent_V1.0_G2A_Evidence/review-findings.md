# G2-A independent review

Scope: approved synthetic-only M03–M06; no merge, deployment, production paths, services, credentials or databases were accessed. Review read the implementation plan, review-package.diff, new modules/tests and existing GREEN logs. No existing test suite was rerun. Two additional Node invocations used in-memory fixture inputs only to reproduce previously untested cases. This report is the reviewer's only file change.

## Current verdict

No remaining Critical or Important finding. All six findings below are repaired within the approved synthetic-only scope. Static reinspection and the implementer's quality-review-green (26/26), archival-state-green (7/7) and trace-freshness-green (24/24) logs support the dispositions. Spec/quality verdict: the reviewed M03–M06 implementation is acceptable for synthetic-only G2-A, subject to the parent task's final joined regression/protection checks. This is not a production approval or a claim that full reports are durably archived.

## Important findings and dispositions

### R1 — FACT prose could contradict valid evidence (P1, repaired)

Initial location: `dist/src/ceo-vnext-analysis.js:14–15` in review-package.diff. Supplying kind=FACT, metric=general, factIds=[fixture-sales] and text claiming profit/sales of 999999 yielded SUPPORTED while the referenced approved fixture was exactly zero. The previous check only tested reference existence and trusted the caller's metric tag. This both misrepresented numeric facts and bypassed the profit safeguard through metric=general.

Disposition: updated `dist/src/ceo-vnext-analysis.js:15–17` generates factual text/assertions from the actual usable facts and preserves free prose for non-fact kinds. Reviewed new contradiction regression and GREEN 26/26 evidence. Closed for the scoped deterministic output contract.

### R2 — inherited dictionary properties could become VERIFIED calibers (P1, repaired)

Initial location: `dist/src/ceo-vnext-context.js:19,27` in review-package.diff. Change an approved synthetic fact to caliber=constructor or __proto__, remove unit and recompute the fixture approval hash. Both inputs produced quality=VERIFIED and unit=null: ordinary indexed lookup returned inherited objects and undefined===undefined passed the unit check. This bypassed unknown-caliber and missing-unit degradation.

Disposition: current `dist/src/ceo-vnext-context.js:19,28` requires an own dictionary property, a nonempty unit and an explicitly supported event basis. Reviewed added prototype/missing-unit regression and GREEN evidence. Closed.

### R3 — event basis was not checked against caliber semantics (P1, repaired)

Initial location: `dist/src/ceo-vnext-context.js:27` in review-package.diff. `safeText(eventBasis)` alone allowed a valid host-approved shipment GMV fact labeled paid to be treated as VERIFIED, contrary to the exact dictionary's shipment-time definition. The implementer confirmed this case and added RED coverage before repair.

Disposition: `config/ceo-data-sources.v1.json` explicitly permits qty.total=paid and amount.gmv=shipment; current context line 28 enforces that mapping. Reviewed the new mismatch regression and GREEN evidence. Closed. The small supported-caliber allowlist is appropriate to this synthetic fixture scope and does not claim complete production coverage.

### R4 — complete observations in future periods could become VERIFIED (P2, repaired)

Initial location: `dist/src/ceo-vnext-context.js:8,20,27` in review-package.diff. Give the approved fixture and context the same period 2099-01-01..2099-12-31 while retaining capture in 2026 and coverage=COMPLETE, then recompute the fixture approval hash. Output was VERIFIED with a usable zero. Matching dates and a fresh capture did not establish that the declared period had completed.

Disposition: current context lines 27–28 derive captureDay in the declared time zone and require captureDay>period.end. Reviewed future-period regression and GREEN evidence. Closed for completed-period facts; intraday coverage is not supplied by the fixture contract.

### R5 — cached workflow proposals must recheck source freshness (P2, repaired)

Location: `dist/src/ceo-workflow-catalog.js:17–20`. Freshness is checked only when `readCeoWorkflowState` issues the object. `planCeoWorkflowInvocation` later checks WeakSet membership and copies disabledReasons without a current-time check. An AVAILABLE state cached for over five minutes therefore remains eligibleForFutureRead=true indefinitely. In-memory reproduction created the state with now/capturedAt=2020-01-01 and invoked the proposal builder in the current process: the result had UNEXECUTED, eligibleForFutureRead=true and disabledReasons=[].

Impact: the explicit stale-state gate can be bypassed by normal caching, even though no executor is dispatched. Revalidate both load/source capture times against an injectable current time at proposal construction; add a cached-state-expiry regression. Preserve UNEXECUTED and zero executor calls.

Follow-up: implementer added now and load-time capturedAt validation, with cached-wrapper expiry GREEN coverage. Remaining edge: sourceCapturedAt is not rechecked. A source four minutes old when loaded remains eligible two minutes later because the wrapper is only two minutes old, although the actual state is six minutes old. The source timestamp must be included in this same check.

Final disposition: current workflow-catalog line 19 checks both workflowState.capturedAt and workflowState.sourceCapturedAt against injected now, rejecting invalid/future/older-than-five-minute values. Inspected the source-freshness-independent-of-wrapper regression and trace-freshness-green 24/24 evidence. Closed; status remains UNEXECUTED and no executor dispatch was introduced.

### R6 — analysis response overstates what is archived (P2, repaired)

Location: `dist/src/ceo-g2a-service.js:32–33`. The current trace persists claim IDs/statuses, priority titles and stopReasons in decisionSummary, with one proposalRef. It does not persist the report, claim assertions or planCandidates. Moreover JSON.stringify(...).slice(0,1900) can cut inside the first long claimId and omit every priority/stop reason. A client still receives archived=true after only this trace has committed; the full report cannot be recovered through the event read API after restart.

If archived denotes full-report archival, the claim is false. A scoped resolution is to explicitly distinguish committed trace archival from unarchived full reports, and make any promised decision summary bounded by fields rather than silently cutting a serialized object. Full-report persistence is not requested as a broad redesign. The implementer has been asked to choose the terminology consistent with the approved M06 contract.

Disposition: current service line 34 reports traceArchived=true/fullReportArchived=false only after successful append; line 33 stores a bounded JSON summary using status counts, bounded priority titles, plan count, up to three proposal references and stopReasons. This does not claim complete report recovery. Checked added archival-fields and injected append-failure assertions plus archival-state-green 7/7. Closed. Complete report persistence remains a declared G2-B artifact-ownership gate, not a claim of this implementation.

## Reviewed boundaries and non-findings

- M04 uses only explicit fixture-root offline copies, a readOnly SQLite connection, query_only/trusted_schema, and a read transaction. Missing creation/initialization and WAL recovery are refused. Existing 17/17 GREEN evidence covers unchanged synthetic files, version/content/store binding and unsafe-path cases. No additional Important defect was established within the stated host-owned, quiescent-copy boundary.
- M06 checks governance before mutation, deduplicates under an exclusive lock, confirms fsync even on duplicate retries, and preserves historical bytes on partial failures. Existing 18/18 GREEN evidence covers concurrent processes, restart, unauthorized/forged corrections, corruption and write/fsync failures. No additional Important defect was established within the synthetic append-only contract.
- The implementer additionally identified a trace policy-version spoofing gap. Current `dist/src/ceo-shadow-trace.js:128` compares event.policyVersion with the governance grant before acquiring the mutation lock; inspected the added before-any-lock/log-write regression and trace-freshness-green evidence. This supplementary repair is accepted; historical loading still preserves previously committed event policy metadata.
- Service canonical record ID repair was inspected at line 33: response uses committed.event.eventId. An uncommitted retry alias is not reserved; the declared canonical-ID limitation is accepted.
- Expired task snapshots produce TASK_SNAPSHOT_STALE. A generic INVESTIGATE proposal may still cite an id/version from that snapshot, but it remains PROPOSED, has no formal task ID/write and carries stopReasons. No finding is asserted beyond the approved investigation-only degradation contract.
- Existing G1 governance is imported rather than modified in the supplied change package; review observed no production startup wiring or executor integration.
- Production identity/log binding, real LLM/executor integration, active/WAL database access, power-loss durability guarantees and hostile host/filesystem races remain outside this authorization; their absence is not scored as a synthetic-only defect.

## Evidence and remaining acceptance

Inspected: m03-m05-green-2 (20/20), m04-green (17/17), m06-green (18/18), service-composed (2/2), quality-review-green (26/26, child exitCode=0), archival-state-green (7/7, child exitCode=0) and trace-freshness-green (24/24, child exitCode=0). These are observed implementer logs, not reviewer reruns. The two pure in-memory reproductions directly confirmed R1/R2/R4/R5; the second invocation occurred after the R3 repair and showed wrong event basis degraded to UNVERIFIED.

All review findings are closed for the scoped contract. Final joined G1/regression/protection-hash reporting belongs to the parent execution task and was not rerun by this reviewer. Backlog: complete report artifact ownership/persistence, production adapters and deployment gates only; no broad redesign proposed.
