/**
 * Asset builder for custom Linux kernel and rootfs images.
 */
import type { BuildConfig } from "./config.js";
import { type BuildOptions, type BuildResult } from "./shared.js";
export type { BuildOptions, BuildResult } from "./shared.js";
/** Build guest assets from a configuration */
export declare function buildAssets(config: BuildConfig, options: BuildOptions): Promise<BuildResult>;
/** Verify asset checksums against manifest */
export declare function verifyAssets(assetDir: string): boolean;
//# sourceMappingURL=index.d.ts.map