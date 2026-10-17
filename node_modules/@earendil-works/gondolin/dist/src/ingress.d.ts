import { EventEmitter } from "events";
import type { VirtualProvider } from "./vfs/node/index.js";
import type { SandboxServer } from "./sandbox/server.js";
export type IngressRoute = {
    /** external path prefix (must start with "/") */
    prefix: string;
    /** guest loopback port */
    port: number;
    /** whether to strip prefix (default: true) */
    stripPrefix: boolean;
};
export type ParsedListenersFile = {
    routes: IngressRoute[];
};
export declare function parseListenersFile(text: string): ParsedListenersFile;
export declare function serializeListenersFile(data: ParsedListenersFile): string;
export declare class GondolinListeners extends EventEmitter {
    private routes;
    private reloadTimer;
    private lastReloadError;
    private readonly etcProvider;
    constructor(etcProvider: VirtualProvider);
    getLastReloadError(): unknown;
    getRoutes(): IngressRoute[];
    /** Called by VFS hooks when /etc/gondolin/listeners may have changed */
    notifyDirty(): void;
    /** Replace the routing table and write canonical listeners file back into the guest */
    setRoutes(routes: IngressRoute[]): void;
    /** Parse listeners file and update routes; also canonicalize file contents */
    reloadNow(): void;
    private readListenersText;
    private writeCanonical;
    private writeListenersText;
}
export type IngressHeaderValue = string | string[];
export type IngressHeaders = Record<string, IngressHeaderValue>;
export type IngressHeaderPatch = Record<string, IngressHeaderValue | null | undefined>;
export declare class IngressRequestBlockedError extends Error {
    /** http status code */
    readonly statusCode: number;
    /** http status message */
    readonly statusMessage: string;
    /** response body */
    readonly body: string;
    constructor(message?: string, statusCode?: number, statusMessage?: string, body?: string);
}
export type IngressAllowInfo = {
    /** client ip address (as reported by Node) */
    clientIp: string;
    /** http method */
    method: string;
    /** request path including query */
    path: string;
    /** request headers (lowercased) */
    headers: Record<string, string | string[]>;
    /** matched ingress route */
    route: IngressRoute;
};
export type IngressHookRequest = {
    /** client ip address (as reported by Node) */
    clientIp: string;
    /** http method */
    method: string;
    /** original request path including query */
    path: string;
    /** matched ingress route */
    route: IngressRoute;
    /** upstream target host */
    backendHost: string;
    /** upstream target port */
    backendPort: number;
    /** upstream request target (path + query) */
    backendTarget: string;
    /** upstream request headers (lowercased) */
    headers: IngressHeaders;
};
export type IngressHookRequestPatch = {
    /** updated http method */
    method?: string;
    /** updated upstream host */
    backendHost?: string;
    /** updated upstream port */
    backendPort?: number;
    /** updated upstream request target (path + query) */
    backendTarget?: string;
    /** upstream header patch */
    headers?: IngressHeaderPatch;
    /** buffer full upstream response body before calling onResponse */
    bufferResponseBody?: boolean;
    /** max buffered upstream response body size in `bytes` */
    maxBufferedResponseBodyBytes?: number;
};
export type IngressHookResponse = {
    /** http status code */
    statusCode: number;
    /** http status message */
    statusMessage: string;
    /** response headers (lowercased) */
    headers: IngressHeaders;
    /** buffered response body (only if `bufferResponseBody` is enabled) */
    body?: Buffer;
};
export type IngressHookResponsePatch = {
    /** updated http status code */
    statusCode?: number;
    /** updated http status message */
    statusMessage?: string;
    /** response header patch */
    headers?: IngressHeaderPatch;
    /** replacement response body */
    body?: Buffer;
};
export type IngressGatewayHooks = {
    /** allow/deny callback */
    isAllowed?: (info: IngressAllowInfo) => Promise<boolean> | boolean;
    /** request rewrite hook (rewrite headers / upstream target) */
    onRequest?: (request: IngressHookRequest) => Promise<IngressHookRequestPatch | void> | IngressHookRequestPatch | void;
    /** response rewrite hook (rewrite status / headers and optionally body) */
    onResponse?: (response: IngressHookResponse, request: IngressHookRequest) => Promise<IngressHookResponsePatch | void> | IngressHookResponsePatch | void;
};
export type EnableIngressOptions = {
    /** host interface to bind (default: 127.0.0.1) */
    listenHost?: string;
    /** host port to bind (default: 0 = ephemeral) */
    listenPort?: number;
    /** whether to allow WebSocket upgrades (default: true) */
    allowWebSockets?: boolean;
    /** ingress gateway hooks */
    hooks?: IngressGatewayHooks;
    /** buffer full upstream response bodies before sending them to the client (default: false) */
    bufferResponseBody?: boolean;
    /** max buffered upstream response body size in `bytes` (default: 2 MiB) */
    maxBufferedResponseBodyBytes?: number;
    /** timeout waiting for upstream response headers in `ms` (default: 2000) */
    upstreamHeaderTimeoutMs?: number;
    /** timeout waiting between upstream response body chunks in `ms` (default: 15000) */
    upstreamResponseTimeoutMs?: number;
};
export type IngressAccess = {
    host: string;
    port: number;
    url: string;
    close(): Promise<void>;
};
export declare class IngressGateway {
    private server;
    private hooks;
    private allowWebSockets;
    private bufferResponseBody;
    private maxBufferedResponseBodyBytes;
    private upstreamHeaderTimeoutMs;
    private upstreamResponseTimeoutMs;
    private readonly sandbox;
    private readonly listeners;
    constructor(sandbox: SandboxServer, listeners: GondolinListeners, options?: Pick<EnableIngressOptions, "hooks" | "bufferResponseBody" | "maxBufferedResponseBodyBytes" | "allowWebSockets" | "upstreamHeaderTimeoutMs" | "upstreamResponseTimeoutMs">);
    listen(options?: EnableIngressOptions): Promise<IngressAccess>;
    private pickRoute;
    private buildUpstreamHookRequest;
    private openUpstreamAndWriteHead;
    private rejectUpgrade;
    private handleRequest;
    private handleUpgrade;
}
export type GondolinEtcMount = {
    provider: VirtualProvider;
    listeners: GondolinListeners;
};
export declare function createGondolinEtcMount(provider: VirtualProvider): GondolinEtcMount;
export declare function createGondolinEtcHooks(listeners: GondolinListeners, etcProvider?: VirtualProvider): {
    after: (ctx: {
        op: string;
        path?: string;
        oldPath?: string;
        newPath?: string;
        data?: Buffer;
        size?: number;
        offset?: number;
        length?: number;
    }) => void;
    before: (ctx: {
        op: string;
        path?: string;
        data?: Buffer;
        size?: number;
        offset?: number;
        length?: number;
    }) => void;
};
//# sourceMappingURL=ingress.d.ts.map