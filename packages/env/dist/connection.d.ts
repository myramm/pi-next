export type Json = Record<string, unknown>;
/** A failure reported by the daemon, with its Node-style code. */
export declare class RemoteError extends Error {
    readonly code: string;
    readonly path?: string;
    readonly fields: Json;
    constructor(fields: Json);
}
/** What `hello` reports about the remote machine. */
export interface RemoteInfo {
    protocol: number;
    version: string;
    os: string;
    arch: string;
    home: string;
    tmpdir: string;
    /** Path separator: `/`, or `\\` on Windows. */
    separator: string;
    /** The daemon's working directory, where Node's `path.resolve` would fall back to `process.cwd()`. */
    cwd: string;
    /** Windows: per-drive working directories (`C:` → `C:\\work`) of the `=C:` variables. */
    driveCwds: Record<string, string>;
    pid: number;
    /** Operations added to protocol 1 that this daemon supports, such as `listFiles`; absent from older daemons. */
    features?: string[];
}
/**
 * Node's names for the daemon's system and architecture, which `hello` reports in Rust's spelling: `windows` is
 * `win32`, `macos` is `darwin`, `x86_64` is `x64`, `aarch64` is `arm64`, so they compare with `process.platform` and
 * `process.arch`. Other names are kept.
 */
export declare function nodePlatform(info: Pick<RemoteInfo, "os" | "arch">): {
    platform: string;
    arch: string;
};
export interface ConnectionOptions {
    /**
     * Command that starts the daemon, before its `serve --token <hex>` arguments, e.g. `["ssh", "-T", "--", "host",
     * "~/.pi/mobile/tools/pi-env"]`. A function computes it at each start (detecting and deploying first, for example);
     * its failure fails that start, and the next request tries again.
     */
    command: readonly string[] | (() => Promise<readonly string[]>);
    /** Receives the daemon's and the transport's diagnostic output. */
    onLog?: (text: string) => void;
}
export interface Reply {
    json: Json;
    payload: Uint8Array;
    /** The daemon session that answered; handles from it are only valid while it lives. */
    session: number;
}
export interface RequestOptions {
    payload?: Uint8Array;
    /** Aborting sends `cancel`; the request still settles with the daemon's result or error. */
    signal?: AbortSignal;
    /** Progress events of the request, such as `exec` output. */
    onEvent?: (json: Json, payload: Uint8Array) => void;
    /** The request's id and session, for `kill`. */
    onStart?: (id: number, session: number) => void;
    /**
     * Only run in this daemon session, for requests on handles it opened. After the connection was lost and started
     * again, such requests fail instead of reaching a daemon that never opened the handle.
     */
    session?: number;
}
/** Whether an error means the connection was lost, not that the daemon refused the request. */
export declare function isConnectionLost(error: unknown): boolean;
/**
 * One connection to a pi-env daemon: started lazily on the first request and started again after it is lost. Requests
 * in flight when it is lost fail with code `unknown`; for mutations their outcome is then unknown.
 */
export declare class Connection {
    #private;
    constructor(options: ConnectionOptions);
    /** Connect if needed and return what the daemon reported about its machine. */
    info(): Promise<RemoteInfo>;
    /** Connect if needed and return the live session's id. */
    session(): Promise<number>;
    request(op: string, json: Json, options?: RequestOptions): Promise<Reply>;
    /** Stop the daemon; it kills everything it started. */
    close(): void;
    /** Kill one `exec` without aborting it. */
    kill(id: number, session: number): void;
}
//# sourceMappingURL=connection.d.ts.map