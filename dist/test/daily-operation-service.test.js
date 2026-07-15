import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { DailyOperationService } from "../src/daily-operation-service.js";
async function serviceFixture() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "daily-operation-"));
    const waitingItemsFile = path.join(directory, "daily-waiting-items.json");
    const service = new DailyOperationService({ waitingItemsFile });
    return { directory, service, waitingItemsFile };
}
const requiredInput = {
    task_id: "store_redline",
    store_id: "store-1",
    store_name: "主力店 A",
    waiting_type: "warehouse",
    owner: "仓库同事",
    description: "补拍违规申诉所需包装照片",
    due_at: "2026-06-22",
    next_follow_up_at: "2026-06-22"
};
describe("daily operation waiting items", () => {
    it("creates daily-waiting-items.json when missing", async () => {
        const { directory, service, waitingItemsFile } = await serviceFixture();
        try {
            await service.initialize();
            const raw = JSON.parse(await readFile(waitingItemsFile, "utf8"));
            assert.deepEqual(raw, { schemaVersion: "1.0", items: [] });
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("creates and reads waiting items", async () => {
        const { directory, service } = await serviceFixture();
        try {
            await service.initialize();
            const item = await service.createWaitingItem({
                ...requiredInput,
                owner_role: "仓库",
                note: "今天下班前催一次"
            });
            assert.equal(item.task_id, "store_redline");
            assert.equal(item.status, "waiting");
            assert.equal(item.resolved_at, "");
            assert.equal(item.note, "今天下班前催一次");
            assert.match(item.waiting_id, /^[0-9a-f-]{36}$/);
            assert.match(item.created_at, /^\d{4}-\d{2}-\d{2}T/);
            assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/);
            const items = await service.listWaitingItems();
            assert.equal(items.length, 1);
            assert.equal(items[0].waiting_id, item.waiting_id);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("sorts waiting items by urgency before resolved and cancelled items", async () => {
        const { directory, service } = await serviceFixture();
        try {
            await service.initialize();
            const future = await service.createWaitingItem({
                ...requiredInput,
                store_id: "future",
                store_name: "未来店",
                next_follow_up_at: "2099-01-01",
                due_at: "2099-01-01"
            });
            const overdue = await service.createWaitingItem({
                ...requiredInput,
                store_id: "overdue",
                store_name: "逾期店",
                next_follow_up_at: "2000-01-01",
                due_at: "2000-01-01"
            });
            const today = await service.createWaitingItem({
                ...requiredInput,
                store_id: "today",
                store_name: "今日店",
                next_follow_up_at: new Date().toISOString().slice(0, 10),
                due_at: new Date().toISOString().slice(0, 10)
            });
            const resolved = await service.createWaitingItem({
                ...requiredInput,
                store_id: "resolved",
                store_name: "已解决店",
                next_follow_up_at: "1999-01-01",
                due_at: "1999-01-01"
            });
            const cancelled = await service.createWaitingItem({
                ...requiredInput,
                store_id: "cancelled",
                store_name: "已取消店",
                next_follow_up_at: "1998-01-01",
                due_at: "1998-01-01"
            });
            await service.updateWaitingItem(resolved.waiting_id, { status: "resolved" });
            await service.updateWaitingItem(cancelled.waiting_id, { status: "cancelled" });
            const items = await service.listWaitingItems();
            assert.deepEqual(items.map((item) => item.waiting_id), [overdue.waiting_id, today.waiting_id, future.waiting_id, resolved.waiting_id, cancelled.waiting_id]);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("marks resolved items with resolved_at and keeps cancelled items", async () => {
        const { directory, service } = await serviceFixture();
        try {
            await service.initialize();
            const resolved = await service.createWaitingItem(requiredInput);
            const cancelled = await service.createWaitingItem({
                ...requiredInput,
                store_id: "store-2",
                store_name: "主力店 B"
            });
            const updated = await service.updateWaitingItem(resolved.waiting_id, {
                status: "resolved"
            });
            await service.updateWaitingItem(cancelled.waiting_id, { status: "cancelled" });
            assert.equal(updated.status, "resolved");
            assert.match(updated.resolved_at, /^\d{4}-\d{2}-\d{2}T/);
            const items = await service.listWaitingItems();
            assert.equal(items.length, 2);
            assert.equal(items.some((item) => item.waiting_id === cancelled.waiting_id), true);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("persists waiting items across service reloads", async () => {
        const { directory, service, waitingItemsFile } = await serviceFixture();
        try {
            await service.initialize();
            const created = await service.createWaitingItem(requiredInput);
            const reloaded = new DailyOperationService({ waitingItemsFile });
            await reloaded.initialize();
            const items = await reloaded.listWaitingItems();
            assert.equal(items.length, 1);
            assert.equal(items[0].waiting_id, created.waiting_id);
        }
        finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it("surfaces write failures instead of swallowing them", async () => {
        const { directory, service } = await serviceFixture();
        try {
            await service.initialize();
            await chmod(directory, 0o500);
            await assert.rejects(() => service.createWaitingItem(requiredInput), /EACCES|EPERM|permission|权限/i);
        }
        finally {
            await chmod(directory, 0o700).catch(() => undefined);
            await rm(directory, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=daily-operation-service.test.js.map