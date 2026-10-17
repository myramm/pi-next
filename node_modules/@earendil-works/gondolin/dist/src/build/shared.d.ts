import { type SpawnOptions } from "child_process";
import { type AssetManifest } from "../assets.js";
import type { BuildConfig } from "./config.js";
/** Fixed output filenames for assets */
export declare const KERNEL_FILENAME = "vmlinuz-virt";
export declare const INITRAMFS_FILENAME = "initramfs.cpio.lz4";
export declare const ROOTFS_FILENAME = "rootfs.ext4";
export declare const KRUN_KERNEL_FILENAME = "krun-kernel";
export declare const KRUN_INITRD_FILENAME = "krun-empty-initrd";
export declare const DEFAULT_ROOTFS_PACKAGES: string[];
export type ResolvedAlpineConfig = {
    version: string;
    branch?: string;
    mirror?: string;
    kernelPackage?: string;
    kernelImage?: string;
    /** libkrunfw release version (e.g. `v5.2.1`) */
    krunfwVersion: string;
    rootfsPackages: string[];
    initramfsPackages: string[];
};
export interface BuildOptions {
    /** output directory for the built assets */
    outputDir: string;
    /** base directory to resolve relative config paths against */
    configDir?: string;
    /** whether to print progress to stderr (default: true) */
    verbose?: boolean;
    /** working directory for the build (default: temp directory) */
    workDir?: string;
    /** whether to skip building sandbox helper binaries */
    skipBinaries?: boolean;
}
export interface BuildResult {
    /** output directory path */
    outputDir: string;
    /** manifest file path */
    manifestPath: string;
    /** parsed manifest */
    manifest: AssetManifest;
}
/** Detect available container runtime */
export declare function detectContainerRuntime(preferred?: "docker" | "podman"): "docker" | "podman";
/** Run a command and stream output */
export declare function runCommand(command: string, args: string[], options: SpawnOptions, log: (msg: string) => void): Promise<void>;
export declare function resolveConfigPath(value: string, configDir?: string): string;
/** Find the guest directory from the provided search roots */
export declare function findGuestDirFrom(starts: string[], env?: NodeJS.ProcessEnv): string | null;
/** Find the guest directory relative to this package */
export declare function findGuestDir(): string | null;
/** Find the host package root (directory containing package.json) */
export declare function findHostPackageRoot(): string | null;
/** Ensure `dist/` exists for container builds */
export declare function ensureHostDistBuilt(hostPkgRoot: string, log: (msg: string) => void): void;
export type SandboxBinaryPaths = {
    sandboxdPath: string;
    sandboxfsPath: string;
    sandboxsshPath: string;
    sandboxingressPath: string;
};
/** Resolve/build sandbox binaries used in image assembly */
export declare function resolveSandboxBinaryPaths(config: BuildConfig, options: BuildOptions, log: (msg: string) => void): Promise<SandboxBinaryPaths>;
/** Compute SHA256 hash of a file */
export declare function computeFileHash(filePath: string): string;
export declare function writeAssetManifest(outputDir: string, config: BuildConfig, ociSource?: {
    image: string;
    runtime: "docker" | "podman";
    platform: string;
    pullPolicy: "if-not-present" | "always" | "never";
    digest?: string;
    reference?: string;
}): {
    manifestPath: string;
    manifest: AssetManifest;
};
//# sourceMappingURL=shared.d.ts.map