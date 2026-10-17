import { EventEmitter } from "events";
import type { SandboxState } from "./controller.js";
export declare function assertMacHypervisorEntitlement(executable: string): void;
export type KrunConfig = {
    /** krun runner binary path */
    krunRunnerPath: string;
    /** kernel image path */
    kernelPath: string;
    /** initrd/initramfs image path */
    initrdPath: string;
    /** root disk image path */
    rootDiskPath?: string;
    /** root disk image format */
    rootDiskFormat?: "raw" | "qcow2";
    /** readonly mode for the root disk */
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
    /** guest console mode */
    console?: "stdio" | "none";
    /** qemu net socket path */
    netSocketPath?: string;
    /** guest mac address */
    netMac?: string;
    /** whether to restart the vm automatically on exit */
    autoRestart: boolean;
};
export declare class KrunController extends EventEmitter {
    private child;
    private state;
    private restartTimer;
    private manualStop;
    private readonly config;
    private activeConfigPath;
    constructor(config: KrunConfig);
    setAppend(append: string): void;
    getState(): SandboxState;
    getHostPid(): number | null;
    start(): Promise<void>;
    close(): Promise<void>;
    restart(): Promise<void>;
    private scheduleRestart;
    private setState;
    private cleanupActiveConfig;
}
//# sourceMappingURL=krun-controller.d.ts.map