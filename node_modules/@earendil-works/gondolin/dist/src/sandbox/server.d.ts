import { EventEmitter } from "events";
import { type ResolvedSandboxServerOptions, type SandboxServerOptions } from "./server-options.js";
import { SandboxServerOps } from "./server-ops.js";
type SandboxServerInternalOptions = {
    /** qemu root disk volatility mode */
    qemuRootDiskVolatileMode?: "snapshot";
};
export declare class SandboxServer extends EventEmitter {
    private emitDebug;
    private normalizeQemuHintLine;
    private recordQemuLogLine;
    private isLowValueQemuHintLine;
    private selectQemuHintLine;
    private formatQemuLogHint;
    private readonly debugFlags;
    private hasDebug;
    private readonly options;
    private readonly controller;
    private readonly bridge;
    private readonly fsBridge;
    private readonly sshBridge;
    private readonly ingressBridge;
    private readonly network;
    private readonly internalOptions;
    private tcpStreams;
    private tcpOpenWaiters;
    private nextTcpStreamId;
    private ingressTcpStreams;
    private ingressTcpOpenWaiters;
    private nextIngressTcpStreamId;
    private readonly baseAppend;
    private vfsProvider;
    private fsService;
    /** VFS requests currently executing in the host filesystem service */
    private activeVfsRequests;
    private clients;
    private inflight;
    private stdinAllowed;
    /** exec admission tokens while host-side async resume is pending */
    private pendingExecAdmissions;
    private execQueue;
    /** exec ids whose exec_request frame has been sent to sandboxd */
    private startedExecs;
    private queuedStdin;
    private queuedStdinBytes;
    /** total bytes buffered in queuedStdin across all queued exec ids in `bytes` */
    private queuedStdinBytesTotal;
    /** stdin credits available to send to sandboxd, tracked in `bytes` */
    private stdinCredits;
    private queuedPtyResize;
    private pendingExecWindows;
    private nextFileOpId;
    private activeFileOpId;
    private fileOps;
    private bridgeWritableWaiters;
    private execWindowFlushScheduled;
    private execIoFlushScheduled;
    private readonly startSingleflight;
    private readonly closeSingleflight;
    private started;
    private qemuStdoutBuffer;
    private qemuStderrBuffer;
    /** recent QEMU stderr log lines, used to enrich error messages */
    private qemuLogTail;
    private status;
    private vfsReady;
    private vfsReadyTimer;
    private bootConfig;
    /**
     * Create a SandboxServer, downloading guest assets if needed.
     *
     * This is the recommended way to create a server in production, as it will
     * automatically download the guest image if it's not available locally.
     *
     * @param options Server configuration options
     * @returns A configured SandboxServer instance
     */
    static create(options?: SandboxServerOptions): Promise<SandboxServer>;
    /**
     * Create a SandboxServer synchronously.
     *
     * This constructor requires that guest assets are available locally (either
     * in a development checkout or via GONDOLIN_GUEST_DIR). For automatic asset
     * downloading, use the async `SandboxServer.create()` factory instead.
     *
     * @param options Server configuration options (or pre-resolved options)
     */
    constructor(options?: SandboxServerOptions | ResolvedSandboxServerOptions, internalOptions?: SandboxServerInternalOptions);
}
export interface SandboxServer extends SandboxServerOps {
}
export {};
//# sourceMappingURL=server.d.ts.map