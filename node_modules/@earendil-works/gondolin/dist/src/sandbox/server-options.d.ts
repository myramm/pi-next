import fs from "fs";
import { type DebugConfig, type DebugFlag } from "../debug.js";
import { type GuestAssets } from "../assets.js";
import { type DnsOptions, type HttpFetch, type HttpHooks } from "../qemu/net.js";
import type { SshOptions } from "../qemu/ssh.js";
import type { TcpOptions } from "../qemu/tcp.js";
import type { VirtualProvider } from "../vfs/node/index.js";
/**
 * Path or selector for guest image assets
 *
 * Can be either:
 * - A string path to a directory containing the assets (vmlinuz-virt, initramfs.cpio.lz4, rootfs.ext4)
 * - A string image selector (ref like `name:tag` or a build id)
 * - An object with explicit paths to each asset file
 */
export type ImagePath = string | GuestAssets;
/** vm backend implementation */
export type SandboxVmm = "qemu" | "krun";
/**
 * sandbox server options
 *
 * imagePath can be either:
 * - a directory containing the guest assets (kernel/initrd/rootfs)
 * - an object with explicit asset paths
 */
export type SandboxServerOptions = {
    /** vm backend implementation */
    vmm?: SandboxVmm;
    /** qemu binary path */
    qemuPath?: string;
    /** krun runner binary path */
    krunRunnerPath?: string;
    /** guest asset directory or explicit asset paths */
    imagePath?: ImagePath;
    /** vm memory size (qemu syntax, e.g. "1G") */
    memory?: string;
    /** vm cpu count */
    cpus?: number;
    /** virtio-serial control socket path */
    virtioSocketPath?: string;
    /** virtiofs/vfs socket path */
    virtioFsSocketPath?: string;
    /** virtio-serial ssh socket path */
    virtioSshSocketPath?: string;
    /** virtio-serial ingress socket path */
    virtioIngressSocketPath?: string;
    /** qemu net socket path */
    netSocketPath?: string;
    /** guest mac address */
    netMac?: string;
    /** whether to enable networking */
    netEnabled?: boolean;
    /** whether to allow WebSocket upgrades for guest egress (default: true) */
    allowWebSockets?: boolean;
    /**
     * Root disk image path (attached as `/dev/vda`)
     *
     * If omitted, uses the base rootfs image from the guest assets.
     */
    rootDiskPath?: string;
    /** root disk image format */
    rootDiskFormat?: "raw" | "qcow2";
    /** qemu readonly mode for the root disk */
    rootDiskReadOnly?: boolean;
    /**
     * Delete the root disk image on VM close
     *
     * This is a host-side lifecycle hint. It is currently only honored by the
     * higher-level {@link VM} wrapper.
     */
    rootDiskDeleteOnClose?: boolean;
    /**
     * Debug configuration
     *
     * - `true`: enable all debug components
     * - `false`: disable all debug components
     * - `string[]`: enable selected components (e.g. `["net", "exec"]`)
     *
     * If omitted, defaults to `GONDOLIN_DEBUG`.
     */
    debug?: DebugConfig;
    /** qemu machine type */
    machineType?: string;
    /** qemu acceleration backend (e.g. kvm, hvf) */
    accel?: string;
    /** qemu cpu model */
    cpu?: string;
    /** guest console mode */
    console?: "stdio" | "none";
    /** whether to restart the vm automatically on exit */
    autoRestart?: boolean;
    /** qemu idle pause timeout in `ms` (`0` disables) */
    qemuIdlePauseMs?: number;
    /** kernel cmdline append string */
    append?: string;
    /** max stdin buffered per process in `bytes` */
    maxStdinBytes?: number;
    /** max stdin buffered for a single queued (not yet active) exec in `bytes` */
    maxQueuedStdinBytes?: number;
    /** max total stdin buffered across all queued (not yet active) execs in `bytes` */
    maxTotalQueuedStdinBytes?: number;
    /** max total exec pressure (running + queued-to-start) */
    maxQueuedExecs?: number;
    /** http fetch implementation for asset downloads */
    fetch?: HttpFetch;
    /** http interception hooks */
    httpHooks?: HttpHooks;
    /** dns configuration */
    dns?: DnsOptions;
    /** ssh egress configuration */
    ssh?: SshOptions;
    /** explicit host-mapped tcp egress configuration */
    tcp?: TcpOptions;
    /** max intercepted http request body size in `bytes` */
    maxHttpBodyBytes?: number;
    /** max buffered upstream http response body size in `bytes` */
    maxHttpResponseBodyBytes?: number;
    /** mitm ca directory path */
    mitmCertDir?: string;
    /** vfs provider to expose under the fuse mount */
    vfsProvider?: VirtualProvider;
};
export type ResolvedSandboxServerOptions = {
    /** vm backend implementation */
    vmm: SandboxVmm;
    /** qemu binary path */
    qemuPath: string;
    /** krun runner binary path */
    krunRunnerPath: string;
    /** kernel image path */
    kernelPath: string;
    /** initrd/initramfs image path */
    initrdPath: string;
    /** rootfs image path */
    rootfsPath: string;
    /** root disk image path (attached as `/dev/vda`) */
    rootDiskPath: string;
    /** root disk image format */
    rootDiskFormat: "raw" | "qcow2";
    /** qemu readonly mode for the root disk */
    rootDiskReadOnly: boolean;
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
    /** qemu net socket path */
    netSocketPath: string;
    /** guest mac address */
    netMac: string;
    /** whether networking is enabled */
    netEnabled: boolean;
    /** whether to allow WebSocket upgrades for guest egress */
    allowWebSockets: boolean;
    /** enabled debug components */
    debug: DebugFlag[];
    /** qemu machine type */
    machineType?: string;
    /** qemu acceleration backend (e.g. kvm, hvf) */
    accel?: string;
    /** qemu cpu model */
    cpu?: string;
    /** guest console mode */
    console?: "stdio" | "none";
    /** whether to restart the vm automatically on exit */
    autoRestart: boolean;
    /** qemu idle pause timeout in `ms` (`undefined` disables) */
    qemuIdlePauseMs?: number;
    /** kernel cmdline append string */
    append?: string;
    /** max stdin buffered per process in `bytes` */
    maxStdinBytes: number;
    /** max stdin buffered for a single queued (not yet active) exec in `bytes` */
    maxQueuedStdinBytes: number;
    /** max total stdin buffered across all queued (not yet active) execs in `bytes` */
    maxTotalQueuedStdinBytes: number;
    /** max total exec pressure (running + queued-to-start) */
    maxQueuedExecs: number;
    /** max intercepted http request body size in `bytes` */
    maxHttpBodyBytes: number;
    /** max buffered upstream http response body size in `bytes` */
    maxHttpResponseBodyBytes: number;
    /** http fetch implementation for asset downloads */
    fetch?: HttpFetch;
    /** http interception hooks */
    httpHooks?: HttpHooks;
    /** dns configuration */
    dns?: DnsOptions;
    /** ssh egress configuration */
    ssh?: SshOptions;
    /** explicit host-mapped tcp egress configuration */
    tcp?: TcpOptions;
    /** mitm ca directory path */
    mitmCertDir?: string;
    /** vfs provider to expose under the fuse mount */
    vfsProvider: VirtualProvider | null;
};
export type GuestFileReadOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** preferred chunk size in `bytes` */
    chunkSize?: number;
    /** abort signal for the read request */
    signal?: AbortSignal;
    /** stream highWaterMark in `bytes` */
    highWaterMark?: number;
};
export type GuestFileWriteOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the write request */
    signal?: AbortSignal;
};
export type GuestFileDeleteOptions = {
    /** ignore missing paths */
    force?: boolean;
    /** recursive delete for directories */
    recursive?: boolean;
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the delete request */
    signal?: AbortSignal;
};
type ResolvePackagedKrunRunnerPathDeps = {
    platform?: NodeJS.Platform;
    arch?: NodeJS.Architecture;
    resolvePackageJson?: (specifier: string) => string;
    readFileSync?: typeof fs.readFileSync;
    existsSync?: typeof fs.existsSync;
    probeRunner?: (candidatePath: string) => boolean;
};
declare function probeKrunRunnerCandidate(candidatePath: string): boolean;
declare function resolvePackagedKrunRunnerPath(deps?: ResolvePackagedKrunRunnerPathDeps): string | null;
type ResolveDefaultKrunRunnerPathDeps = {
    envPath?: string;
    resolveLocalPath?: () => string | null;
    resolvePackagedPath?: () => string | null;
};
declare function resolveDefaultKrunRunnerPath(deps?: ResolveDefaultKrunRunnerPathDeps): string;
/**
 * Resolve server options synchronously.
 *
 * This version uses local development paths if available. For production use,
 * prefer `resolveSandboxServerOptionsAsync` which will download assets if needed.
 *
 * @param options User-provided options
 * @param assets Optional pre-resolved guest assets (from ensureGuestAssets)
 */
type ResolveSandboxServerOptionsDeps = {
    /** test-only override for default krun runner resolution */
    resolveDefaultKrunRunnerPath?: () => string;
};
export declare function resolveSandboxServerOptions(options?: SandboxServerOptions, assets?: GuestAssets, deps?: ResolveSandboxServerOptionsDeps): ResolvedSandboxServerOptions;
/**
 * Resolve server options asynchronously, downloading guest assets if needed.
 *
 * This is the recommended way to get resolved options for production use.
 */
export declare function resolveSandboxServerOptionsAsync(options?: SandboxServerOptions): Promise<ResolvedSandboxServerOptions>;
export declare const __test: {
    probeKrunRunnerCandidate: typeof probeKrunRunnerCandidate;
    resolvePackagedKrunRunnerPath: typeof resolvePackagedKrunRunnerPath;
    resolveDefaultKrunRunnerPath: typeof resolveDefaultKrunRunnerPath;
};
export {};
//# sourceMappingURL=server-options.d.ts.map