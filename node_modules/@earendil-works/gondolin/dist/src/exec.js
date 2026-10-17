import { Readable } from "stream";
import { attachTty } from "./utils/tty-attach.js";
const DEFAULT_ENCODING = "utf-8";
const DEFAULT_WINDOW_BYTES = 256 * 1024;
const MIN_WINDOW_UPDATE_BYTES = 32 * 1024;
/**
 * Result of a completed exec command.
 */
export class ExecResult {
    id;
    exitCode;
    signal;
    _stdout;
    _stderr;
    _encoding;
    constructor(id, exitCode, stdout, stderr, signal, encoding = DEFAULT_ENCODING) {
        this.id = id;
        this.exitCode = exitCode;
        this._stdout = stdout;
        this._stderr = stderr;
        this.signal = signal;
        this._encoding = encoding;
    }
    /** stdout as string */
    get stdout() {
        return this._stdout.toString(this._encoding);
    }
    /** stderr as string */
    get stderr() {
        return this._stderr.toString(this._encoding);
    }
    /** stdout as Buffer (for binary data) */
    get stdoutBuffer() {
        return this._stdout;
    }
    /** stderr as Buffer (for binary data) */
    get stderrBuffer() {
        return this._stderr;
    }
    /** Parse stdout as JSON */
    json() {
        return JSON.parse(this.stdout);
    }
    /** Split stdout into lines */
    lines() {
        return this.stdout.split("\n").filter((line) => line.length > 0);
    }
    /** Check if the command succeeded (exit code 0) */
    get ok() {
        return this.exitCode === 0;
    }
    toString() {
        return this.stdout;
    }
}
/** @internal */
export function normalizeCommand(command, options) {
    // Array form: execute an executable directly
    // NOTE: the guest does not search `$PATH` for this.
    if (Array.isArray(command)) {
        if (command.length === 0) {
            throw new Error("command array must include the executable");
        }
        return { cmd: command[0], argv: command.slice(1) };
    }
    // String form: run through a login shell
    // Equivalent to: vm.exec(["/bin/sh", "-lc", command])
    const extraArgv = options.argv ?? [];
    const argv = ["-lc", command];
    // If the caller provides extra argv entries, pass them as positional params
    // to the shell script (requires an explicit $0 parameter).
    if (extraArgv.length) {
        argv.push("sh", ...extraArgv);
    }
    return { cmd: "/bin/sh", argv };
}
function isAsyncIterable(value) {
    return (typeof value === "object" &&
        value !== null &&
        Symbol.asyncIterator in value &&
        typeof value[Symbol.asyncIterator] === "function");
}
/** @internal */
export async function* toAsyncIterable(value) {
    if (typeof value === "string" ||
        Buffer.isBuffer(value) ||
        typeof value === "boolean") {
        return;
    }
    if (isAsyncIterable(value)) {
        for await (const chunk of value) {
            yield Buffer.from(chunk);
        }
        return;
    }
    if (value instanceof Readable) {
        for await (const chunk of value) {
            yield Buffer.from(chunk);
        }
        return;
    }
    throw new Error("unsupported stdin type");
}
function asWritableStream(value) {
    // Best-effort detection: we intentionally only require `.write(...)`.
    // Some call sites pass custom writable-like objects and we don't want to be
    // overly strict. At the same time, avoid obvious false-positives like Buffer.
    if (!value || typeof value !== "object")
        return null;
    if (Buffer.isBuffer(value))
        return null;
    const v = value;
    if (typeof v.write !== "function")
        return null;
    return value;
}
export function resolveOutputMode(value, legacyBuffer, streamName) {
    // If the user didn't pass an explicit mode, default based on legacy buffer option.
    if (value === undefined) {
        const buffer = legacyBuffer ?? true;
        if (buffer)
            return { mode: "buffer" };
        // If output is not being buffered, default to ignore. This avoids accidental deadlocks
        // where the guest blocks on output because the caller didn't consume a pipe.
        return { mode: "ignore" };
    }
    // Treat custom Node writable streams as a dedicated output mode.
    // Detection is best-effort; if it quacks like a writable, we accept it.
    const writable = asWritableStream(value);
    if (writable) {
        return { mode: "writable", stream: writable };
    }
    if (value === "inherit") {
        return {
            mode: "writable",
            stream: streamName === "stdout" ? process.stdout : process.stderr,
        };
    }
    if (value === "buffer" || value === "pipe" || value === "ignore") {
        return { mode: value };
    }
    // Fail-fast on invalid explicit values; otherwise misconfiguration silently changes
    // buffering/backpressure behavior.
    throw new Error(`invalid exec ${streamName} option: ${String(value)} (expected "buffer"|"pipe"|"inherit"|"ignore" or a writable stream)`);
}
function resolveWindowBytes(value) {
    if (value === undefined)
        return DEFAULT_WINDOW_BYTES;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
        return DEFAULT_WINDOW_BYTES;
    // Keep sane bounds (also ensures it fits comfortably in uint32)
    return Math.max(4 * 1024, Math.min(16 * 1024 * 1024, Math.trunc(n)));
}
class ExecPipeStream extends Readable {
    onConsumed;
    constructor(windowBytes, onConsumed) {
        super({ highWaterMark: windowBytes });
        this.onConsumed = onConsumed;
    }
    bufferedBytes = 0;
    consumedPending = 0;
    consumedScheduled = false;
    getBufferedBytes() {
        // When an encoding is set (setEncoding()), Node's `readableLength` can be in
        // units that do not match raw byte counts (e.g. "hex" expands 1 byte -> 2 chars).
        // Credits/backpressure are based on raw bytes, so rely on our own accounting.
        if (this.readableEncoding) {
            return this.bufferedBytes;
        }
        // Without an encoding, `readableLength` reflects Node's internal queue size in
        // bytes (what `pause()`/`resume()` interacts with).  Our own `bufferedBytes`
        // tracks raw bytes pushed/consumed.
        //
        // When these disagree, we must never *undercount* buffered bytes; otherwise we
        // may grant too many credits and allow unbounded growth in the stream buffer.
        const rl = this.readableLength;
        if (typeof rl === "number" && Number.isFinite(rl)) {
            return Math.max(this.bufferedBytes, rl);
        }
        return this.bufferedBytes;
    }
    queueConsumed(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0)
            return;
        this.consumedPending += bytes;
        if (this.consumedScheduled)
            return;
        this.consumedScheduled = true;
        // Defer credit replenishment to avoid re-entrancy and allow pause()/resume()
        // to take effect before we grant more credits.
        queueMicrotask(() => {
            this.consumedScheduled = false;
            const n = this.consumedPending;
            this.consumedPending = 0;
            if (n > 0)
                this.onConsumed();
        });
    }
    consume(chunk) {
        let bytes = 0;
        if (Buffer.isBuffer(chunk)) {
            bytes = chunk.length;
        }
        else if (typeof chunk === "string") {
            const enc = this.readableEncoding ?? "utf8";
            bytes = Buffer.byteLength(chunk, enc);
        }
        if (bytes > 0) {
            // Track bytes buffered independent of Node's readableLength, which can
            // change units when setEncoding() is used.
            this.bufferedBytes = Math.max(0, this.bufferedBytes - bytes);
            this.queueConsumed(bytes);
        }
    }
    emit(eventName, ...args) {
        // Intercept actual delivery of data in flowing mode without installing a
        // 'data' listener (which would force flowing mode early and can drop output).
        if (eventName === "data") {
            this.consume(args[0]);
        }
        return super.emit(eventName, ...args);
    }
    read(size) {
        const chunk = super.read(size);
        // In non-flowing mode, reading does not emit 'data', so we need to account
        // credits here.
        const state = this._readableState;
        if (chunk && !state?.flowing) {
            this.consume(chunk);
        }
        return chunk;
    }
    _read(_size) {
        // No-op: backpressure is enforced by the host↔guest credit window.
    }
    pushChunk(chunk) {
        // We intentionally ignore the return value here; backpressure is enforced
        // by the credit window between host and guest.
        this.bufferedBytes += chunk.length;
        this.push(chunk);
    }
    endStream() {
        this.push(null);
    }
}
export class ExecProcess {
    attached = false;
    session;
    callbacks;
    constructor(session, callbacks) {
        this.session = session;
        this.callbacks = callbacks;
    }
    get id() {
        return this.session.id;
    }
    then(onfulfilled, onrejected) {
        return this.session.resultPromise.then(onfulfilled, onrejected);
    }
    catch(onrejected) {
        return this.session.resultPromise.catch(onrejected);
    }
    finally(onfinally) {
        return this.session.resultPromise.finally(onfinally);
    }
    get result() {
        return this.session.resultPromise;
    }
    write(data) {
        if (!this.session.stdinEnabled) {
            throw new Error("stdin was not enabled for this exec");
        }
        this.callbacks.sendStdin(this.session.id, data);
    }
    end() {
        if (!this.session.stdinEnabled) {
            throw new Error("stdin was not enabled for this exec");
        }
        this.callbacks.sendStdinEof(this.session.id);
    }
    resize(rows, cols) {
        if (!this.callbacks.sendResize)
            return;
        this.callbacks.sendResize(this.session.id, rows, cols);
    }
    async *[Symbol.asyncIterator]() {
        const stdout = this.session.stdoutPipe;
        if (!stdout) {
            throw new Error('stdout is not piped (set exec options.stdout="pipe")');
        }
        const encoding = this.session.encoding;
        for await (const chunk of stdout) {
            yield chunk.toString(encoding);
        }
    }
    async *output() {
        const stdout = this.session.stdoutPipe;
        const stderr = this.session.stderrPipe;
        if (!stdout || !stderr) {
            throw new Error('stdout/stderr are not piped (set exec options.stdout/stderr="pipe")');
        }
        const encoding = this.session.encoding;
        // Merge stdout/stderr without switching streams into flowing mode.
        // Using Readable async iteration preserves credit-based backpressure.
        //
        // If the consumer calls `proc.stdout.setEncoding(...)` / `proc.stderr.setEncoding(...)`,
        // Node will yield strings from async iteration. Normalize those back to Buffer so our
        // public OutputChunk.data contract remains stable.
        const outIt = stdout[Symbol.asyncIterator]();
        const errIt = stderr[Symbol.asyncIterator]();
        const toBuffer = (pipe, chunk) => {
            if (Buffer.isBuffer(chunk))
                return chunk;
            if (typeof chunk === "string") {
                const enc = pipe.readableEncoding;
                const bufEnc = typeof enc === "string" && enc.length > 0
                    ? enc
                    : "utf8";
                return Buffer.from(chunk, bufEnc);
            }
            throw new Error(`unexpected ${typeof chunk} chunk from exec output stream`);
        };
        let outNext = outIt.next();
        let errNext = errIt.next();
        while (outNext || errNext) {
            const raced = await Promise.race([
                outNext
                    ? outNext.then((r) => ({ stream: "stdout", r }))
                    : new Promise(() => { }),
                errNext
                    ? errNext.then((r) => ({ stream: "stderr", r }))
                    : new Promise(() => { }),
            ]);
            if (raced.r.done) {
                if (raced.stream === "stdout")
                    outNext = null;
                else
                    errNext = null;
                continue;
            }
            const pipe = raced.stream === "stdout" ? stdout : stderr;
            const data = toBuffer(pipe, raced.r.value);
            yield {
                stream: raced.stream,
                data,
                text: data.toString(encoding),
            };
            if (raced.stream === "stdout")
                outNext = outIt.next();
            else
                errNext = errIt.next();
        }
    }
    async *lines() {
        const stdout = this.session.stdoutPipe;
        if (!stdout) {
            throw new Error('stdout is not piped (set exec options.stdout="pipe")');
        }
        let buffer = "";
        const encoding = this.session.encoding;
        for await (const chunk of stdout) {
            buffer += chunk.toString(encoding);
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                yield line;
            }
        }
        if (buffer.length > 0) {
            yield buffer;
        }
    }
    get stdout() {
        return this.session.stdoutPipe;
    }
    get stderr() {
        return this.session.stderrPipe;
    }
    attach(stdin, stdout, stderr) {
        if (this.attached) {
            throw new Error("already attached");
        }
        this.attached = true;
        const out = this.session.stdoutPipe;
        const err = this.session.stderrPipe;
        // In pipe mode we forward output here; in inherit/writable modes output is
        // already written by the VM output router.
        const shouldForwardStdout = out != null;
        const shouldForwardStderr = err != null;
        if (!shouldForwardStdout && !shouldForwardStderr) {
            const hasLiveOutput = this.session.stdoutMode.mode === "writable" ||
                this.session.stderrMode.mode === "writable";
            if (!hasLiveOutput) {
                throw new Error('attach() requires streaming output (set exec options stdout/stderr="pipe" or "inherit")');
            }
        }
        const { cleanup } = attachTty(stdin, stdout, (stderr ?? stdout), shouldForwardStdout ? out : null, shouldForwardStderr ? err : null, {
            write: (chunk) => this.write(chunk),
            end: () => this.end(),
            resize: (rows, cols) => this.resize(rows, cols),
        });
        void this.session.resultPromise.then(() => {
            // Note: do not manually unpipe here. Readable.pipe() cleans itself up on
            // stream end. Unpiping eagerly can drop buffered output that has not yet
            // been flushed to the destination.
            cleanup();
        }, () => {
            cleanup();
        });
    }
}
export function createExecSession(id, options) {
    let resolve;
    let reject;
    const resultPromise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    const windowBytes = resolveWindowBytes(options.windowBytes);
    const session = {
        id,
        stdoutMode: options.stdout,
        stderrMode: options.stderr,
        stdoutPipe: null,
        stderrPipe: null,
        stdoutChunks: [],
        stderrChunks: [],
        windowBytes,
        stdoutCredit: windowBytes,
        stderrCredit: windowBytes,
        stdoutUpdatePending: 0,
        stderrUpdatePending: 0,
        outputWriteError: null,
        stdoutWritableErrorHooked: false,
        stderrWritableErrorHooked: false,
        stdoutWritableBlocked: false,
        stderrWritableBlocked: false,
        stdoutWritableBlockedBytes: 0,
        stderrWritableBlockedBytes: 0,
        sendWindowUpdate: null,
        resolve,
        reject,
        resultPromise,
        stdinEnabled: options.stdinEnabled,
        encoding: options.encoding ?? DEFAULT_ENCODING,
        signal: options.signal,
        requestReady: false,
        pendingStdin: [],
        pendingResize: null,
    };
    if (session.stdoutMode.mode === "pipe") {
        session.stdoutPipe = new ExecPipeStream(windowBytes, () => {
            refillPipeWindow(session, "stdout");
        });
    }
    if (session.stderrMode.mode === "pipe") {
        session.stderrPipe = new ExecPipeStream(windowBytes, () => {
            refillPipeWindow(session, "stderr");
        });
    }
    return session;
}
function refillPipeWindow(session, stream) {
    if (!session.sendWindowUpdate)
        return;
    const pipe = stream === "stdout" ? session.stdoutPipe : session.stderrPipe;
    if (!pipe)
        return;
    // Keep guest credit aligned with host-side pipe buffering.
    const targetCredit = Math.max(0, session.windowBytes - pipe.getBufferedBytes());
    const advertisedCredit = stream === "stdout"
        ? session.stdoutCredit + session.stdoutUpdatePending
        : session.stderrCredit + session.stderrUpdatePending;
    const delta = targetCredit - advertisedCredit;
    if (delta > 0) {
        queueWindowUpdate(session, stream, delta);
    }
}
function updateThreshold(session) {
    // Coalesce updates, but ensure small windows still make progress.
    return Math.max(1024, Math.min(MIN_WINDOW_UPDATE_BYTES, Math.floor(session.windowBytes / 2)));
}
function flushWindowUpdates(session) {
    if (!session.sendWindowUpdate)
        return;
    const stdoutBytes = session.stdoutUpdatePending;
    const stderrBytes = session.stderrUpdatePending;
    if (stdoutBytes <= 0 && stderrBytes <= 0)
        return;
    session.stdoutUpdatePending = 0;
    session.stderrUpdatePending = 0;
    session.stdoutCredit += stdoutBytes;
    session.stderrCredit += stderrBytes;
    session.sendWindowUpdate(stdoutBytes, stderrBytes);
}
function queueWindowUpdate(session, stream, bytes) {
    if (!session.sendWindowUpdate)
        return;
    if (!Number.isFinite(bytes) || bytes <= 0)
        return;
    if (stream === "stdout")
        session.stdoutUpdatePending += bytes;
    else
        session.stderrUpdatePending += bytes;
    const threshold = updateThreshold(session);
    // Send if we have a meaningful batch, or if the guest is starved on this stream.
    if (session.stdoutUpdatePending >= threshold ||
        session.stderrUpdatePending >= threshold ||
        session.stdoutCredit === 0 ||
        session.stderrCredit === 0) {
        flushWindowUpdates(session);
    }
}
export function finishExecSession(session, exitCode, signal) {
    const result = new ExecResult(session.id, exitCode, Buffer.concat(session.stdoutChunks), Buffer.concat(session.stderrChunks), signal, session.encoding);
    session.stdoutPipe?.endStream();
    session.stderrPipe?.endStream();
    if (session.signal && session.signalListener) {
        session.signal.removeEventListener("abort", session.signalListener);
    }
    session.resolve(result);
}
export function rejectExecSession(session, error) {
    session.stdoutPipe?.endStream();
    session.stderrPipe?.endStream();
    if (session.signal && session.signalListener) {
        session.signal.removeEventListener("abort", session.signalListener);
    }
    session.reject(error);
}
function failWritableOutput(session, stream, err, extraBytes) {
    // Switch to ignore mode to avoid deadlocks (we still grant credits back)
    if (stream === "stdout") {
        session.stdoutMode = { mode: "ignore" };
        extraBytes += session.stdoutWritableBlockedBytes;
        session.stdoutWritableBlockedBytes = 0;
        session.stdoutWritableBlocked = false;
    }
    else {
        session.stderrMode = { mode: "ignore" };
        extraBytes += session.stderrWritableBlockedBytes;
        session.stderrWritableBlockedBytes = 0;
        session.stderrWritableBlocked = false;
    }
    if (extraBytes > 0) {
        queueWindowUpdate(session, stream, extraBytes);
        flushWindowUpdates(session);
    }
    const error = err instanceof Error ? err : new Error(String(err));
    if (!session.outputWriteError) {
        session.outputWriteError = error;
        const wrapped = new Error(`${stream} output write failed: ${error.message}`);
        wrapped.cause = error;
        // Preserve stable identifiers on common Node.js system errors (EPIPE, etc.)
        const src = error;
        const dst = wrapped;
        for (const key of [
            "code",
            "errno",
            "syscall",
            "path",
            "address",
            "port",
            "dest",
        ]) {
            if (src && src[key] !== undefined)
                dst[key] = src[key];
        }
        rejectExecSession(session, wrapped);
    }
}
export function applyOutputChunk(session, stream, data) {
    // Update credit accounting (credits represent what the guest can still send)
    if (stream === "stdout") {
        session.stdoutCredit = Math.max(0, session.stdoutCredit - data.length);
    }
    else {
        session.stderrCredit = Math.max(0, session.stderrCredit - data.length);
    }
    const mode = stream === "stdout" ? session.stdoutMode : session.stderrMode;
    if (mode.mode === "buffer") {
        if (stream === "stdout")
            session.stdoutChunks.push(data);
        else
            session.stderrChunks.push(data);
        // Stored output is consumed immediately.
        queueWindowUpdate(session, stream, data.length);
        return;
    }
    if (mode.mode === "ignore") {
        // Dropped output is consumed immediately.
        queueWindowUpdate(session, stream, data.length);
        return;
    }
    if (mode.mode === "pipe") {
        const pipe = stream === "stdout" ? session.stdoutPipe : session.stderrPipe;
        pipe?.pushChunk(data);
        // Credits are replenished based on host-side pipe buffering.
        return;
    }
    if (mode.mode === "writable") {
        const w = mode.stream;
        // Observe async errors (e.g. EPIPE on a closed pipe)
        if (typeof w.once === "function") {
            if (stream === "stdout") {
                if (!session.stdoutWritableErrorHooked) {
                    session.stdoutWritableErrorHooked = true;
                    w.once("error", (err) => {
                        const current = session.stdoutMode;
                        if (current.mode === "writable" && current.stream === w) {
                            failWritableOutput(session, "stdout", err, 0);
                        }
                    });
                }
            }
            else {
                if (!session.stderrWritableErrorHooked) {
                    session.stderrWritableErrorHooked = true;
                    w.once("error", (err) => {
                        const current = session.stderrMode;
                        if (current.mode === "writable" && current.stream === w) {
                            failWritableOutput(session, "stderr", err, 0);
                        }
                    });
                }
            }
        }
        let ok;
        try {
            ok = w.write(data);
        }
        catch (err) {
            // Treat as consumed to avoid guest deadlocks, but fail the exec.
            failWritableOutput(session, stream, err, data.length);
            return;
        }
        if (ok) {
            queueWindowUpdate(session, stream, data.length);
            return;
        }
        // Backpressured: don't grant credits back until drain.
        if (stream === "stdout") {
            session.stdoutWritableBlockedBytes += data.length;
            if (!session.stdoutWritableBlocked) {
                session.stdoutWritableBlocked = true;
                if (typeof w.once === "function") {
                    w.once("drain", () => {
                        const n = session.stdoutWritableBlockedBytes;
                        session.stdoutWritableBlockedBytes = 0;
                        session.stdoutWritableBlocked = false;
                        if (n > 0) {
                            queueWindowUpdate(session, "stdout", n);
                            flushWindowUpdates(session);
                        }
                    });
                }
                else {
                    // Unknown writable implementation: avoid deadlocking by treating as consumed.
                    queueWindowUpdate(session, "stdout", session.stdoutWritableBlockedBytes);
                    session.stdoutWritableBlockedBytes = 0;
                    session.stdoutWritableBlocked = false;
                    flushWindowUpdates(session);
                }
            }
        }
        else {
            session.stderrWritableBlockedBytes += data.length;
            if (!session.stderrWritableBlocked) {
                session.stderrWritableBlocked = true;
                if (typeof w.once === "function") {
                    w.once("drain", () => {
                        const n = session.stderrWritableBlockedBytes;
                        session.stderrWritableBlockedBytes = 0;
                        session.stderrWritableBlocked = false;
                        if (n > 0) {
                            queueWindowUpdate(session, "stderr", n);
                            flushWindowUpdates(session);
                        }
                    });
                }
                else {
                    // Unknown writable implementation: avoid deadlocking by treating as consumed.
                    queueWindowUpdate(session, "stderr", session.stderrWritableBlockedBytes);
                    session.stderrWritableBlockedBytes = 0;
                    session.stderrWritableBlocked = false;
                    flushWindowUpdates(session);
                }
            }
        }
        return;
    }
    // Unreachable: all output modes are normalized to buffer/ignore/pipe/writable.
}
//# sourceMappingURL=exec.js.map