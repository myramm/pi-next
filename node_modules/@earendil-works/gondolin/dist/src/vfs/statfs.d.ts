import type { VfsStatfs } from "./node/index.js";
type MaybeStatfsProvider = {
    statfs?: (path: string) => Promise<VfsStatfs>;
};
export declare function cloneSyntheticStatfs(): VfsStatfs;
export declare function delegateStatfsOrEnosys(provider: MaybeStatfsProvider, path: string): Promise<VfsStatfs>;
export declare function normalizeStatfs(raw: VfsStatfs): VfsStatfs;
export declare function isErrnoValue(error: unknown, errno: number): boolean;
export declare function isStatfsProbeFallbackError(error: unknown): boolean;
export {};
//# sourceMappingURL=statfs.d.ts.map