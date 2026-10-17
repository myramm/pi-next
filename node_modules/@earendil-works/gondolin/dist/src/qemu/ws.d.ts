import net from "net";
import type { QemuNetworkBackend, TcpSession } from "./contracts.js";
import type { InternalHttpRequest } from "../internal/http-types.js";
import type { HttpRequestData } from "../http/utils.js";
export type WebSocketState = {
    /** current websocket state */
    phase: "handshake" | "open";
    /** connected upstream socket (null until connected) */
    upstream: net.Socket | null;
    /** buffered guest->upstream bytes while the upstream socket is not yet connected */
    pending: Buffer[];
    /** bytes currently queued in `pending` in `bytes` */
    pendingBytes: number;
};
export declare function handleWebSocketClientData(backend: QemuNetworkBackend, key: string, session: TcpSession, data: Buffer): void;
export declare function isWebSocketUpgradeRequest(request: HttpRequestData): boolean;
export declare function bridgeWebSocketUpgrade(backend: QemuNetworkBackend, key: string, session: TcpSession, info: {
    protocol: "http" | "https";
    address: string;
    port: number;
    method: string;
    parsedUrl: URL;
    hookRequest: InternalHttpRequest;
}, options: {
    scheme: "http" | "https";
    write: (chunk: Buffer) => void;
    finish: () => void;
}, httpVersion: "HTTP/1.0" | "HTTP/1.1"): Promise<boolean>;
export declare function connectWebSocketUpstream(backend: QemuNetworkBackend, info: {
    protocol: "http" | "https";
    hostname: string;
    address: string;
    port: number;
}): Promise<net.Socket>;
export declare function readUpstreamHttpResponseHead(backend: QemuNetworkBackend, socket: net.Socket): Promise<{
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string | string[]>;
    rest: Buffer;
}>;
//# sourceMappingURL=ws.d.ts.map