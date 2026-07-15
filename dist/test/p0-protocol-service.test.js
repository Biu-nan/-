import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { P0ProtocolService } from "../src/p0-protocol-service.js";
const fixtureRoot = path.join(process.cwd(), "test", "fixtures", "p0", "smt_choice_listing");
describe("P0 protocol service", () => {
    it("reads the smt_choice_listing workflow spec", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const spec = await service.getWorkflowSpec("smt_choice_listing");
        assert.equal(spec.workflow_id, "smt_choice_listing");
        assert.deepEqual(spec.stages.map((stage) => stage.stage_id), ["S0", "S1", "S2"]);
    });
    it("reads the sample task", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const task = await service.getSampleTask();
        assert.equal(task.workflow_id, "smt_choice_listing");
        assert.ok(["S0", "S1", "S2"].includes(task.current_stage_id));
        assert.ok(["sample", "draft", "active"].includes(task.status));
        assert.equal(task.represents_real_execution, false);
    });
    it("reads the context pack", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const context = await service.getSampleContextPack();
        assert.ok(Array.isArray(context.included_context));
        assert.ok(Array.isArray(context.excluded_context));
        assert.ok(Array.isArray(context.missing_context));
        assert.ok(Array.isArray(context.conflict_context));
        assert.equal(context.approved_for_run, false);
    });
    it("reads the agent job", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const job = await service.getSampleAgentJob();
        assert.equal(typeof job.executor, "string");
        assert.equal(typeof job.goal, "string");
        assert.equal(typeof job.status, "string");
        assert.ok(Array.isArray(job.allowed_actions));
        assert.ok(Array.isArray(job.forbidden_actions));
    });
    it("reads the artifact sample", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const artifact = await service.getSampleArtifact();
        assert.equal(artifact.artifact_type, "product_fact_base");
        assert.equal(artifact.task_id, "sample-p0-smt-choice-listing-001");
        assert.equal(artifact.stage_id, "S2");
        assert.equal(typeof artifact.summary, "string");
        assert.ok(Array.isArray(artifact.source_evidence));
        assert.equal(artifact.qc_status, "pending");
    });
    it("assembles the smt_choice_listing sample chain", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const chain = await service.getSampleChain("smt_choice_listing");
        assert.equal(chain.workflow.workflow_id, "smt_choice_listing");
        assert.equal(chain.task.task_id, "sample-p0-smt-choice-listing-001");
        assert.equal(chain.context_pack.approved_for_run, false);
        assert.equal(chain.agent_job.executor, "codex-p0-readonly-sample");
        assert.equal(chain.artifact.artifact_type, "product_fact_base");
        assert.deepEqual(chain.chain_summary, {
            workflow_id: "smt_choice_listing",
            task_id: "sample-p0-smt-choice-listing-001",
            current_stage_id: "S1",
            chain_status: "sample",
            included_object_count: 5,
            note: "Static sample fixture for protocol validation only; it does not represent real business execution completion."
        });
    });
    it("reports ready health when all P0 fixtures and the sample chain are available", async () => {
        const service = new P0ProtocolService({ fixtureRoot });
        const health = await service.getHealth();
        assert.equal(health.status, "ready");
        assert.equal(health.workflow_id, "smt_choice_listing");
        assert.deepEqual(Object.keys(health.checks).sort(), [
            "agent_job",
            "artifact",
            "context_pack",
            "sample_chain",
            "sample_task",
            "workflow_spec"
        ].sort());
        assert.equal(health.summary.total, 6);
        assert.equal(health.summary.failed, 0);
        assert.equal(health.summary.passed, 6);
        assert.match(health.note, /Static P0 sample fixture health check/);
    });
    it("throws a controlled error when a fixture is missing", async () => {
        const missingRoot = await mkdtemp(path.join(os.tmpdir(), "p0-missing-"));
        const service = new P0ProtocolService({ fixtureRoot: missingRoot });
        await assert.rejects(() => service.getSampleTask(), /P0 fixture missing: sample-task.json/);
    });
});
//# sourceMappingURL=p0-protocol-service.test.js.map