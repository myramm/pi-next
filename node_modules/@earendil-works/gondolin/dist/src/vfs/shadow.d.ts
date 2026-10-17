import type { Dirent } from "node:fs";
import type { VirtualFileHandle, VirtualProvider, VfsStatfs } from "./node/index.js";
import { VirtualProviderClass } from "./utils.js";
export type ShadowWriteMode = 
/** reject any write/mutation against shadowed paths */
"deny"
/** route writes to an in-memory provider so the guest can create its own files */
 | "tmpfs";
export type ShadowContext = {
    /** operation name */
    op: string;
    /** absolute posix path */
    path: string;
    /** open flags (for open/create) */
    flags?: string;
    /** source path for rename */
    oldPath?: string;
    /** destination path for rename */
    newPath?: string;
};
export type ShadowPredicate = (ctx: ShadowContext) => boolean;
export type ShadowProviderOptions = {
    /** policy callback that returns true if a path should be shadowed */
    shouldShadow: ShadowPredicate;
    /** behavior for write operations targeting shadowed paths (default: "deny") */
    writeMode?: ShadowWriteMode;
    /** provider used for shadowed writes when writeMode is "tmpfs" (default: new MemoryProvider()) */
    tmpfs?: VirtualProvider;
    /**
     * If true, additionally consult `backend.realpath()` and apply shadow policy to the resolved path
     *
     * This blocks trivial symlink bypasses (e.g. `ln -s .envrc x; cat x`).
     *
     * Default: true
     */
    denySymlinkBypass?: boolean;
    /**
     * Errno used for denied write operations (default: EACCES)
     *
     * Read operations always behave like the path does not exist (ENOENT).
     */
    denyWriteErrno?: number;
};
/**
 * Convenience helper to turn a list of shadowed paths into a ShadowPredicate
 *
 * The provided paths are interpreted as absolute VFS paths within the provider (rooted at `/`).
 *
 * Note: inputs are normalized with `normalizeVfsPath()`, so a relative string like
 * `".env"` will be treated as `"/.env"` (it is not relative to the directory being accessed).
 */
export declare function createShadowPathPredicate(shadowPaths: string[]): ShadowPredicate;
/**
 * Wraps a provider and shadows any path for which `shouldShadow(...)` returns true.
 *
 * Semantics:
 * - Read-ish ops (stat, open for read, access, readdir) behave as if it doesn’t exist (ENOENT)
 * - Shadowed entries are omitted from directory listings (unless present in tmpfs upper layer)
 * - Write ops are either denied (default) or redirected to tmpfs
 */
export declare class ShadowProvider extends VirtualProviderClass implements VirtualProvider {
    private readonly shouldShadow;
    private readonly writeMode;
    private readonly tmpfs;
    private readonly denySymlinkBypass;
    private readonly denyWriteErrno;
    private readonly backend;
    constructor(backend: VirtualProvider, options: ShadowProviderOptions);
    get readonly(): boolean;
    get supportsSymlinks(): boolean;
    get supportsWatch(): boolean;
    private shadowedFor;
    private shadowedForRename;
    private resolvesToShadowed;
    private resolvesToShadowedSync;
    open(entryPath: string, flags: string, mode?: number): Promise<VirtualFileHandle>;
    openSync(entryPath: string, flags: string, mode?: number): VirtualFileHandle;
    stat(entryPath: string, options?: object): Promise<import("fs").Stats>;
    statSync(entryPath: string, options?: object): import("fs").Stats;
    lstat(entryPath: string, options?: object): Promise<import("fs").Stats>;
    lstatSync(entryPath: string, options?: object): import("fs").Stats;
    readdir(entryPath: string, options?: object): Promise<(string | Dirent<string>)[]>;
    readdirSync(entryPath: string, options?: object): (string | Dirent<string>)[];
    mkdir(entryPath: string, options?: object): Promise<string | void>;
    mkdirSync(entryPath: string, options?: object): string | void;
    rmdir(entryPath: string): Promise<void>;
    rmdirSync(entryPath: string): void;
    unlink(entryPath: string): Promise<void>;
    unlinkSync(entryPath: string): void;
    rename(oldPath: string, newPath: string): Promise<void>;
    renameSync(oldPath: string, newPath: string): void;
    readlink(entryPath: string, options?: object): Promise<any>;
    readlinkSync(entryPath: string, options?: object): any;
    symlink(target: string, entryPath: string, type?: string): Promise<any>;
    symlinkSync(target: string, entryPath: string, type?: string): any;
    realpath(entryPath: string, options?: object): Promise<any>;
    realpathSync(entryPath: string, options?: object): any;
    access(entryPath: string, mode?: number): Promise<any>;
    accessSync(entryPath: string, mode?: number): any;
    statfs(entryPath: string): Promise<VfsStatfs>;
    watch(entryPath: string, options?: object): any;
    watchAsync(entryPath: string, options?: object): any;
    watchFile(entryPath: string, options?: object, listener?: (...args: unknown[]) => void): any;
    unwatchFile(entryPath: string, listener?: (...args: unknown[]) => void): void;
    close(): Promise<void>;
    private openShadowed;
    private openShadowedSync;
    private statShadowed;
    private statShadowedSync;
    private lstatShadowed;
    private lstatShadowedSync;
    private readdirShadowed;
    private readdirShadowedSync;
    private tryReaddirUpper;
    private tryReaddirUpperSync;
    private writeShadowed;
    private writeShadowedSync;
}
//# sourceMappingURL=shadow.d.ts.map