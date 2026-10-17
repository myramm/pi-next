import { HttpRequestBlockedError } from "../http/utils.js";
function headerValueArray(value) {
    return Array.isArray(value) ? value : [value];
}
function httpResponseHeadersToHeadersInit(headers) {
    const out = [];
    for (const [name, value] of Object.entries(headers)) {
        for (const item of headerValueArray(value))
            out.push([name, item]);
    }
    return out;
}
function isNullBodyStatus(status) {
    return (status === 101 ||
        status === 103 ||
        status === 204 ||
        status === 205 ||
        status === 304);
}
function isBodyStream(value) {
    return (typeof value === "object" &&
        value !== null &&
        typeof value.getReader === "function");
}
async function readBodyStreamWithLimit(stream, options) {
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
        while (true) {
            let done = false;
            let value;
            try {
                const next = await reader.read();
                done = next.done;
                value = next.value;
            }
            catch {
                throw options.invalidError();
            }
            if (done)
                break;
            if (!value || value.length === 0)
                continue;
            if (options.maxBodyBytes !== null &&
                total + value.length > options.maxBodyBytes) {
                try {
                    await reader.cancel();
                }
                catch {
                    // ignore cancellation failures
                }
                throw options.overflowError();
            }
            const chunk = Buffer.from(value);
            chunks.push(chunk);
            total += chunk.length;
        }
    }
    finally {
        reader.releaseLock();
    }
    return chunks.length === 0
        ? Buffer.alloc(0)
        : Buffer.from(Buffer.concat(chunks, total));
}
async function readBodyLikeWithLimit(value, options) {
    if (value.body === null || value.body === undefined) {
        return Buffer.alloc(0);
    }
    if (isBodyStream(value.body)) {
        return readBodyStreamWithLimit(value.body, options);
    }
    if (typeof value.arrayBuffer !== "function") {
        throw options.invalidError();
    }
    let bytes;
    try {
        bytes = Buffer.from(await value.arrayBuffer.call(value));
    }
    catch {
        throw options.invalidError();
    }
    if (options.maxBodyBytes !== null && bytes.length > options.maxBodyBytes) {
        throw options.overflowError();
    }
    return bytes;
}
export async function webRequestToInternalHttpRequest(value, options) {
    const headers = requestHeadersToRecord(new Headers(value.headers));
    if (!options.allowBody && value.body !== null) {
        throw new HttpRequestBlockedError("request body not allowed in this hook", 400, "Bad Request");
    }
    let body = null;
    const upperMethod = value.method.toUpperCase();
    if (options.allowBody &&
        upperMethod !== "GET" &&
        upperMethod !== "HEAD" &&
        (value.body !== null || typeof value.arrayBuffer === "function")) {
        const bytes = Buffer.from(await readBodyLikeWithLimit(value, {
            maxBodyBytes: options.maxBodyBytes,
            overflowError: () => new HttpRequestBlockedError(`request body exceeds ${options.maxBodyBytes} bytes`, 413, "Payload Too Large"),
            invalidError: () => new HttpRequestBlockedError("invalid request body", 400, "Bad Request"),
        }));
        body = bytes.length > 0 ? bytes : null;
    }
    else if (options.allowBody &&
        (value.body !== null || typeof value.arrayBuffer === "function")) {
        throw new HttpRequestBlockedError(`request body not allowed for ${upperMethod} in buffered request hooks`, 400, "Bad Request");
    }
    return {
        method: value.method,
        url: value.url,
        headers,
        body,
    };
}
export async function webResponseToInternalHttpResponse(value, options) {
    const headers = responseHeadersToRecord(new Headers(value.headers));
    const raw = value.headers;
    if (typeof raw.getSetCookie === "function") {
        const cookies = raw.getSetCookie();
        if (Array.isArray(cookies) &&
            cookies.every((item) => typeof item === "string")) {
            if (cookies.length === 1)
                headers["set-cookie"] = cookies[0];
            else if (cookies.length > 1)
                headers["set-cookie"] = cookies;
        }
    }
    const body = Buffer.from(await readBodyLikeWithLimit(value, {
        maxBodyBytes: options.maxBodyBytes,
        overflowError: () => new HttpRequestBlockedError(`response body exceeds ${options.maxBodyBytes} bytes`, 502, "Bad Gateway"),
        invalidError: () => new HttpRequestBlockedError("invalid response body", 502, "Bad Gateway"),
    }));
    return {
        status: value.status,
        statusText: typeof value.statusText === "string" && value.statusText.length > 0
            ? value.statusText
            : "OK",
        headers,
        body,
    };
}
function requestHeadersToRecord(headers) {
    const record = {};
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value;
    });
    return record;
}
export function responseHeadersToRecord(headers) {
    const record = {};
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value;
    });
    const anyHeaders = headers;
    if (typeof anyHeaders.getSetCookie === "function") {
        const cookies = anyHeaders.getSetCookie();
        if (cookies.length === 1)
            record["set-cookie"] = cookies[0];
        else if (cookies.length > 1)
            record["set-cookie"] = cookies;
    }
    return record;
}
export function internalHttpRequestToWebRequest(request) {
    const method = request.method.toUpperCase();
    const hasBody = Boolean(request.body && request.body.length > 0);
    const canHaveBody = method !== "GET" && method !== "HEAD";
    if (hasBody && !canHaveBody) {
        throw new HttpRequestBlockedError(`request body not allowed for ${method} in web hooks`, 400, "Bad Request");
    }
    return new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: hasBody ? new Uint8Array(request.body) : undefined,
    });
}
export function internalHttpResponseToWebResponse(response) {
    const body = isNullBodyStatus(response.status)
        ? null
        : new Uint8Array(response.body);
    return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: httpResponseHeadersToHeadersInit(response.headers),
    });
}
//# sourceMappingURL=http-conversion.js.map