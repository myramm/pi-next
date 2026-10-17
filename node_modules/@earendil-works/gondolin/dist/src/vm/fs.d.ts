import type { Stats } from "node:fs";
import { Readable } from "stream";
import type { ExecResult } from "../exec.js";
import type { SandboxServer } from "../sandbox/server.js";
import type { SandboxVfsProvider } from "../vfs/provider.js";
type VmFsExecInput = string | string[];
type VmFsExecOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the exec request */
    signal?: AbortSignal;
};
export type VmFsAccessOptions = {
    /** access mode bitmask from `fs.constants` */
    mode?: number;
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the access request */
    signal?: AbortSignal;
};
export type VmFsMkdirOptions = {
    /** recursive directory creation */
    recursive?: boolean;
    /** directory mode bits */
    mode?: number;
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the mkdir request */
    signal?: AbortSignal;
};
export type VmFsListDirOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the list request */
    signal?: AbortSignal;
};
export type VmFsStatOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the stat request */
    signal?: AbortSignal;
};
export type VmFsRenameOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the rename request */
    signal?: AbortSignal;
};
export type VmFsReadFileBufferOptions = {
    /** decoded output disabled (returns Buffer) */
    encoding?: null;
    /** working directory for relative paths */
    cwd?: string;
    /** preferred chunk size in `bytes` */
    chunkSize?: number;
    /** abort signal for the read command */
    signal?: AbortSignal;
};
export type VmFsReadFileTextOptions = {
    /** text encoding for returned data */
    encoding: BufferEncoding;
    /** working directory for relative paths */
    cwd?: string;
    /** preferred chunk size in `bytes` */
    chunkSize?: number;
    /** abort signal for the read command */
    signal?: AbortSignal;
};
export type VmFsReadFileStreamOptions = {
    /** working directory for relative paths */
    cwd?: string;
    /** preferred chunk size in `bytes` */
    chunkSize?: number;
    /** stream highWaterMark in `bytes` */
    highWaterMark?: number;
    /** abort signal for the read request */
    signal?: AbortSignal;
};
export type VmFsReadFileOptions = VmFsReadFileBufferOptions | VmFsReadFileTextOptions;
export type VmFsWriteFileInput = string | Buffer | Uint8Array | Readable | AsyncIterable<Buffer | Uint8Array>;
export type VmFsWriteFileOptions = {
    /** string encoding for top-level text input */
    encoding?: BufferEncoding;
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the write command */
    signal?: AbortSignal;
};
export type VmFsDeleteOptions = {
    /** ignore missing path errors */
    force?: boolean;
    /** allow recursive directory deletion */
    recursive?: boolean;
    /** working directory for relative paths */
    cwd?: string;
    /** abort signal for the delete command */
    signal?: AbortSignal;
};
export type VmFsStat = Stats;
export type VmFs = {
    /** check whether a guest path is accessible */
    access(filePath: string, options?: VmFsAccessOptions): Promise<void>;
    /** create a guest directory */
    mkdir(dirPath: string, options?: VmFsMkdirOptions): Promise<void>;
    /** list direct child names in a guest directory */
    listDir(dirPath: string, options?: VmFsListDirOptions): Promise<string[]>;
    /** read filesystem metadata for a guest path */
    stat(filePath: string, options?: VmFsStatOptions): Promise<VmFsStat>;
    /** rename or move a guest path */
    rename(oldPath: string, newPath: string, options?: VmFsRenameOptions): Promise<void>;
    /** create a readable stream for a guest file */
    readFileStream(filePath: string, options?: VmFsReadFileStreamOptions): Promise<Readable>;
    /** read a guest file as text */
    readFile(filePath: string, options: VmFsReadFileTextOptions): Promise<string>;
    /** read a guest file as bytes */
    readFile(filePath: string, options?: VmFsReadFileBufferOptions): Promise<Buffer>;
    /** write file content inside the guest */
    writeFile(filePath: string, data: VmFsWriteFileInput, options?: VmFsWriteFileOptions): Promise<void>;
    /** delete a file or directory inside the guest */
    deleteFile(filePath: string, options?: VmFsDeleteOptions): Promise<void>;
};
export type VmFsControllerOptions = {
    /** start the vm */
    start: () => Promise<void>;
    /** execute a guest command */
    exec: (command: VmFsExecInput, options?: VmFsExecOptions) => PromiseLike<ExecResult>;
    /** lookup sandbox server when started */
    getServer: () => SandboxServer | null;
    /** optional wrapped vfs provider */
    vfs: SandboxVfsProvider | null;
    /** guest path where fuse is mounted */
    fuseMount: string;
    /** guest bind mounts that map directly into vfs paths */
    shortcutBindMounts: string[];
};
export declare class VmFsController implements VmFs {
    private readonly options;
    constructor(options: VmFsControllerOptions);
    access(filePath: string, options?: VmFsAccessOptions): Promise<void>;
    mkdir(dirPath: string, options?: VmFsMkdirOptions): Promise<void>;
    listDir(dirPath: string, options?: VmFsListDirOptions): Promise<string[]>;
    stat(filePath: string, options?: VmFsStatOptions): Promise<VmFsStat>;
    rename(oldPath: string, newPath: string, options?: VmFsRenameOptions): Promise<void>;
    readFileStream(filePath: string, options?: VmFsReadFileStreamOptions): Promise<Readable>;
    readFile(filePath: string, options: VmFsReadFileTextOptions): Promise<string>;
    readFile(filePath: string, options?: VmFsReadFileBufferOptions): Promise<Buffer>;
    writeFile(filePath: string, data: VmFsWriteFileInput, options?: VmFsWriteFileOptions): Promise<void>;
    deleteFile(filePath: string, options?: VmFsDeleteOptions): Promise<void>;
    private resolveVfsShortcutPath;
    private readFileStreamFromVfs;
    private readFileFromVfs;
    private iterateVfsFileChunks;
    private writeFileToVfs;
    private deleteVfsPath;
    private deleteVfsTree;
}
export {};
//# sourceMappingURL=fs.d.ts.map