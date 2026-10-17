import dns from "dns";
import { Agent } from "undici";
import forge from "node-forge";
import type { HttpHooks, QemuNetworkBackend } from "../qemu/contracts.js";
import type { InternalHeaderValue, InternalHttpRequest, InternalHttpResponseHeaders } from "../internal/http-types.js";
export declare class HttpRequestBlockedError extends Error {
    status: number;
    statusText: string;
    constructor(message?: string, status?: number, statusText?: string);
}
export declare function parseHeaderLines(lines: Iterable<string>): Record<string, string | string[]>;
export declare function coalesceHeaderRecord(headers: Record<string, string | string[]>): Record<string, string>;
export declare function parseContentLength(raw: string | string[] | undefined): number | null;
export declare const MAX_HTTP_HEADER_BYTES: number;
export type HttpWireVersion = "HTTP/1.0" | "HTTP/1.1";
export declare function sendHttpResponseHead(write: (chunk: Buffer) => void, response: {
    status: number;
    statusText: string;
    headers: InternalHttpResponseHeaders;
}, httpVersion?: HttpWireVersion, encoding?: BufferEncoding): void;
export declare function sendHttpResponse(write: (chunk: Buffer) => void, response: {
    status: number;
    statusText: string;
    headers: InternalHttpResponseHeaders;
    body: Buffer;
}, httpVersion?: HttpWireVersion, encoding?: BufferEncoding): void;
export declare function isWebSocketUpgradeRequestHeaders(headers: Record<string, string | string[] | undefined>): boolean;
export declare function stripHopByHopHeaders<T extends InternalHeaderValue>(this: any, headers: Record<string, T>): Record<string, T>;
export declare function stripHopByHopHeadersForWebSocket<T extends InternalHeaderValue>(this: any, headers: Record<string, T>): Record<string, T>;
export type LookupEntry = {
    address: string;
    family: 4 | 6;
};
export type LookupResult = string | dns.LookupAddress[];
export type LookupCallback = (err: NodeJS.ErrnoException | null, address: LookupResult, family?: number) => void;
export type LookupFn = (hostname: string, options: dns.LookupOneOptions | dns.LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, address: LookupResult, family?: number) => void) => void;
export declare function createLookupGuard(info: {
    hostname: string;
    port: number;
    protocol: "http" | "https";
}, isIpAllowed: NonNullable<HttpHooks["isIpAllowed"]>, lookupFn?: LookupFn): (hostname: string, options: dns.LookupOneOptions | dns.LookupAllOptions | number, callback: LookupCallback) => void;
export declare function normalizeLookupEntries(address: LookupResult | undefined, family?: number): LookupEntry[];
type FetchResponseLike = {
    status: number;
    headers: {
        get: (name: string) => string | null;
    };
};
export declare function getRedirectUrl(response: FetchResponseLike, currentUrl: URL): URL | null;
export declare function applyRedirectRequest(request: InternalHttpRequest, status: number, sourceUrl: URL, redirectUrl: URL): InternalHttpRequest;
export declare function closeSharedDispatchers(backend: QemuNetworkBackend): void;
export declare function evictSharedDispatcher(backend: QemuNetworkBackend, originKey: string): void;
export declare function getCheckedDispatcher(backend: QemuNetworkBackend, info: {
    hostname: string;
    port: number;
    protocol: "http" | "https";
}): Agent | null;
export declare function caCertVerifiesLeaf(caCert: forge.pki.Certificate, leafCert: forge.pki.Certificate): boolean;
export declare function privateKeyMatchesLeafCert(keyPem: string, leafCert: forge.pki.Certificate): boolean;
export type HttpRequestData = {
    method: string;
    target: string;
    version: string;
    headers: Record<string, string>;
    body: Buffer;
};
export declare class HttpReceiveBuffer {
    private readonly chunks;
    private totalBytes;
    get length(): number;
    append(chunk: Buffer): void;
    resetTo(buffer: Buffer): void;
    /**
     * Find the start offset of the first "\r\n\r\n" sequence or -1 if missing
     */
    findHeaderEnd(maxSearchBytes: number): number;
    /**
     * Copies the first `n` bytes into a contiguous Buffer
     */
    prefix(n: number): Buffer;
    /**
     * Copies the bytes from `start` (inclusive) to the end into a contiguous Buffer
     */
    suffix(start: number): Buffer;
    cursor(start?: number): HttpReceiveCursor;
    toBuffer(): Buffer;
}
export declare class HttpReceiveCursor {
    private chunkIndex;
    private chunkOffset;
    offset: number;
    private readonly chunks;
    private readonly totalBytes;
    constructor(chunks: Buffer[], totalBytes: number, startOffset: number);
    private cloneState;
    private commitState;
    private readByteFrom;
    remaining(): number;
    tryConsumeSequenceIfPresent(sequence: number[]): boolean | null;
    tryConsumeExactSequence(sequence: number[]): boolean | null;
    tryReadLineAscii(maxBytes: number): string | null;
    tryReadBytes(n: number): Buffer | null;
    tryConsumeUntilDoubleCrlf(): boolean | null;
}
export {};
//# sourceMappingURL=utils.d.ts.map