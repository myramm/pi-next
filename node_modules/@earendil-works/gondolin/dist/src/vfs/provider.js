import { createErrnoError } from "./errors.js";
import { delegateStatfsOrEnosys } from "./statfs.js";
import { ERRNO, VirtualProviderClass } from "./utils.js";
class HookedHandle {
    inner;
    hooks;
    handlePath;
    constructor(inner, hooks, handlePath) {
        this.inner = inner;
        this.hooks = hooks;
        this.handlePath = handlePath;
    }
    get path() {
        // Always report the path that was used to open the handle.
        //
        // Many backend providers expose a handle-local `path` property that is
        // relative to the provider's mount root (e.g. "/listeners" for a mount
        // at "/etc/gondolin").  VFS hooks, however, operate on the *guest-visible*
        // paths that flow through the mounted provider (e.g. "/etc/gondolin/listeners").
        //
        // Using the backend handle's `path` here breaks path-based hooks like the
        // /etc/gondolin/listeners reload logic.
        return this.handlePath;
    }
    get flags() {
        return this.inner.flags;
    }
    get mode() {
        return this.inner.mode;
    }
    get position() {
        return this.inner.position;
    }
    get closed() {
        return this.inner.closed;
    }
    async read(buffer, offset, length, position) {
        await this.runBefore({
            op: "read",
            path: this.path,
            offset: position ?? undefined,
            length,
        });
        const result = await this.inner.read(buffer, offset, length, position);
        await this.runAfter({
            op: "read",
            path: this.path,
            offset: position ?? undefined,
            length,
            result,
        });
        return result;
    }
    readSync(buffer, offset, length, position) {
        this.runBeforeSync({
            op: "read",
            path: this.path,
            offset: position ?? undefined,
            length,
        });
        const bytesRead = this.inner.readSync(buffer, offset, length, position);
        this.runAfterSync({
            op: "read",
            path: this.path,
            offset: position ?? undefined,
            length,
            result: bytesRead,
        });
        return bytesRead;
    }
    async write(buffer, offset, length, position) {
        await this.runBefore({
            op: "write",
            path: this.path,
            offset: position ?? undefined,
            length,
        });
        const result = await this.inner.write(buffer, offset, length, position);
        await this.runAfter({
            op: "write",
            path: this.path,
            offset: position ?? undefined,
            length,
            result,
        });
        return result;
    }
    writeSync(buffer, offset, length, position) {
        this.runBeforeSync({
            op: "write",
            path: this.path,
            offset: position ?? undefined,
            length,
        });
        const bytesWritten = this.inner.writeSync(buffer, offset, length, position);
        this.runAfterSync({
            op: "write",
            path: this.path,
            offset: position ?? undefined,
            length,
            result: bytesWritten,
        });
        return bytesWritten;
    }
    async readFile(options) {
        await this.runBefore({ op: "readFile", path: this.path });
        const result = await this.inner.readFile(options);
        await this.runAfter({ op: "readFile", path: this.path, result });
        return result;
    }
    readFileSync(options) {
        this.runBeforeSync({ op: "readFile", path: this.path });
        const result = this.inner.readFileSync(options);
        this.runAfterSync({ op: "readFile", path: this.path, result });
        return result;
    }
    async writeFile(data, options) {
        await this.runBefore({
            op: "writeFile",
            path: this.path,
            data: Buffer.isBuffer(data) ? data : Buffer.from(data),
        });
        await this.inner.writeFile(data, options);
        await this.runAfter({ op: "writeFile", path: this.path });
    }
    writeFileSync(data, options) {
        this.runBeforeSync({
            op: "writeFile",
            path: this.path,
            data: Buffer.isBuffer(data) ? data : Buffer.from(data),
        });
        this.inner.writeFileSync(data, options);
        this.runAfterSync({ op: "writeFile", path: this.path });
    }
    async stat(options) {
        await this.runBefore({ op: "stat", path: this.path });
        const result = await this.inner.stat(options);
        await this.runAfter({ op: "stat", path: this.path, result });
        return result;
    }
    statSync(options) {
        this.runBeforeSync({ op: "stat", path: this.path });
        const result = this.inner.statSync(options);
        this.runAfterSync({ op: "stat", path: this.path, result });
        return result;
    }
    async truncate(len) {
        await this.runBefore({ op: "truncate", path: this.path, size: len });
        await this.inner.truncate(len);
        await this.runAfter({ op: "truncate", path: this.path, size: len });
    }
    truncateSync(len) {
        this.runBeforeSync({ op: "truncate", path: this.path, size: len });
        this.inner.truncateSync(len);
        this.runAfterSync({ op: "truncate", path: this.path, size: len });
    }
    async close() {
        await this.runBefore({ op: "release", path: this.path });
        await this.inner.close();
        await this.runAfter({ op: "release", path: this.path });
    }
    closeSync() {
        this.runBeforeSync({ op: "release", path: this.path });
        this.inner.closeSync();
        this.runAfterSync({ op: "release", path: this.path });
    }
    async runBefore(context) {
        if (this.hooks.before) {
            await this.hooks.before(context);
        }
    }
    async runAfter(context) {
        if (this.hooks.after) {
            await this.hooks.after(context);
        }
    }
    runBeforeSync(context) {
        if (this.hooks.before) {
            const result = this.hooks.before(context);
            if (result && typeof result.then === "function") {
                throw new Error("async hook used in sync operation");
            }
        }
    }
    runAfterSync(context) {
        if (this.hooks.after) {
            const result = this.hooks.after(context);
            if (result && typeof result.then === "function") {
                throw new Error("async hook used in sync operation");
            }
        }
    }
}
export class SandboxVfsProvider extends VirtualProviderClass {
    backend;
    hooks;
    constructor(backend, hooks = {}) {
        super();
        this.backend = backend;
        this.hooks = hooks;
    }
    get readonly() {
        return this.backend.readonly;
    }
    get supportsSymlinks() {
        return this.backend.supportsSymlinks;
    }
    get supportsWatch() {
        return this.backend.supportsWatch;
    }
    async open(path, flags, mode) {
        await this.runBefore({ op: "open", path, flags, mode });
        const handle = this.wrapHandle(path, await this.backend.open(path, flags, mode));
        await this.runAfter({ op: "open", path, flags, mode, result: handle });
        return handle;
    }
    openSync(path, flags, mode) {
        this.runBeforeSync({ op: "open", path, flags, mode });
        const handle = this.wrapHandle(path, this.backend.openSync(path, flags, mode));
        this.runAfterSync({ op: "open", path, flags, mode, result: handle });
        return handle;
    }
    async stat(path, options) {
        await this.runBefore({ op: "stat", path });
        const stats = await this.backend.stat(path, options);
        await this.runAfter({ op: "stat", path, result: stats });
        return stats;
    }
    statSync(path, options) {
        this.runBeforeSync({ op: "stat", path });
        const stats = this.backend.statSync(path, options);
        this.runAfterSync({ op: "stat", path, result: stats });
        return stats;
    }
    async lstat(path, options) {
        await this.runBefore({ op: "lstat", path });
        const stats = await this.backend.lstat(path, options);
        await this.runAfter({ op: "lstat", path, result: stats });
        return stats;
    }
    lstatSync(path, options) {
        this.runBeforeSync({ op: "lstat", path });
        const stats = this.backend.lstatSync(path, options);
        this.runAfterSync({ op: "lstat", path, result: stats });
        return stats;
    }
    async readdir(path, options) {
        await this.runBefore({ op: "readdir", path });
        const entries = await this.backend.readdir(path, options);
        await this.runAfter({ op: "readdir", path, result: entries });
        return entries;
    }
    readdirSync(path, options) {
        this.runBeforeSync({ op: "readdir", path });
        const entries = this.backend.readdirSync(path, options);
        this.runAfterSync({ op: "readdir", path, result: entries });
        return entries;
    }
    async mkdir(path, options) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "mkdir", path);
        }
        await this.runBefore({
            op: "mkdir",
            path,
            mode: options?.mode,
        });
        const result = await this.backend.mkdir(path, options);
        await this.runAfter({ op: "mkdir", path, result });
        return result;
    }
    mkdirSync(path, options) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "mkdir", path);
        }
        this.runBeforeSync({
            op: "mkdir",
            path,
            mode: options?.mode,
        });
        const result = this.backend.mkdirSync(path, options);
        this.runAfterSync({ op: "mkdir", path, result });
        return result;
    }
    async rmdir(path) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "rmdir", path);
        }
        await this.runBefore({ op: "rmdir", path });
        await this.backend.rmdir(path);
        await this.runAfter({ op: "rmdir", path });
    }
    rmdirSync(path) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "rmdir", path);
        }
        this.runBeforeSync({ op: "rmdir", path });
        this.backend.rmdirSync(path);
        this.runAfterSync({ op: "rmdir", path });
    }
    async unlink(path) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "unlink", path);
        }
        await this.runBefore({ op: "unlink", path });
        await this.backend.unlink(path);
        await this.runAfter({ op: "unlink", path });
    }
    unlinkSync(path) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "unlink", path);
        }
        this.runBeforeSync({ op: "unlink", path });
        this.backend.unlinkSync(path);
        this.runAfterSync({ op: "unlink", path });
    }
    async rename(oldPath, newPath) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "rename", oldPath);
        }
        await this.runBefore({ op: "rename", oldPath, newPath });
        await this.backend.rename(oldPath, newPath);
        await this.runAfter({ op: "rename", oldPath, newPath });
    }
    renameSync(oldPath, newPath) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "rename", oldPath);
        }
        this.runBeforeSync({ op: "rename", oldPath, newPath });
        this.backend.renameSync(oldPath, newPath);
        this.runAfterSync({ op: "rename", oldPath, newPath });
    }
    async link(oldPath, newPath) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "link", newPath);
        }
        await this.runBefore({ op: "link", oldPath, newPath });
        if (this.backend.link) {
            await this.backend.link(oldPath, newPath);
            await this.runAfter({ op: "link", oldPath, newPath });
            return;
        }
        throw createErrnoError(ERRNO.ENOSYS, "link", oldPath);
    }
    linkSync(oldPath, newPath) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "link", newPath);
        }
        this.runBeforeSync({ op: "link", oldPath, newPath });
        if (this.backend.linkSync) {
            this.backend.linkSync(oldPath, newPath);
            this.runAfterSync({ op: "link", oldPath, newPath });
            return;
        }
        throw createErrnoError(ERRNO.ENOSYS, "link", oldPath);
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
    async symlink(target, path, type) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "symlink", path);
        }
        if (this.backend.symlink) {
            return this.backend.symlink(target, path, type);
        }
        return super.symlink(target, path, type);
    }
    symlinkSync(target, path, type) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "symlink", path);
        }
        if (this.backend.symlinkSync) {
            return this.backend.symlinkSync(target, path, type);
        }
        return super.symlinkSync(target, path, type);
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
    async truncate(path, length) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "truncate", path);
        }
        await this.runBefore({ op: "truncate", path, size: length });
        const backendWithTruncate = this.backend;
        if (typeof backendWithTruncate.truncate === "function") {
            await backendWithTruncate.truncate(path, length);
        }
        else {
            const handle = await this.backend.open(path, "r+");
            try {
                await handle.truncate(length);
            }
            finally {
                await handle.close();
            }
        }
        await this.runAfter({ op: "truncate", path, size: length });
    }
    truncateSync(path, length) {
        if (this.readonly) {
            throw createErrnoError(ERRNO.EROFS, "truncate", path);
        }
        this.runBeforeSync({ op: "truncate", path, size: length });
        const backendWithTruncate = this.backend;
        if (typeof backendWithTruncate.truncateSync === "function") {
            backendWithTruncate.truncateSync(path, length);
        }
        else {
            const handle = this.backend.openSync(path, "r+");
            try {
                handle.truncateSync(length);
            }
            finally {
                handle.closeSync();
            }
        }
        this.runAfterSync({ op: "truncate", path, size: length });
    }
    async statfs(path) {
        await this.runBefore({ op: "statfs", path });
        const result = await delegateStatfsOrEnosys(this.backend, path);
        await this.runAfter({ op: "statfs", path, result });
        return result;
    }
    async close() {
        const backend = this.backend;
        if (backend.close) {
            await backend.close();
        }
    }
    wrapHandle(path, handle) {
        if (!this.hooks.before && !this.hooks.after) {
            return handle;
        }
        return new HookedHandle(handle, this.hooks, path);
    }
    async runBefore(context) {
        if (this.hooks.before) {
            await this.hooks.before(context);
        }
    }
    async runAfter(context) {
        if (this.hooks.after) {
            await this.hooks.after(context);
        }
    }
    runBeforeSync(context) {
        if (this.hooks.before) {
            const result = this.hooks.before(context);
            if (result && typeof result.then === "function") {
                throw new Error("async hook used in sync operation");
            }
        }
    }
    runAfterSync(context) {
        if (this.hooks.after) {
            const result = this.hooks.after(context);
            if (result && typeof result.then === "function") {
                throw new Error("async hook used in sync operation");
            }
        }
    }
}
function isPromiseLike(value) {
    return typeof value?.then === "function";
}
/** @internal */
export function composeVfsHooks(a, b) {
    if (!a || (!a.before && !a.after))
        return b ?? {};
    if (!b || (!b.before && !b.after))
        return a;
    return {
        before: (ctx) => {
            const ra = a.before?.(ctx);
            if (isPromiseLike(ra)) {
                return Promise.resolve(ra).then(() => b.before?.(ctx));
            }
            return b.before?.(ctx);
        },
        after: (ctx) => {
            const ra = a.after?.(ctx);
            if (isPromiseLike(ra)) {
                return Promise.resolve(ra).then(() => b.after?.(ctx));
            }
            return b.after?.(ctx);
        },
    };
}
/** @internal */
export function wrapProvider(provider, hooks) {
    if (provider instanceof SandboxVfsProvider)
        return provider;
    return new SandboxVfsProvider(provider, hooks);
}
//# sourceMappingURL=provider.js.map