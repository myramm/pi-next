import { EventEmitter } from "events";
import net from "net";
import tls from "tls";
import { Duplex } from "stream";
import { type SshOptions } from "./ssh.js";
import { type TcpMappedTarget, type TcpOptions } from "./tcp.js";
import { type HttpSession } from "./http.js";
import type { WebSocketState } from "./ws.js";
import { type DnsOptions, type HttpFetch, type HttpHooks } from "./contracts.js";
export declare const DEFAULT_MAX_HTTP_BODY_BYTES: number;
export declare const DEFAULT_MAX_HTTP_RESPONSE_BODY_BYTES: number;
import { type TcpFlowProtocol } from "./network-stack.js";
declare class GuestTlsStream extends Duplex {
    private readonly onEncryptedWrite;
    constructor(onEncryptedWrite: (chunk: Buffer) => void | Promise<void>);
    pushEncrypted(data: Buffer): void;
    _read(): void;
    _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void;
}
type TlsSession = {
    stream: GuestTlsStream;
    socket: tls.TLSSocket;
    servername: string | null;
};
export type TcpSession = {
    socket: net.Socket | null;
    srcIP: string;
    srcPort: number;
    dstIP: string;
    dstPort: number;
    /** upstream host/ip used by the host socket connect */
    connectIP: string;
    /** upstream port used by the host socket connect */
    connectPort: number;
    /** synthetic hostname derived from destination synthetic dns ip */
    syntheticHostname: string | null;
    /** mapped raw tcp target derived from synthetic host mapping */
    mappedTcp: TcpMappedTarget | null;
    flowControlPaused: boolean;
    protocol: TcpFlowProtocol | null;
    connected: boolean;
    pendingWrites: Buffer[];
    /** bytes currently queued in `pendingWrites` in `bytes` (does not include Node's socket buffer) */
    pendingWriteBytes: number;
    http?: HttpSession;
    tls?: TlsSession;
    /** active WebSocket upgrade/tunnel state */
    ws?: WebSocketState;
};
export type { DnsMode, DnsOptions, HttpFetch, HttpHooks, HttpIpAllowInfo, SyntheticDnsHostMappingMode, } from "./contracts.js";
export type { TcpOptions } from "./tcp.js";
export type QemuNetworkOptions = {
    /** unix socket path for the qemu net backend */
    socketPath: string;
    /** gateway ipv4 address */
    gatewayIP?: string;
    /** guest ipv4 address */
    vmIP?: string;
    /** gateway mac address */
    gatewayMac?: Buffer;
    /** guest mac address */
    vmMac?: Buffer;
    /** whether to enable debug logging */
    debug?: boolean;
    /** dns configuration */
    dns?: DnsOptions;
    /** ssh egress configuration */
    ssh?: SshOptions;
    /** explicit host-mapped tcp egress configuration */
    tcp?: TcpOptions;
    /** http fetch implementation */
    fetch?: HttpFetch;
    /** http interception hooks */
    httpHooks?: HttpHooks;
    /** mitm ca directory path */
    mitmCertDir?: string;
    /** max intercepted http request body size in `bytes` */
    maxHttpBodyBytes?: number;
    /** max buffered upstream http response body size in `bytes` */
    maxHttpResponseBodyBytes?: number;
    /** whether to allow WebSocket upgrades (default: true) */
    allowWebSockets?: boolean;
    /** max buffered guest->upstream tcp write bytes per session in `bytes` */
    maxTcpPendingWriteBytes?: number;
    /** websocket upstream connect + tls handshake timeout in `ms` */
    webSocketUpstreamConnectTimeoutMs?: number;
    /** websocket upstream response header timeout in `ms` */
    webSocketUpstreamHeaderTimeoutMs?: number;
    /** tls MITM context cache max entries */
    tlsContextCacheMaxEntries?: number;
    /** tls MITM context cache ttl in `ms` (<=0 disables caching) */
    tlsContextCacheTtlMs?: number;
};
export declare class QemuNetworkBackend extends EventEmitter {
    private server;
    private waitingDrain;
    private readonly udpSessions;
    private guestActivityActive;
    private readonly mitmDir;
    private caPromise;
    private tlsContexts;
    private tlsContextPromises;
    private readonly icmp;
    private eventLoopDelay;
    private readonly tlsContextCacheMaxEntries;
    private readonly tlsContextCacheTtlMs;
    private readonly flowResumeWaiters;
    private readonly dnsMode;
    private readonly trustedDnsServers;
    private trustedDnsIndex;
    private readonly syntheticDnsOptions;
    private readonly syntheticDnsHostMapping;
    private readonly syntheticDnsHostMap;
    constructor(options: QemuNetworkOptions);
    hasActiveGuestActivity(): boolean;
    private notifyGuestActivityChange;
    start(): void;
    close(): Promise<void>;
    private attachSocket;
    private detachSocket;
    private resetStack;
    private cleanupSessions;
    private pickTrustedDnsServer;
    private handleSyntheticDns;
    private handleUdpSend;
    private handleTcpConnect;
    private queueTcpPendingWrite;
    private handleTcpSend;
    private handleSshProxyData;
    private handleTcpClose;
    private handleTcpPause;
    private handleTcpResume;
    private ensureTcpSocket;
    private ensureTlsSession;
    private handleTlsData;
    private getMitmDir;
    private ensureCaAsync;
    private loadOrCreateCa;
    private pruneTlsContextCache;
    private evictTlsContextCacheIfNeeded;
    private getTlsContextAsync;
    private createTlsContext;
    private ensureLeafCertificateAsync;
}
//# sourceMappingURL=net.d.ts.map