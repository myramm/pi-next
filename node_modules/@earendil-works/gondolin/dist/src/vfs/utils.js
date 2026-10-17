import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VirtualProvider as VirtualProviderBase } from "./node/index.js";
/**
 * Base class for implementing custom VFS providers
 *
 * The upstream `VirtualProvider` value is loaded dynamically and its TypeScript
 * type is a constructor signature, which is not directly extendable. Casting it
 * once here keeps custom providers readable.
 */
export const VirtualProviderClass = VirtualProviderBase;
/** system errno constants */
export const ERRNO = os.constants.errno;
/**
 * Check if the given flag string implies a write operation
 *
 * Flags like 'w', 'w+', 'a', 'a+', 'r+' all allow writing
 */
export function isWriteFlag(flags) {
    // 'w' - write only, create/truncate
    // 'w+' - read and write, create/truncate
    // 'a' - append only
    // 'a+' - read and append
    // 'r+' - read and write
    // 'wx', 'ax' - exclusive variants
    return /[wa+]/.test(flags);
}
/**
 * Normalize an absolute POSIX path used by the VFS layer
 *
 * - Ensures a leading '/'
 * - Removes trailing '/' except for the root
 */
export function normalizeVfsPath(inputPath) {
    let normalized = path.posix.normalize(inputPath);
    if (!normalized.startsWith("/")) {
        normalized = `/${normalized}`;
    }
    if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
export class VirtualDirent {
    name;
    constructor(name) {
        this.name = name;
    }
    isFile() {
        return false;
    }
    isDirectory() {
        return true;
    }
    isSymbolicLink() {
        return false;
    }
    isBlockDevice() {
        return false;
    }
    isCharacterDevice() {
        return false;
    }
    isFIFO() {
        return false;
    }
    isSocket() {
        return false;
    }
}
export function createVirtualDirStats() {
    const now = Date.now();
    const stats = Object.create(fs.Stats.prototype);
    Object.assign(stats, {
        dev: 0,
        mode: 0o040755,
        nlink: 1,
        uid: 0,
        gid: 0,
        rdev: 0,
        blksize: 4096,
        ino: 0,
        size: 4096,
        blocks: 8,
        atimeMs: now,
        mtimeMs: now,
        ctimeMs: now,
        birthtimeMs: now,
        atime: new Date(now),
        mtime: new Date(now),
        ctime: new Date(now),
        birthtime: new Date(now),
    });
    return stats;
}
export function formatVirtualEntries(entries, withTypes) {
    if (!withTypes)
        return entries;
    return entries.map((entry) => new VirtualDirent(entry));
}
//# sourceMappingURL=utils.js.map