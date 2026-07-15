import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DAILY_WAITING_ITEMS_FILE, PROJECT_ROOT } from "./config.js";
import { enqueueFileWrite } from "./json-write-queue.js";
const WAITING_ITEM_STATUSES = [
    "waiting",
    "resolved",
    "cancelled"
];
const WAITING_TYPES = [
    "warehouse",
    "platform_operator",
    "supplier",
    "supervisor",
    "platform_review",
    "other"
];
const EMPTY_WAITING_ITEMS_FILE = {
    schemaVersion: "1.0",
    items: []
};
function emptyWaitingItemsFile() {
    return { schemaVersion: "1.0", items: [] };
}
export class DailyOperationService {
    waitingItemsFile;
    constructor(options = {}) {
        this.waitingItemsFile = options.waitingItemsFile ?? DAILY_WAITING_ITEMS_FILE;
    }
    async initialize() {
        await mkdir(PROJECT_ROOT, { recursive: true });
        try {
            await readFile(this.waitingItemsFile, "utf8");
        }
        catch {
            await this.writeFile(emptyWaitingItemsFile());
        }
    }
    async listWaitingItems() {
        const file = await this.readFile();
        return [...file.items].sort((left, right) => this.compareWaitingItems(left, right));
    }
    async createWaitingItem(input) {
        const now = new Date().toISOString();
        let createdItem;
        await this.mutateFile((file) => {
            const item = {
                waiting_id: randomUUID(),
                date: this.date(input.date) || now.slice(0, 10),
                task_id: this.required(input.task_id, "task_id"),
                task_name: this.optional(input.task_name),
                step_id: this.optional(input.step_id),
                step_name: this.optional(input.step_name),
                store_id: this.required(input.store_id, "store_id"),
                store_name: this.required(input.store_name, "store_name"),
                product_id: this.optional(input.product_id),
                listing_id: this.optional(input.listing_id),
                issue_id: this.optional(input.issue_id),
                waiting_type: this.enumValue(input.waiting_type, WAITING_TYPES, "waiting_type"),
                owner: this.required(input.owner, "owner"),
                owner_role: this.text(input.owner_role),
                description: this.required(input.description, "description"),
                status: "waiting",
                due_at: this.requiredDate(input.due_at, "due_at"),
                next_follow_up_at: this.requiredDate(input.next_follow_up_at, "next_follow_up_at"),
                created_at: now,
                resolved_at: "",
                note: this.text(input.note),
                operator_id: this.optional(input.operator_id),
                operator_name: this.optional(input.operator_name),
                created_by_operator_id: this.optional(input.created_by_operator_id),
                created_by_operator_name: this.optional(input.created_by_operator_name),
                updated_by_operator_id: this.optional(input.updated_by_operator_id),
                updated_by_operator_name: this.optional(input.updated_by_operator_name)
            };
            file.items.push(item);
            createdItem = item;
        });
        if (!createdItem)
            throw new Error("等待事项创建失败");
        return createdItem;
    }
    async updateWaitingItem(waitingId, input) {
        const id = this.required(waitingId, "waiting_id");
        let updatedItem;
        await this.mutateFile((file) => {
            const index = file.items.findIndex((item) => item.waiting_id === id);
            if (index === -1)
                throw new Error("未找到等待事项");
            const existing = file.items[index];
            const nextStatus = input.status === undefined
                ? existing.status
                : this.enumValue(input.status, WAITING_ITEM_STATUSES, "status");
            const next = {
                ...existing,
                task_name: input.task_name === undefined ? existing.task_name : this.optional(input.task_name),
                step_id: input.step_id === undefined ? existing.step_id : this.optional(input.step_id),
                step_name: input.step_name === undefined ? existing.step_name : this.optional(input.step_name),
                owner: input.owner === undefined ? existing.owner : this.required(input.owner, "owner"),
                owner_role: input.owner_role === undefined
                    ? existing.owner_role
                    : this.text(input.owner_role),
                description: input.description === undefined
                    ? existing.description
                    : this.required(input.description, "description"),
                due_at: input.due_at === undefined
                    ? existing.due_at
                    : this.requiredDate(input.due_at, "due_at"),
                next_follow_up_at: input.next_follow_up_at === undefined
                    ? existing.next_follow_up_at
                    : this.requiredDate(input.next_follow_up_at, "next_follow_up_at"),
                note: input.note === undefined ? existing.note : this.text(input.note),
                status: nextStatus,
                resolved_at: nextStatus === "resolved" && !existing.resolved_at
                    ? new Date().toISOString()
                    : nextStatus === "resolved"
                        ? existing.resolved_at
                        : existing.resolved_at,
                operator_id: input.operator_id === undefined ? existing.operator_id : this.optional(input.operator_id),
                operator_name: input.operator_name === undefined ? existing.operator_name : this.optional(input.operator_name),
                updated_by_operator_id: input.updated_by_operator_id === undefined
                    ? existing.updated_by_operator_id
                    : this.optional(input.updated_by_operator_id),
                updated_by_operator_name: input.updated_by_operator_name === undefined
                    ? existing.updated_by_operator_name
                    : this.optional(input.updated_by_operator_name)
            };
            file.items[index] = next;
            updatedItem = next;
        });
        if (!updatedItem)
            throw new Error("未找到等待事项");
        return updatedItem;
    }
    compareWaitingItems(left, right) {
        const leftRank = this.statusRank(left);
        const rightRank = this.statusRank(right);
        if (leftRank !== rightRank)
            return leftRank - rightRank;
        const leftDateRank = this.dateRank(left.next_follow_up_at);
        const rightDateRank = this.dateRank(right.next_follow_up_at);
        if (leftDateRank !== rightDateRank)
            return leftDateRank - rightDateRank;
        const leftTime = this.dateTime(left.next_follow_up_at);
        const rightTime = this.dateTime(right.next_follow_up_at);
        if (leftTime !== rightTime)
            return leftTime - rightTime;
        return left.created_at.localeCompare(right.created_at);
    }
    statusRank(item) {
        if (item.status === "waiting")
            return 0;
        if (item.status === "resolved")
            return 1;
        return 2;
    }
    dateRank(value) {
        if (!value)
            return 3;
        const today = new Date().toISOString().slice(0, 10);
        if (value < today)
            return 0;
        if (value === today)
            return 1;
        return 2;
    }
    dateTime(value) {
        if (!value)
            return Number.MAX_SAFE_INTEGER;
        const time = new Date(value).getTime();
        return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
    }
    async readFile() {
        try {
            const parsed = JSON.parse(await readFile(this.waitingItemsFile, "utf8"));
            if (!parsed || !Array.isArray(parsed.items))
                return emptyWaitingItemsFile();
            return {
                schemaVersion: "1.0",
                items: parsed.items
            };
        }
        catch {
            return emptyWaitingItemsFile();
        }
    }
    async writeFile(value) {
        await enqueueFileWrite(this.waitingItemsFile, () => this.writeFileDirect(value));
    }
    async mutateFile(mutator) {
        await enqueueFileWrite(this.waitingItemsFile, async () => {
            const file = await this.readFile();
            mutator(file);
            await this.writeFileDirect(file);
        });
    }
    async writeFileDirect(value) {
        await mkdir(path.dirname(this.waitingItemsFile), { recursive: true });
        const temporary = `${this.waitingItemsFile}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
        await rename(temporary, this.waitingItemsFile);
    }
    enumValue(value, allowed, label) {
        const text = this.text(value);
        if (allowed.includes(text))
            return text;
        throw new Error(`${label} 不合法`);
    }
    required(value, label) {
        const text = this.text(value);
        if (!text)
            throw new Error(`${label} 不能为空`);
        return text;
    }
    requiredDate(value, label) {
        const text = this.required(value, label);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text))
            throw new Error(`${label} 必须是 YYYY-MM-DD`);
        return text;
    }
    date(value) {
        const text = this.text(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
    }
    optional(value) {
        return this.text(value) || undefined;
    }
    text(value) {
        return String(value ?? "").trim();
    }
}
//# sourceMappingURL=daily-operation-service.js.map