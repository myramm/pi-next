import { withoutAbortSignal } from "@earendil-works/chord/context";
import { errorMessage } from "../errors.js";
/** Maximum exact committed frames retained behind one unavailable watch listener. */
const MAX_PENDING_WATCH_FRAMES = 100;
/** Canonical terminal update for a retired document incarnation. */
export const RETIREMENT_OPERATIONS = [["r", null]];
/**
 * Session-to-Chord bridge owned one-to-one by one attached state: a document, or a conversation view. A `null` value
 * retires it. @internal
 */
export class CommittedStateSource {
    #attachments = new Set();
    #release;
    /** Released on disposal. */
    #value;
    #cursor = 0;
    #retired = false;
    #closed = false;
    constructor(value, release) {
        this.#value = value;
        this.#release = release;
    }
    attach() {
        if (this.#closed)
            throw new Error("State source is closed");
        const attachment = new SessionSourceAttachment({ value: this.#value, cursor: this.#cursor }, () => {
            this.#attachments.delete(attachment);
            if (this.#attachments.size === 0)
                this.#finishDisposal();
        });
        this.#attachments.add(attachment);
        return attachment;
    }
    advance(value, ops, context) {
        if (this.#closed || this.#retired)
            return;
        this.#value = value;
        this.#cursor += 1;
        if (value === null)
            this.#retired = true;
        const frame = {
            cursor: this.#cursor,
            value,
            ops,
            context,
        };
        for (const attachment of [...this.#attachments])
            attachment.publish(frame);
    }
    /** Stop publishing; the attached states keep their last value. A failure ends them the same way. */
    closeSession() {
        if (this.#closed)
            return;
        for (const attachment of [...this.#attachments])
            attachment.dispose();
        this.#finishDisposal();
    }
    #finishDisposal() {
        if (this.#closed)
            return;
        this.#closed = true;
        this.#value = undefined;
        const release = this.#release;
        this.#release = undefined;
        release?.();
    }
}
class SessionSourceAttachment {
    snapshot;
    #release;
    #frames = [];
    #listener;
    #activated = false;
    #disposed = false;
    #scheduled = false;
    #delivering = false;
    constructor(snapshot, release) {
        this.snapshot = snapshot;
        this.#release = release;
    }
    activate(listener) {
        if (this.#activated)
            throw new Error("State attachment is already active");
        if (this.#disposed)
            throw new Error("State attachment is disposed");
        this.#activated = true;
        this.#listener = listener;
        this.#drain();
    }
    publish(frame) {
        if (this.#disposed)
            return;
        this.#frames.push(frame);
        if (!this.#activated || this.#delivering || this.#scheduled)
            return;
        this.#scheduled = true;
        queueMicrotask(() => {
            this.#scheduled = false;
            if (this.#disposed)
                return;
            try {
                this.#drain();
            }
            catch {
                // Chord's frame listener contains source-contract failures. Isolate an
                // unexpected direct listener failure to this attachment as well.
                this.dispose();
            }
        });
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#frames.length = 0;
        this.#listener = undefined;
        const release = this.#release;
        this.#release = undefined;
        release?.();
    }
    #drain() {
        const listener = this.#listener;
        if (listener === undefined || this.#delivering || this.#disposed)
            return;
        this.#delivering = true;
        try {
            while (!this.#disposed) {
                const frame = this.#frames.shift();
                if (frame === undefined)
                    break;
                listener(frame);
            }
        }
        finally {
            this.#delivering = false;
        }
    }
}
/**
 * Serialized exact-frame watch bound to one document incarnation or conversation view. A `null` value retires it.
 * @internal
 */
export class CommittedWatch {
    #detach;
    #report;
    #replace;
    #closed = Promise.withResolvers();
    #pending = [];
    #value;
    #listener;
    #started = false;
    #scheduled = false;
    #running = false;
    #retired = false;
    /** Set once, by `#terminate()`. */
    #end;
    #cancellationSignal;
    #cancellationListener;
    /**
     * `report` gets a listener's throw, which also ends the watch. `replace` gives the value an overflow delivers; by
     * default the newest value.
     */
    constructor(value, detach, report, replace) {
        this.#value = value;
        this.#detach = detach;
        this.#report = report;
        this.#replace = replace;
    }
    get value() {
        return this.#value;
    }
    get closed() {
        return this.#closed.promise;
    }
    start(listener) {
        if (this.#started)
            throw new Error("Watch is already started");
        if (this.#end !== undefined)
            throw new Error("Watch is stopped");
        this.#started = true;
        this.#listener = listener;
        if (this.#pending.length > 0)
            this.#schedule();
    }
    stop() {
        this.#terminate({ reason: "stopped" });
        return this.#closed.promise;
    }
    observeCancellation(signal) {
        if (this.#cancellationSignal !== undefined)
            throw new Error("Watch cancellation is already installed");
        if (this.#end !== undefined)
            return;
        this.#cancellationSignal = signal;
        this.#cancellationListener = () => this.cancel();
        signal.addEventListener("abort", this.#cancellationListener, { once: true });
        if (signal.aborted)
            this.cancel();
    }
    cancel() {
        this.#terminate({ reason: "cancelled" });
    }
    /** End with `session_closed`, or with `session_failed` and the error when the Session failed. */
    closeSession(failure) {
        this.#terminate(failure === undefined ? { reason: "session_closed" } : { reason: "session_failed", error: failure.error });
    }
    advance(value, ops, context) {
        if (this.#end !== undefined || this.#retired)
            return;
        if (value === null)
            this.#retired = true;
        if (this.#pending.length >= MAX_PENDING_WATCH_FRAMES) {
            this.#pending.length = 0;
            const replacement = this.#replace?.() ?? value;
            this.#pending.push({ value: replacement, ops: [["r", replacement]], context });
        }
        else {
            this.#pending.push({ value, ops, context });
        }
        if (this.#started)
            this.#schedule();
    }
    #schedule() {
        if (this.#scheduled || this.#running || this.#end !== undefined)
            return;
        this.#scheduled = true;
        queueMicrotask(() => {
            this.#scheduled = false;
            void this.#drain();
        });
    }
    async #drain() {
        if (this.#running || this.#end !== undefined || !this.#started)
            return;
        this.#running = true;
        try {
            while (this.#end === undefined) {
                const frame = this.#pending.shift();
                if (frame === undefined)
                    break;
                this.#value = frame.value;
                const deliveryContext = withoutAbortSignal(frame.context);
                try {
                    await this.#listener(frame.value, frame.ops, deliveryContext);
                }
                catch (error) {
                    if (this.#end === undefined) {
                        this.#report(error);
                        this.#terminate({ reason: "listener_error", error: toError(error) });
                    }
                    break;
                }
                if (frame.value === null) {
                    this.#terminate({ reason: "retired" });
                    break;
                }
            }
        }
        finally {
            this.#running = false;
            if (this.#end === undefined && this.#pending.length > 0)
                this.#schedule();
        }
    }
    /** End the watch, once: detach, drop pending frames, and settle `closed`. A callback already running keeps running. */
    #terminate(end) {
        if (this.#end !== undefined)
            return;
        this.#end = end;
        this.#detach();
        this.#pending.length = 0;
        if (this.#cancellationListener !== undefined) {
            this.#cancellationSignal?.removeEventListener("abort", this.#cancellationListener);
        }
        this.#closed.resolve(end);
    }
}
function toError(error) {
    return error instanceof Error ? error : new Error(errorMessage(error));
}
//# sourceMappingURL=observation.js.map