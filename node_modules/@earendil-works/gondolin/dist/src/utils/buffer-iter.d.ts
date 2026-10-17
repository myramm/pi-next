import { Readable } from "stream";
export type BufferIterableChunk = Buffer | Uint8Array | string;
export type BufferIterableInput = BufferIterableChunk | Readable | AsyncIterable<BufferIterableChunk>;
/**
 * Normalize supported input types into an async iterable of Buffer chunks.
 */
export declare function toBufferIterable(input: BufferIterableInput, options?: {
    /** string encoding for top-level strings and string chunks */
    encoding?: BufferEncoding;
}): AsyncIterable<Buffer>;
//# sourceMappingURL=buffer-iter.d.ts.map