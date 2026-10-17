import { EventEmitter } from "events";
export type UdpSendMessage = {
    /** nat/session key */
    key: string;
    /** destination ipv4 address */
    dstIP: string;
    /** destination udp port */
    dstPort: number;
    /** source ipv4 address */
    srcIP: string;
    /** source udp port */
    srcPort: number;
    /** udp payload */
    payload: Buffer;
};
export type TcpConnectMessage = {
    /** nat/session key */
    key: string;
    /** destination ipv4 address */
    dstIP: string;
    /** destination tcp port */
    dstPort: number;
    /** source ipv4 address */
    srcIP: string;
    /** source tcp port */
    srcPort: number;
};
export type TcpSendMessage = {
    /** nat/session key */
    key: string;
    /** tcp payload */
    data: Buffer;
};
export type TcpConnectDecision = {
    /** whether to bypass protocol sniffing and allow raw tcp for this flow */
    allowRawTcp?: boolean;
};
export type TcpCloseMessage = {
    /** nat/session key */
    key: string;
    /** whether to force-close the socket */
    destroy: boolean;
};
export type TcpPauseMessage = {
    /** nat/session key */
    key: string;
};
export type TcpResumeMessage = {
    /** nat/session key */
    key: string;
};
export type TcpFlowProtocol = "http" | "tls" | "ssh" | "tcp";
export type TcpFlowInfo = {
    /** nat/session key */
    key: string;
    /** source ipv4 address */
    srcIP: string;
    /** source tcp port */
    srcPort: number;
    /** destination ipv4 address */
    dstIP: string;
    /** destination tcp port */
    dstPort: number;
    /** detected flow protocol */
    protocol: TcpFlowProtocol;
    /** http method when protocol is "http" */
    httpMethod?: string;
};
export type NetworkCallbacks = {
    onUdpSend: (message: UdpSendMessage) => void;
    onTcpConnect: (message: TcpConnectMessage) => void;
    onTcpSend: (message: TcpSendMessage) => void;
    onTcpClose: (message: TcpCloseMessage) => void;
    onTcpPause: (message: TcpPauseMessage) => void;
    onTcpResume: (message: TcpResumeMessage) => void;
};
export type NetworkStackOptions = {
    /** gateway ipv4 address */
    gatewayIP?: string;
    /** guest ipv4 address */
    vmIP?: string;
    /** gateway mac address */
    gatewayMac?: Buffer;
    /** guest mac address */
    vmMac?: Buffer;
    /** dns server ipv4 addresses */
    dnsServers?: string[];
    /** network event callbacks */
    callbacks: NetworkCallbacks;
    /** policy callback for allowing a sniffed tcp flow */
    allowTcpFlow?: (info: TcpFlowInfo) => boolean;
    /** tcp ports that should be classified as SSH when the banner matches */
    sshPorts?: number[];
    /** qemu tx buffer hard cap in `bytes` (includes the 4-byte length prefix) */
    txQueueMaxBytes?: number;
};
export type TxPriority = "high" | "low";
/**
 * Payload for the `"tx-drop"` event emitted by {@link NetworkStack}.
 *
 * Emitted when an outgoing (host->guest) ethernet frame is dropped (or evicted)
 * because the QEMU TX queue hit its hard cap.
 */
export type TxDropInfo = {
    /** queue priority */
    priority: TxPriority;
    /** bytes dropped/evicted in `bytes` */
    bytes: number;
    /** drop/eviction reason */
    reason: "queue-full" | "packet-too-large" | "evicted";
    /** bytes evicted from the low-priority queue in `bytes` (high priority only) */
    evictedBytes?: number;
};
export declare class NetworkStack extends EventEmitter {
    gatewayIP: string;
    vmIP: string;
    gatewayMac: Buffer;
    vmMac: Buffer | null;
    dnsServers: string[];
    private readonly callbacks;
    private readonly allowTcpFlow;
    private readonly sshPorts;
    private readonly natTable;
    private readonly MAX_FLOW_SNIFF;
    private rxBuffer;
    private txQueueHigh;
    private txQueueLow;
    private txQueueSize;
    private txQueueHighSize;
    private readonly TX_QUEUE_MAX_BYTES;
    private readonly TX_BUFFER_HIGH_WATER;
    private readonly TX_BUFFER_LOW_WATER;
    private readonly TCP_MAX_IN_FLIGHT_BYTES;
    private readonly TCP_MAX_BURST_BYTES;
    private readonly txQueuePaused;
    private readonly txFlowPaused;
    constructor(options: NetworkStackOptions);
    reset(): void;
    hasPendingData(): boolean;
    writeToNetwork(data: Buffer): void;
    readFromNetwork(maxLen: number): Buffer | null;
    send(payload: Buffer, proto: number): void;
    sendBroadcast(payload: Buffer, proto: number): void;
    private classifyTxPriority;
    /**
     * Enqueues a QEMU-framed ethernet packet for host->guest delivery.
     *
     * Emits:
     * - `"network-activity"` when something is queued
     * - `"tx-drop"` with {@link TxDropInfo} when a packet is dropped/evicted due to queue limits
     */
    private enqueueTx;
    receive(frame: Buffer): void;
    handleARP(packet: Buffer): void;
    handleIP(packet: Buffer): void;
    calculateChecksum(buf: Buffer): number;
    calculateUdpChecksum(payload: Buffer, srcIP: Buffer, dstIP: Buffer): number;
    handleICMP(data: Buffer, srcIP: Buffer, dstIP: Buffer): void;
    sendIP(payload: Buffer, protocol: number, srcIP: Buffer, dstIP: Buffer): void;
    private looksLikeTlsClientHello;
    private matchHttpMethodPrefix;
    private parseHttpRequestLine;
    private classifyTcpFlow;
    private rejectTcpFlow;
    handleTCP(segment: Buffer, srcIP: Buffer, dstIP: Buffer): void;
    sendTCP(dstIP: Buffer, dstPort: number, srcIP: Buffer, srcPort: number, seq: number, ack: number, flags: number, payload?: Buffer): void;
    handleUDP(segment: Buffer, srcIP: Buffer, dstIP: Buffer): void;
    handleDHCP(data: Buffer): void;
    sendDHCPReply(msgType: number, xid: number, chaddr: Buffer, flags: number): void;
    handleUdpResponse(message: {
        data: Buffer;
        srcIP: string;
        srcPort: number;
        dstIP: string;
        dstPort: number;
    }): void;
    private clearPauseState;
    private destroyTcpSession;
    /**
     * Tears down the NAT flow when a host->guest TCP packet with payload is dropped
     *
     * We cannot retransmit dropped payload from this userspace stack, so keeping
     * the session open can deadlock on in-flight accounting. Pure control packets
     * (ACK/FIN/RST without payload) are left to normal TCP recovery.
     */
    private teardownDroppedTcpSession;
    private pauseFlow;
    private maybeResumeFlow;
    private drainOutboundTcp;
    handleTcpConnected(message: {
        key: string;
    }): void;
    handleTcpData(message: {
        key: string;
        data: Buffer;
    }): void;
    handleTcpEnd(message: {
        key: string;
    }): void;
    handleTcpError(message: {
        key: string;
    }): void;
    handleTcpClosed(message: {
        key: string;
    }): void;
}
//# sourceMappingURL=network-stack.d.ts.map