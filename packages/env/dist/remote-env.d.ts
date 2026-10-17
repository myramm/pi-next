import { type PlatformPath } from "node:path";
import type { Context } from "@earendil-works/chord";
import { type BinaryReader, type DirReader, type ExecutionEnv, ExecutionError, FileError, type FileInfo, type FileListing, type FileWatcher, type ListFilesOptions, type Result, type ShellExecOptions, type ShellExecResult, type TextLineReader, type WatchChange, type WatchTarget } from "@earendil-works/pi-durable/env";
import { type Connection, type RemoteInfo } from "./connection.ts";
import { type RemoteWatchOptions } from "./watch.ts";
export interface RemoteExecutionEnvOptions {
    connection: Connection;
    /** The file namespace: equal ids see the same files (`FileSystem.id`), e.g. `pi-env:<env name>`. */
    id: string;
    cwd: string;
    shellPath?: string;
    /** Added to the remote environment of every command that inherits it, like `NodeExecutionEnv`'s `shellEnv`. */
    shellEnv?: Record<string, string>;
    /** How the daemon watches, like `NodeExecutionEnv`'s `watch` option. */
    watch?: RemoteWatchOptions;
}
/** Node's path rules of the remote system. */
export declare function remotePath(connection: Connection): Promise<PlatformPath>;
/**
 * An `ExecutionEnv` on another machine, reached through a pi-env daemon. Results match `NodeExecutionEnv` running on
 * that machine: the daemon performs the system calls, and this class applies Node's path, error, and result rules.
 */
export declare class RemoteExecutionEnv implements ExecutionEnv {
    #private;
    readonly id: string;
    cwd: string;
    readonly connection: Connection;
    constructor(options: RemoteExecutionEnvOptions);
    absolutePath(path: string, _context: Context): Promise<Result<string, FileError>>;
    joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>>;
    readTextFile(path: string, context: Context): Promise<Result<string, FileError>>;
    readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>>;
    openBinaryReader(path: string, options: {
        noFollow?: boolean;
    } | undefined, context: Context): Promise<Result<BinaryReader, FileError>>;
    openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>>;
    readTextLines(path: string, options: {
        maxLines?: number;
    } | undefined, context: Context): Promise<Result<string[], FileError>>;
    writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
    appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>>;
    truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>>;
    flushFile(path: string, context: Context): Promise<Result<void, FileError>>;
    renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>>;
    fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>>;
    listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>>;
    /** Through the daemon; `not_supported` with a daemon released before `listFiles`. */
    listFiles(path: string, options: ListFilesOptions | undefined, context: Context): Promise<Result<FileListing, FileError>>;
    openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>>;
    canonicalPath(path: string, context: Context): Promise<Result<string, FileError>>;
    exists(path: string, context: Context): Promise<Result<boolean, FileError>>;
    createDir(path: string, options: {
        recursive?: boolean;
    } | undefined, context: Context): Promise<Result<void, FileError>>;
    remove(path: string, options: {
        recursive?: boolean;
        force?: boolean;
    } | undefined, context: Context): Promise<Result<void, FileError>>;
    createTempDir(prefix: string | undefined, context: Context): Promise<Result<string, FileError>>;
    createTempFile(options: {
        prefix?: string;
        suffix?: string;
    } | undefined, context: Context): Promise<Result<string, FileError>>;
    watch(targets: readonly WatchTarget[], onChange: (change: WatchChange) => void, context: Context): Promise<Result<FileWatcher, FileError>>;
    exec(command: string | readonly string[], options: ShellExecOptions | undefined, context: Context): Promise<Result<ShellExecResult, ExecutionError>>;
    cleanup(_context: Context): Promise<void>;
}
export type { RemoteInfo };
//# sourceMappingURL=remote-env.d.ts.map