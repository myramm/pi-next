import { Buffer } from "node:buffer";
export declare const MAX_FRAME: number;
export type ExecOutput = {
    /** protocol version */
    v: number;
    /** message type */
    t: "exec_output";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** output stream */
        stream: "stdout" | "stderr";
        /** raw output bytes */
        data: Buffer;
    };
};
export type ExecResponse = {
    /** protocol version */
    v: number;
    /** message type */
    t: "exec_response";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** process exit code */
        exit_code: number;
        /** termination signal (if any) */
        signal?: number;
    };
};
export type ErrorResponse = {
    /** protocol version */
    v: number;
    /** message type */
    t: "error";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** stable error code */
        code: string;
        /** human-readable error message */
        message: string;
    };
};
export type FsRequest = {
    /** protocol version */
    v: number;
    /** message type */
    t: "fs_request";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** operation name */
        op: string;
        /** operation fields */
        req: Record<string, unknown>;
    };
};
export type FsResponse = {
    /** protocol version */
    v: number;
    /** message type */
    t: "fs_response";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** operation name */
        op: string;
        /** operation error code */
        err: number;
        /** operation result fields */
        res?: Record<string, unknown>;
        /** optional error detail */
        message?: string;
    };
};
export type VfsReady = {
    /** protocol version */
    v: number;
    /** message type */
    t: "vfs_ready";
    /** request id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type VfsError = {
    /** protocol version */
    v: number;
    /** message type */
    t: "vfs_error";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** error message */
        message: string;
    };
};
export type TcpOpen = {
    /** protocol version */
    v: number;
    /** message type */
    t: "tcp_open";
    /** stream id */
    id: number;
    /** payload */
    p: {
        /** target host (must be loopback) */
        host: string;
        /** target port */
        port: number;
    };
};
export type TcpOpened = {
    /** protocol version */
    v: number;
    /** message type */
    t: "tcp_opened";
    /** stream id */
    id: number;
    /** payload */
    p: {
        /** whether the connection was established */
        ok: boolean;
        /** error message when ok=false */
        message?: string;
    };
};
export type TcpData = {
    /** protocol version */
    v: number;
    /** message type */
    t: "tcp_data";
    /** stream id */
    id: number;
    /** payload */
    p: {
        /** raw data bytes */
        data: Buffer;
    };
};
export type TcpEof = {
    /** protocol version */
    v: number;
    /** message type */
    t: "tcp_eof";
    /** stream id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type TcpClose = {
    /** protocol version */
    v: number;
    /** message type */
    t: "tcp_close";
    /** stream id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type FileReadData = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_read_data";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** raw file bytes */
        data: Buffer;
    };
};
export type FileReadDone = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_read_done";
    /** request id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type FileWriteDone = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_write_done";
    /** request id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type FileDeleteDone = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_delete_done";
    /** request id */
    id: number;
    /** payload */
    p: Record<string, never>;
};
export type StdinWindow = {
    /** protocol version */
    v: number;
    /** message type */
    t: "stdin_window";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** additional stdin credits in `bytes` */
        stdin: number;
    };
};
export type IncomingMessage = ExecOutput | ExecResponse | ErrorResponse | StdinWindow | FsRequest | FsResponse | VfsReady | VfsError | TcpOpen | TcpOpened | TcpData | TcpEof | TcpClose | FileReadData | FileReadDone | FileWriteDone | FileDeleteDone;
export type ExecRequest = {
    /** protocol version */
    v: number;
    /** message type */
    t: "exec_request";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** executable */
        cmd: string;
        /** argv entries (excluding cmd) */
        argv?: string[];
        /** environment variables as `KEY=VALUE` */
        env?: string[];
        /** working directory */
        cwd?: string;
        /** whether stdin messages will be sent */
        stdin?: boolean;
        /** whether to allocate a pty */
        pty?: boolean;
        /** initial stdout credit window in `bytes` */
        stdout_window?: number;
        /** initial stderr credit window in `bytes` */
        stderr_window?: number;
    };
};
export type StdinData = {
    /** protocol version */
    v: number;
    /** message type */
    t: "stdin_data";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** stdin chunk */
        data: Buffer;
        /** whether this chunk closes stdin */
        eof?: boolean;
    };
};
export type PtyResize = {
    /** protocol version */
    v: number;
    /** message type */
    t: "pty_resize";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** pty row count */
        rows: number;
        /** pty column count */
        cols: number;
    };
};
export type ExecWindow = {
    /** protocol version */
    v: number;
    /** message type */
    t: "exec_window";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** additional stdout credits in `bytes` */
        stdout?: number;
        /** additional stderr credits in `bytes` */
        stderr?: number;
    };
};
export type FileReadRequest = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_read_request";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** target path */
        path: string;
        /** working directory for relative paths */
        cwd?: string;
        /** preferred chunk size in `bytes` */
        chunk_size?: number;
    };
};
export type FileWriteRequest = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_write_request";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** target path */
        path: string;
        /** working directory for relative paths */
        cwd?: string;
        /** whether to truncate existing file */
        truncate?: boolean;
    };
};
export type FileWriteData = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_write_data";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** file chunk */
        data: Buffer;
        /** whether this chunk closes the write stream */
        eof?: boolean;
    };
};
export type FileDeleteRequest = {
    /** protocol version */
    v: number;
    /** message type */
    t: "file_delete_request";
    /** request id */
    id: number;
    /** payload */
    p: {
        /** target path */
        path: string;
        /** working directory for relative paths */
        cwd?: string;
        /** ignore missing paths */
        force?: boolean;
        /** recursive delete for directories */
        recursive?: boolean;
    };
};
export declare class FrameReader {
    private buffer;
    private expectedLength;
    push(chunk: Buffer, onFrame: (frame: Buffer) => void): void;
}
export declare function normalize(value: unknown): unknown;
export declare function decodeMessage(frame: Buffer): IncomingMessage;
export declare function buildExecRequest(id: number, payload: ExecRequest["p"]): ExecRequest;
export declare function buildStdinData(id: number, data: Buffer, eof?: boolean): StdinData;
export declare function buildPtyResize(id: number, rows: number, cols: number): PtyResize;
export declare function buildExecWindow(id: number, stdout?: number, stderr?: number): ExecWindow;
export declare function buildFileReadRequest(id: number, payload: FileReadRequest["p"]): FileReadRequest;
export declare function buildFileWriteRequest(id: number, payload: FileWriteRequest["p"]): FileWriteRequest;
export declare function buildFileWriteData(id: number, data: Buffer, eof?: boolean): FileWriteData;
export declare function buildFileDeleteRequest(id: number, payload: FileDeleteRequest["p"]): FileDeleteRequest;
export declare function encodeFrame(message: object): Buffer;
//# sourceMappingURL=virtio-protocol.d.ts.map