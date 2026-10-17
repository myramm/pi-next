import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { decodeOutputFrame, encodeOutputFrame, } from "./sandbox/control-protocol.js";
const CACHE_BASE = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
const SESSIONS_DIR = process.env.GONDOLIN_SESSIONS_DIR ??
    path.join(CACHE_BASE, "gondolin", "sessions");
const MAX_REQUEST_ID = 0xffffffff;
const INTERNAL_ID_FLOOR = 0x80000000;
function ensureSessionsDir() {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    return SESSIONS_DIR;
}
function metadataPath(id) {
    return path.join(SESSIONS_DIR, `${id}.json`);
}
function socketPath(id) {
    return path.join(SESSIONS_DIR, `${id}.sock`);
}
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function isSocketAlive(sockPath, timeoutMs = 500) {
    return new Promise((resolve) => {
        if (!fs.existsSync(sockPath)) {
            resolve(false);
            return;
        }
        const socket = net.createConnection({ path: sockPath });
        const timer = setTimeout(() => {
            socket.destroy();
            resolve(false);
        }, timeoutMs);
        socket.once("connect", () => {
            clearTimeout(timer);
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => {
            clearTimeout(timer);
            resolve(false);
        });
    });
}
/** register a live session */
export function registerSession(options) {
    ensureSessionsDir();
    const sockPath = socketPath(options.id);
    const metaPath = metadataPath(options.id);
    const info = {
        id: options.id,
        pid: process.pid,
        socketPath: sockPath,
        createdAt: new Date().toISOString(),
        label: options.label,
    };
    fs.writeFileSync(metaPath, JSON.stringify(info, null, 2) + "\n");
    return { socketPath: sockPath, metadataPath: metaPath };
}
/** unregister a session */
export function unregisterSession(id) {
    try {
        fs.rmSync(metadataPath(id), { force: true });
    }
    catch {
        // ignore
    }
    try {
        fs.rmSync(socketPath(id), { force: true });
    }
    catch {
        // ignore
    }
}
/** list known sessions */
export async function listSessions() {
    const dir = ensureSessionsDir();
    let files;
    try {
        files = fs.readdirSync(dir);
    }
    catch {
        return [];
    }
    const entries = [];
    for (const file of files) {
        if (!file.endsWith(".json"))
            continue;
        const filePath = path.join(dir, file);
        try {
            const info = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (!info.id || !Number.isInteger(info.pid) || !info.socketPath) {
                continue;
            }
            const pidAlive = isPidAlive(info.pid);
            const sockAlive = pidAlive ? await isSocketAlive(info.socketPath) : false;
            entries.push({ ...info, alive: pidAlive && sockAlive });
        }
        catch {
            // ignore malformed metadata
        }
    }
    entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return entries;
}
/** collect stale sessions and orphan socket files */
export async function gcSessions() {
    const dir = ensureSessionsDir();
    let files;
    try {
        files = fs.readdirSync(dir);
    }
    catch {
        return 0;
    }
    const staleIds = new Set();
    const knownIds = new Set();
    for (const file of files) {
        if (!file.endsWith(".json"))
            continue;
        const filePath = path.join(dir, file);
        try {
            const info = JSON.parse(fs.readFileSync(filePath, "utf8"));
            if (!info.id || !Number.isInteger(info.pid) || !info.socketPath) {
                staleIds.add(file.replace(/\.json$/, ""));
                continue;
            }
            knownIds.add(info.id);
            if (!isPidAlive(info.pid)) {
                staleIds.add(info.id);
                continue;
            }
            const alive = await isSocketAlive(info.socketPath);
            if (!alive) {
                staleIds.add(info.id);
            }
        }
        catch {
            staleIds.add(file.replace(/\.json$/, ""));
        }
    }
    for (const file of files) {
        if (!file.endsWith(".sock"))
            continue;
        const id = file.replace(/\.sock$/, "");
        if (!knownIds.has(id)) {
            staleIds.add(id);
        }
    }
    for (const id of staleIds) {
        unregisterSession(id);
    }
    return staleIds.size;
}
/** find a session by exact or prefix id */
export async function findSession(query) {
    const sessions = await listSessions();
    const needle = query.toLowerCase();
    const exact = sessions.find((session) => session.id === needle);
    if (exact)
        return exact;
    const matches = sessions.filter((session) => session.id.startsWith(needle));
    if (matches.length === 0)
        return null;
    if (matches.length === 1)
        return matches[0];
    throw new Error(`ambiguous session prefix '${query}' matches ${matches.length} sessions:\n` +
        matches.map((session) => `  ${session.id}`).join("\n"));
}
function isNonTerminalExecErrorCode(code) {
    return code === "stdin_backpressure" || code === "stdin_chunk_too_large";
}
function sendFramed(socket, type, payload, onFlushed) {
    if (socket.destroyed || !socket.writable)
        return false;
    const header = Buffer.alloc(5);
    header.writeUInt8(type, 0);
    header.writeUInt32BE(payload.length, 1);
    try {
        socket.write(Buffer.concat([header, payload]), () => {
            onFlushed?.();
        });
        return true;
    }
    catch {
        return false;
    }
}
function sendJson(socket, message, onFlushed) {
    return sendFramed(socket, 0, Buffer.from(JSON.stringify(message)), onFlushed);
}
function sendError(socket, code, message, id) {
    const payload = {
        type: "error",
        code,
        message,
        id,
    };
    return sendJson(socket, payload);
}
export class SessionIpcServer {
    server = null;
    clients = new Set();
    allocatedInternalIds = new Set();
    nextInternalId = 0xffffffff;
    sockPath;
    connectToSandbox;
    handlers;
    constructor(sockPath, connectToSandbox, handlers = {}) {
        this.sockPath = sockPath;
        this.connectToSandbox = connectToSandbox;
        this.handlers = handlers;
    }
    start() {
        if (this.server)
            return;
        try {
            fs.rmSync(this.sockPath, { force: true });
        }
        catch {
            // ignore
        }
        const server = net.createServer((socket) => {
            this.handleConnection(socket);
        });
        server.on("error", () => {
            // ignore
        });
        server.listen(this.sockPath);
        this.server = server;
    }
    async close() {
        for (const socket of this.clients) {
            try {
                socket.destroy();
            }
            catch {
                // ignore
            }
        }
        this.clients.clear();
        if (this.server) {
            const server = this.server;
            this.server = null;
            await new Promise((resolve) => server.close(() => resolve()));
        }
        try {
            fs.rmSync(this.sockPath, { force: true });
        }
        catch {
            // ignore
        }
    }
    allocateInternalId() {
        for (let i = 0; i <= MAX_REQUEST_ID; i += 1) {
            if (this.nextInternalId < INTERNAL_ID_FLOOR ||
                this.nextInternalId === 0) {
                this.nextInternalId = 0xffffffff;
            }
            const candidate = this.nextInternalId;
            this.nextInternalId = (this.nextInternalId - 1) >>> 0;
            if (candidate < INTERNAL_ID_FLOOR)
                continue;
            if (this.allocatedInternalIds.has(candidate))
                continue;
            this.allocatedInternalIds.add(candidate);
            return candidate;
        }
        throw new Error("no available internal request ids");
    }
    releaseInternalId(id) {
        this.allocatedInternalIds.delete(id);
    }
    handleConnection(socket) {
        this.clients.add(socket);
        socket.setNoDelay(true);
        // Per-client id translation to keep each external channel independent.
        const externalToInternal = new Map();
        const internalToExternal = new Map();
        let connection = null;
        const ensureConnection = () => {
            if (connection) {
                return connection;
            }
            try {
                connection = this.connectToSandbox((data, isBinary) => {
                    if (isBinary) {
                        try {
                            const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
                            const decoded = decodeOutputFrame(frame);
                            const externalId = internalToExternal.get(decoded.id);
                            if (externalId === undefined) {
                                return;
                            }
                            const remapped = encodeOutputFrame(externalId, decoded.stream, decoded.data);
                            sendFramed(socket, 1, remapped);
                        }
                        catch {
                            // ignore malformed frames
                        }
                        return;
                    }
                    let message;
                    try {
                        message = JSON.parse(typeof data === "string" ? data : data.toString());
                    }
                    catch {
                        return;
                    }
                    if (message.type === "exec_response") {
                        const externalId = internalToExternal.get(message.id);
                        if (externalId === undefined)
                            return;
                        const remapped = {
                            ...message,
                            id: externalId,
                        };
                        sendJson(socket, remapped);
                        const internalId = message.id;
                        internalToExternal.delete(internalId);
                        externalToInternal.delete(externalId);
                        this.releaseInternalId(internalId);
                        return;
                    }
                    if (message.type === "error" && message.id !== undefined) {
                        const externalId = internalToExternal.get(message.id);
                        if (externalId === undefined)
                            return;
                        const remapped = {
                            ...message,
                            id: externalId,
                        };
                        sendJson(socket, remapped);
                        if (!isNonTerminalExecErrorCode(message.code)) {
                            const internalId = message.id;
                            internalToExternal.delete(internalId);
                            externalToInternal.delete(externalId);
                            this.releaseInternalId(internalId);
                        }
                        return;
                    }
                    sendJson(socket, message);
                }, () => {
                    socket.destroy();
                });
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                sendError(socket, "ipc_unavailable", detail);
                socket.destroy();
                return null;
            }
            return connection;
        };
        let readBuffer = Buffer.alloc(0);
        let expectedLength = null;
        const handleExec = (message) => {
            if (!Number.isInteger(message.id) || message.id < 0) {
                sendError(socket, "invalid_request", "exec requires a uint32 id");
                return;
            }
            if (externalToInternal.has(message.id)) {
                sendError(socket, "duplicate_id", "request id already in use", message.id);
                return;
            }
            let internalId;
            try {
                internalId = this.allocateInternalId();
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                sendError(socket, "queue_full", detail, message.id);
                return;
            }
            externalToInternal.set(message.id, internalId);
            internalToExternal.set(internalId, message.id);
            const conn = ensureConnection();
            if (!conn) {
                externalToInternal.delete(message.id);
                internalToExternal.delete(internalId);
                this.releaseInternalId(internalId);
                return;
            }
            try {
                conn.send({ ...message, id: internalId });
            }
            catch (err) {
                externalToInternal.delete(message.id);
                internalToExternal.delete(internalId);
                this.releaseInternalId(internalId);
                const detail = err instanceof Error ? err.message : String(err);
                sendError(socket, "ipc_error", detail, message.id);
            }
        };
        const forwardMappedIdMessage = (message) => {
            const internalId = externalToInternal.get(message.id);
            if (internalId === undefined) {
                sendError(socket, "unknown_id", "request id not found", message.id);
                return;
            }
            const conn = ensureConnection();
            if (!conn)
                return;
            try {
                conn.send({ ...message, id: internalId });
            }
            catch (err) {
                const detail = err instanceof Error ? err.message : String(err);
                sendError(socket, "ipc_error", detail, message.id);
            }
        };
        const handleSnapshot = (message) => {
            if (!Number.isInteger(message.id) || message.id < 0) {
                sendError(socket, "invalid_request", "snapshot requires a uint32 id");
                return;
            }
            if (!message.path || typeof message.path !== "string") {
                sendError(socket, "invalid_request", "snapshot requires a non-empty output path", message.id);
                return;
            }
            if (!this.handlers.onSnapshot) {
                sendError(socket, "unsupported", "snapshot actions are not supported for this session", message.id);
                return;
            }
            void this.handlers
                .onSnapshot(message)
                .then((result) => {
                const response = {
                    type: "snapshot_response",
                    id: message.id,
                    path: result.path,
                    name: result.name,
                };
                const onResponseQueued = result.onResponseQueued;
                const sent = sendJson(socket, response, () => {
                    if (!onResponseQueued)
                        return;
                    void Promise.resolve(onResponseQueued()).catch(() => {
                        // ignore post-response cleanup errors
                    });
                });
                if (!sent && onResponseQueued) {
                    // If client socket is already gone, still run cleanup.
                    void Promise.resolve(onResponseQueued()).catch(() => {
                        // ignore post-response cleanup errors
                    });
                }
            })
                .catch((err) => {
                const detail = err instanceof Error ? err.message : String(err);
                sendError(socket, "snapshot_failed", detail, message.id);
            });
        };
        const handleMessage = (message) => {
            if (message.type === "boot") {
                // Attach clients connect to an already-running VM; ignore boot requests.
                return;
            }
            if (message.type === "exec") {
                handleExec(message);
                return;
            }
            if (message.type === "stdin") {
                forwardMappedIdMessage(message);
                return;
            }
            if (message.type === "pty_resize") {
                forwardMappedIdMessage(message);
                return;
            }
            if (message.type === "exec_window") {
                forwardMappedIdMessage(message);
                return;
            }
            if (message.type === "snapshot") {
                handleSnapshot(message);
                return;
            }
            if (message.type === "lifecycle") {
                sendError(socket, "unsupported", "lifecycle actions are not supported over attach IPC");
                return;
            }
        };
        socket.on("data", (chunk) => {
            readBuffer = Buffer.concat([readBuffer, chunk]);
            while (true) {
                if (expectedLength === null) {
                    if (readBuffer.length < 4)
                        return;
                    expectedLength = readBuffer.readUInt32BE(0);
                    readBuffer = readBuffer.subarray(4);
                }
                if (readBuffer.length < expectedLength)
                    return;
                const frame = readBuffer.subarray(0, expectedLength);
                readBuffer = readBuffer.subarray(expectedLength);
                expectedLength = null;
                try {
                    const message = JSON.parse(frame.toString());
                    handleMessage(message);
                }
                catch {
                    sendError(socket, "invalid_request", "invalid framed JSON message");
                }
            }
        });
        const cleanup = () => {
            this.clients.delete(socket);
            for (const internalId of internalToExternal.keys()) {
                this.releaseInternalId(internalId);
            }
            internalToExternal.clear();
            externalToInternal.clear();
            connection?.close();
            connection = null;
        };
        socket.on("error", cleanup);
        socket.on("close", cleanup);
        socket.on("end", cleanup);
    }
}
/** connect to an external session IPC socket */
export function connectToSession(sockPath, callbacks) {
    const socket = net.createConnection({ path: sockPath });
    socket.setNoDelay(true);
    let closed = false;
    let readBuffer = Buffer.alloc(0);
    let expectedLength = null;
    let frameType = null;
    socket.on("data", (chunk) => {
        readBuffer = Buffer.concat([readBuffer, chunk]);
        while (true) {
            if (expectedLength === null) {
                if (readBuffer.length < 5)
                    return;
                frameType = readBuffer.readUInt8(0);
                expectedLength = readBuffer.readUInt32BE(1);
                readBuffer = readBuffer.subarray(5);
            }
            if (readBuffer.length < expectedLength)
                return;
            const frame = readBuffer.subarray(0, expectedLength);
            readBuffer = readBuffer.subarray(expectedLength);
            const type = frameType;
            expectedLength = null;
            frameType = null;
            if (type === 1) {
                callbacks.onBinary(Buffer.from(frame));
                continue;
            }
            try {
                const message = JSON.parse(frame.toString());
                callbacks.onJson(message);
            }
            catch {
                // ignore malformed json frames
            }
        }
    });
    socket.on("error", (err) => {
        if (closed)
            return;
        closed = true;
        callbacks.onClose(err);
    });
    socket.on("close", () => {
        if (closed)
            return;
        closed = true;
        callbacks.onClose();
    });
    return {
        send(message) {
            if (closed)
                return;
            const payload = Buffer.from(JSON.stringify(message));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(payload.length, 0);
            socket.write(Buffer.concat([header, payload]));
        },
        close() {
            if (closed)
                return;
            closed = true;
            socket.destroy();
        },
    };
}
//# sourceMappingURL=session-registry.js.map