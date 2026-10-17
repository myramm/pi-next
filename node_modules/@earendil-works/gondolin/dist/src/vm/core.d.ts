import { VmCheckpoint } from "../checkpoint.js";
import { type ResolvedSandboxServerOptions } from "../sandbox/server-options.js";
import type { SandboxState } from "../sandbox/controller.js";
import type { EnvInput, VMOptions } from "./types.js";
import { type DebugLogFn } from "../debug.js";
import { type EnableIngressOptions, type IngressAccess, type IngressRoute } from "../ingress.js";
import { type VmFs } from "./fs.js";
import { ExecProcess, type ExecOptions } from "../exec.js";
type ExecInput = string | string[];
export type { VmFs, VmFsAccessOptions, VmFsMkdirOptions, VmFsListDirOptions, VmFsStatOptions, VmFsRenameOptions, VmFsStat, VmFsReadFileOptions, VmFsReadFileBufferOptions, VmFsReadFileTextOptions, VmFsReadFileStreamOptions, VmFsWriteFileInput, VmFsWriteFileOptions, VmFsDeleteOptions, } from "./fs.js";
export type { VMOptions, VmRootfsOptions, VmVfsOptions } from "./types.js";
export type ShellOptions = {
    /** command to run (default: /bin/bash) */
    command?: string | string[];
    /** environment variables */
    env?: EnvInput;
    /** working directory */
    cwd?: string;
    /** abort signal */
    signal?: AbortSignal;
    /** whether to attach to stdin/stdout/stderr (default: true in a tty) */
    attach?: boolean;
};
export type EnableSshOptions = {
    /** ssh username (default: "root") */
    user?: string;
    /** local listen host (default: 127.0.0.1) */
    listenHost?: string;
    /** local listen port (0 picks an ephemeral port) */
    listenPort?: number;
};
export type SshAccess = {
    /** local host to connect to */
    host: string;
    /** local port to connect to */
    port: number;
    /** ssh username */
    user: string;
    /** path to a temporary private key file */
    identityFile: string;
    /** ready-to-run ssh command */
    command: string;
    /** close the local forwarder and remove temporary key material */
    close(): Promise<void>;
};
export type VMState = SandboxState | "unknown";
export declare class VM {
    /**
     * Replace the debug log callback.
     *
     * Passing `null` disables debug output.
     */
    setDebugLog(callback: DebugLogFn | null): void;
    /** vm session identifier */
    readonly id: string;
    /** guest filesystem operations */
    readonly fs: VmFs;
    private readonly autoStart;
    private readonly startTimeoutMs;
    private readonly sessionLabel;
    private server;
    private readonly resolvedSandboxOptions;
    private rootDisk;
    private checkpointed;
    private readonly baseOptionsForClone;
    private readonly defaultEnv;
    private connection;
    private connectPromise;
    private readonly startSingleflight;
    private readonly closeSingleflight;
    private startupGeneration;
    private statusPromise;
    private statusResolve;
    private statusReject;
    private state;
    private stateWaiters;
    private sessions;
    private nextId;
    private vfs;
    private readonly fuseMount;
    private readonly fuseBinds;
    private readonly shortcutBindMounts;
    private bootSent;
    private vfsReadyPromise;
    private rootfsGuestResizePending;
    private rootfsGuestResizeDone;
    private vmmChecked;
    private debugLog;
    private debugListener;
    private sshAccess;
    private gondolinEtc;
    private ingressAccess;
    private sessionIpc;
    /**
     * Create a VM instance, downloading guest assets if needed.
     *
     * This is the recommended way to create a VM in production, as it will
     * automatically download the guest image if it's not available locally.
     *
     * @param options VM configuration options
     * @returns A configured VM instance
     */
    static create(options?: VMOptions): Promise<VM>;
    /**
     * Create a VM instance synchronously.
     *
     * This constructor requires that guest assets are available locally (either
     * in a development checkout or via GONDOLIN_GUEST_DIR). For automatic asset
     * downloading, use the async `VM.create()` factory instead.
     *
     * @param options VM configuration options
     * @param resolvedSandboxOptions Optional pre-resolved sandbox options (from VM.create())
     */
    constructor(options?: VMOptions, resolvedSandboxOptions?: ResolvedSandboxServerOptions);
    /**
     * Start the VM.
     *
     * If VFS is configured, this also waits for the VFS mount(s) to be ready.
     */
    start(): Promise<void>;
    /**
     * Close the VM and release associated resources.
     */
    close(): Promise<void>;
    /**
     * Return the host PID of the active VM runner process, or null when no runner is active.
     */
    getHostPid(): number | null;
    /**
     * Execute a command in the sandbox.
     *
     * Returns an ExecProcess which can be:
     * - awaited for a buffered result with strings
     * - iterated for streaming output (requires stdout: "pipe")
     * - used with stdin via write()/end()
     *
     * @example
     * ```typescript
     * // String form runs via `/bin/sh -lc "..."`
     * const r1 = await vm.exec("echo hello");
     * console.log(r1.stdout); // 'hello\n'
     *
     * // Array form executes an executable directly (does not search `$PATH`)
     * const r2 = await vm.exec(["/bin/echo", "hello"]);
     * console.log(r2.stdout); // 'hello\n'
     *
     * // Streaming output (piped stdout)
     * for await (const line of vm.exec(["/bin/tail", "-f", "/var/log/syslog"], { stdout: "pipe" })) {
     *   console.log(line);
     * }
     *
     * // Interactive with stdin
     * const proc = vm.exec(["/bin/cat"], { stdin: true });
     * proc.write("hello\n");
     * proc.end();
     * const result = await proc;
     * ```
     */
    exec(command: ExecInput, options?: ExecOptions): ExecProcess;
    /**
     * Start an interactive shell session.
     *
     * By default, attaches to process.stdin/stdout/stderr when running in a TTY.
     *
     * @example
     * ```typescript
     * // Simple interactive shell
     * const result = await vm.shell();
     * process.exit(result.exitCode);
     *
     * // Custom command (absolute path required)
     * const result = await vm.shell({ command: "/bin/sh" });
     *
     * // Manual control
     * const proc = vm.shell({ attach: false });
     * proc.write('ls\n');
     * for await (const chunk of proc) {
     *   process.stdout.write(chunk);
     * }
     * ```
     */
    shell(options?: ShellOptions): ExecProcess;
    /**
     * Enable SSH access to the VM by starting `sshd` in the guest (bound to loopback)
     * and creating a host-local TCP forwarder.
     */
    enableSsh(options?: EnableSshOptions): Promise<SshAccess>;
    /**
     * Get the current ingress routes (parsed from /etc/gondolin/listeners).
     */
    getIngressRoutes(): IngressRoute[];
    /**
     * Replace ingress routes and write the canonical /etc/gondolin/listeners file.
     */
    setIngressRoutes(routes: IngressRoute[]): void;
    /**
     * Enable the host-side ingress gateway.
     *
     * The gateway listens on a single host port and routes requests to guest-local
     * HTTP servers as configured by /etc/gondolin/listeners.
     */
    enableIngress(options?: EnableIngressOptions): Promise<IngressAccess>;
    private execInternal;
    private startExec;
    private ensureVmmAvailable;
    private beginStartupGeneration;
    private invalidateStartupGeneration;
    private ensureStartupGeneration;
    private startInternal;
    private withStartTimeout;
    private ensureSessionIpc;
    private cleanupRootDiskSync;
    private closeInternal;
    private allocateId;
    private pipeStdin;
    private markSessionReady;
    private sendStdinData;
    private sendStdinEof;
    private sendStdinDataNow;
    private sendStdinEofNow;
    private sendPtyResize;
    private sendPtyResizeNow;
    private ensureConnection;
    private resetConnectionState;
    private initStatusPromise;
    private ensureBoot;
    private ensureRunning;
    private ensureRootfsResized;
    private ensureVfsReady;
    private waitForVfsReadyInternal;
    private waitForMount;
    private waitForBindMount;
    private waitForPath;
    private execInternalNoVfsWait;
    private waitForStatus;
    private waitForState;
    private handleMessage;
    private updateState;
    private handleExecResponse;
    private handleError;
    private rejectAll;
    private handleDisconnect;
    private disconnect;
    /**
     * Create a disk-only checkpoint of the VM root disk.
     *
     * This stops the VM and materializes its writable qcow2 overlay at
     * `checkpointPath`.
     *
     * The checkpoint metadata is stored as a JSON trailer appended to the qcow2
     * file so the checkpoint is a single file.
     */
    checkpoint(checkpointPath: string): Promise<VmCheckpoint>;
    private checkpointInternal;
    private sendJson;
}
//# sourceMappingURL=core.d.ts.map