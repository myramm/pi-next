import type { monitorEventLoopDelay } from "perf_hooks";
export type IcmpTiming = {
    srcIP: string;
    dstIP: string;
    id: number;
    seq: number;
    recvTime: number;
    rxTime: number;
    replyTime: number;
    size: number;
};
export declare class QemuIcmpTracker {
    private readonly icmpTimings;
    private icmpDebugBuffer;
    private icmpRxBuffer;
    private readonly emitDebug;
    private readonly getEventLoopDelay;
    constructor(emitDebug: (message: string) => void, getEventLoopDelay: () => ReturnType<typeof monitorEventLoopDelay> | null);
    reset(): void;
    recordIcmpTiming(info: IcmpTiming): void;
    trackIcmpRequests(chunk: Buffer, now: number): void;
    trackIcmpReplies(chunk: Buffer, now: number): void;
    private icmpKey;
    private logIcmpRequestFrame;
    private logIcmpReplyFrame;
}
//# sourceMappingURL=icmp.d.ts.map