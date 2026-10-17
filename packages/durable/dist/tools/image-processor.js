export const DEFAULT_IMAGE_LIMITS = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 };
/** Formats every provider takes inline; others, such as BMP, need converting. */
export const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/**
 * Standard base64 of `bytes`. `btoa` takes a binary string, built 8 KiB at a time: a single `String.fromCharCode`
 * call with megabytes of arguments overflows the stack.
 */
export function toBase64(bytes) {
    const parts = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        // `apply` takes any array-like, though its type asks for an array.
        parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)));
    }
    return btoa(parts.join(""));
}
/** The length of the base64 of `byteLength` bytes. */
export function base64Length(byteLength) {
    return Math.ceil(byteLength / 3) * 4;
}
//# sourceMappingURL=image-processor.js.map