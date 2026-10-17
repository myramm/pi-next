import type { Architecture, ContainerRuntime, OciPullPolicy } from "../build/config.js";
import type { OciResolvedSource, OciRootfsOptions, RootfsOwnershipEntry } from "./types.js";
interface OciExportOptions extends OciRootfsOptions {
    /** target architecture */
    arch: Architecture;
    /** working directory for temporary export files */
    workDir: string;
    /** rootfs extraction target directory */
    targetDir: string;
    /** log sink */
    log: (msg: string) => void;
    /** callback for tar ownership metadata */
    ownershipSink?: (entries: RootfsOwnershipEntry[]) => void;
}
interface OciResolvedDigest {
    /** canonical image reference containing digest */
    reference: string;
    /** resolved OCI digest (`sha256:...`) */
    digest: string;
}
export declare function exportOciRootfs(opts: OciExportOptions): OciResolvedSource;
export declare function hasLocalOciImage(runtime: ContainerRuntime, image: string, platform: string): boolean;
export declare function buildOciCreateArgs(image: string, platform: string, pullPolicy: OciPullPolicy): string[];
export declare function resolveLocalOciImageDigest(runtime: ContainerRuntime, image: string): OciResolvedDigest;
declare function readTarOwnershipEntries(tarPath: string): RootfsOwnershipEntry[];
export declare const __test: {
    readTarOwnershipEntries: typeof readTarOwnershipEntries;
};
export {};
//# sourceMappingURL=oci.d.ts.map