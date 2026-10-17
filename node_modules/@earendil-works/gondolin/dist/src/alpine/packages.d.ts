import type { Architecture } from "../build/config.js";
import type { ApkMeta } from "./types.js";
/** Parse an APKINDEX file into package metadata records */
export declare function parseApkIndex(content: string): ApkMeta[];
/** Install Alpine packages with dependency resolution */
export declare function installPackages(targetDir: string, packages: string[], arch: Architecture, cacheDir: string, log: (msg: string) => void): Promise<void>;
export declare function runPostBuildCommands(rootfsDir: string, commands: string[], targetArch: Architecture, log: (msg: string) => void): void;
//# sourceMappingURL=packages.d.ts.map