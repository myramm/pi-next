// Host manager (Node only): runs a child host process and keeps at most one instance of it alive.
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { unlinkSync } from "node:fs";
import { lstat, mkdir, rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChordError } from "./errors.js";
import { ipcLink } from "./link.js";
/**
 * A process lock owned by the kernel for the holder's lifetime: an abstract socket (Linux, Android) or a named pipe
 * (Windows) vanishes with its process, so there is no stale state to take over and no race between two would-be
 * owners. Other platforms need a socket file, removed on exit; a leftover one nobody accepts on is taken over.
 * The child acquires it (before opening storage), so the lock follows the process that owns the data.
 */
export async function processLock(name) {
    const key = createHash("sha256").update(name).digest("hex").slice(0, 32);
    const file = process.platform !== "win32" && process.platform !== "linux" && process.platform !== "android";
    const address = process.platform === "win32"
        ? `\\\\.\\pipe\\chord2-${key}`
        : file
            ? await lockSocketPath(`chord2-${key}.sock`)
            : `\0chord2-${key}`;
    const server = createServer((socket) => socket.end());
    for (;;) {
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(address, () => {
                    server.removeListener("error", reject);
                    resolve();
                });
            });
            break;
        }
        catch (error) {
            if (error.code !== "EADDRINUSE")
                throw error;
            if (!file || (await accepting(address))) {
                throw new ChordError("unavailable", `lock ${name} is held by another process`, { reason: "locked" });
            }
            await rm(address, { force: true });
        }
    }
    const removeFile = () => {
        try {
            unlinkSync(address);
        }
        catch {
            // Already gone.
        }
    };
    if (file)
        process.once("exit", removeFile);
    return () => new Promise((resolve, reject) => {
        if (file)
            process.removeListener("exit", removeFile);
        server.close((error) => (error ? reject(error) : resolve()));
    });
}
/** sun_path references 104 bytes on macOS and the BSDs, including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 103;
/**
 * The lock socket's path: in the temporary directory, or, when that path does not fit in sun_path (a deep TMPDIR,
 * such as a test runner's below macOS's per-user one), in a private per-user directory under /tmp. Other users must
 * not be able to create or remove sockets there, so the directory has to be ours and closed to everyone else.
 */
