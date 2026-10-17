import type { VirtualProvider } from "./node/index.js";
import type { FsRequest, FsResponse } from "../sandbox/virtio-protocol.js";
export declare const MAX_RPC_DATA: number;
export type FsRpcMetrics = {
    /** total request count */
    requests: number;
    /** total error count */
    errors: number;
    /** total bytes read in `bytes` */
    bytesRead: number;
    /** total bytes written in `bytes` */
    bytesWritten: number;
    /** per-op request counts */
    ops: Record<string, number>;
};
export type FsRpcServiceOptions = {
    /** optional log sink */
    logger?: (message: string) => void;
};
export declare class FsRpcService {
    private nextIno;
    private nextHandle;
    private readonly pathToIno;
    private readonly inoToPaths;
    private readonly handles;
    private readonly readdirCache;
    private readonly readdirInFlight;
    private readdirCacheVersion;
    private readonly logger?;
    private readonly provider;
    readonly metrics: FsRpcMetrics;
    constructor(provider: VirtualProvider, options?: FsRpcServiceOptions);
    handleRequest(message: FsRequest): Promise<FsResponse>;
    close(): Promise<void>;
    private dispatch;
    private handleLookup;
    private handleGetattr;
    private handleReadlink;
    private handleReaddir;
    private handleOpen;
    private handleRead;
    private handleWrite;
    private handleCreate;
    private handleMkdir;
    private handleSymlink;
    private handleUnlink;
    private handleRmdir;
    private handleRename;
    private handleLink;
    private handleAccess;
    private handleTruncate;
    private handleFallocate;
    private handleCopyFileRange;
    private handleRelease;
    private handleStatfs;
    private truncatePath;
    private record;
    private readCachedDirEntries;
    private setReaddirCacheEntry;
    private invalidateReaddirCacheEntries;
    private ensureIno;
    private requirePath;
    private allocateHandle;
    private getHandle;
    private removeMapping;
    private renameMapping;
}
//# sourceMappingURL=rpc-service.d.ts.map