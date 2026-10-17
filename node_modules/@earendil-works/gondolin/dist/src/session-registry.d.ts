import type { SandboxConnection } from "./sandbox/client.js";
import { type ClientMessage, type ServerMessage, type SnapshotCommandMessage } from "./sandbox/control-protocol.js";
/** persisted session metadata */
export type SessionInfo = {
    /** session uuid */
    id: string;
    /** host process pid */
    pid: number;
    /** unix socket path for IPC */
    socketPath: string;
    /** iso 8601 creation timestamp */
    createdAt: string;
    /** human-readable label */
    label?: string;
};
/** discovered session entry */
export type SessionEntry = SessionInfo & {
    /** whether the session socket is connectable */
    alive: boolean;
};
/** register a live session */
export declare function registerSession(options: {
    id: string;
    label?: string;
}): {
    socketPath: string;
    metadataPath: string;
};
/** unregister a session */
export declare function unregisterSession(id: string): void;
/** list known sessions */
export declare function listSessions(): Promise<SessionEntry[]>;
/** collect stale sessions and orphan socket files */
export declare function gcSessions(): Promise<number>;
/** find a session by exact or prefix id */
export declare function findSession(query: string): Promise<SessionEntry | null>;
type SessionSnapshotResult = {
    /** absolute path to the checkpoint `.qcow2` file */
    path: string;
    /** snapshot name */
    name: string;
    /** callback invoked after the response frame has been queued */
    onResponseQueued?: () => void | Promise<void>;
};
type SessionIpcServerHandlers = {
    /** create a VM checkpoint for a running session */
    onSnapshot?: (message: SnapshotCommandMessage) => Promise<SessionSnapshotResult>;
};
export declare class SessionIpcServer {
    private server;
    private clients;
    private allocatedInternalIds;
    private nextInternalId;
    private readonly sockPath;
    private readonly connectToSandbox;
    private readonly handlers;
    constructor(sockPath: string, connectToSandbox: (onMessage: (data: Buffer | string, isBinary: boolean) => void, onClose?: () => void) => SandboxConnection, handlers?: SessionIpcServerHandlers);
    start(): void;
    close(): Promise<void>;
    private allocateInternalId;
    private releaseInternalId;
    private handleConnection;
}
export type IpcClientCallbacks = {
    /** called with JSON server messages */
    onJson: (message: ServerMessage) => void;
    /** called with binary output frames */
    onBinary: (data: Buffer) => void;
    /** called when the connection closes */
    onClose: (error?: Error) => void;
};
/** connect to an external session IPC socket */
export declare function connectToSession(sockPath: string, callbacks: IpcClientCallbacks): {
    send: (message: ClientMessage) => void;
    close: () => void;
};
export {};
//# sourceMappingURL=session-registry.d.ts.map