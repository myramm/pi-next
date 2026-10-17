import type { RootfsOwnershipEntry } from "./types.js";
export declare class DownloadFileError extends Error {
    /** requested download URL */
    readonly url: string;
    /** upstream HTTP status code when available */
    readonly status?: number;
    constructor(url: string, options?: {
        status?: number;
        message?: string;
        cause?: unknown;
    });
}
/** Download helper using Node's built-in fetch */
export declare function downloadFile(url: string, dest: string): Promise<void>;
export declare function copyExecutable(src: string, dest: string, rootDir?: string): void;
export declare function writeExecutable(dest: string, content: string, rootDir?: string): void;
export declare function injectBeforeSandboxdExec(script: string, snippet: string): string;
export declare function generateImageEnvScript(env: Record<string, string> | string[]): string | null;
/** Find mke2fs / mkfs.ext4 binary */
export declare function findMke2fs(): string;
/** Create an ext4 rootfs image from a directory tree */
export declare function createRootfsImage(mkfsCmd: string, imagePath: string, sourceDir: string, label: string, fixedSizeMb?: number, ownershipEntries?: RootfsOwnershipEntry[]): void;
/** Create a compressed initramfs from a directory tree */
export declare function createInitramfs(sourceDir: string, outputPath: string): void;
//# sourceMappingURL=utils.d.ts.map