/**
 * Alpine Linux image builder orchestration.
 */
import type { AlpineBuildOptions, AlpineBuildResult } from "../alpine/types.js";
export type { AlpineBuildOptions, AlpineBuildResult, OciResolvedSource, RootfsOwnershipEntry, } from "../alpine/types.js";
/** Build Alpine rootfs and initramfs images */
export declare function buildAlpineImages(opts: AlpineBuildOptions): Promise<AlpineBuildResult>;
//# sourceMappingURL=alpine.d.ts.map