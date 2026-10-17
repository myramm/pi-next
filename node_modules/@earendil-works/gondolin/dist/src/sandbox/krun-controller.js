import { EventEmitter } from "events";
import child_process from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
const activeChildren = new Set();
let exitHookRegistered = false;
function killActiveChildren() {
    for (const child of activeChildren) {
        try {
            child.kill("SIGKILL");
        }
        catch {
            // ignore
        }
    }
}
function registerExitHook() {
    if (exitHookRegistered)
        return;
    exitHookRegistered = true;
    process.once("exit", () => {
        killActiveChildren();
    });
}
function trackChild(child) {
    registerExitHook();
    activeChildren.add(child);
    const cleanup = () => {
        activeChildren.delete(child);
    };
    child.once("exit", cleanup);
    child.once("error", cleanup);
}
function resolveExecutableForInspection(executable) {
    if (path.isAbsolute(executable) || executable.includes(path.sep)) {
        return executable;
    }
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        if (!dir)
            continue;
        const candidate = path.join(dir, executable);
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return candidate;
        }
        catch {
            // try next PATH entry
        }
    }
    return executable;
}
function hasMacHypervisorEntitlement(executable) {
    const inspectPath = resolveExecutableForInspection(executable);
    try {
        const entitlements = child_process.execFileSync("/usr/bin/codesign", ["-d", "--entitlements", ":-", inspectPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return entitlements.includes("com.apple.security.hypervisor");
    }
    catch {
        return false;
    }
}
export function assertMacHypervisorEntitlement(executable) {
    if (process.platform !== "darwin")
        return;
    if (hasMacHypervisorEntitlement(executable))
        return;
    const inspectPath = resolveExecutableForInspection(executable);
    throw new Error("krun runner is not signed with the macOS Hypervisor entitlement " +
        `(com.apple.security.hypervisor): ${inspectPath}\n` +
        "Fix: rebuild the local runner with `make krun-runner` or set " +
        "GONDOLIN_KRUN_RUNNER to a signed runner binary.");
}
export class KrunController extends EventEmitter {
    child = null;
    state = "stopped";
    restartTimer = null;
    manualStop = false;
    config;
    activeConfigPath = null;
    constructor(config) {
        super();
        this.config = config;
    }
    setAppend(append) {
        this.config.append = append;
    }
    getState() {
        return this.state;
    }
    getHostPid() {
        return this.child?.pid ?? null;
    }
    async start() {
        if (this.child)
            return;
        this.manualStop = false;
        this.setState("starting");
        try {
            assertMacHypervisorEntitlement(this.config.krunRunnerPath);
            const runnerConfig = buildRunnerConfig(this.config);
            const configPath = writeRunnerConfig(runnerConfig);
            this.activeConfigPath = configPath;
            this.child = child_process.spawn(this.config.krunRunnerPath, ["--config", configPath], {
                stdio: ["ignore", "pipe", "pipe"],
            });
            trackChild(this.child);
            this.child.stdout?.on("data", (chunk) => {
                this.emit("log", chunk.toString(), "stdout");
            });
            this.child.stderr?.on("data", (chunk) => {
                this.emit("log", chunk.toString(), "stderr");
            });
            this.child.on("spawn", () => {
                this.setState("running");
            });
            this.child.on("error", (err) => {
                this.cleanupActiveConfig();
                this.child = null;
                this.setState("stopped");
                this.emit("exit", { code: null, signal: null, error: err });
            });
            this.child.on("exit", (code, signal) => {
                this.cleanupActiveConfig();
                this.child = null;
                this.setState("stopped");
                this.emit("exit", { code, signal });
                if (this.manualStop) {
                    this.manualStop = false;
                    return;
                }
                if (this.config.autoRestart) {
                    this.scheduleRestart();
                }
            });
        }
        catch (err) {
            this.cleanupActiveConfig();
            this.child = null;
            this.setState("stopped");
            throw err;
        }
    }
    async close() {
        if (!this.child) {
            this.cleanupActiveConfig();
            return;
        }
        const child = this.child;
        this.child = null;
        this.manualStop = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        const closeTimeoutMs = 10_000;
        let exited = false;
        let exitHandler = null;
        let errorHandler = null;
        const waitForExit = new Promise((resolve) => {
            const exitCode = child.exitCode;
            if (typeof exitCode === "number") {
                exited = true;
                resolve();
                return;
            }
            exitHandler = () => {
                exited = true;
                resolve();
            };
            errorHandler = () => {
                exited = true;
                resolve();
            };
            child.once("exit", exitHandler);
            child.once("error", errorHandler);
        });
        try {
            child.kill("SIGTERM");
        }
        catch {
            // ignore
        }
        const sigkillTimer = setTimeout(() => {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // ignore
            }
        }, 3000);
        let closeTimeoutTimer = null;
        try {
            await Promise.race([
                waitForExit,
                new Promise((resolve) => {
                    closeTimeoutTimer = setTimeout(resolve, closeTimeoutMs);
                }),
            ]);
        }
        finally {
            if (closeTimeoutTimer) {
                clearTimeout(closeTimeoutTimer);
            }
            clearTimeout(sigkillTimer);
        }
        if (!exited) {
            try {
                child.kill("SIGKILL");
            }
            catch {
                // ignore
            }
            try {
                child.stdin?.destroy?.();
            }
            catch {
                // ignore
            }
            try {
                child.stdout?.destroy?.();
            }
            catch {
                // ignore
            }
            try {
                child.stderr?.destroy?.();
            }
            catch {
                // ignore
            }
            try {
                child.unref();
            }
            catch {
                // ignore
            }
            killActiveChildren();
            if (exitHandler)
                child.off("exit", exitHandler);
            if (errorHandler)
                child.off("error", errorHandler);
        }
        this.cleanupActiveConfig();
        this.setState("stopped");
    }
    async restart() {
        await this.close();
        await this.start();
    }
    scheduleRestart() {
        if (this.restartTimer)
            return;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            void this.start();
        }, 1000);
    }
    setState(state) {
        if (this.state === state)
            return;
        this.state = state;
        this.emit("state", state);
    }
    cleanupActiveConfig() {
        if (!this.activeConfigPath)
            return;
        try {
            fs.rmSync(this.activeConfigPath, { force: true });
        }
        catch {
            // ignore
        }
        this.activeConfigPath = null;
    }
}
function parseMemoryToMiB(value) {
    const trimmed = value.trim();
    const match = /^(\d+)([kKmMgGtT]?)$/.exec(trimmed);
    if (!match) {
        throw new Error(`invalid vm memory value for krun backend: ${JSON.stringify(value)}`);
    }
    const amount = Number.parseInt(match[1], 10);
    const unit = match[2].toUpperCase();
    let bytes = amount;
    if (unit === "K")
        bytes *= 1024;
    else if (unit === "M" || unit === "")
        bytes *= 1024 * 1024;
    else if (unit === "G")
        bytes *= 1024 * 1024 * 1024;
    else if (unit === "T")
        bytes *= 1024 * 1024 * 1024 * 1024;
    const mib = Math.max(1, Math.ceil(bytes / (1024 * 1024)));
    if (!Number.isSafeInteger(mib) || mib > 0xffffffff) {
        throw new Error(`vm memory is too large for krun backend: ${value}`);
    }
    return mib;
}
function buildRunnerConfig(config) {
    if (config.cpus < 1 || config.cpus > 255 || !Number.isInteger(config.cpus)) {
        throw new Error(`invalid vm cpu count for krun backend: ${config.cpus}`);
    }
    return {
        kernelPath: config.kernelPath,
        initrdPath: config.initrdPath,
        rootDiskPath: config.rootDiskPath,
        rootDiskFormat: config.rootDiskFormat,
        rootDiskReadOnly: config.rootDiskReadOnly ?? false,
        memoryMiB: parseMemoryToMiB(config.memory),
        cpus: config.cpus,
        virtioSocketPath: config.virtioSocketPath,
        virtioFsSocketPath: config.virtioFsSocketPath,
        virtioSshSocketPath: config.virtioSshSocketPath,
        virtioIngressSocketPath: config.virtioIngressSocketPath,
        append: config.append,
        console: config.console ?? "none",
        netSocketPath: config.netSocketPath,
        netMac: config.netMac,
    };
}
function writeRunnerConfig(config) {
    const configPath = path.resolve(os.tmpdir(), `gondolin-krun-runner-${randomUUID().slice(0, 8)}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
    return configPath;
}
//# sourceMappingURL=krun-controller.js.map