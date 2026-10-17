export class LocalSandboxClient {
    closed = false;
    onMessage;
    onClose;
    constructor(onMessage, onClose) {
        this.onMessage = onMessage;
        this.onClose = onClose;
    }
    sendJson(message) {
        if (this.closed)
            return false;
        this.onMessage(JSON.stringify(message), false);
        return true;
    }
    sendBinary(data) {
        if (this.closed)
            return false;
        this.onMessage(data, true);
        return true;
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.onClose?.();
    }
}
export function sendJson(client, message) {
    return client.sendJson(message);
}
export function sendBinary(client, data) {
    return client.sendBinary(data);
}
export function sendError(client, error) {
    return sendJson(client, error);
}
//# sourceMappingURL=client.js.map