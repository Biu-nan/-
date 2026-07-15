import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { HiddenDataLoopService, KNOWLEDGE_ITEM_STATUSES, QCLAW_TASK_STATUSES } from "../src/hidden-data-loop-service.js";
async function createService() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "hidden-data-loop-"));
    const service = new HiddenDataLoopService({ dataDir: path.join(directory, "data") });
    await service.ensureHiddenDataFiles();
    return service;
}
describe("hidden data loop service", () => {
    it("initializes all hidden data files", async () => {
        const service = await createService();
        const files = await service.hiddenDataFileStatus();
        assert.deepEqual(files.map((file) => path.basename(file.path)).sort(), [
            "action_log.jsonl",
            "command_inbox.jsonl",
            "event_log.jsonl",
            "knowledge_items.jsonl",
            "qclaw_results.jsonl",
            "qclaw_state.json",
            "qclaw_tasks.jsonl",
            "reviews.jsonl",
            "snapshots.jsonl",
            "task_state.json",
            "today_dashboard.json"
        ].sort());
        assert.ok(files.every((file) => file.exists));
    });
    it("appends event_log records through the unified JSONL writer", async () => {
        const service = await createService();
        const event = await service.appendEvent({
            type: "test.event",
            source: "test",
            correlation_id: "corr-test"
        });
        const events = await service.readJsonl("event_log");
        assert.equal(events.length, 1);
        assert.equal(events[0].id, event.id);
        assert.equal(events[0].schema_version, "1.0");
    });
    it("creates commands with a generated correlation_id and event evidence", async () => {
        const service = await createService();
        const command = await service.createCommand({
            type: "secretary.command",
            source: "website",
            payload: { text: "生成 QClaw 任务草稿" }
        });
        assert.ok(command.correlation_id);
        const commands = await service.readJsonl("command_inbox");
        const events = await service.readJsonl("event_log");
        assert.equal(commands[0].correlation_id, command.correlation_id);
        assert.equal(events[0].type, "command.created");
        assert.equal(events[0].correlation_id, command.correlation_id);
    });
    it("creates qclaw tasks and rejects invalid status transitions", async () => {
        const service = await createService();
        const task = await service.createQclawTask({
            type: "qclaw.task",
            source: "website",
            title: "测试 QClaw 任务",
            risk_level: "L2",
            status: "draft"
        });
        assert.equal(task.status, "draft");
        await assert.rejects(() => service.createQclawTask({
            type: "qclaw.task",
            source: "website",
            title: "非法 QClaw 任务",
            risk_level: "L2",
            status: "success"
        }), /initial status/);
        assert.ok(QCLAW_TASK_STATUSES.includes("needs_human"));
    });
    it("forces L3 qclaw tasks into pending_approval", async () => {
        const service = await createService();
        const task = await service.createQclawTask({
            type: "qclaw.task",
            source: "secretary",
            title: "高风险外部执行",
            risk_level: "L3",
            status: "queued"
        });
        assert.equal(task.status, "pending_approval");
    });
    it("links qclaw task and result by correlation_id and projects dashboard counts", async () => {
        const service = await createService();
        const task = await service.createQclawTask({
            type: "qclaw.task",
            source: "website",
            title: "跑一个低风险任务",
            risk_level: "L0",
            status: "queued",
            correlation_id: "corr-qclaw"
        });
        const result = await service.appendQclawResult({
            type: "qclaw.result",
            source: "qclaw",
            task_id: task.id,
            status: "failed",
            summary: "测试失败可见",
            correlation_id: task.correlation_id
        });
        assert.equal(result.correlation_id, task.correlation_id);
        const dashboard = await service.rebuildTodayDashboard();
        assert.equal(dashboard.qclaw_tasks_total, 1);
        assert.equal(dashboard.qclaw_failed_or_needs_human, 1);
    });
    it("filters smoke and qa records from today dashboard by default", async () => {
        const service = await createService();
        const smokeTask = await service.createQclawTask({
            type: "qclaw.task",
            source: "qa-smoke",
            title: "QA 测试任务",
            risk_level: "L3",
            status: "queued",
            smoke_test: true,
            correlation_id: "corr-smoke"
        });
        await service.appendQclawResult({
            type: "qclaw.result",
            source: "qclaw",
            task_id: smokeTask.id,
            status: "failed",
            summary: "测试 result 未直接标 smoke，但应随 task 过滤",
            correlation_id: smokeTask.correlation_id
        });
        await service.createQclawTask({
            type: "qclaw.task",
            source: "website",
            title: "正式待确认任务",
            risk_level: "L3",
            status: "queued",
            correlation_id: "corr-real"
        });
        const filtered = await service.rebuildTodayDashboard();
        assert.equal(filtered.qclaw_pending_approval, 1);
        assert.equal(filtered.qclaw_failed_or_needs_human, 0);
        assert.equal(filtered.qclaw_tasks_total, 1);
        assert.equal(filtered.include_test_data, false);
        assert.equal(filtered.test_data_filtered, true);
        assert.equal(filtered.test_record_count, 2);
        const included = await service.rebuildTodayDashboard({ includeTestData: true, persist: false });
        assert.equal(included.qclaw_pending_approval, 2);
        assert.equal(included.qclaw_failed_or_needs_human, 1);
        assert.equal(included.qclaw_tasks_total, 2);
        assert.equal(included.include_test_data, true);
        assert.equal(included.test_data_filtered, false);
    });
    it("accepts only fixed knowledge item statuses", async () => {
        const service = await createService();
        const item = await service.createKnowledgeItem({
            type: "knowledge.item",
            source: "secretary",
            title: "待审核 SOP",
            status: "pending_review"
        });
        assert.equal(item.status, "pending_review");
        assert.ok(KNOWLEDGE_ITEM_STATUSES.includes("conflict"));
        await assert.rejects(() => service.createKnowledgeItem({
            type: "knowledge.item",
            source: "secretary",
            title: "非法状态",
            status: "auto_approved"
        }), /knowledge item status/);
    });
    it("keeps feishu webhook limited to command_inbox and event_log", async () => {
        const service = await createService();
        await service.createFeishuCommand({ text: "飞书输入" });
        assert.equal((await service.readJsonl("command_inbox")).length, 1);
        assert.equal((await service.readJsonl("event_log")).length, 1);
        assert.equal((await service.readJsonl("action_log")).length, 0);
        assert.equal((await service.readJsonl("qclaw_results")).length, 0);
    });
    it("persists JSON projections with the unified writer", async () => {
        const service = await createService();
        await service.writeJson("task_state", { schema_version: "1.0", tasks: [] });
        const file = await readFile(service.filePath("task_state"), "utf8");
        assert.match(file, /"tasks": \[\]/);
    });
});
//# sourceMappingURL=hidden-data-loop-service.test.js.map