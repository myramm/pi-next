import type { BuildConfig } from "./config.js";
import { type BuildOptions, type BuildResult } from "./shared.js";
/** Build assets natively (Linux or macOS with appropriate tools) */
export declare function buildNative(config: BuildConfig, options: BuildOptions, workDir: string, log: (msg: string) => void): Promise<BuildResult>;
type KrunArchive = {
    archivePath: string;
    kind: "prebuilt" | "shared";
};
type DownloadFileFn = (url: string, dest: string) => Promise<void>;
declare function downloadKrunArchive(krunfwVersion: string, archName: "aarch64" | "x86_64", cacheDir: string, log: (msg: string) => void, download?: DownloadFileFn): Promise<KrunArchive>;
declare function extractKernelBundleFromCSource(source: string): Buffer;
declare function extractKernelBundleFromSharedLibraryBytes(bytes: Buffer, archName: "aarch64" | "x86_64"): Buffer;
export declare const __test: {
    downloadKrunArchive: typeof downloadKrunArchive;
    extractKernelBundleFromCSource: typeof extractKernelBundleFromCSource;
    extractKernelBundleFromSharedLibraryBytes: typeof extractKernelBundleFromSharedLibraryBytes;
};
export {};
//# sourceMappingURL=native.d.ts.map