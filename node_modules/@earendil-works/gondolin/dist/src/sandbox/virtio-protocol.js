import { Buffer } from "node:buffer";
import { TypeEncoderMap, decode, encode } from "cbor2";
const cborEncoderTypes = new TypeEncoderMap();
cborEncoderTypes.registerEncoder(Buffer, (value) => [
    NaN,
    new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
]);
export const MAX_FRAME = 4 * 1024 * 1024;
export class FrameReader {
    buffer = Buffer.alloc(0);
    expectedLength = null;
    push(chunk, onFrame) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            if (this.expectedLength === null) {
                if (this.buffer.length < 4)
                    return;
                this.expectedLength = this.buffer.readUInt32BE(0);
                this.buffer = this.buffer.slice(4);
                if (this.expectedLength > MAX_FRAME) {
                    throw new Error(`Frame too large: ${this.expectedLength}`);
                }
            }
            if (this.buffer.length < this.expectedLength)
                return;
            const frame = this.buffer.slice(0, this.expectedLength);
            this.buffer = this.buffer.slice(this.expectedLength);
            this.expectedLength = null;
            onFrame(frame);
        }
    }
}
export function normalize(value) {
    if (value instanceof Map) {
        const obj = {};
        for (const [key, entry] of value.entries()) {
            obj[String(key)] = normalize(entry);
        }
        return obj;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => normalize(entry));
    }
    if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
        return Buffer.from(value);
    }
    return value;
}
export function decodeMessage(frame) {
    const raw = decode(frame);
    return normalize(raw);
}
export function buildExecRequest(id, payload) {
    const cleaned = { cmd: payload.cmd };
    if (payload.argv !== undefined)
        cleaned.argv = payload.argv;
    if (payload.env !== undefined)
        cleaned.env = payload.env;
    if (payload.cwd !== undefined)
        cleaned.cwd = payload.cwd;
    if (payload.stdin !== undefined)
        cleaned.stdin = payload.stdin;
    if (payload.pty !== undefined)
        cleaned.pty = payload.pty;
    if (payload.stdout_window !== undefined)
        cleaned.stdout_window = payload.stdout_window;
    if (payload.stderr_window !== undefined)
        cleaned.stderr_window = payload.stderr_window;
    return {
        v: 1,
        t: "exec_request",
        id,
        p: cleaned,
    };
}
export function buildStdinData(id, data, eof) {
    return {
        v: 1,
        t: "stdin_data",
        id,
        p: {
            data,
            ...(eof ? { eof } : {}),
        },
    };
}
export function buildPtyResize(id, rows, cols) {
    return {
        v: 1,
        t: "pty_resize",
        id,
        p: {
            rows,
            cols,
        },
    };
}
export function buildExecWindow(id, stdout, stderr) {
    const p = {};
    if (stdout !== undefined)
        p.stdout = stdout;
    if (stderr !== undefined)
        p.stderr = stderr;
    return {
        v: 1,
        t: "exec_window",
        id,
        p,
    };
}
export function buildFileReadRequest(id, payload) {
    const p = { path: payload.path };
    if (payload.cwd !== undefined)
        p.cwd = payload.cwd;
    if (payload.chunk_size !== undefined)
        p.chunk_size = payload.chunk_size;
    return {
        v: 1,
        t: "file_read_request",
        id,
        p,
    };
}
export function buildFileWriteRequest(id, payload) {
    const p = { path: payload.path };
    if (payload.cwd !== undefined)
        p.cwd = payload.cwd;
    if (payload.truncate !== undefined)
        p.truncate = payload.truncate;
    return {
        v: 1,
        t: "file_write_request",
        id,
        p,
    };
}
export function buildFileWriteData(id, data, eof) {
    return {
        v: 1,
        t: "file_write_data",
        id,
        p: {
            data,
            ...(eof ? { eof } : {}),
        },
    };
}
export function buildFileDeleteRequest(id, payload) {
    const p = { path: payload.path };
    if (payload.cwd !== undefined)
        p.cwd = payload.cwd;
    if (payload.force !== undefined)
        p.force = payload.force;
    if (payload.recursive !== undefined)
        p.recursive = payload.recursive;
    return {
        v: 1,
        t: "file_delete_request",
        id,
        p,
    };
}
export function encodeFrame(message) {
    const payload = Buffer.from(encode(message, { rejectUndefined: true, types: cborEncoderTypes }));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    return Buffer.concat([header, payload]);
}
//# sourceMappingURL=virtio-protocol.js.map