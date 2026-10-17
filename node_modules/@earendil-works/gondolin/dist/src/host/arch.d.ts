import type { Architecture } from "../build/config.js";
/**
 * Return the (cached) host node architecture.
 *
 * On Apple Silicon running under Rosetta, this will eventually become "arm64"
 * after a background sysctl probe completes.
 */
export declare function getHostNodeArchCached(): NodeJS.Architecture;
export declare function detectHostArchitectureSync(): Architecture;
//# sourceMappingURL=arch.d.ts.map