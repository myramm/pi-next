import type { ClientMessage, ErrorMessage, ServerMessage } from "./control-protocol.js";
export type SandboxClient = {
    sendJson: (message: ServerMessage) => boolean;
    sendBinary: (data: Buffer) => boolean;
    close: () => void;
};
export type SandboxConnection = {
    /** send a control message to the guest */
    send: (message: ClientMessage) => void;
    /** close the underlying connection */
    close: () => void;
};
export declare class LocalSandboxClient implements SandboxClient {
    private closed;
    private readonly onMessage;
    private readonly onClose?;
    constructor(onMessage: (data: Buffer | string, isBinary: boolean) => void, onClose?: () => void);
    sendJson(message: ServerMessage): boolean;
    sendBinary(data: Buffer): boolean;
    close(): void;
}
export declare function sendJson(client: SandboxClient, message: ServerMessage): boolean;
export declare function sendBinary(client: SandboxClient, data: Buffer): boolean;
export declare function sendError(client: SandboxClient, error: ErrorMessage): boolean;
//# sourceMappingURL=client.d.ts.map