async function lockSocketPath(file) {
    const preferred = join(tmpdir(), file);
    if (Buffer.byteLength(preferred) <= MAX_SOCKET_PATH_BYTES)
        return preferred;
    const uid = process.getuid?.() ?? 0;
    const directory = `/tmp/chord2-${uid}`;
    await mkdir(directory, { mode: 0o700, recursive: true });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.uid !== uid || (stats.mode & 0o077) !== 0) {
        throw new ChordError("unavailable", `lock directory ${directory} must be a directory only its owner can access`);
    }
    return join(directory, file);
}
function accepting(address) {
    return new Promise((resolve) => {
        const socket = connect(address);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", (error) => resolve(error.code !== "ECONNREFUSED" && error.code !== "ENOENT"));
    });
}
const LOCK_ENV = "CHORD2_LOCK";
/** A control message to a peer process that is gone: dropped (its exit or `disconnect` is reported separately). */
const ignoreSendError = () => { };
export function forkDriver(options) {
    return {
        spawn() {
            // A lock this process inherited (e.g. as a child host itself) is not the child's: it gets only its own.
            const env = { ...process.env };
            delete env[LOCK_ENV];
            Object.assign(env, options.env);
            if (options.lock !== undefined)
                env[LOCK_ENV] = options.lock;
            // Detached: the child leads a process group, so the whole tree can be killed.
            const child = fork(options.entry, [...(options.args ?? [])], {
                env,
                execArgv: [...(options.execArgv ?? [])],
                detached: true,
                stdio: ["ignore", options.onOutput ? "pipe" : "inherit", options.onOutput ? "pipe" : "inherit", "ipc"],
            });
            if (options.onOutput) {
                for (const stream of ["stdout", "stderr"]) {
                    child[stream]?.on("data", (chunk) => {
                        options.onOutput(stream, chunk);
                        process[stream].write(chunk);
                    });
                }
            }
            const pid = child.pid ?? -1;
            const killGroup = () => {
                try {
                    process.kill(-pid, "SIGKILL");
                }
                catch {
                    // No group left.
                }
            };
            const exited = new Promise((resolve) => {
                child.once("exit", (code, signal) => {
                    // However the leader ended (graceful, crash, kill), nothing it spawned outlives it.
                    killGroup();
                    resolve({ code, signal });
                });
            });
            const listeners = new Set();
            child.on("message", (message) => {
                options.onMessage?.(message);
                const control = message?.chord2control;
                if (control !== undefined)
                    for (const listener of listeners)
                        listener(control);
            });
            const send = (message) => {
                // A child that exited before the channel reported it fails the write (EPIPE): its exit is what counts.
                if (child.connected)
                    child.send({ chord2control: message }, ignoreSendError);
            };
            if (options.init !== undefined)
                send({ type: "init", value: options.init });
            return {
                pid,
                link: ipcLink(child),
                exited,
                send,
                killTree: () => {
                    try {
                        process.kill(-pid, "SIGKILL");
                    }
                    catch {
                        child.kill("SIGKILL");
                    }
                },
                onControl: (listener) => listeners.add(listener),
            };
        },
    };
}
export function createHostManager(options) {
    let status = "stopped";
    let instance;
    let queue = Promise.resolve();
    let report = { activeCalls: 0, viewers: 0, durableTasks: 0 };
    /** When the child last became idle; undefined while it reports work. */
    let idleSince;
    let booting = false;
    let timer;
    const serialized = (step) => {
        const next = queue.then(step, step);
        queue = next.catch(() => { });
        return next;
    };
    const liveness = () => ({
        booting,
        ...report,
        idleFor: idleSince === undefined ? 0 : Date.now() - idleSince,
    });
    const doStop = async () => {
        const current = instance;
        if (current === undefined) {
            status = "stopped";
            booting = false;
            return;
        }
        status = "stopping";
        if (timer !== undefined)
            clearInterval(timer);
        current.send({ type: "shutdown" });
        let graceTimer;
        const graceful = await Promise.race([
            current.exited.then(() => true),
            new Promise((resolve) => {
                graceTimer = setTimeout(() => resolve(false), options.grace ?? 5000);
            }),
        ]);
        clearTimeout(graceTimer);
        if (!graceful)
            current.killTree();
        await current.exited;
        if (instance === current)
            instance = undefined;
        status = "stopped";
    };
    const doStart = async () => {
        if (instance !== undefined && status === "running")
            return instance;
        status = "starting";
        booting = true;
        report = { activeCalls: 0, viewers: 0, durableTasks: 0 };
        let current;
        try {
            current = options.driver.spawn();
        }
        catch (error) {
            status = "stopped";
            booting = false;
            throw error;
        }
        instance = current;
        current.exited.then((exit) => {
            if (instance === current) {
                instance = undefined;
                status = "stopped";
                if (timer !== undefined)
                    clearInterval(timer);
            }
            options.onExit?.(exit);
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new ChordError("unavailable", "child not ready in time")), options.readyTimeout ?? 30_000);
            const settle = (fn) => {
                clearTimeout(timeout);
                fn();
            };
            current.exited.then((exit) => settle(() => reject(new ChordError("unavailable", `child exited before ready (${exit.code ?? exit.signal})`))));
            current.onControl((message) => {
                if (message.type === "ready")
                    settle(resolve);
                else if (message.type === "fatal")
                    settle(() => reject(new ChordError("unavailable", `child failed: ${message.message}`, { reason: message.reason })));
                else if (message.type === "status") {
                    report = {
                        activeCalls: message.activeCalls ?? 0,
                        viewers: message.viewers ?? 0,
                        durableTasks: message.durableTasks ?? 0,
                    };
                    // The idle clock starts at the busy → idle transition, not at the last busy report.
                    if (report.activeCalls + report.viewers + report.durableTasks > 0)
                        idleSince = undefined;
                    else
                        idleSince ??= Date.now();
                }
            });
        }).catch(async (error) => {
            current.killTree();
            await current.exited;
            throw error;
        });
        booting = false;
        if (report.activeCalls + report.viewers + report.durableTasks === 0)
            idleSince ??= Date.now();
        status = "running";
        if (options.keepAlive !== undefined) {
            const keepAlive = options.keepAlive;
            timer = setInterval(() => {
                if (status === "running" && !keepAlive(liveness()))
                    void serialized(doStop);
            }, options.checkInterval ?? 1000);
            timer.unref?.();
        }
        return current;
    };
    return {
        get status() {
            return status;
        },
        get instance() {
            return instance;
        },
        get liveness() {
            return liveness();
        },
        start: () => serialized(doStart),
        stop: () => serialized(doStop),
        replace: () => serialized(async () => {
            await doStop();
            return doStart();
        }),
    };
}
/** The child side of the control channel (call in the child's entry). */
export function childControl(channel = process) {
    const send = (message) => {
        // A parent that is gone fails the write (EPIPE); the `disconnect` that follows is how a child notices.
        if (channel.connected)
            channel.send?.({ chord2control: message }, undefined, undefined, ignoreSendError);
    };
    let resolveInit = () => { };
    const init = new Promise((resolve) => {
        resolveInit = resolve;
    });
    const shutdown = new Set();
    channel.on("message", (message) => {
        const control = message?.chord2control;
        if (control?.type === "init")
            resolveInit(control.value);
        if (control?.type === "shutdown")
            for (const handler of shutdown)
                void handler();
    });
    const fatal = (error) => send({
        type: "fatal",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ChordError && error.reason !== undefined ? { reason: error.reason } : {}),
    });
    return {
        init,
        lock: async () => {
            const name = process.env[LOCK_ENV];
            if (name === undefined)
                return;
            try {
                await processLock(name);
            }
            catch (error) {
                fatal(error);
                throw error;
            }
        },
        ready: () => send({ type: "ready" }),
        fatal,
        report: (status) => send({ type: "status", ...status }),
        onShutdown: (handler) => shutdown.add(handler),
    };
}
//# sourceMappingURL=manager.js.map