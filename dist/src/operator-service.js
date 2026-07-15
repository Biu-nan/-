import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OPERATORS_FILE, PROJECT_ROOT } from "./config.js";
import { enqueueFileWrite } from "./json-write-queue.js";
const DEFAULT_OPERATORS = [
    {
        operator_id: "lance",
        operator_name: "Lance",
        role: "admin",
        color: "blue",
        enabled: true,
        created_at: "2026-06-24T00:00:00.000Z"
    },
    {
        operator_id: "anna",
        operator_name: "Anna",
        role: "operator",
        color: "green",
        enabled: true,
        created_at: "2026-06-24T00:00:00.000Z"
    }
];
function defaultOperatorsFile() {
    return { schemaVersion: "1.0", operators: DEFAULT_OPERATORS };
}
export class OperatorService {
    operatorsFile;
    constructor(options = {}) {
        this.operatorsFile = options.operatorsFile ?? OPERATORS_FILE;
    }
    async initialize() {
        await mkdir(PROJECT_ROOT, { recursive: true });
        try {
            await readFile(this.operatorsFile, "utf8");
        }
        catch {
            await this.writeFile(defaultOperatorsFile());
        }
    }
    async listOperators() {
        const file = await this.readFile();
        return file.operators.filter((operator) => operator.enabled);
    }
    async createOperator(input) {
        const now = new Date().toISOString();
        const operator = {
            operator_id: this.required(input.operator_id, "operator_id"),
            operator_name: this.required(input.operator_name, "operator_name"),
            role: this.text(input.role) || "operator",
            color: this.text(input.color) || "blue",
            enabled: input.enabled ?? true,
            created_at: this.text(input.created_at) || now
        };
        const file = await this.readFile();
        const index = file.operators.findIndex((item) => item.operator_id === operator.operator_id);
        if (index === -1)
            file.operators.push(operator);
        else
            file.operators[index] = { ...file.operators[index], ...operator };
        await this.writeFile(file);
        return operator;
    }
    async readFile() {
        try {
            const parsed = JSON.parse(await readFile(this.operatorsFile, "utf8"));
            if (!parsed || !Array.isArray(parsed.operators))
                return defaultOperatorsFile();
            return {
                schemaVersion: "1.0",
                operators: parsed.operators
            };
        }
        catch {
            return defaultOperatorsFile();
        }
    }
    async writeFile(value) {
        await mkdir(path.dirname(this.operatorsFile), { recursive: true });
        await enqueueFileWrite(this.operatorsFile, async () => {
            const temporary = `${this.operatorsFile}.${process.pid}.${Date.now()}.tmp`;
            await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
            await rename(temporary, this.operatorsFile);
        });
    }
    required(value, label) {
        const text = this.text(value);
        if (!text)
            throw new Error(`${label} 不能为空`);
        return text;
    }
    text(value) {
        return String(value ?? "").trim();
    }
}
//# sourceMappingURL=operator-service.js.map