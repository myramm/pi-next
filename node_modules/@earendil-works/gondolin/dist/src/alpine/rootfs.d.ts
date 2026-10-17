/** Check if any intermediate component of `target` (below `root`) is a symlink */
export declare function hasSymlinkComponent(target: string, root: string): boolean;
/** Check whether a path entry exists without following the final symlink */
export declare function pathEntryExists(targetPath: string): boolean;
export declare function resolveWritePath(target: string, root: string): string;
export declare function assertSafeWritePath(target: string, root: string): void;
export declare function hardenExtractedRootfs(rootfsDir: string): void;
export declare function ensureRootfsShell(rootfsDir: string, ociImage?: string, initramfsDir?: string, log?: (msg: string) => void): void;
//# sourceMappingURL=rootfs.d.ts.map