import { createErrnoError } from "./errors.js";
import { delegateStatfsOrEnosys } from "./statfs.js";
import { ERRNO, isWriteFlag, VirtualProviderClass } from "./utils.js";
/**
 * Wraps a VirtualProvider and makes it read-only by blocking all write operations.
 * Useful for mounting host directories in read-only mode.
 */
export class ReadonlyProvider extends VirtualProviderClass {
    backend;
    constructor(backend) {
        super();
        this.backend = backend;
    }
    get readonly() {
        return true;
    }
    get supportsSymlinks() {
        return this.backend.supportsSymlinks;
    }
    get supportsWatch() {
        return this.backend.supportsWatch;
    }
    async open(path, flags, mode) {
        if (isWriteFlag(flags)) {
            throw createErrnoError(ERRNO.EROFS, "open", path);
        }
        return this.backend.open(path, flags, mode);
    }
    openSync(path, flags, mode) {
        if (isWriteFlag(flags)) {
            throw createErrnoError(ERRNO.EROFS, "open", path);
        }
        return this.backend.openSync(path, flags, mode);
    }
    async stat(path, options) {
        return this.backend.stat(path, options);
    }
    statSync(path, options) {
        return this.backend.statSync(path, options);
    }
    async lstat(path, options) {
        return this.backend.lstat(path, options);
    }
    lstatSync(path, options) {
        return this.backend.lstatSync(path, options);
    }
    async readdir(path, options) {
        return this.backend.readdir(path, options);
    }
    readdirSync(path, options) {
        return this.backend.readdirSync(path, options);
    }
    async mkdir(path, _options) {
        throw createErrnoError(ERRNO.EROFS, "mkdir", path);
    }
    mkdirSync(path, _options) {
        throw createErrnoError(ERRNO.EROFS, "mkdir", path);
    }
    async rmdir(path) {
        throw createErrnoError(ERRNO.EROFS, "rmdir", path);
    }
    rmdirSync(path) {
        throw createErrnoError(ERRNO.EROFS, "rmdir", path);
    }
    async unlink(path) {
        throw createErrnoError(ERRNO.EROFS, "unlink", path);
    }
    unlinkSync(path) {
        throw createErrnoError(ERRNO.EROFS, "unlink", path);
    }
    async rename(oldPath, _newPath) {
        throw createErrnoError(ERRNO.EROFS, "rename", oldPath);
    }
    renameSync(oldPath, _newPath) {
        throw createErrnoError(ERRNO.EROFS, "rename", oldPath);
    }
    async link(_existingPath, newPath) {
        throw createErrnoError(ERRNO.EROFS, "link", newPath);
    }
    linkSync(_existingPath, newPath) {
        throw createErrnoError(ERRNO.EROFS, "link", newPath);
    }
    async readlink(path, options) {
        if (this.backend.readlink) {
            return this.backend.readlink(path, options);
        }
        return super.readlink(path, options);
    }
    readlinkSync(path, options) {
        if (this.backend.readlinkSync) {
            return this.backend.readlinkSync(path, options);
        }
        return super.readlinkSync(path, options);
    }
    async symlink(_target, path, _type) {
        throw createErrnoError(ERRNO.EROFS, "symlink", path);
    }
    symlinkSync(_target, path, _type) {
        throw createErrnoError(ERRNO.EROFS, "symlink", path);
    }
    async realpath(path, options) {
        if (this.backend.realpath) {
            return this.backend.realpath(path, options);
        }
        return super.realpath(path, options);
    }
    realpathSync(path, options) {
        if (this.backend.realpathSync) {
            return this.backend.realpathSync(path, options);
        }
        return super.realpathSync(path, options);
    }
    async access(path, mode) {
        if (this.backend.access) {
            return this.backend.access(path, mode);
        }
        return super.access(path, mode);
    }
    accessSync(path, mode) {
        if (this.backend.accessSync) {
            return this.backend.accessSync(path, mode);
        }
        return super.accessSync(path, mode);
    }
    async statfs(path) {
        return delegateStatfsOrEnosys(this.backend, path);
    }
    watch(path, options) {
        return this.backend.watch?.(path, options) ?? super.watch(path, options);
    }
    watchAsync(path, options) {
        return (this.backend.watchAsync?.(path, options) ??
            super.watchAsync(path, options));
    }
    watchFile(path, options, listener) {
        return (this.backend.watchFile?.(path, options, listener) ??
            super.watchFile(path, options));
    }
    unwatchFile(path, listener) {
        if (this.backend.unwatchFile) {
            this.backend.unwatchFile(path, listener);
            return;
        }
        super.unwatchFile(path, listener);
    }
    async close() {
        const backend = this.backend;
        if (backend.close) {
            await backend.close();
        }
    }
}
//# sourceMappingURL=readonly.js.map