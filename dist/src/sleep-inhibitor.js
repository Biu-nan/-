import { spawn } from "node:child_process";
import { platform } from "node:os";
export class SleepInhibitor {
    process;
    activeTasks = 0;
    async run(task) {
        this.acquire();
        try {
            return await task();
        }
        finally {
            this.release();
        }
    }
    isActive() {
        return this.process !== undefined;
    }
    stop() {
        this.activeTasks = 0;
        this.process?.kill("SIGTERM");
        this.process = undefined;
    }
    acquire() {
        this.activeTasks += 1;
        if (this.process)
            return;
        // caffeinate 仅存在于 macOS。Windows 上此前每个后台任务都会触发 ENOENT，
        // 既无法防休眠又会持续刷错；Windows 直接跳过，任务本身不受影响。
        if (platform() !== "darwin")
            return;
        const child = spawn("/usr/bin/caffeinate", ["-i"], {
            stdio: "ignore"
        });
        child.once("error", (error) => {
            console.error("Failed to prevent system sleep:", error);
            if (this.process === child)
                this.process = undefined;
        });
        child.once("exit", () => {
            if (this.process === child)
                this.process = undefined;
        });
        this.process = child;
    }
    release() {
        this.activeTasks = Math.max(0, this.activeTasks - 1);
        if (this.activeTasks === 0)
            this.stop();
    }
}
//# sourceMappingURL=sleep-inhibitor.js.map
