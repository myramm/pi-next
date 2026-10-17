import { type IpcLink } from "./link.ts";
/** Control messages share the IPC channel with chord frames: `{ chord2control: message }`. */
export type ControlMessage = {
    readonly type: "init";
    readonly value: unknown;
} | {
    readonly type: "ready";
} | {
    readonly type: "fatal";
    readonly message: string;
    readonly reason?: string;
} | {
    readonly type: "shutdown";
} | {
    readonly type: "status";
    readonly activeCalls?: number;
    readonly viewers?: number;
    readonly durableTasks?: number;
};
export interface Liveness {
    /** Started but not ready yet. */
    readonly booting: boolean;
    readonly activeCalls: number;
    /** Viewers the child reports (it counts heartbeating subscribers). */
    readonly viewers: number;
    readonly durableTasks: number;
    /** Milliseconds since the child last reported work (calls, viewers or tasks), or since it became ready. */
    readonly idleFor: number;
}
export interface Exit {
    readonly code: number | null;
    readonly signal: string | null;
}
/** A running child: its link (for `host.accept`) and its exit. */
export interface Instance {
    readonly pid: number;
    readonly link: IpcLink;
    readonly exited: Promise<Exit>;
    send(message: ControlMessage): void;
    /** Kills the child and everything it spawned. */
    killTree(): void;
    onControl(listener: (message: ControlMessage) => void): void;
}
export interface Driver {
    spawn(): Instance;
}
export interface ForkDriverOptions {
    /** The child's entry module. */
    readonly entry: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    /** Node flags for the child, e.g. `["--import", sourceResolver]` (default: none). */
    readonly execArgv?: readonly string[];
    /** Sent to the child as its first control message (`childControl().init`). */
    readonly init?: unknown;
    /**
     * A lock name: one live process per name, across managers and processes. The child acquires it as a kernel lock
     * (`childControl().lock()`, before opening its storage); a second child fails to start with `unavailable/locked`.
     */
    readonly lock?: string;
    /** Optional stdout/stderr tap. Streams are still mirrored to the parent's standard output. */
    readonly onOutput?: (stream: "stdout" | "stderr", chunk: Uint8Array) => void;
    /** Optional application metadata tap; control messages and chord frames keep their normal handling. */
    readonly onMessage?: (message: unknown) => void;
}
/**
 * A process lock owned by the kernel for the holder's lifetime: an abstract socket (Linux, Android) or a named pipe
 * (Windows) vanishes with its process, so there is no stale state to take over and no race between two would-be
 * owners. Other platforms need a socket file, removed on exit; a leftover one nobody accepts on is taken over.
 * The child acquires it (before opening storage), so the lock follows the process that owns the data.
 */
export declare function processLock(name: string): Promise<() => Promise<void>>;
export declare function forkDriver(options: ForkDriverOptions): Driver;
export interface HostManagerOptions {
    readonly driver: Driver;
    /** Evaluated every `checkInterval` while running; `false` stops the child. */
    readonly keepAlive?: (liveness: Liveness) => boolean;
    readonly checkInterval?: number;
    /** Milliseconds a child may take to shut down before its process tree is killed (default 5000). */
    readonly grace?: number;
    /** Milliseconds to wait for `ready` (default 30000). */
    readonly readyTimeout?: number;
    /** The child exited on its own (crash, fatal) or after a stop. */
    readonly onExit?: (exit: Exit) => void;
}
export interface HostManager {
    readonly status: "stopped" | "starting" | "running" | "stopping";
    readonly instance: Instance | undefined;
    readonly liveness: Liveness;
    /** Starts the child (or returns the running one) once it reported ready. Serialized with stop/replace. */
    start(): Promise<Instance>;
    /** Asks the child to shut down, then kills its process tree after the grace period. */
    stop(): Promise<void>;
    /** Stop, wait for the exit, start. */
    replace(): Promise<Instance>;
}
export declare function createHostManager(options: HostManagerOptions): HostManager;
/** The child side of the control channel (call in the child's entry). */
export declare function childControl(channel?: NodeJS.Process): {
    readonly init: Promise<unknown>;
    /**
     * Acquires the manager's lock (if one was configured) as a kernel lock held for this process's lifetime. Call it
     * before opening storage. Fails with `unavailable/locked`, also reported to the manager as a fatal start error.
     */
    lock(): Promise<void>;
    ready(): void;
    fatal(error: unknown): void;
    report(status: {
        activeCalls?: number;
        viewers?: number;
        durableTasks?: number;
    }): void;
    onShutdown(handler: () => void | Promise<void>): void;
};
//# sourceMappingURL=manager.d.ts.map