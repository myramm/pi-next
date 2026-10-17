import type { PostBuildCopyEntry } from "../build/config.js";
/** Copy host paths into the built rootfs before post-build commands */
export declare function applyPostBuildCopies(rootfsDir: string, entries: PostBuildCopyEntry[], log: (msg: string) => void): void;
//# sourceMappingURL=post-build-copy.d.ts.map