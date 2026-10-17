import type { TarEntry } from "./types.js";
/** Parse a raw tar archive buffer into entries */
export declare function parseTar(buf: Buffer): TarEntry[];
/** Decompress a .tar.gz file and return the raw tar buffer */
export declare function decompressTarGz(filePath: string): Promise<Buffer>;
/** Extract a .tar.gz file into a directory (safe against symlink traversal) */
export declare function extractTarGz(tarGzPath: string, destDir: string): Promise<void>;
/** Extract tar entries into a directory with symlink-safety checks */
export declare function extractEntries(entries: TarEntry[], destDir: string): void;
//# sourceMappingURL=tar.d.ts.map