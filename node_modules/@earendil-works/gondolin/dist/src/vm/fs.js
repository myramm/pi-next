import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { toBufferIterable } from "../utils/buffer-iter.js";
import { getRelativePath, isNoEntryError, isUnderMountPoint, } from "../vfs/mounts.js";
import { normalizeVfsPath } from "../vfs/utils.js";
const DEFAULT_VFS_FILE_CHUNK_SIZE = 64 * 1024;
export class VmFsController {
    options;
    constructor(options) {
        this.options = options;
    }
    async access(filePath, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const mode = normalizeAccessMode(options.mode);
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        if (vfsPath) {
            const vfs = this.options.vfs;
            if (!vfs) {
                throw new Error("vfs provider is not available");
            }
            try {
                assertNotAborted(options.signal, "file access aborted");
                await vfs.access(vfsPath, mode);
                return;
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to access guest file '${filePath}': ${detail}`);
            }
        }
        const shouldCheckRead = (mode & fs.constants.R_OK) !== 0;
        const shouldCheckWrite = (mode & fs.constants.W_OK) !== 0;
        const shouldCheckExec = (mode & fs.constants.X_OK) !== 0;
        const script = [
            "set -eu",
            'entry="$1"',
            '[ -e "$entry" ]',
            'if [ "$2" = "1" ]; then [ -r "$entry" ]; fi',
            'if [ "$3" = "1" ]; then [ -w "$entry" ]; fi',
            'if [ "$4" = "1" ]; then [ -x "$entry" ]; fi',
        ].join("\n");
        const result = await this.options.exec([
            "/bin/sh",
            "-c",
            script,
            "sh",
            filePath,
            shouldCheckRead ? "1" : "0",
            shouldCheckWrite ? "1" : "0",
            shouldCheckExec ? "1" : "0",
        ], {
            cwd: options.cwd,
            signal: options.signal,
        });
        if (result.exitCode !== 0) {
            throw new Error(`failed to access guest file '${filePath}': ${formatExecFailure(result)}`);
        }
    }
    async mkdir(dirPath, options = {}) {
        if (typeof dirPath !== "string" || dirPath.length === 0) {
            throw new Error("dirPath must be a non-empty string");
        }
        const normalizedMode = normalizeMkdirMode(options.mode);
        const vfsPath = this.resolveVfsShortcutPath(dirPath, options.cwd);
        if (vfsPath) {
            const vfs = this.options.vfs;
            if (!vfs) {
                throw new Error("vfs provider is not available");
            }
            try {
                assertNotAborted(options.signal, "mkdir aborted");
                const mkdirOptions = options.recursive || normalizedMode !== undefined
                    ? {
                        recursive: options.recursive,
                        mode: normalizedMode,
                    }
                    : undefined;
                await vfs.mkdir(vfsPath, mkdirOptions);
                return;
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to create guest directory '${dirPath}': ${detail}`);
            }
        }
        const modeText = normalizedMode === undefined ? "" : normalizedMode.toString(8);
        const script = [
            "set -eu",
            'entry="$1"',
            'mode="$2"',
            'recursive="$3"',
            'if [ "$recursive" = "1" ]; then',
            '  if [ -n "$mode" ]; then mkdir -p -m "$mode" "$entry"; else mkdir -p "$entry"; fi',
            "else",
            '  if [ -n "$mode" ]; then mkdir -m "$mode" "$entry"; else mkdir "$entry"; fi',
            "fi",
        ].join("\n");
        const result = await this.options.exec([
            "/bin/sh",
            "-c",
            script,
            "sh",
            dirPath,
            modeText,
            options.recursive ? "1" : "0",
        ], {
            cwd: options.cwd,
            signal: options.signal,
        });
        if (result.exitCode !== 0) {
            throw new Error(`failed to create guest directory '${dirPath}': ${formatExecFailure(result)}`);
        }
    }
    async listDir(dirPath, options = {}) {
        if (typeof dirPath !== "string" || dirPath.length === 0) {
            throw new Error("dirPath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(dirPath, options.cwd);
        if (vfsPath) {
            const vfs = this.options.vfs;
            if (!vfs) {
                throw new Error("vfs provider is not available");
            }
            try {
                assertNotAborted(options.signal, "list directory aborted");
                const entries = await vfs.readdir(vfsPath, { withFileTypes: true });
                return entries.map((entry) => typeof entry === "string" ? entry : entry.name);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to list guest directory '${dirPath}': ${detail}`);
            }
        }
        const script = [
            "set -eu",
            'entry="$1"',
            '[ -d "$entry" ]',
            'exec /bin/ls -1A -- "$entry"',
        ].join("\n");
        const result = await this.options.exec(["/bin/sh", "-c", script, "sh", dirPath], {
            cwd: options.cwd,
            signal: options.signal,
        });
        if (result.exitCode !== 0) {
            throw new Error(`failed to list guest directory '${dirPath}': ${formatExecFailure(result)}`);
        }
        return splitOutputLines(result.stdout);
    }
    async stat(filePath, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        if (vfsPath) {
            const vfs = this.options.vfs;
            if (!vfs) {
                throw new Error("vfs provider is not available");
            }
            try {
                assertNotAborted(options.signal, "file stat aborted");
                return await vfs.stat(vfsPath);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to stat guest file '${filePath}': ${detail}`);
            }
        }
        const script = [
            "set -eu",
            'entry="$1"',
            'exec stat -Lc "%f|%d|%i|%h|%u|%g|%r|%s|%B|%b|%X|%Y|%Z" -- "$entry"',
        ].join("\n");
        const result = await this.options.exec(["/bin/sh", "-c", script, "sh", filePath], {
            cwd: options.cwd,
            signal: options.signal,
        });
        if (result.exitCode !== 0) {
            throw new Error(`failed to stat guest file '${filePath}': ${formatExecFailure(result)}`);
        }
        try {
            return parseGuestStatOutput(result.stdout);
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`failed to stat guest file '${filePath}': ${detail}`);
        }
    }
    async rename(oldPath, newPath, options = {}) {
        if (typeof oldPath !== "string" || oldPath.length === 0) {
            throw new Error("oldPath must be a non-empty string");
        }
        if (typeof newPath !== "string" || newPath.length === 0) {
            throw new Error("newPath must be a non-empty string");
        }
        const oldVfsPath = this.resolveVfsShortcutPath(oldPath, options.cwd);
        const newVfsPath = this.resolveVfsShortcutPath(newPath, options.cwd);
        if (oldVfsPath && newVfsPath) {
            const vfs = this.options.vfs;
            if (!vfs) {
                throw new Error("vfs provider is not available");
            }
            try {
                assertNotAborted(options.signal, "rename aborted");
                await vfs.rename(oldVfsPath, newVfsPath);
                return;
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to rename guest path '${oldPath}' to '${newPath}': ${detail}`);
            }
        }
        const script = [
            "set -eu",
            'src="$1"',
            'dst="$2"',
            'exec mv -- "$src" "$dst"',
        ].join("\n");
        const result = await this.options.exec(["/bin/sh", "-c", script, "sh", oldPath, newPath], {
            cwd: options.cwd,
            signal: options.signal,
        });
        if (result.exitCode !== 0) {
            throw new Error(`failed to rename guest path '${oldPath}' to '${newPath}': ${formatExecFailure(result)}`);
        }
    }
    async readFileStream(filePath, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        if (vfsPath) {
            try {
                return this.readFileStreamFromVfs(vfsPath, options);
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to stream guest file '${filePath}': ${detail}`);
            }
        }
        await this.options.start();
        const server = this.options.getServer();
        if (!server) {
            throw new Error("sandbox server is not available");
        }
        try {
            return await server.readGuestFileStream(filePath, {
                cwd: options.cwd,
                chunkSize: options.chunkSize,
                highWaterMark: options.highWaterMark,
                signal: options.signal,
            });
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`failed to stream guest file '${filePath}': ${detail}`);
        }
    }
    async readFile(filePath, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        let data;
        if (vfsPath) {
            try {
                data = await this.readFileFromVfs(vfsPath, {
                    chunkSize: options.chunkSize,
                    signal: options.signal,
                });
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to read guest file '${filePath}': ${detail}`);
            }
        }
        else {
            await this.options.start();
            const server = this.options.getServer();
            if (!server) {
                throw new Error("sandbox server is not available");
            }
            try {
                data = await server.readGuestFile(filePath, {
                    cwd: options.cwd,
                    chunkSize: options.chunkSize,
                    signal: options.signal,
                });
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to read guest file '${filePath}': ${detail}`);
            }
        }
        if ("encoding" in options && options.encoding) {
            return data.toString(options.encoding);
        }
        return data;
    }
    async writeFile(filePath, data, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        const payload = typeof data === "string"
            ? Buffer.from(data, options.encoding ?? "utf-8")
            : data;
        if (vfsPath) {
            try {
                await this.writeFileToVfs(vfsPath, payload, options.signal);
                return;
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to write guest file '${filePath}': ${detail}`);
            }
        }
        await this.options.start();
        const server = this.options.getServer();
        if (!server) {
            throw new Error("sandbox server is not available");
        }
        try {
            await server.writeGuestFile(filePath, payload, {
                cwd: options.cwd,
                signal: options.signal,
            });
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`failed to write guest file '${filePath}': ${detail}`);
        }
    }
    async deleteFile(filePath, options = {}) {
        if (typeof filePath !== "string" || filePath.length === 0) {
            throw new Error("filePath must be a non-empty string");
        }
        const vfsPath = this.resolveVfsShortcutPath(filePath, options.cwd);
        if (vfsPath) {
            try {
                await this.deleteVfsPath(vfsPath, {
                    force: options.force,
                    recursive: options.recursive,
                    signal: options.signal,
                });
                return;
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                throw new Error(`failed to delete guest file '${filePath}': ${detail}`);
            }
        }
        await this.options.start();
        const server = this.options.getServer();
        if (!server) {
            throw new Error("sandbox server is not available");
        }
        try {
            await server.deleteGuestFile(filePath, {
                force: options.force,
                recursive: options.recursive,
                cwd: options.cwd,
                signal: options.signal,
            });
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`failed to delete guest file '${filePath}': ${detail}`);
        }
    }
    resolveVfsShortcutPath(filePath, cwd) {
        if (!this.options.vfs)
            return null;
        const absolutePath = resolveAbsoluteGuestPath(filePath, cwd);
        if (!absolutePath)
            return null;
        for (const mountPath of this.options.shortcutBindMounts) {
            if (isUnderMountPoint(absolutePath, mountPath)) {
                return absolutePath;
            }
        }
        if (isUnderMountPoint(absolutePath, this.options.fuseMount)) {
            return getRelativePath(absolutePath, this.options.fuseMount);
        }
        return null;
    }
    readFileStreamFromVfs(filePath, options) {
        assertNotAborted(options.signal, "file read aborted");
        const chunkSize = normalizePositiveInt(options.chunkSize, DEFAULT_VFS_FILE_CHUNK_SIZE) ??
            DEFAULT_VFS_FILE_CHUNK_SIZE;
        const highWaterMark = normalizePositiveInt(options.highWaterMark);
        const stream = Readable.from(this.iterateVfsFileChunks(filePath, chunkSize, options.signal), highWaterMark
            ? { objectMode: false, highWaterMark }
            : { objectMode: false });
        stream.on("error", () => {
            // keep process alive if caller does not attach an error handler
        });
        return stream;
    }
    async readFileFromVfs(filePath, options) {
        const chunkSize = normalizePositiveInt(options.chunkSize, DEFAULT_VFS_FILE_CHUNK_SIZE) ??
            DEFAULT_VFS_FILE_CHUNK_SIZE;
        const chunks = [];
        for await (const chunk of this.iterateVfsFileChunks(filePath, chunkSize, options.signal)) {
            chunks.push(chunk);
        }
        return Buffer.concat(chunks);
    }
    async *iterateVfsFileChunks(filePath, chunkSize, signal) {
        const vfs = this.options.vfs;
        if (!vfs) {
            throw new Error("vfs provider is not available");
        }
        assertNotAborted(signal, "file read aborted");
        const handle = await vfs.open(filePath, "r");
        try {
            const buffer = Buffer.alloc(chunkSize);
            let offset = 0;
            while (true) {
                assertNotAborted(signal, "file read aborted");
                const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
                if (bytesRead === 0) {
                    return;
                }
                offset += bytesRead;
                yield Buffer.from(buffer.subarray(0, bytesRead));
            }
        }
        finally {
            await handle.close();
        }
    }
    async writeFileToVfs(filePath, input, signal) {
        const vfs = this.options.vfs;
        if (!vfs) {
            throw new Error("vfs provider is not available");
        }
        assertNotAborted(signal, "file write aborted");
        const handle = await vfs.open(filePath, "w");
        try {
            let position = 0;
            for await (const chunk of toBufferIterable(input)) {
                assertNotAborted(signal, "file write aborted");
                let offset = 0;
                while (offset < chunk.length) {
                    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, position + offset);
                    if (bytesWritten <= 0) {
                        throw new Error("short write");
                    }
                    offset += bytesWritten;
                }
                position += chunk.length;
            }
        }
        finally {
            await handle.close();
        }
    }
    async deleteVfsPath(filePath, options) {
        const vfs = this.options.vfs;
        if (!vfs) {
            throw new Error("vfs provider is not available");
        }
        try {
            assertNotAborted(options.signal, "file delete aborted");
            if (!options.recursive) {
                await vfs.unlink(filePath);
                return;
            }
            const stats = await vfs.lstat(filePath);
            if (stats.isDirectory()) {
                await this.deleteVfsTree(filePath, options.signal);
            }
            else {
                await vfs.unlink(filePath);
            }
        }
        catch (err) {
            if (options.force && isNoEntryError(err)) {
                return;
            }
            throw err;
        }
    }
    async deleteVfsTree(filePath, signal) {
        const vfs = this.options.vfs;
        if (!vfs) {
            throw new Error("vfs provider is not available");
        }
        assertNotAborted(signal, "file delete aborted");
        const entries = await vfs.readdir(filePath, { withFileTypes: true });
        for (const entry of entries) {
            assertNotAborted(signal, "file delete aborted");
            const name = typeof entry === "string" ? entry : entry.name;
            if (!name || name === "." || name === "..") {
                continue;
            }
            const childPath = path.posix.join(filePath, name);
            const isDir = typeof entry === "string"
                ? (await vfs.lstat(childPath)).isDirectory()
                : entry.isDirectory() && !entry.isSymbolicLink();
            if (isDir) {
                await this.deleteVfsTree(childPath, signal);
            }
            else {
                await vfs.unlink(childPath);
            }
        }
        await vfs.rmdir(filePath);
    }
}
function resolveAbsoluteGuestPath(filePath, cwd) {
    if (filePath.startsWith("/")) {
        return normalizeVfsPath(filePath);
    }
    if (!cwd || !cwd.startsWith("/")) {
        return null;
    }
    return normalizeVfsPath(path.posix.join(cwd, filePath));
}
function normalizePositiveInt(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.trunc(value);
}
function assertNotAborted(signal, message) {
    if (signal?.aborted) {
        throw new Error(message);
    }
}
function normalizeAccessMode(mode) {
    if (mode === undefined) {
        return fs.constants.F_OK;
    }
    if (!Number.isInteger(mode) || mode < 0) {
        throw new Error("mode must be a non-negative integer");
    }
    const allowed = fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK;
    if ((mode & ~allowed) !== 0) {
        throw new Error("mode can only contain fs.constants.R_OK, W_OK, and X_OK");
    }
    return mode;
}
function normalizeMkdirMode(mode) {
    if (mode === undefined) {
        return undefined;
    }
    if (!Number.isInteger(mode) || mode < 0) {
        throw new Error("mode must be a non-negative integer");
    }
    if (mode > 0o7777) {
        throw new Error("mode must fit in permission bits (max 0o7777)");
    }
    return mode;
}
function parseGuestStatOutput(stdout) {
    const line = stdout.trim();
    const parts = line.split("|");
    if (parts.length !== 13) {
        throw new Error(`invalid stat output: ${JSON.stringify(line)}`);
    }
    const mode = parseInteger(parts[0], 16, "mode");
    const dev = parseInteger(parts[1], 10, "dev");
    const ino = parseInteger(parts[2], 10, "ino");
    const nlink = parseInteger(parts[3], 10, "nlink");
    const uid = parseInteger(parts[4], 10, "uid");
    const gid = parseInteger(parts[5], 10, "gid");
    const rdev = parseInteger(parts[6], 10, "rdev", 0);
    const size = parseInteger(parts[7], 10, "size");
    const blksize = parseInteger(parts[8], 10, "blksize", 4096);
    const blocks = parseInteger(parts[9], 10, "blocks", Math.max(1, Math.ceil(size / Math.max(blksize, 1))));
    const atimeMs = parseInteger(parts[10], 10, "atime") * 1000;
    const mtimeMs = parseInteger(parts[11], 10, "mtime") * 1000;
    const ctimeMs = parseInteger(parts[12], 10, "ctime") * 1000;
    const birthtimeMs = ctimeMs;
    const stats = Object.create(fs.Stats.prototype);
    Object.assign(stats, {
        dev,
        mode,
        nlink,
        uid,
        gid,
        rdev,
        blksize,
        ino,
        size,
        blocks,
        atimeMs,
        mtimeMs,
        ctimeMs,
        birthtimeMs,
        atime: new Date(atimeMs),
        mtime: new Date(mtimeMs),
        ctime: new Date(ctimeMs),
        birthtime: new Date(birthtimeMs),
    });
    return stats;
}
function parseInteger(value, radix, field, fallback) {
    const parsed = parseInt(value, radix);
    if (!Number.isFinite(parsed)) {
        if (fallback !== undefined) {
            return fallback;
        }
        throw new Error(`invalid ${field} in stat output: ${JSON.stringify(value)}`);
    }
    return parsed;
}
function formatExecFailure(result) {
    const stderr = result.stderr.trim();
    if (stderr.length > 0) {
        return stderr;
    }
    if (typeof result.signal === "number") {
        return `signal ${result.signal}`;
    }
    return `exit ${result.exitCode}`;
}
function splitOutputLines(value) {
    if (value.length === 0) {
        return [];
    }
    const lines = value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}
//# sourceMappingURL=fs.js.map