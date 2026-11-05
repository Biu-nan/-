# G0/G1 implementation ledger
Plan: F:/yikuaborder-deploy/CEO agent/CEO_Agent_V1.0_Minimal_Change_Scope_20261105.md
Authorization: G0 and M01/M02 isolated development; no production deployment, business writes, real credentials or identity migration.
Worktree: feature/ceo-g0-g1-20261105 @ main 052abd7 + whitelisted CEO sources fed03d3.
Ruling: Native create_worktree failed to recognize both Windows path forms; created isolated Git worktree locally; no existing branch changed.
Ruling: Formal Taskboard binding not confirmed. User explicitly permits all independent G1 fixture development; production database wiring stays blocked. No empty replacement database.
Pre-flight: M01 health consumes M02 mode; M02 requires pure query classification to avoid old GET recovery paths. Implement manifest/lease first, then governed boundary and task-service adapter. Shared state is synthetic only.
Task G0: baseline evidence captured in g0-before.json and g0-runtime.json. Last service binding corroborated by start script and before/after receipts; current formal binding remains unverified.
Task reuse: 39 exact tracked CEO files imported from fed03d3; legacy-import-manifest.json records hashes. Reuse existing implementation is baseline import, not new feature code.

Baseline finding: first guarded run exposed test-preloader sqlite options forwarding error; reproduced with direct synthetic SQLite open, fixed in test infrastructure, reran. Corrected baseline: 417 tests,390 pass,27 fail. CLI-page 503 traced to missing ceo-tasks.html from source import closure; imported exact tracked source file. Other baseline failures preserved.
Task M01 first slice: 14 assertions RED (missing API) to GREEN 14/14; m01-red/m01-green logs, command/exit-code/diff saved.

M01/M02 integration slices completed; individual RED/GREEN records kept. Ruling: formal binding and production activation remain stopped. Default legacy HTTP is read-only; manual regression requires explicit synthetic fixture root. Test recorder Unicode encoding issue corrected; empty recorder invocation produced no test result and is not counted.

Final review fixes: reproduced uppercase API bypass, cwd root mismatch, broad synthetic Human executor grant and resource-store mismatch; added RED tests and fixed gateway and startup checks. Manifest dependency omission regraded Important because M01 requires an honest executable package identity; direct Listing dependency RED->GREEN added. Legacy standalone persistence CLI fixture guard RED->GREEN. No production code/identity migration or binding changed.

Protection finding: main config/metrics-schema.json drifted during this work; source unconfirmed, not in assistant write operations. Preserve it; do not claim production configuration globally unchanged. Main tracked diff now contains this additional change; original CEO/run diffs remain unchanged.
Test finding: final-g1-new parallel run 54/55, main duplicate startup deadline1.5s expired under concurrent suites/syntax checks; invariant unchanged, deadline increased to10s. Earlier actual full suite passed this same test. Keep failing result and rerun.
