import { FileError } from "@earendil-works/pi-durable/env";
import { isConnectionLost } from "./connection.js";
import { toFileError } from "./errors.js";
const RECONNECT_FIRST_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/**
 * A watcher running in the daemon (Durable's `NodeFileWatcher` next to the files). When the connection is lost, it is
 * opened again once the connection can be started again, and reports `overflow`: changes in between were not seen.
 */
export class RemoteWatcher {
    #connection;
    #targets;
    #onChange;
    #options;
    #mode = "native";
    #closed = false;
    #controller;
    #request;
    #wake;
    constructor(connection, targets, onChange, options) {
        this.#connection = connection;
        this.#targets = targets;
        this.#onChange = onChange;
        this.#options = options;
    }
    /** Watch `targets` (resolved paths); fails like `NodeFileWatcher.open` if coverage cannot be established. */
    static async open(connection, targets, onChange, options = {}) {
        const watcher = new RemoteWatcher(connection, targets, onChange, options);
        await watcher.#start();
        return watcher;
    }
    get mode() {
        return this.#mode;
    }
    async close(_context) {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#wake?.();
        this.#controller?.abort();
        await this.#request;
    }
    #deliver(change) {
        if (this.#closed)
            return;
        try {
            this.#onChange(change);
        }
        catch {
            // A throwing callback must not stop watching.
        }
    }
    /** Open the daemon's watcher; resolves once it reports coverage. */
    #start() {
        return new Promise((resolve, reject) => {
            let ready = false;
            const controller = new AbortController();
            this.#controller = controller;
            const request = this.#connection.request("watch", {
                targets: this.#targets.map((target) => ({
                    path: target.path,
                    recursive: target.recursive === true,
                    exclude: { hidden: target.exclude?.hidden === true, names: [...(target.exclude?.names ?? [])] },
                })),
                ...this.#options,
            }, {
                signal: controller.signal,
                onEvent: (event) => {
                    if (event.kind === "ready") {
                        ready = true;
                        this.#mode = event.mode === "polling" ? "polling" : "native";
                        resolve();
                    }
                    else if (event.kind === "change") {
                        if (event.mode === "polling")
                            this.#mode = "polling";
                        if (event.overflow === true)
                            this.#deliver({ overflow: true });
                        else
                            this.#deliver({ paths: event.paths });
                    }
                    else if (event.kind === "error") {
                        const code = event.code === "permission_denied" ? "permission_denied" : "invalid";
                        this.#deliver({ error: new FileError(code, String(event.message)) });
                        this.#closed = true;
                    }
                },
            });
            this.#request = request.then(() => { }, (error) => {
                if (!ready) {
                    reject(error);
                    return;
                }
                if (this.#closed)
                    return;
                if (isConnectionLost(error)) {
                    void this.#reconnect();
                    return;
                }
                this.#deliver({ error: toFileError(error) });
                this.#closed = true;
            });
        });
    }
    async #reconnect() {
        for (let delay = RECONNECT_FIRST_MS; !this.#closed; delay = Math.min(delay * 2, RECONNECT_MAX_MS)) {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, delay);
                timer.unref();
                this.#wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            this.#wake = undefined;
            if (this.#closed)
                return;
            try {
                await this.#start();
                // Changes while disconnected were not seen.
                this.#deliver({ overflow: true });
                return;
            }
            catch (error) {
                if (isConnectionLost(error))
                    continue;
                this.#deliver({ error: toFileError(error) });
                this.#closed = true;
                return;
            }
        }
    }
}
//# sourceMappingURL=watch.js.map