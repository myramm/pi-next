import type { Connection } from "./connection.ts";
export interface TerminalOptions {
    /** Working directory of the program; it must exist. */
    cwd: string;
    /** Program and arguments. Default: the user's shell (`SHELL` in `env` or the daemon's environment) as a login shell. */
    argv?: readonly string[];
    /** Added to the daemon's environment, or the whole environment with `inheritEnv: false`. Set `TERM` here. */
    env?: Record<string, string>;
    inheritEnv?: boolean;
    cols: number;
    rows: number;
    /** The terminal's raw output, in order. */
    onData: (bytes: Uint8Array) => void;
}
/** The foreground job of a terminal: its process group id, and its leader's name if the system tells. */
export interface TerminalForeground {
    pid: number;
    name?: string;
}
/**
 * A program running in a pseudo-terminal of a pi-env daemon. It ends when the program exits, `close()` kills it, or
 * the connection is lost (the daemon then kills it).
 */
export declare class RemoteTerminal {
    #private;
    readonly pid: number;
    /** The exit code; rejects with the daemon's error, with code `aborted` after `close()`. */
    readonly exited: Promise<number>;
    constructor(connection: Connection, id: number, session: number, pid: number, exited: Promise<number>, abort: AbortController);
    /** Send input; once the terminal has ended, input is dropped. */
    write(data: Uint8Array | string): void;
    /** Change the size; the program receives `SIGWINCH`. */
    resize(cols: number, rows: number): void;
    /** Kill the program and everything in its session. */
    close(): void;
    /**
     * The job in the terminal's foreground when it is not the program itself: what a shell runs, such as an editor.
     * Undefined while the program is in front (a shell at its prompt). Rejects once the terminal has ended.
     */
    foreground(): Promise<TerminalForeground | undefined>;
}
/** Start a program in a new pseudo-terminal of the daemon behind `connection`. */
export declare function openTerminal(connection: Connection, options: TerminalOptions): Promise<RemoteTerminal>;
//# sourceMappingURL=terminal.d.ts.map