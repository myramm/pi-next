import { Readable } from "stream";
/**
 * Output chunk from a streaming exec, with stream label.
 */
export type OutputChunk = {
    stream: "stdout" | "stderr";
    data: Buffer;
    text: string;
};
/**
 * Result of a completed exec command.
 */
export declare class ExecResult {
    readonly id: number;
    readonly exitCode: number;
    readonly signal?: number;
    private readonly _stdout;
    private readonly _stderr;
    private readonly _encoding;
    constructor(id: number, exitCode: number, stdout: Buffer, stderr: Buffer, signal?: number, encoding?: BufferEncoding);
    /** stdout as string */
    get stdout(): string;
    /** stderr as string */
    get stderr(): string;
    /** stdout as Buffer (for binary data) */
    get stdoutBuffer(): Buffer;
    /** stderr as Buffer (for binary data) */
    get stderrBuffer(): Buffer;
    /** Parse stdout as JSON */
    json<T = unknown>(): T;
    /** Split stdout into lines */
    lines(): string[];
    /** Check if the command succeeded (exit code 0) */
    get ok(): boolean;
    toString(): string;
}
export type ExecOutputMode = "buffer" | "pipe" | "inherit" | "ignore" | NodeJS.WritableStream;
/**
 * Options for exec.
 */
export type ExecOptions = {
    /** extra argv entries passed as shell positional parameters when `command` is a string */
    argv?: string[];
    /** environment variables */
    env?: string[] | Record<string, string>;
    /** working directory */
    cwd?: string;
    /** stdin input (true enables manual write/end) */
    stdin?: boolean | string | Buffer | Readable | AsyncIterable<Buffer>;
    /** whether to allocate a pty */
    pty?: boolean;
    /** string encoding for decoded output (default: utf-8) */
    encoding?: BufferEncoding;
    /** abort signal */
    signal?: AbortSignal;
    /** stdout handling (default: "buffer") */
    stdout?: ExecOutputMode;
    /** stderr handling (default: "buffer") */
    stderr?: ExecOutputMode;
    /**
     * Backpressure window size in `bytes` for stdout/stderr when using streaming modes.
     *
     * Defaults to 256 KiB.
     */
    windowBytes?: number;
    /**
     * Legacy option: whether to buffer stdout/stderr for the result (default: true).
     *
     * - buffer=true: stdout/stderr default to "buffer"
     * - buffer=false: stdout/stderr default to "ignore"
     */
    buffer?: boolean;
};
export type ResolvedExecOutputMode = {
    mode: "buffer";
} | {
    mode: "ignore";
} | {
    mode: "pipe";
} | {
    mode: "writable";
    stream: NodeJS.WritableStream;
};
export declare function resolveOutputMode(value: ExecOutputMode | undefined, legacyBuffer: boolean | undefined, streamName: "stdout" | "stderr"): ResolvedExecOutputMode;
declare class ExecPipeStream extends Readable {
    private readonly onConsumed;
    constructor(windowBytes: number, onConsumed: () => void);
    private bufferedBytes;
    private consumedPending;
    private consumedScheduled;
    getBufferedBytes(): number;
    private queueConsumed;
    private consume;
    emit(eventName: string | symbol, ...args: any[]): boolean;
    read(size?: number): any;
    _read(_size: number): void;
    pushChunk(chunk: Buffer): void;
    endStream(): void;
}
export type ExecSession = {
    id: number;
    stdoutMode: ResolvedExecOutputMode;
    stderrMode: ResolvedExecOutputMode;
    stdoutPipe: ExecPipeStream | null;
    stderrPipe: ExecPipeStream | null;
    stdoutChunks: Buffer[];
    stderrChunks: Buffer[];
    windowBytes: number;
    stdoutCredit: number;
    stderrCredit: number;
    stdoutUpdatePending: number;
    stderrUpdatePending: number;
    outputWriteError: Error | null;
    stdoutWritableErrorHooked: boolean;
    stderrWritableErrorHooked: boolean;
    stdoutWritableBlocked: boolean;
    stderrWritableBlocked: boolean;
    stdoutWritableBlockedBytes: number;
    stderrWritableBlockedBytes: number;
    sendWindowUpdate: ((stdoutBytes: number, stderrBytes: number) => void) | null;
    resolve: (result: ExecResult) => void;
    reject: (error: Error) => void;
    resultPromise: Promise<ExecResult>;
    stdinEnabled: boolean;
    encoding: BufferEncoding;
    signal?: AbortSignal;
    signalListener?: () => void;
    requestReady: boolean;
    pendingStdin: Array<{
        type: "data";
        data: Buffer | string;
    } | {
        type: "eof";
    }>;
    pendingResize: {
        rows: number;
        cols: number;
    } | null;
};
export type ExecProcessCallbacks = {
    sendStdin: (id: number, data: Buffer | string) => void;
    sendStdinEof: (id: number) => void;
    sendResize?: (id: number, rows: number, cols: number) => void;
    cleanup: (id: number) => void;
};
export declare class ExecProcess implements PromiseLike<ExecResult>, AsyncIterable<string> {
    private attached;
    private readonly session;
    private readonly callbacks;
    constructor(session: ExecSession, callbacks: ExecProcessCallbacks);
    get id(): number;
    then<TResult1 = ExecResult, TResult2 = never>(onfulfilled?: ((value: ExecResult) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
    catch<TResult = never>(onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null): Promise<ExecResult | TResult>;
    finally(onfinally?: (() => void) | null): Promise<ExecResult>;
    get result(): Promise<ExecResult>;
    write(data: string | Buffer): void;
    end(): void;
    resize(rows: number, cols: number): void;
    [Symbol.asyncIterator](): AsyncIterator<string>;
    output(): AsyncIterable<OutputChunk>;
    lines(): AsyncIterable<string>;
    get stdout(): Readable | null;
    get stderr(): Readable | null;
    attach(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, stderr?: NodeJS.WriteStream): void;
}
export declare function createExecSession(id: number, options: {
    stdinEnabled: boolean;
    encoding?: BufferEncoding;
    signal?: AbortSignal;
    stdout: ResolvedExecOutputMode;
    stderr: ResolvedExecOutputMode;
    windowBytes?: number;
}): ExecSession;
export declare function finishExecSession(session: ExecSession, exitCode: number, signal?: number): void;
export declare function rejectExecSession(session: ExecSession, error: Error): void;
export declare function applyOutputChunk(session: ExecSession, stream: "stdout" | "stderr", data: Buffer): void;
export {};
//# sourceMappingURL=exec.d.ts.map