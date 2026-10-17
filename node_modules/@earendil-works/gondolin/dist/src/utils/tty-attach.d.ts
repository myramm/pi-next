import type { Readable } from "node:stream";
export type AttachEscape = {
    /** escape byte value */
    byte: number;
    /** called after local cleanup when escape is triggered */
    onEscape: () => void;
};
export type AttachTtyHooks = {
    write: (chunk: Buffer) => void;
    end: () => void;
    resize?: (rows: number, cols: number) => void;
    escape?: AttachEscape;
};
/**
 * Attach a PTY-like exec session to local stdio.
 *
 * This is a shared helper used by both the library (ExecProcess.attach) and
 * the CLI, to reduce drift between implementations.
 */
export declare function attachTty(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, stderr: NodeJS.WriteStream, stdoutPipe: Readable | null, stderrPipe: Readable | null, hooks: AttachTtyHooks): {
    cleanup: () => void;
};
//# sourceMappingURL=tty-attach.d.ts.map