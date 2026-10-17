import type { SandboxVmm } from "./sandbox/server-options.js";
import type { VMOptions } from "./vm/types.js";
declare const CHECKPOINT_SCHEMA_VERSION: 1;
export type VmCheckpointData = {
    /** checkpoint schema version */
    version: typeof CHECKPOINT_SCHEMA_VERSION;
    /** checkpoint name */
    name: string;
    /** creation timestamp (`iso 8601`) */
    createdAt: string;
    /** qcow2 disk filename (`basename` of checkpoint file path) */
    diskFile: string;
    /** deterministic guest asset build identifier (uuid) */
    guestAssetBuildId: string;
    /** checkpoint payload kind */
    snapshotKind?: "disk";
    /** backend used when the checkpoint was created */
    createdWithVmm?: SandboxVmm;
    /** backends allowed for checkpoint resume */
    compatibleVmm?: SandboxVmm[];
};
/**
 * Disk-only checkpoint that can be resumed using qcow2 backing files.
 */
export declare class VmCheckpoint {
    private readonly checkpointPath;
    private readonly data;
    private readonly baseVmOptions;
    constructor(checkpointPath: string, data: VmCheckpointData, baseVmOptions?: VMOptions | null);
    /** checkpoint name */
    get name(): string;
    /** absolute path to the checkpoint qcow2 file */
    get path(): string;
    /** absolute path to the directory containing the checkpoint file */
    get dir(): string;
    /** absolute path to the qcow2 disk file */
    get diskPath(): string;
    /** deterministic guest asset build identifier (uuid) */
    get guestAssetBuildId(): string;
    toJSON(): VmCheckpointData;
    /**
     * Resume the checkpoint into a new VM.
     *
     * The resumed VM is implemented as a fresh qcow2 overlay backed by this
     * checkpoint's qcow2 disk image.
     */
    resume<TVm = any>(options?: VMOptions): Promise<TVm>;
    /** @deprecated Use {@link resume} */
    clone<TVm = any>(options?: VMOptions): Promise<TVm>;
    /** Load a checkpoint from a qcow2 file with a metadata trailer. */
    static load(checkpointPath: string): VmCheckpoint;
    /** Delete the checkpoint file. */
    delete(): void;
    /** Create a checkpoint metadata trailer and append it to a qcow2 file. */
    static writeTrailer(diskPath: string, data: VmCheckpointData): void;
}
export {};
//# sourceMappingURL=checkpoint.d.ts.map