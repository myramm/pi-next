import type { Frame } from "./wire.ts";
/** An ordered (FIFO), bidirectional frame channel between two hosts. */
export interface Link {
    readonly closed: boolean;
    /**
     * Returns the size of the encoded frame as sent (JSON text length, or bytes of a packed message) when the transport
     * knows it. The connection's flow control counts these sizes; frames without one count as zero, so a link that never
     * reports sizes is not windowed.
     */
    send(frame: Frame): number | undefined;
    /** Sets the single receiver. Frames arriving earlier are queued. */
    receive(handler: (frame: Frame) => void): void;
    onClose(handler: (reason: string) => void): void;
    /** Closes both ends: the peer gets a `bye`. */
    close(reason?: string): void;
}
/** Shared plumbing: receive queue, close handlers, `bye`. Transports implement `transmit` and `shutdown`. */
declare abstract class BaseLink implements Link {
    #private;
    get closed(): boolean;
    protected abstract transmit(frame: Frame): number | undefined;
    protected abstract shutdown(): void;
    send(frame: Frame): number | undefined;
    receive(handler: (frame: Frame) => void): void;
    onClose(handler: (reason: string) => void): void;
    close(reason?: string): void;
    /** Delivers a parsed frame from the transport, after any frame still being decoded (`deliverLater`). */
    protected deliver(frame: Frame): void;
    /** Delivers a frame that is still being decoded (inflated in a browser); later frames wait for it, in order. */
    protected deliverLater(frame: Promise<Frame>): void;
    /** Marks the link closed (transport ended) and notifies once. */
    protected ended(reason: string): void;
}
/** Payloads whose JSON is longer than this many characters are deflated. */
export declare const PACK_THRESHOLD: number;
/** A deflated JSON payload, kept as received until a host uses it. */
export declare class Packed {
    readonly bytes: Uint8Array;
    constructor(bytes: Uint8Array);
}
/** A frame payload as its user needs it: inflated and parsed if it arrived packed. */
export declare function unpack(value: unknown): unknown;
/**
 * The text frame of a binary (packed) WebSocket message, inflated: for a transport that relays text frames only (the
 * TUI launcher feeding its sandbox). Needs zlib.
 */
export declare function inflateMessage(data: Uint8Array): string;
export declare class MemoryLink extends BaseLink {
    #private;
    peer: MemoryLink | undefined;
    /** Simulates a dead network: frames are dropped silently in both directions and no close is signalled. */
    sever(): void;
    protected transmit(frame: Frame): number | undefined;
    protected shutdown(): void;
}
/** Two connected in-memory links (tests). */
export declare function memoryLinkPair(): [MemoryLink, MemoryLink];
/** `process` in a forked child, or the parent's `ChildProcess`. Structural, so Chord needs no Node types here. */
export interface IpcChannel {
    readonly connected: boolean;
    /**
     * With a callback, Node reports a failed write (the peer process exited and the pipe is broken: `EPIPE`) to it
     * instead of emitting `error`, which nobody would handle.
     */
    send(message: unknown, callback?: (error: Error | null) => void): boolean;
    on(event: "message", listener: (message: unknown) => void): unknown;
    on(event: "disconnect", listener: () => void): unknown;
    off(event: "message", listener: (message: unknown) => void): unknown;
    off(event: "disconnect", listener: () => void): unknown;
}
/**
 * Chord frames on an IPC channel are wrapped as `{ chord2: frame }`; other messages (control) pass by. Both ends are
 * Node processes of one application, so large payloads are packed both ways. Node serializes the messages itself, so
 * the link reports no sizes and is not windowed: both ends are local processes.
 */
export declare class IpcLink extends BaseLink {
    #private;
    constructor(channel: IpcChannel);
    protected transmit(frame: Frame): undefined;
    protected shutdown(): void;
}
export declare const ipcLink: (channel: IpcChannel) => IpcLink;
/** The WHATWG WebSocket surface: the browser `WebSocket`, Node's global `WebSocket`, and `ws` sockets. */
export interface WebSocketLike {
    readonly readyState: number;
    send(data: string | Uint8Array): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: "message", listener: (event: {
        readonly data: unknown;
    }) => void): void;
    addEventListener(type: "open" | "close" | "error", listener: () => void): void;
}
export interface WebSocketLinkOptions {
    /** Deflate large payloads of outgoing frames (default false; the server's side of client sockets). */
    readonly compress?: boolean;
    /** Accept packed (binary) frames from the peer (default true; false for a server's untrusted clients). */
    readonly acceptPacked?: boolean;
}
export declare class WebSocketLink extends BaseLink {
    #private;
    constructor(socket: WebSocketLike, options?: WebSocketLinkOptions);
    protected transmit(frame: Frame): number;
    protected shutdown(): void;
}
export declare const webSocketLink: (socket: WebSocketLike, options?: WebSocketLinkOptions) => WebSocketLink;
export {};
//# sourceMappingURL=link.d.ts.map