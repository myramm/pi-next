import { EventEmitter } from "events";
export type SandboxConfig = {
    /** qemu binary path */
    qemuPath: string;
    /** kernel image path */
    kernelPath: string;
    /** initrd/initramfs image path */
    initrdPath: string;
    /**
     * Root disk image path (attached as `/dev/vda`)
     *
     * If omitted, no root disk is attached.
     */
    rootDiskPath?: string;
    /** root disk image format */
    rootDiskFormat?: "raw" | "qcow2";
    /** transient root disk mode */
    rootDiskVolatileMode?: "snapshot";
    /** qemu readonly mode for the root disk */
    rootDiskReadOnly?: boolean;
    /** vm memory size (qemu syntax, e.g. "1G") */
    memory: string;
    /** vm cpu count */
    cpus: number;
    /** virtio-serial control socket path */
    virtioSocketPath: string;
    /** virtiofs/vfs socket path */
    virtioFsSocketPath: string;
    /** virtio-serial ssh socket path */
    virtioSshSocketPath: string;
    /** virtio-serial ingress socket path */
    virtioIngressSocketPath: string;
    /** kernel cmdline append string */
    append: string;
    /** qemu machine type */
    machineType?: string;
    /** qemu acceleration backend (e.g. kvm, hvf) */
    accel?: string;
    /** qemu cpu model */
    cpu?: string;
    /** guest console mode */
    console?: "stdio" | "none";
    /** qemu net socket path */
    netSocketPath?: string;
    /** guest mac address */
    netMac?: string;
    /** qemu monitor socket path */
    qmpSocketPath?: string;
    /** qemu idle pause timeout in `ms` */
    qemuIdlePauseMs?: number;
    /** whether to restart the vm automatically on exit */
    autoRestart: boolean;
};
export type SandboxState = "starting" | "running" | "stopped";
export type SandboxLogStream = "stdout" | "stderr";
export declare class SandboxController extends EventEmitter {
    private child;
    private state;
    private restartTimer;
    private idleTimer;
    private manualStop;
    private paused;
    private pauseInProgress;
    private qmpIdleDisabled;
    private qmpChain;
    private qmpGeneration;
    private readonly config;
    private readonly qmpSocketPath;
    private readonly idlePauseMs;
    constructor(config: SandboxConfig);
    setAppend(append: string): void;
    getState(): SandboxState;
    getHostPid(): number | null;
    start(): Promise<void>;
    close(): Promise<void>;
    resumeForActivity(): Promise<void> | void;
    private resumeForActivityAsync;
    scheduleIdlePause(): void;
    cancelIdlePause(): void;
    private pauseForIdle;
    private isCurrentQmpGeneration;
    private queryQmpRunning;
    private runQmpCommand;
    private cleanupQmpSocket;
    restart(): Promise<void>;
    private scheduleRestart;
    private setState;
}
//# sourceMappingURL=controller.d.ts.map