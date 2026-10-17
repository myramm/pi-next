import type { VirtualProvider, VfsStatfs } from "./node/index.js";
import { VirtualProviderClass } from "./utils.js";
/**
 * Wraps a VirtualProvider and makes it read-only by blocking all write operations.
 * Useful for mounting host directories in read-only mode.
 */
export declare class ReadonlyProvider extends VirtualProviderClass implements VirtualProvider {
    private readonly backend;
    constructor(backend: VirtualProvider);
    get readonly(): boolean;
    get supportsSymlinks(): boolean;
    get supportsWatch(): boolean;
    open(path: string, flags: string, mode?: number): Promise<import("./node/index.js").VirtualFileHandle>;
    openSync(path: string, flags: string, mode?: number): import("./node/index.js").VirtualFileHandle;
    stat(path: string, options?: object): Promise<import("fs").Stats>;
    statSync(path: string, options?: object): import("fs").Stats;
    lstat(path: string, options?: object): Promise<import("fs").Stats>;
    lstatSync(path: string, options?: object): import("fs").Stats;
    readdir(path: string, options?: object): Promise<(string | import("fs").Dirent<string>)[]>;
    readdirSync(path: string, options?: object): (string | import("fs").Dirent<string>)[];
    mkdir(path: string, _options?: object): Promise<void | string>;
    mkdirSync(path: string, _options?: object): void | string;
    rmdir(path: string): Promise<void>;
    rmdirSync(path: string): void;
    unlink(path: string): Promise<void>;
    unlinkSync(path: string): void;
    rename(oldPath: string, _newPath: string): Promise<void>;
    renameSync(oldPath: string, _newPath: string): void;
    link(_existingPath: string, newPath: string): Promise<void>;
    linkSync(_existingPath: string, newPath: string): void;
    readlink(path: string, options?: object): Promise<string>;
    readlinkSync(path: string, options?: object): string;
    symlink(_target: string, path: string, _type?: string): Promise<void>;
    symlinkSync(_target: string, path: string, _type?: string): void;
    realpath(path: string, options?: object): Promise<string>;
    realpathSync(path: string, options?: object): string;
    access(path: string, mode?: number): Promise<void>;
    accessSync(path: string, mode?: number): void;
    statfs(path: string): Promise<VfsStatfs>;
    watch(path: string, options?: object): any;
    watchAsync(path: string, options?: object): any;
    watchFile(path: string, options?: object, listener?: (...args: unknown[]) => void): any;
    unwatchFile(path: string, listener?: (...args: unknown[]) => void): void;
    close(): Promise<void>;
}
//# sourceMappingURL=readonly.d.ts.map