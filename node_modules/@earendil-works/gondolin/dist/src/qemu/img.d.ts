/** Ensure `qemu-img` can be invoked. */
export declare function ensureQemuImgAvailable(): void;
export declare function inferDiskFormatFromPath(diskPath: string): "raw" | "qcow2";
/** Parse a disk size string into `bytes`. */
export declare function parseDiskSizeToBytes(value: string | number): number;
export declare function createTempQcow2Overlay(backingPath: string, backingFormat: "raw" | "qcow2"): string;
/**
 * Move a file to a new location, falling back to copy+unlink across devices.
 */
export declare function moveFile(src: string, dst: string): void;
/**
 * Return the qcow2 backing filename recorded in the image (if any).
 *
 * Note: this is the string stored in the qcow2 metadata and may be relative.
 */
export declare function getQcow2BackingFilename(imagePath: string): string | null;
/** Return the image virtual size in `bytes`. */
export declare function getImageVirtualSizeBytes(imagePath: string): number;
/** Grow an image's virtual size to at least `bytes`. */
export declare function ensureDiskImageMinimumSize(imagePath: string, sizeBytes: number): void;
/** Resolve qcow2 backing metadata into an absolute path when present. */
export declare function resolveQcow2BackingPath(imagePath: string): string | null;
/**
 * Rebase a qcow2 image to a new backing file path in-place.
 */
export declare function rebaseQcow2InPlace(imagePath: string, backingPath: string, backingFormat: "raw" | "qcow2", mode?: "safe" | "unsafe"): void;
//# sourceMappingURL=img.d.ts.map