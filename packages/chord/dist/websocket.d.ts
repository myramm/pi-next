import type { AcceptOptions } from "./connection.ts";
import type { Host } from "./host.ts";
import { type WebSocketLike } from "./link.ts";
/** A WebSocket server (e.g. `ws`'s `WebSocketServer`), structurally: Chord does not depend on `ws`. */
export interface WebSocketServerLike<Request> {
    on(event: "connection", listener: (socket: WebSocketLike, request: Request) => void): unknown;
}
/** WebSocket peers are always accepted as clients: no roots, no code versions, no reload votes, not addressable. */
export interface WebSocketAcceptOptions<Request, P = unknown> extends Omit<AcceptOptions<P>, "principal" | "kind" | "name"> {
    /** The authenticator: the principal of the connecting client, or undefined to refuse it. */
    principal(request: Request): P | undefined | Promise<P | undefined>;
}
/** Accepts every connection of `server` on `host` as a client link stamped with the authenticated principal. */
export declare function acceptWebSockets<Request, P = unknown>(server: WebSocketServerLike<Request>, host: Host<P>, options: WebSocketAcceptOptions<Request, P>): void;
//# sourceMappingURL=websocket.d.ts.map