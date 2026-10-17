import { Duplex } from "stream";
import { type IncomingMessage } from "./virtio-protocol.js";
export declare const MAX_REQUEST_ID = 4294967295;
export declare class VirtioBridge {
    private socket;
    private server;
    private readonly reader;
    private reconnectTimer;
    private pending;
    private pendingBytes;
    private waitingDrain;
    private allowReconnect;
    private closed;
    private readonly socketPath;
    private readonly maxPendingBytes;
    constructor(socketPath: string, maxPendingBytes?: number);
    connect(): void;
    disconnect(): Promise<void>;
    send(message: object): boolean;
    onMessage?: (message: IncomingMessage) => void;
    onError?: (error: unknown) => void;
    /** Called when the bridge may be able to accept more queued messages */
    onWritable?: () => void;
    private writeFrame;
    private queueFrame;
    private flushPending;
    private attachSocket;
    private handleDisconnect;
    private scheduleReconnect;
}
export declare class TcpForwardStream extends Duplex {
    private closedByRemote;
    private closeSent;
    readonly id: number;
    private readonly sendFrame;
    private readonly onDispose;
    constructor(id: number, sendFrame: (message: object) => boolean, onDispose: () => void);
    _read(_size: number): void;
    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
    _final(callback: (error?: Error | null) => void): void;
    _destroy(_error: Error | null, callback: (error?: Error | null) => void): void;
    pushRemote(data: Buffer): void;
    remoteClose(): void;
    openFailed(message: string): void;
}
export declare function parseMac(value: string): Buffer | null;
export declare function isValidRequestId(value: unknown): value is number;
export declare function estimateBase64Bytes(value: string): number;
//# sourceMappingURL=server-transport.d.ts.map