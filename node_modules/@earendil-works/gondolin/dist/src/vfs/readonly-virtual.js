import fs from "node:fs";
import { createErrnoError } from "./errors.js";
import { ERRNO, isWriteFlag, VirtualProviderClass } from "./utils.js";
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
export class ReadonlyVirtualProvider extends VirtualProviderClass {
    get readonly() {
        return true;
    }
    get supportsSymlinks() {
        return false;
    }
    get supportsWatch() {
        return false;
    }
    async open(entryPath, flags, mode) {
        return this.openSync(entryPath, flags, mode);
    }
    openSync(entryPath, flags, mode) {
        if (isWriteFlag(flags)) {
            throw createErrnoError(ERRNO.EROFS, "open", entryPath);
        }
        return this.openReadonlySync(entryPath, flags, mode);
    }
    async stat(entryPath, options) {
        return this.statSync(entryPath, options);
    }
    async lstat(entryPath, options) {
        return this.lstatSync(entryPath, options);
    }
    async readdir(entryPath, options) {
        return this.readdirSync(entryPath, options);
    }
    async mkdir(entryPath, options) {
        return this.mkdirSync(entryPath, options);
    }
    mkdirSync(entryPath, _options) {
        throw createErrnoError(ERRNO.EROFS, "mkdir", entryPath);
    }
    async rmdir(entryPath) {
        return this.rmdirSync(entryPath);
    }
    rmdirSync(entryPath) {
        throw createErrnoError(ERRNO.EROFS, "rmdir", entryPath);
    }
    async unlink(entryPath) {
        return this.unlinkSync(entryPath);
    }
    unlinkSync(entryPath) {
        throw createErrnoError(ERRNO.EROFS, "unlink", entryPath);
    }
    async rename(oldPath, newPath) {
        return this.renameSync(oldPath, newPath);
    }
    renameSync(oldPath, _newPath) {
        throw createErrnoError(ERRNO.EROFS, "rename", oldPath);
    }
    async symlink(target, entryPath, type) {
        return this.symlinkSync(target, entryPath, type);
    }
    symlinkSync(_target, entryPath, _type) {
        throw createErrnoError(ERRNO.EROFS, "symlink", entryPath);
    }
    // Convenience async wrappers for optional sync overrides
    async realpath(entryPath, options) {
        return this.realpathSync(entryPath, options);
    }
    async access(entryPath, mode) {
        return this.accessSync(entryPath, mode);
    }
    async readlink(entryPath, options) {
        return this.readlinkSync(entryPath, options);
    }
}
//# sourceMappingURL=readonly-virtual.js.map