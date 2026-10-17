import net from "net";
import dns from "dns";
import { Agent } from "undici";
import forge from "node-forge";
export class HttpRequestBlockedError extends Error {
    status;
    statusText;
    constructor(message = "request blocked", status = 403, statusText = "Forbidden") {
        super(message);
        this.name = "HttpRequestBlockedError";
        this.status = status;
        this.statusText = statusText;
    }
}
export function parseHeaderLines(lines) {
    const headers = {};
    for (const line of lines) {
        if (!line)
            continue;
        const idx = line.indexOf(":");
        if (idx === -1)
            continue;
        const key = line.slice(0, idx).trim().toLowerCase();
        if (!key)
            continue;
        const value = line.slice(idx + 1).trim();
        const prev = headers[key];
        if (prev === undefined) {
            headers[key] = value;
        }
        else if (Array.isArray(prev)) {
            prev.push(value);
        }
        else {
            headers[key] = [prev, value];
        }
    }
    return headers;
}
export function coalesceHeaderRecord(headers) {
    // Use WHATWG Headers for coalescing rules (notably Cookie uses `; `
    // instead of `, `).
    const h = new Headers();
    for (const [key, value] of Object.entries(headers)) {
        if (Array.isArray(value)) {
            for (const v of value) {
                h.append(key, v);
            }
        }
        else {
            h.append(key, value);
        }
    }
    const out = {};
    for (const [key] of h) {
        const value = h.get(key);
        if (value !== null) {
            out[key.toLowerCase()] = value;
        }
    }
    return out;
}
export function parseContentLength(raw) {
    if (raw === undefined)
        return null;
    const rawString = Array.isArray(raw) ? raw.join(",") : raw;
    const n = Number.parseInt(rawString, 10);
    if (!Number.isSafeInteger(n) || n < 0) {
        return null;
    }
    return n;
}
export const MAX_HTTP_HEADER_BYTES = 64 * 1024;
function renderHttpResponseHead(response, httpVersion = "HTTP/1.1") {
    const statusLine = `${httpVersion} ${response.status} ${response.statusText}\r\n`;
    const headerLines = [];
    for (const [rawName, rawValue] of Object.entries(response.headers)) {
        const name = rawName.replace(/[\r\n:]+/g, "");
        if (!name)
            continue;
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        for (const v of values) {
            const value = String(v).replace(/[\r\n]+/g, " ");
            headerLines.push(`${name}: ${value}`);
        }
    }
    let headerBlock = statusLine;
    if (headerLines.length > 0) {
        headerBlock += headerLines.join("\r\n") + "\r\n";
    }
    headerBlock += "\r\n";
    return headerBlock;
}
export function sendHttpResponseHead(write, response, httpVersion = "HTTP/1.1", encoding = "utf8") {
    const head = renderHttpResponseHead(response, httpVersion);
    write(Buffer.from(head, encoding));
}
export function sendHttpResponse(write, response, httpVersion = "HTTP/1.1", encoding = "utf8") {
    sendHttpResponseHead(write, response, httpVersion, encoding);
    if (response.body.length > 0) {
        write(response.body);
    }
}
function joinInternalHeaderValue(raw) {
    if (typeof raw === "string")
        return raw;
    if (Array.isArray(raw))
        return raw.join(",");
    return "";
}
export function isWebSocketUpgradeRequestHeaders(headers) {
    const upgrade = joinInternalHeaderValue(headers["upgrade"]).toLowerCase();
    if (upgrade === "websocket")
        return true;
    // Some clients omit Upgrade/Connection but include the WebSocket-specific headers.
    if (headers["sec-websocket-key"] || headers["sec-websocket-version"]) {
        return true;
    }
    return false;
}
const HOP_BY_HOP_HEADERS = new Set([
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
]);
const DEFAULT_SHARED_UPSTREAM_CONNECTIONS_PER_ORIGIN = 16;
const DEFAULT_SHARED_UPSTREAM_MAX_ORIGINS = 512;
const DEFAULT_SHARED_UPSTREAM_IDLE_TTL_MS = 30 * 1000;
export function stripHopByHopHeaders(headers) {
    const connectionValue = headers["connection"];
    const connection = Array.isArray(connectionValue)
        ? connectionValue.join(",")
        : typeof connectionValue === "string"
            ? connectionValue
            : "";
    const connectionTokens = new Set();
    if (connection) {
        for (const token of connection.split(",")) {
            const normalized = token.trim().toLowerCase();
            if (normalized)
                connectionTokens.add(normalized);
        }
    }
    const output = {};
    for (const [name, value] of Object.entries(headers)) {
        const normalizedName = name.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(normalizedName))
            continue;
        if (connectionTokens.has(normalizedName))
            continue;
        output[normalizedName] = value;
    }
    return output;
}
export function stripHopByHopHeadersForWebSocket(headers) {
    const out = { ...headers };
    // Unlike normal HTTP proxying, WebSocket handshakes require forwarding Connection/Upgrade
    // Still strip proxy-only and framing hop-by-hop headers
    delete out["keep-alive"];
    delete out["proxy-connection"];
    delete out["proxy-authenticate"];
    delete out["proxy-authorization"];
    // No request bodies for WebSocket handshake
    delete out["content-length"];
    delete out["transfer-encoding"];
    delete out["expect"];
    // Avoid forwarding framed/trailer-related hop-by-hop headers
    delete out["te"];
    delete out["trailer"];
    // Apply Connection: token stripping, but keep Upgrade + WebSocket-specific headers
    const connectionValue = out["connection"];
    const connection = Array.isArray(connectionValue)
        ? connectionValue.join(",")
        : typeof connectionValue === "string"
            ? connectionValue
            : "";
    const tokens = connection
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    const keepNominated = new Set([
        "upgrade",
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-protocol",
        "sec-websocket-extensions",
    ]);
    for (const token of tokens) {
        if (keepNominated.has(token))
            continue;
        delete out[token];
    }
    return out;
}
export function createLookupGuard(info, isIpAllowed, lookupFn = dns.lookup.bind(dns)) {
    return (hostname, options, callback) => {
        const normalizedOptions = normalizeLookupOptions(options);
        lookupFn(hostname, normalizedOptions, (err, address, family) => {
            if (err) {
                callback(err, normalizeLookupFailure(normalizedOptions));
                return;
            }
            void (async () => {
                const entries = normalizeLookupEntries(address, family);
                if (entries.length === 0) {
                    callback(new Error("DNS lookup returned no addresses"), normalizeLookupFailure(normalizedOptions));
                    return;
                }
                const allowedEntries = [];
                for (const entry of entries) {
                    const allowed = await isIpAllowed({
                        hostname: info.hostname,
                        ip: entry.address,
                        family: entry.family,
                        port: info.port,
                        protocol: info.protocol,
                    });
                    if (allowed) {
                        if (!normalizedOptions.all) {
                            callback(null, entry.address, entry.family);
                            return;
                        }
                        allowedEntries.push(entry);
                    }
                }
                if (normalizedOptions.all && allowedEntries.length > 0) {
                    callback(null, allowedEntries.map((entry) => ({
                        address: entry.address,
                        family: entry.family,
                    })));
                    return;
                }
                callback(new HttpRequestBlockedError(`blocked by policy: ${info.hostname}`), normalizeLookupFailure(normalizedOptions));
            })().catch((error) => {
                callback(error, normalizeLookupFailure(normalizedOptions));
            });
        });
    };
}
export function normalizeLookupEntries(address, family) {
    if (!address)
        return [];
    if (Array.isArray(address)) {
        return address
            .map((entry) => {
            const family = entry.family === 6 ? 6 : 4;
            return {
                address: entry.address,
                family: family,
            };
        })
            .filter((entry) => Boolean(entry.address));
    }
    const resolvedFamily = family === 6 || family === 4 ? family : net.isIP(address);
    if (resolvedFamily !== 4 && resolvedFamily !== 6)
        return [];
    return [{ address, family: resolvedFamily }];
}
function normalizeLookupOptions(options) {
    if (typeof options === "number") {
        return { family: options };
    }
    return options;
}
function normalizeLookupFailure(options) {
    return options.all ? [] : "";
}
function normalizeOriginPort(url) {
    if (url.port)
        return url.port;
    if (url.protocol === "https:")
        return "443";
    if (url.protocol === "http:")
        return "80";
    return "";
}
function isSameOrigin(a, b) {
    return (a.protocol === b.protocol &&
        a.hostname.toLowerCase() === b.hostname.toLowerCase() &&
        normalizeOriginPort(a) === normalizeOriginPort(b));
}
export function getRedirectUrl(response, currentUrl) {
    if (![301, 302, 303, 307, 308].includes(response.status))
        return null;
    const location = response.headers.get("location");
    if (!location)
        return null;
    try {
        return new URL(location, currentUrl);
    }
    catch {
        return null;
    }
}
export function applyRedirectRequest(request, status, sourceUrl, redirectUrl) {
    let method = request.method;
    let body = request.body;
    if (status === 303 && method !== "GET" && method !== "HEAD") {
        method = "GET";
        body = null;
    }
    else if ((status === 301 || status === 302) && method === "POST") {
        method = "GET";
        body = null;
    }
    const headers = { ...request.headers };
    if (headers.host) {
        headers.host = redirectUrl.host;
    }
    if (!isSameOrigin(sourceUrl, redirectUrl)) {
        // Do not forward credentials across origins
        delete headers.authorization;
        delete headers.cookie;
    }
    if (!body || method === "GET" || method === "HEAD") {
        delete headers["content-length"];
        delete headers["content-type"];
        delete headers["transfer-encoding"];
    }
    return {
        method,
        url: redirectUrl.toString(),
        headers,
        body,
    };
}
export function closeSharedDispatchers(backend) {
    for (const entry of backend.http.sharedDispatchers.values()) {
        try {
            entry.dispatcher.close();
        }
        catch {
            // ignore
        }
    }
    backend.http.sharedDispatchers.clear();
}
export function evictSharedDispatcher(backend, originKey) {
    const entry = backend.http.sharedDispatchers.get(originKey);
    if (!entry)
        return;
    backend.http.sharedDispatchers.delete(originKey);
    try {
        entry.dispatcher.close();
    }
    catch {
        // ignore
    }
}
function pruneSharedDispatchers(backend, now = Date.now()) {
    if (backend.http.sharedDispatchers.size === 0)
        return;
    for (const [key, entry] of backend.http.sharedDispatchers) {
        if (now - entry.lastUsedAt <= DEFAULT_SHARED_UPSTREAM_IDLE_TTL_MS)
            continue;
        evictSharedDispatcher(backend, key);
    }
}
function evictSharedDispatchersIfNeeded(backend) {
    while (backend.http.sharedDispatchers.size > DEFAULT_SHARED_UPSTREAM_MAX_ORIGINS) {
        const oldestKey = backend.http.sharedDispatchers.keys().next().value;
        if (!oldestKey)
            break;
        evictSharedDispatcher(backend, oldestKey);
    }
}
export function getCheckedDispatcher(backend, info) {
    const isIpAllowed = backend.options.httpHooks?.isIpAllowed;
    if (!isIpAllowed)
        return null;
    pruneSharedDispatchers(backend);
    const key = `${info.protocol}://${info.hostname}:${info.port}`;
    const cached = backend.http.sharedDispatchers.get(key);
    if (cached) {
        cached.lastUsedAt = Date.now();
        // LRU: move to map tail
        backend.http.sharedDispatchers.delete(key);
        backend.http.sharedDispatchers.set(key, cached);
        return cached.dispatcher;
    }
    const lookupFn = createLookupGuard({
        hostname: info.hostname,
        port: info.port,
        protocol: info.protocol,
    }, isIpAllowed);
    const dispatcher = new Agent({
        connect: { lookup: lookupFn },
        connections: DEFAULT_SHARED_UPSTREAM_CONNECTIONS_PER_ORIGIN,
    });
    backend.http.sharedDispatchers.set(key, {
        dispatcher,
        lastUsedAt: Date.now(),
    });
    evictSharedDispatchersIfNeeded(backend);
    return dispatcher;
}
export function caCertVerifiesLeaf(caCert, leafCert) {
    try {
        return caCert.verify(leafCert);
    }
    catch {
        return false;
    }
}
export function privateKeyMatchesLeafCert(keyPem, leafCert) {
    try {
        const privateKey = forge.pki.privateKeyFromPem(keyPem);
        const publicKey = leafCert.publicKey;
        return (privateKey.n.toString(16) === publicKey.n.toString(16) &&
            privateKey.e.toString(16) === publicKey.e.toString(16));
    }
    catch {
        return false;
    }
}
export class HttpReceiveBuffer {
    chunks = [];
    totalBytes = 0;
    get length() {
        return this.totalBytes;
    }
    append(chunk) {
        if (chunk.length === 0)
            return;
        this.chunks.push(chunk);
        this.totalBytes += chunk.length;
    }
    resetTo(buffer) {
        this.chunks.length = 0;
        this.totalBytes = 0;
        this.append(buffer);
    }
    /**
     * Find the start offset of the first "\r\n\r\n" sequence or -1 if missing
     */
    findHeaderEnd(maxSearchBytes) {
        const pattern = [0x0d, 0x0a, 0x0d, 0x0a];
        let matched = 0;
        let index = 0;
        for (const chunk of this.chunks) {
            for (let i = 0; i < chunk.length; i += 1) {
                if (index >= maxSearchBytes)
                    return -1;
                const b = chunk[i];
                if (b === pattern[matched]) {
                    matched += 1;
                    if (matched === pattern.length) {
                        return index - (pattern.length - 1);
                    }
                }
                else {
                    // Only possible overlap is a new '\r'.
                    matched = b === pattern[0] ? 1 : 0;
                }
                index += 1;
            }
        }
        return -1;
    }
    /**
     * Copies the first `n` bytes into a contiguous Buffer
     */
    prefix(n) {
        if (n <= 0)
            return Buffer.alloc(0);
        if (n >= this.totalBytes)
            return this.toBuffer();
        const out = Buffer.allocUnsafe(n);
        let written = 0;
        for (const chunk of this.chunks) {
            if (written >= n)
                break;
            const remaining = n - written;
            const take = Math.min(remaining, chunk.length);
            chunk.copy(out, written, 0, take);
            written += take;
        }
        return out;
    }
    /**
     * Copies the bytes from `start` (inclusive) to the end into a contiguous Buffer
     */
    suffix(start) {
        if (start <= 0)
            return this.toBuffer();
        if (start >= this.totalBytes)
            return Buffer.alloc(0);
        const outLen = this.totalBytes - start;
        const out = Buffer.allocUnsafe(outLen);
        let written = 0;
        let skipped = 0;
        for (const chunk of this.chunks) {
            if (skipped + chunk.length <= start) {
                skipped += chunk.length;
                continue;
            }
            const chunkStart = Math.max(0, start - skipped);
            const take = chunk.length - chunkStart;
            chunk.copy(out, written, chunkStart, chunkStart + take);
            written += take;
            skipped += chunk.length;
        }
        return out;
    }
    cursor(start = 0) {
        return new HttpReceiveCursor(this.chunks, this.totalBytes, start);
    }
    toBuffer() {
        if (this.chunks.length === 0)
            return Buffer.alloc(0);
        if (this.chunks.length === 1)
            return this.chunks[0];
        return Buffer.concat(this.chunks, this.totalBytes);
    }
}
export class HttpReceiveCursor {
    chunkIndex = 0;
    chunkOffset = 0;
    offset;
    chunks;
    totalBytes;
    constructor(chunks, totalBytes, startOffset) {
        this.chunks = chunks;
        this.totalBytes = totalBytes;
        this.offset = startOffset;
        let remaining = startOffset;
        while (this.chunkIndex < this.chunks.length) {
            const chunk = this.chunks[this.chunkIndex];
            if (remaining < chunk.length) {
                this.chunkOffset = remaining;
                break;
            }
            remaining -= chunk.length;
            this.chunkIndex += 1;
        }
        if (this.chunkIndex >= this.chunks.length && remaining !== 0) {
            // Clamp: cursor can start at end, but never beyond.
            this.offset = this.totalBytes;
            this.chunkIndex = this.chunks.length;
            this.chunkOffset = 0;
        }
    }
    cloneState() {
        return {
            chunkIndex: this.chunkIndex,
            chunkOffset: this.chunkOffset,
            offset: this.offset,
        };
    }
    commitState(state) {
        this.chunkIndex = state.chunkIndex;
        this.chunkOffset = state.chunkOffset;
        this.offset = state.offset;
    }
    readByteFrom(state) {
        if (state.offset >= this.totalBytes)
            return null;
        while (state.chunkIndex < this.chunks.length) {
            const chunk = this.chunks[state.chunkIndex];
            if (state.chunkOffset < chunk.length) {
                const b = chunk[state.chunkOffset];
                state.chunkOffset += 1;
                state.offset += 1;
                return b;
            }
            state.chunkIndex += 1;
            state.chunkOffset = 0;
        }
        return null;
    }
    remaining() {
        return Math.max(0, this.totalBytes - this.offset);
    }
    tryConsumeSequenceIfPresent(sequence) {
        const state = this.cloneState();
        for (const expected of sequence) {
            const b = this.readByteFrom(state);
            if (b === null)
                return null;
            if (b !== expected)
                return false;
        }
        this.commitState(state);
        return true;
    }
    tryConsumeExactSequence(sequence) {
        const consumed = this.tryConsumeSequenceIfPresent(sequence);
        if (consumed === null)
            return null;
        if (!consumed) {
            throw new Error("invalid chunk terminator");
        }
        return true;
    }
    tryReadLineAscii(maxBytes) {
        const state = this.cloneState();
        const bytes = [];
        while (true) {
            const b = this.readByteFrom(state);
            if (b === null)
                return null;
            if (b === 0x0d) {
                const b2 = this.readByteFrom(state);
                if (b2 === null)
                    return null;
                if (b2 !== 0x0a) {
                    throw new Error("invalid line terminator");
                }
                this.commitState(state);
                return Buffer.from(bytes).toString("ascii");
            }
            bytes.push(b);
            if (bytes.length > maxBytes) {
                throw new Error("chunk size line too large");
            }
        }
    }
    tryReadBytes(n) {
        if (n === 0)
            return Buffer.alloc(0);
        if (this.remaining() < n)
            return null;
        const state = this.cloneState();
        const firstChunk = this.chunks[state.chunkIndex];
        if (firstChunk && state.chunkOffset + n <= firstChunk.length) {
            const slice = firstChunk.subarray(state.chunkOffset, state.chunkOffset + n);
            state.chunkOffset += n;
            state.offset += n;
            this.commitState(state);
            return slice;
        }
        const out = Buffer.allocUnsafe(n);
        let written = 0;
        while (written < n) {
            const chunk = this.chunks[state.chunkIndex];
            if (!chunk)
                return null;
            if (state.chunkOffset >= chunk.length) {
                state.chunkIndex += 1;
                state.chunkOffset = 0;
                continue;
            }
            const available = chunk.length - state.chunkOffset;
            const take = Math.min(available, n - written);
            chunk.copy(out, written, state.chunkOffset, state.chunkOffset + take);
            state.chunkOffset += take;
            state.offset += take;
            written += take;
        }
        this.commitState(state);
        return out;
    }
    tryConsumeUntilDoubleCrlf() {
        const pattern = [0x0d, 0x0a, 0x0d, 0x0a];
        const state = this.cloneState();
        let matched = 0;
        while (true) {
            const b = this.readByteFrom(state);
            if (b === null)
                return null;
            if (b === pattern[matched]) {
                matched += 1;
                if (matched === pattern.length) {
                    this.commitState(state);
                    return true;
                }
            }
            else {
                matched = b === pattern[0] ? 1 : 0;
            }
        }
    }
}
//# sourceMappingURL=utils.js.map