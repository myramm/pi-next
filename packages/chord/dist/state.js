/**
 * Replicated state: an immutable JSON value with ordered, serialized change notifications. Either authoritative and
 * mutable (`replicatedState(initial)`) or a publication-only view of an external revision source
 * (`replicatedState(source)`).
 */
import { BACKGROUND_CONTEXT } from "./context/index.js";
import { track } from "./delta/index.js";
/** One public subscription, independent of producer and other subscriber progress. */
class StateSubscriber {
    #listener;
    #reportError;
    #pending = [];
    #running = false;
    #started = false;
    #closed = false;
    constructor(listener, reportError) {
        this.#listener = listener;
        this.#reportError = reportError;
    }
    push(frame) {
        if (this.#closed)
            return;
        if (this.#pending.length === 100) {
            // A cold replica can queue updates reentrantly before this subscriber's first hydration starts.
            const hydration = this.#started ? undefined : this.#pending[0];
            this.#pending.length = 0;
            if (hydration !== undefined)
                this.#pending.push(hydration);
        }
        this.#pending.push(frame);
    }
    drain() {
        if (this.#running || this.#closed)
            return;
        this.#running = true;
        for (let frame = this.#pending.shift(); frame !== undefined; frame = this.#pending.shift()) {
            this.#started = true;
            try {
                const result = this.#listener(frame.value, frame.context, frame.delivery);
                if (isPromiseLike(result)) {
                    void Promise.resolve(result).then(() => this.#resume(), (error) => {
                        this.#report(error);
                        this.#resume();
                    });
                    return;
                }
            }
            catch (error) {
                this.#report(error);
            }
        }
        this.#running = false;
    }
    clear() {
        this.#pending.length = 0;
    }
    close() {
        this.#closed = true;
        this.clear();
    }
    #resume() {
        this.#running = false;
        this.drain();
    }
    #report(error) {
        try {
            this.#reportError(toError(error));
        }
        catch (reportError) {
            reportErrorAsync(toError(reportError));
        }
    }
}
/** Maintains local publication order independently of how revisions are produced. */
class ReplicatedStatePublisher {
    #listeners = new Map();
    #reportError;
    #publications = [];
    #value;
    #sequence = 0;
    #delivering = false;
    constructor(initial, reportError = reportErrorAsync) {
        this.#value = initial;
        this.#reportError = reportError;
    }
    get value() {
        return this.#value;
    }
    snapshot() {
        return { value: this.#value, sequence: this.#sequence };
    }
    subscribe(listener) {
        const { value, sequence } = this.snapshot();
        const subscriber = new StateSubscriber(listener, this.#reportError);
        this.#listeners.set(subscriber, sequence);
        // Hydration has no caller; it is delivered with the background context.
        subscriber.push({ value, context: BACKGROUND_CONTEXT, delivery: { kind: "hydrate", sequence } });
        subscriber.drain();
        return () => {
            subscriber.close();
            this.#listeners.delete(subscriber);
        };
    }
    /** Publish an already-prepared immutable revision. Subscriber failures are reported, never thrown. */
    publish(value, context) {
        this.#value = value;
        this.#sequence += 1;
        this.#publications.push({ value, sequence: this.#sequence, context });
        if (this.#delivering)
            return;
        this.#delivering = true;
        try {
            for (let publication = this.#publications.shift(); publication !== undefined; publication = this.#publications.shift()) {
                const delivery = { kind: "update", sequence: publication.sequence };
                for (const [subscriber, hydratedSequence] of [...this.#listeners]) {
                    if (publication.sequence <= hydratedSequence)
                        continue;
                    subscriber.push({ value: publication.value, context: publication.context, delivery });
                    subscriber.drain();
                }
            }
        }
        finally {
            this.#delivering = false;
        }
    }
}
class MutableReplicatedStateImpl {
    #tracker;
    #publisher;
    #changing = false;
    constructor(initial) {
        this.#tracker = track(initial);
        this.#publisher = new ReplicatedStatePublisher(this.#tracker.value);
    }
    get value() {
        return this.#tracker.value;
    }
    change(context, mutate) {
        if (this.#changing)
            throw new Error("Replicated state cannot be changed reentrantly from a change callback");
        this.#changing = true;
        let prepared;
        try {
            const change = this.#tracker.beginChange();
            try {
                const outcome = mutate(change.state);
                if (isPromiseLike(outcome)) {
                    void Promise.resolve(outcome).catch(() => undefined);
                    throw new TypeError("Replicated state change callbacks must be synchronous");
                }
                prepared = change.prepare();
            }
            catch (error) {
                change.abort();
                throw error;
            }
        }
        finally {
            this.#changing = false;
        }
        this.#tracker.adopt(prepared);
        if (prepared.ops.length > 0)
            this.#publisher.publish(prepared.value, context);
    }
    replace(context, value) {
        if (this.#changing)
            throw new Error("Replicated state cannot be replaced from a change callback");
        const prepared = this.#tracker.prepareReplace(value);
        this.#tracker.adopt(prepared);
        if (prepared.ops.length > 0)
            this.#publisher.publish(prepared.value, context);
    }
    subscribe(listener) {
        return this.#publisher.subscribe(listener);
    }
}
class AttachedReplicatedStateImpl {
    #publisher;
    #attachment;
    #reportError;
    #cursor;
    #disposed = false;
    constructor(attachment, options) {
        const { snapshot } = attachment;
        assertCursor(snapshot.cursor, "snapshot");
        this.#attachment = attachment;
        this.#cursor = snapshot.cursor;
        this.#reportError = options.onError ?? reportErrorAsync;
        this.#publisher = new ReplicatedStatePublisher(snapshot.value, (error) => this.#report(error));
    }
    get value() {
        return this.#publisher.value;
    }
    subscribe(listener) {
        return this.#publisher.subscribe(listener);
    }
    activate() {
        this.#attachment.activate((frame) => this.#receive(frame));
    }
    dispose() {
        if (this.#disposed)
            return;
        this.#disposed = true;
        this.#attachment.dispose();
    }
    #receive(frame) {
        if (this.#disposed)
            return;
        try {
            assertCursor(frame.cursor, "frame");
            const expected = this.#cursor + 1;
            if (frame.cursor !== expected) {
                throw new Error(`Replicated state source cursor has a gap: expected ${expected}, received ${frame.cursor}`);
            }
            this.#cursor = frame.cursor;
            this.#publisher.publish(frame.value, frame.context);
        }
        catch (error) {
            this.#fail(toError(error));
        }
    }
    #fail(error) {
        if (this.#disposed)
            return;
        this.#disposed = true;
        try {
            this.#attachment.dispose();
        }
        catch (disposeError) {
            this.#report(new AggregateError([error, disposeError], "Replicated state source contract failed"));
            return;
        }
        this.#report(error);
    }
    #report(error) {
        try {
            this.#reportError(toError(error));
        }
        catch (reportError) {
            reportErrorAsync(toError(reportError));
        }
    }
}
/** Attach a publication-only replicated state to one authoritative immutable source stream. */
function attachReplicatedStateSource(source, options = {}) {
    const attachment = source.attach();
    try {
        const state = new AttachedReplicatedStateImpl(attachment, options);
        state.activate();
        return state;
    }
    catch (error) {
        try {
            attachment.dispose();
        }
        catch (disposeError) {
            throw new AggregateError([error, disposeError], "Failed to attach replicated state source");
        }
        throw error;
    }
}
function assertCursor(cursor, kind) {
    if (!Number.isSafeInteger(cursor))
        throw new TypeError(`Replicated state source ${kind} cursor must be a safe integer`);
}
function isPromiseLike(value) {
    return (((typeof value === "object" && value !== null) || typeof value === "function") &&
        typeof value.then === "function");
}
function reportErrorAsync(error) {
    queueMicrotask(() => {
        throw error;
    });
}
function toError(error) {
    return error instanceof Error ? error : new Error(String(error));
}
export function replicatedState(initialOrSource, options) {
    if (isReplicatedStateSource(initialOrSource))
        return attachReplicatedStateSource(initialOrSource, options);
    return new MutableReplicatedStateImpl(initialOrSource);
}
function isReplicatedStateSource(value) {
    return typeof value.attach === "function";
}
//# sourceMappingURL=state.js.map