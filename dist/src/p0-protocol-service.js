import { readFile } from "node:fs/promises";
import path from "node:path";
const defaultFixtureRoot = path.join(process.cwd(), "test", "fixtures", "p0", "smt_choice_listing");
export class P0ProtocolService {
    fixtureRoot;
    constructor(options = {}) {
        this.fixtureRoot = options.fixtureRoot ?? defaultFixtureRoot;
    }
    async getWorkflowSpec(workflowId) {
        if (workflowId !== "smt_choice_listing") {
            throw new Error(`P0 workflow not found: ${workflowId}`);
        }
        return this.readFixture("workflow-spec.json");
    }
    async getSampleTask() {
        return this.readFixture("sample-task.json");
    }
    async getSampleContextPack() {
        return this.readFixture("context-pack.json");
    }
    async getSampleAgentJob() {
        return this.readFixture("agent-job.json");
    }
    async getSampleArtifact() {
        return this.readFixture("artifact-sample.json");
    }
    async getSampleChain(workflowId) {
        const [workflow, task, contextPack, agentJob, artifact] = await Promise.all([
            this.getWorkflowSpec(workflowId),
            this.getSampleTask(),
            this.getSampleContextPack(),
            this.getSampleAgentJob(),
            this.getSampleArtifact()
        ]);
        return {
            workflow,
            task,
            context_pack: contextPack,
            agent_job: agentJob,
            artifact,
            chain_summary: {
                workflow_id: workflow.workflow_id,
                task_id: String(task.task_id ?? ""),
                current_stage_id: task.current_stage_id,
                chain_status: "sample",
                included_object_count: 5,
                note: "Static sample fixture for protocol validation only; it does not represent real business execution completion."
            }
        };
    }
    async getHealth() {
        const checks = {
            workflow_spec: await this.runHealthCheck("workflow_spec", () => this.getWorkflowSpec("smt_choice_listing")),
            sample_task: await this.runHealthCheck("sample_task", () => this.getSampleTask()),
            context_pack: await this.runHealthCheck("context_pack", () => this.getSampleContextPack()),
            agent_job: await this.runHealthCheck("agent_job", () => this.getSampleAgentJob()),
            artifact: await this.runHealthCheck("artifact", () => this.getSampleArtifact()),
            sample_chain: await this.runHealthCheck("sample_chain", () => this.getSampleChain("smt_choice_listing"))
        };
        const checkResults = Object.values(checks);
        const failed = checkResults.filter((check) => check.status === "fail").length;
        const passed = checkResults.length - failed;
        return {
            status: failed === 0 ? "ready" : "not_ready",
            workflow_id: "smt_choice_listing",
            checks,
            summary: {
                passed,
                failed,
                total: checkResults.length
            },
            note: "Static P0 sample fixture health check only; it does not represent real business execution status."
        };
    }
    async runHealthCheck(name, check) {
        try {
            await check();
            return { name, status: "pass" };
        }
        catch (error) {
            return {
                name,
                status: "fail",
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async readFixture(fileName) {
        const filePath = path.join(this.fixtureRoot, fileName);
        try {
            return JSON.parse(await readFile(filePath, "utf8"));
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                throw new Error(`P0 fixture invalid JSON: ${fileName}`);
            }
            throw new Error(`P0 fixture missing: ${fileName}`);
        }
    }
}
//# sourceMappingURL=p0-protocol-service.js.map