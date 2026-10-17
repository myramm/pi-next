import { Duplex, Readable } from "stream";
import { type BootCommandMessage, type ClientMessage, type ExecCommandMessage, type ExecWindowCommandMessage, type PtyResizeCommandMessage, type StdinCommandMessage } from "./control-protocol.js";
import type { SandboxState } from "./controller.js";
import { type GuestFileDeleteOptions, type GuestFileReadOptions, type GuestFileWriteOptions } from "./server-options.js";
import { type SandboxClient, type SandboxConnection } from "./client.js";
export declare class SandboxServerOps {
    [key: string]: any;
    getState(): any;
    /**
     * Return the host PID of the active VM runner process, if available.
     */
    getHostPid(): number | null;
    getVfsProvider(): any;
    getFsMetrics(): any;
    resumeControllerForActivity(): Promise<void> | void;
    hasActiveGuestActivity(): boolean;
    execPressure(): number;
    scheduleControllerIdlePause(): void;
    connect(onMessage: (data: Buffer | string, isBinary: boolean) => void, onClose?: () => void): SandboxConnection;
    /**
     * Create a readable stream for a guest file.
     */
    readGuestFileStream(filePath: string, options?: GuestFileReadOptions): Promise<Readable>;
    /**
     * Read an entire guest file into a Buffer.
     */
    readGuestFile(filePath: string, options?: GuestFileReadOptions): Promise<Buffer>;
    /**
     * Write file content to the guest.
     */
    writeGuestFile(filePath: string, input: Buffer | Uint8Array | string | Readable | AsyncIterable<Buffer | Uint8Array | string>, options?: GuestFileWriteOptions): Promise<void>;
    /**
     * Delete a guest file or directory.
     */
    deleteGuestFile(filePath: string, options?: GuestFileDeleteOptions): Promise<void>;
    /**
     * Open a TCP stream to a loopback service inside the guest.
     *
     * This is implemented via a dedicated virtio-serial port and does not use the
     * guest network stack.
     */
    openTcpStream(target: {
        host: string;
        port: number;
        timeoutMs?: number;
    }): Promise<Duplex>;
    /**
     * Open a TCP stream to a loopback service inside the guest via the ingress connector.
     *
     * This is intended for the host-side ingress gateway and should not be exposed
     * as a generic port-forwarding primitive.
     */
    openIngressStream(target: {
        host: string;
        port: number;
        timeoutMs?: number;
    }): Promise<Duplex>;
    broadcastStatus(state: SandboxState): void;
    clearVfsReadyTimer(): void;
    handleVfsReady(): void;
    handleVfsError(message: string, code?: string): void;
    start(): Promise<void>;
    close(): Promise<void>;
    startInternal(): Promise<void>;
    closeInternal(): Promise<void>;
    attachClient(client: SandboxClient): void;
    closeClient(client: SandboxClient): void;
    closeAllClients(): void;
    assertGuestPath(value: string, field: string): void;
    allocateFileOpId(): number;
    waitForExecIdle(signal?: AbortSignal): Promise<void>;
    isNonTerminalExecErrorCode(code: string): boolean;
    flushBridgeWritableWaiters(): void;
    waitForBridgeWritable(signal?: AbortSignal): Promise<void>;
    sendControlMessage(message: object, signal?: AbortSignal): Promise<void>;
    resolveFileOperation(id: number): void;
    rejectFileOperation(id: number, err: Error): void;
    failFileOperations(message: string): void;
    disconnectClient(client: SandboxClient): void;
    clearQueuedStdin(id: number): void;
    handleClientMessage(client: SandboxClient, message: ClientMessage): void;
    handleBoot(client: SandboxClient, message: BootCommandMessage): Promise<void>;
    startExecNow(entry: {
        client: SandboxClient;
        message: ExecCommandMessage;
        payload: any;
    }): void;
    pumpExecQueue(): void;
    handleExec(client: SandboxClient, message: ExecCommandMessage): Promise<void>;
    handleStdin(client: SandboxClient, message: StdinCommandMessage): void;
    handlePtyResize(client: SandboxClient, message: PtyResizeCommandMessage): void;
    scheduleExecWindowFlush(): void;
    scheduleExecIoFlush(): void;
    flushQueuedPtyResizeFor(id: number): boolean;
    flushQueuedPtyResize(): void;
    flushQueuedStdinFor(id: number): boolean;
    flushQueuedStdin(): void;
    flushPendingExecWindowsFor(id: number): boolean;
    flushPendingExecWindows(): void;
    handleExecWindow(client: SandboxClient, message: ExecWindowCommandMessage): void;
    failInflight(code: string, message: string): void;
}
export declare function installSandboxServerOps(target: {
    prototype: object;
}): void;
//# sourceMappingURL=server-ops.d.ts.map