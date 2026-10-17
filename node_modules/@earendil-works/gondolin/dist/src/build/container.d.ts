import type { BuildConfig } from "./config.js";
import { type BuildOptions, type BuildResult } from "./shared.js";
/** Build assets inside a container */
export declare function buildInContainer(config: BuildConfig, options: BuildOptions, log: (msg: string) => void): Promise<BuildResult>;
//# sourceMappingURL=container.d.ts.map