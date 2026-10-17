import type { VirtualProvider, VirtualFileHandle, VfsStatfs } from "./node/index.js";
import { VirtualProviderClass } from "./utils.js";
export type VfsHookContext = {
    /** operation name */
    op: string;
    /** primary path */
    path?: string;
    /** source path for rename/link */
    oldPath?: string;
    /** destination path for rename/link */
    newPath?: string;
    /** open flags */
    flags?: string | number;
    /** file mode bits */
    mode?: number;
    /** file handle id */
    fh?: number;
    /** file offset in `bytes` */
    offset?: number;
    /** length in `bytes` */
    length?: number;
    /** size in `bytes` */
    size?: number;
    /** payload bytes */
    data?: Buffer;
    /** operation result */
    result?: unknown;
};
export type VfsHooks = {
    /** hook called before the operation */
    before?: (context: VfsHookContext) => void | Promise<void>;
    /** hook called after the operation */
    after?: (context: VfsHookContext) => void | Promise<void>;
};
declare class HookedHandle implements VirtualFileHandle {
    private readonly inner;
    private readonly hooks;
    private readonly handlePath;
    constructor(inner: VirtualFileHandle, hooks: VfsHooks, handlePath: string);
    get path(): string;
    get flags(): string | undefined;
    get mode(): number | undefined;
    get position(): number | undefined;
    get closed(): boolean | undefined;
    read(buffer: Buffer, offset: number, length: number, position?: number | null): Promise<{
        bytesRead: number;
        buffer: Buffer;
    }>;
    readSync(buffer: Buffer, offset: number, length: number, position?: number | null): number;
    write(buffer: Buffer, offset: number, length: number, position?: number | null): Promise<{
        bytesWritten: number;
        buffer: Buffer;
    }>;
    writeSync(buffer: Buffer, offset: number, length: number, position?: number | null): number;
    readFile(options?: {
        encoding?: BufferEncoding;
    } | BufferEncoding): Promise<string | Buffer<ArrayBufferLike>>;
    readFileSync(options?: {
        encoding?: BufferEncoding;
    } | BufferEncoding): string | Buffer<ArrayBufferLike>;
    writeFile(data: Buffer | string, options?: {
        encoding?: BufferEncoding;
    }): Promise<void>;
    writeFileSync(data: Buffer | string, options?: {
        encoding?: BufferEncoding;
    }): void;
    stat(options?: object): Promise<import("fs").Stats>;
    statSync(options?: object): import("fs").Stats;
    truncate(len?: number): Promise<void>;
    truncateSync(len?: number): void;
    close(): Promise<void>;
    closeSync(): void;
    private runBefore;
    private runAfter;
    private runBeforeSync;
    private runAfterSync;
}
export declare class SandboxVfsProvider extends VirtualProviderClass implements VirtualProvider {
    private readonly backend;
    private readonly hooks;
    constructor(backend: VirtualProvider, hooks?: VfsHooks);
    get readonly(): boolean;
    get supportsSymlinks(): boolean;
    get supportsWatch(): boolean;
    open(path: string, flags: string, mode?: number): Promise<VirtualFileHandle | HookedHandle>;
    openSync(path: string, flags: string, mode?: number): VirtualFileHandle | HookedHandle;
    stat(path: string, options?: object): Promise<import("fs").Stats>;
    statSync(path: string, options?: object): import("fs").Stats;
    lstat(path: string, options?: object): Promise<import("fs").Stats>;
    lstatSync(path: string, options?: object): import("fs").Stats;
    readdir(path: string, options?: object): Promise<(string | import("fs").Dirent<string>)[]>;
    readdirSync(path: string, options?: object): (string | import("fs").Dirent<string>)[];
    mkdir(path: string, options?: object): Promise<string | void>;
    mkdirSync(path: string, options?: object): string | void;
    rmdir(path: string): Promise<void>;
    rmdirSync(path: string): void;
    unlink(path: string): Promise<void>;
    unlinkSync(path: string): void;
    rename(oldPath: string, newPath: string): Promise<void>;
    renameSync(oldPath: string, newPath: string): void;
    link(oldPath: string, newPath: string): Promise<void>;
    linkSync(oldPath: string, newPath: string): void;
    readlink(path: string, options?: object): Promise<any>;
    readlinkSync(path: string, options?: object): any;
    symlink(target: string, path: string, type?: string): Promise<any>;
    symlinkSync(target: string, path: string, type?: string): any;
    realpath(path: string, options?: object): Promise<any>;
    realpathSync(path: string, options?: object): any;
    access(path: string, mode?: number): Promise<any>;
    accessSync(path: string, mode?: number): any;
    watch(path: string, options?: object): any;
    watchAsync(path: string, options?: object): any;
    watchFile(path: string, options?: object, listener?: (...args: unknown[]) => void): any;
    unwatchFile(path: string, listener?: (...args: unknown[]) => void): void;
    truncate(path: string, length: number): Promise<void>;
    truncateSync(path: string, length: number): void;
    statfs(path: string): Promise<VfsStatfs>;
    close(): Promise<void>;
    private wrapHandle;
    private runBefore;
    private runAfter;
    private runBeforeSync;
    private runAfterSync;
}
export {};
//# sourceMappingURL=provider.d.ts.map