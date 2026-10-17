import fs from "node:fs";
import os from "node:os";
/**
 * Base class for implementing custom VFS providers
 *
 * The upstream `VirtualProvider` value is loaded dynamically and its TypeScript
 * type is a constructor signature, which is not directly extendable. Casting it
 * once here keeps custom providers readable.
 */
export declare const VirtualProviderClass: {
    new (...args: any[]): any;
};
/** system errno constants */
export declare const ERRNO: typeof os.constants.errno;
/**
 * Check if the given flag string implies a write operation
 *
 * Flags like 'w', 'w+', 'a', 'a+', 'r+' all allow writing
 */
export declare function isWriteFlag(flags: string): boolean;
/**
 * Normalize an absolute POSIX path used by the VFS layer
 *
 * - Ensures a leading '/'
 * - Removes trailing '/' except for the root
 */
export declare function normalizeVfsPath(inputPath: string): string;
export declare class VirtualDirent {
    readonly name: string;
    constructor(name: string);
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
}
export declare function createVirtualDirStats(): fs.Stats;
export declare function formatVirtualEntries(entries: string[], withTypes: boolean): string[] | fs.Dirent<string>[];
//# sourceMappingURL=utils.d.ts.map