/** Shared plumbing: receive queue, close handlers, `bye`. Transports implement `transmit` and `shutdown`. */
class BaseLink {
    #handler;
    #queue = [];
    #closeHandlers = new Set();
    #closed = false;
    /** The tail of frames being decoded asynchronously; undefined when none is. */
    #decoding;
    get closed() {
        return this.#closed;
    }
    send(frame) {
        if (this.#closed)
            return undefined;
        return this.transmit(frame);
    }
    receive(handler) {
        this.#handler = handler;
        for (const frame of this.#queue.splice(0))
            handler(frame);
    }
    onClose(handler) {
        if (this.#closed)
            handler("closed");
        else
            this.#closeHandlers.add(handler);
    }
    close(reason = "closed") {
        if (this.#closed)
            return;
        try {
            this.transmit({ t: "bye", reason });
        }
        catch {
            // The transport may already be gone.
        }
        this.ended(reason);
    }
    /** Delivers a parsed frame from the transport, after any frame still being decoded (`deliverLater`). */
    deliver(frame) {
        if (this.#decoding !== undefined)
            this.deliverLater(Promise.resolve(frame));
        else
            this.#deliverNow(frame);
    }
    /** Delivers a frame that is still being decoded (inflated in a browser); later frames wait for it, in order. */
    deliverLater(frame) {
        const next = (this.#decoding ?? Promise.resolve())
            .then(() => frame)
            .then((decoded) => this.#deliverNow(decoded), () => this.close("protocol error"))
            .finally(() => {
            if (this.#decoding === next)
                this.#decoding = undefined;
        });
        this.#decoding = next;
    }
    #deliverNow(frame) {
        if (this.#closed)
            return;
        if (frame.t === "bye") {
            this.ended(frame.reason ?? "peer closed");
            return;
        }
        if (this.#handler === undefined)
            this.#queue.push(frame);
        else
            this.#handler(frame);
    }
    /** Marks the link closed (transport ended) and notifies once. */
    ended(reason) {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#queue = [];
        try {
            this.shutdown();
        }
        finally {
            for (const handler of this.#closeHandlers)
                handler(reason);
            this.#closeHandlers.clear();
        }
    }
}
// ─── payload packing ─────────────────────────────────────────────────────────
//
// A transport optimization, invisible above the links. A frame's payload (call args, a result value, a state snapshot)
// whose JSON exceeds `PACK_THRESHOLD` characters is sent deflated. A host that only relays the frame forwards the
// deflated bytes unread (`Packed`); the host that uses the payload inflates it (`unpack`). Only hosts with Node's zlib
// deflate (synchronously, so frames keep their order); a browser inflates with `DecompressionStream` before delivery.
/** Payloads whose JSON is longer than this many characters are deflated. */
export const PACK_THRESHOLD = 64 * 1024;
const zlib = globalThis.process?.getBuiltinModule?.("node:zlib");
/** A deflated JSON payload, kept as received until a host uses it. */
export class Packed {
    bytes;
    constructor(bytes) {
        this.bytes = bytes;
    }
}
/** A frame payload as its user needs it: inflated and parsed if it arrived packed. */
export function unpack(value) {
    if (!(value instanceof Packed))
        return value;
    if (zlib === undefined)
        throw new TypeError("packed payload without zlib");
    return JSON.parse(zlib.inflateRawSync(value.bytes).toString("utf8"));
}
const PAYLOAD_FIELDS = new Set(["args", "value"]);
function payloadField(frame) {
    if (frame.t === "call")
        return frame.args === undefined ? undefined : "args";
    if (frame.t === "result" || frame.t === "state")
        return frame.value === undefined ? undefined : "value";
    return undefined;
}
/** The frame without its payload field (the envelope). */
function envelopeOf(frame, field) {
    const envelope = { ...frame };
    delete envelope[field];
    return envelope;
}
/** The payload's deflated bytes: as received, or deflated now if large. Undefined: send it as JSON. */
function packedBytes(value, compress, json) {
    if (value instanceof Packed)
        return value.bytes;
    if (!compress || zlib === undefined || json === undefined || json.length <= PACK_THRESHOLD)
        return undefined;
    return zlib.deflateRawSync(json, { level: 1 });
}
/** For object transports (Node IPC, memory): a packed payload travels as `z: [field, base64]`. */
function packObject(frame, compress) {
    const field = payloadField(frame);
    if (field === undefined)
        return frame;
    const value = frame[field];
    const bytes = packedBytes(value, compress, compress && zlib !== undefined ? JSON.stringify(value) : undefined);
    if (bytes === undefined)
        return frame;
    return {
        ...envelopeOf(frame, field),
        z: [field, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")],
    };
}
function unpackObject(message) {
    if (message === null || typeof message !== "object" || !("z" in message))
        return message;
    const { z, ...rest } = message;
    if (!Array.isArray(z) || !PAYLOAD_FIELDS.has(z[0]) || typeof z[1] !== "string")
        throw new TypeError("bad packed payload");
    return { ...rest, [z[0]]: new Packed(Buffer.from(z[1], "base64")) };
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/**
 * For WebSockets: a frame with a packed payload is a binary message, `[envelope length: u32 BE][envelope JSON, with
 * z: field][deflated payload]`; any other frame is text. The payload's JSON is spliced in, not encoded twice.
 */
function packMessage(frame, compress) {
    const field = payloadField(frame);
    if (field === undefined)
        return JSON.stringify(frame);
    const value = frame[field];
    const json = value instanceof Packed ? undefined : JSON.stringify(value);
    const bytes = packedBytes(value, compress, json);
    const envelope = envelopeOf(frame, field);
    if (bytes === undefined) {
        const head = JSON.stringify(envelope);
        return `${head.slice(0, -1)},${JSON.stringify(field)}:${json}}`;
    }
    const head = encoder.encode(JSON.stringify({ ...envelope, z: field }));
    const message = new Uint8Array(4 + head.byteLength + bytes.byteLength);
    new DataView(message.buffer).setUint32(0, head.byteLength);
    message.set(head, 4);
    message.set(bytes, 4 + head.byteLength);
    return message;
}
/** The envelope of a binary message and its payload bytes. */
function splitMessage(data) {
    const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0);
    const envelope = JSON.parse(decoder.decode(data.subarray(4, 4 + length)));
    if (envelope === null || typeof envelope !== "object")
        throw new TypeError("bad envelope");
    const { z: field, ...rest } = envelope;
    if (typeof field !== "string" || !PAYLOAD_FIELDS.has(field))
        throw new TypeError("bad packed payload");
    return { envelope: rest, field: field, bytes: data.slice(4 + length) };
}
/**
 * The text frame of a binary (packed) WebSocket message, inflated: for a transport that relays text frames only (the
 * TUI launcher feeding its sandbox). Needs zlib.
 */
export function inflateMessage(data) {
    if (zlib === undefined)
        throw new TypeError("inflateMessage needs zlib");
    const { envelope, field, bytes } = splitMessage(data);
    const head = JSON.stringify(envelope);
    return `${head.slice(0, -1)},${JSON.stringify(field)}:${zlib.inflateRawSync(bytes).toString("utf8")}}`;
}
/** Inflates without zlib (browsers). */
async function inflate(bytes) {
    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
    return JSON.parse(await new Response(stream).text());
}
/** Parses a JSON frame; anything else is a protocol error. */
function parseFrame(data) {
    const frame = unpackObject(JSON.parse(data));
    if (frame === null || typeof frame !== "object" || typeof frame.t !== "string")
        throw new TypeError("not a frame");
    return frame;
}
// ─── memory ──────────────────────────────────────────────────────────────────
export class MemoryLink extends BaseLink {
    peer;
    #severed = false;
    #pending = Promise.resolve();
    /** Simulates a dead network: frames are dropped silently in both directions and no close is signalled. */
    sever() {
        this.#severed = true;
        if (this.peer)
            this.peer.#severed = true;
    }
    transmit(frame) {
        if (this.#severed)
            return undefined;
        // A JSON round trip detaches the frame (and rejects what JSON would mangle silently, e.g. bigint).
        const data = JSON.stringify(packObject(frame, true));
        const peer = this.peer;
        // One promise chain per direction keeps delivery FIFO and asynchronous, like a real transport.
        this.#pending = this.#pending.then(() => {
            if (!this.#severed && peer !== undefined)
                peer.deliver(parseFrame(data));
        });
        return data.length;
    }
    shutdown() {
        const peer = this.peer;
        this.#pending = this.#pending.then(() => peer?.ended("peer closed"));
    }
}
/** Two connected in-memory links (tests). */
export function memoryLinkPair() {
    const a = new MemoryLink();
    const b = new MemoryLink();
    a.peer = b;
    b.peer = a;
    return [a, b];
}
/**
 * Chord frames on an IPC channel are wrapped as `{ chord2: frame }`; other messages (control) pass by. Both ends are
 * Node processes of one application, so large payloads are packed both ways. Node serializes the messages itself, so
 * the link reports no sizes and is not windowed: both ends are local processes.
 */
export class IpcLink extends BaseLink {
    #channel;
    #onMessage = (message) => {
        const frame = message?.chord2;
        if (frame === undefined)
            return;
        try {
            this.deliver(unpackObject(frame));
        }
        catch {
            this.close("protocol error");
        }
    };
    #onDisconnect = () => this.ended("ipc disconnected");
    /**
     * A write can fail after the peer exited and before the channel reports `disconnect` (an `ack` or a `bye` sent then).
     * The peer is gone either way: the link ends, as on `disconnect`.
     */
    #onSent = (error) => {
        if (error !== null)
            this.ended(`ipc send failed: ${error.code ?? error.message}`);
    };
    constructor(channel) {
        super();
        this.#channel = channel;
        channel.on("message", this.#onMessage);
        channel.on("disconnect", this.#onDisconnect);
    }
    transmit(frame) {
        if (this.#channel.connected)
            this.#channel.send({ chord2: packObject(frame, true) }, this.#onSent);
        return undefined;
    }
    shutdown() {
        this.#channel.off("message", this.#onMessage);
        this.#channel.off("disconnect", this.#onDisconnect);
    }
}
export const ipcLink = (channel) => new IpcLink(channel);
const OPEN = 1;
export class WebSocketLink extends BaseLink {
    #socket;
    #compress;
    #outbox = [];
    constructor(socket, options = {}) {
        super();
        this.#socket = socket;
        this.#compress = options.compress ?? false;
        const acceptPacked = options.acceptPacked ?? true;
        // Binary messages as ArrayBuffer (browsers and Node's WebSocket default to Blob).
        if ("binaryType" in socket)
            socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => {
            for (const data of this.#outbox.splice(0))
                socket.send(data);
        });
        socket.addEventListener("message", (event) => {
            try {
                const data = event.data;
                if (typeof data === "string") {
                    this.deliver(parseFrame(data));
                    return;
                }
                if (!acceptPacked)
                    throw new TypeError("packed frames are not accepted");
                const bytes = data instanceof ArrayBuffer
                    ? new Uint8Array(data)
                    : ArrayBuffer.isView(data)
                        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                        : undefined;
                if (bytes === undefined)
                    throw new TypeError("unknown message type");
                const { envelope, field, bytes: payload } = splitMessage(bytes);
                if (zlib !== undefined)
                    this.deliver({ ...envelope, [field]: new Packed(payload) });
                else
                    this.deliverLater(inflate(payload).then((value) => ({ ...envelope, [field]: value })));
            }
            catch {
                this.close("protocol error");
            }
        });
        socket.addEventListener("close", () => this.ended("socket closed"));
    }
    transmit(frame) {
        const data = packMessage(frame, this.#compress);
        if (this.#socket.readyState === OPEN)
            this.#socket.send(data);
        else
            this.#outbox.push(data);
        return typeof data === "string" ? data.length : data.byteLength;
    }
    shutdown() {
        this.#outbox = [];
        if (this.#socket.readyState <= OPEN)
            this.#socket.close(1000);
    }
}
export const webSocketLink = (socket, options) => new WebSocketLink(socket, options);
//# sourceMappingURL=link.js.map