import fs from "node:fs";
import type { VirtualFileHandle, VirtualProvider } from "./node/index.js";
import { VirtualProviderClass } from "./utils.js";
/**
 * Small helper base-class for implementing a synchronous, read-only VFS provider.
 *
 * Most custom providers in examples are sync-first (they call into local code,
 * spawn processes, or consult in-memory caches). This class:
 *
 * - Implements async methods by delegating to their sync counterparts
 * - Rejects any write operation with `EROFS`
 * - Rejects `open(..., flags)` that imply writing with `EROFS`
 */
export declare abstract class ReadonlyVirtualProvider extends VirtualProviderClass implements VirtualProvider {
    get readonly(): boolean;
    get supportsSymlinks(): boolean;
    get supportsWatch(): boolean;
    open(entryPath: string, flags: string, mode?: number): Promise<VirtualFileHandle>;
    openSync(entryPath: string, flags: string, mode?: number): VirtualFileHandle;
    /** Sync open implementation for read-only use-cases */
    protected abstract openReadonlySync(entryPath: string, flags: string, mode?: number): VirtualFileHandle;
    stat(entryPath: string, options?: object): Promise<fs.Stats>;
    abstract statSync(entryPath: string, options?: object): fs.Stats;
    lstat(entryPath: string, options?: object): Promise<fs.Stats>;
    abstract lstatSync(entryPath: string, options?: object): fs.Stats;
    readdir(entryPath: string, options?: object): Promise<(string | fs.Dirent<string>)[]>;
    abstract readdirSync(entryPath: string, options?: object): Array<string | fs.Dirent>;
    mkdir(entryPath: string, options?: object): Promise<string | void>;
    mkdirSync(entryPath: string, _options?: object): void | string;
    rmdir(entryPath: string): Promise<void>;
    rmdirSync(entryPath: string): void;
    unlink(entryPath: string): Promise<void>;
    unlinkSync(entryPath: string): void;
    rename(oldPath: string, newPath: string): Promise<void>;
    renameSync(oldPath: string, _newPath: string): void;
    symlink(target: string, entryPath: string, type?: string): Promise<void>;
    symlinkSync(_target: string, entryPath: string, _type?: string): void;
    realpath(entryPath: string, options?: object): Promise<string>;
    access(entryPath: string, mode?: number): Promise<void>;
    readlink(entryPath: string, options?: object): Promise<string>;
}
//# sourceMappingURL=readonly-virtual.d.ts.map