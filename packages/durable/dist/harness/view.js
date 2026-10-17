import { replicatedState } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import { applyImmutable } from "@earendil-works/chord/delta";
import { CommittedStateSource, CommittedWatch } from "../session/observation.js";
import { contained } from "../session/session.js";
import { AgentDoc } from "./agent.js";
import { activeEntries, captureContextBounds } from "./context.js";
import { InboxDoc } from "./inbox.js";
import { LiveDoc } from "./live.js";
import { ProviderDoc } from "./provider.js";
import { UsageDoc } from "./usage.js";
import { closedError } from "./util.js";
const MOUNTED = [
    AgentDoc,
    LiveDoc,
    InboxDoc,
    ProviderDoc,
    UsageDoc,
];
const MOUNTED_KINDS = new Set(MOUNTED.map((token) => token.definition.kind));
const VIEWS = new WeakMap();
/** The view mounts of a Harness, for adapters built on them. */
export function conversationViews(harness) {
    const views = VIEWS.get(harness);
    if (views === undefined)
        throw new Error("Not a Harness");
    return views;
}
/**
 * The Harness's conversation view mounts: at most one per conversation, built on the Session line by its first
 * observer and dropped with its last. Each mount advances from the Session's commit publications, which are durable.
 */
export class ConversationViews {
    #session;
    #storage;
    #mounts = new Map();
    #closed = false;
    constructor(session, storage) {
        this.#session = session;
        this.#storage = storage;
        VIEWS.set(session, this);
        session.observeCommits((publication, context) => {
            for (const [id, mount] of this.#mounts)
                advance(id, mount, publication, context, (error) => this.report(error));
        });
        session.subscribeClose(() => {
            this.#closed = true;
            for (const mount of this.#mounts.values())
                for (const observer of [...mount.observers]) {
                    contained(() => observer.closeSession(this.#session.failure), (error) => this.report(error));
                }
            this.#mounts.clear();
        });
    }
    /** Report an observer's listener error through the Harness. */
    report(error) {
        this.#session.report(error);
    }
    /** A disposable read-only Chord state of the view. */
    async state(id, context) {
        const { observer, detach } = await this.attach(id, (value, release) => new CommittedStateSource(value, release), context);
        try {
            return replicatedState(observer, { onError: (error) => this.#session.report(error) });
        }
        catch (error) {
            detach();
            throw error;
        }
    }
    /** A serialized exact-frame watch of the view; cancelling `context` stops it. */
    async watch(id, context) {
        const { observer } = await this.attach(id, (value, release) => new CommittedWatch(value, release, (error) => this.#session.report(error)), context);
        const signal = context.abortSignal;
        if (signal?.aborted) {
            observer.cancel();
            throw signal.reason;
        }
        if (signal !== undefined)
            observer.observeCancellation(signal);
        return observer;
    }
    /**
     * Register an observer created from the current revision, atomically on the Session line: it sees every later
     * publication and nothing earlier. `create` may read committed Storage, still on the line. `release` drops it, and
     * the mount with its last observer.
     */
    attach(id, create, context) {
        return this.#session.readOnLine(async () => {
            const mount = this.#mounts.get(id) ?? (await this.#build(id, context));
            const detach = () => {
                mount.observers.delete(observer);
                if (mount.observers.size === 0 && this.#mounts.get(id) === mount)
                    this.#mounts.delete(id);
            };
            const observer = await create(mount.value, detach, this.#storage);
            // Close or cancellation may begin while the mount hydrates; register nothing then.
            if (this.#closed)
                throw closedError(this.#session);
            context.abortSignal?.throwIfAborted();
            this.#mounts.set(id, mount);
            mount.observers.add(observer);
            return { observer, detach };
        });
    }
    async #build(id, context) {
        const conversation = await this.#storage.conversation(id, context);
        if (conversation === undefined)
            throw new Error(`Conversation ${id} does not exist`);
        const bounds = await captureContextBounds(this.#storage, id, context);
        const entries = await activeEntries(this.#storage, id, bounds, context);
        const docs = {};
        const incarnations = new Map();
        for (const token of MOUNTED) {
            const loaded = await this.#session.conversationDocumentOnLine(token, id, context);
            if (loaded === undefined)
                continue;
            docs[token.definition.kind] = loaded.value;
            incarnations.set(token.definition.kind, { id: loaded.record.id, version: loaded.version });
        }
        return { value: { conversation, entries, docs }, docs: incarnations, observers: new Set() };
    }
}
/**
 * Derive the mount's operations from one publication, apply them, and hand the revision to every observer; one that
 * throws is reported through `report`, and the others still get it.
 */
function advance(id, mount, publication, context, report) {
    const docOps = [];
    const entryOps = [];
    let entries = mount.value.entries;
    // Entry writes are published in ID order.
    for (const change of publication.changes) {
        if (change.type === "entry" && change.value.conversationId === id) {
            const entry = change.value;
            const value = entry;
            if (entry.head === undefined) {
                entryOps.push(["p", ["entries"], entries.length, 0, [value]]);
                entries = [...entries, entry];
                continue;
            }
            // A head marker keeps the non-head entries from its head, which are always a suffix, and goes in front.
            const target = entry.head;
            let kept = entries.findIndex((candidate) => candidate.head === undefined && candidate.id >= target);
            if (kept < 0)
                kept = entries.length;
            entryOps.push(["p", ["entries"], 0, kept, [value]]);
            entries = [entry, ...entries.slice(kept)];
            continue;
        }
        if (change.type !== "document" || change.conversationId !== id)
            continue;
        const kind = change.record.kind;
        if (!MOUNTED_KINDS.has(kind) || change.record.key !== undefined)
            continue;
        const path = ["docs", kind];
        const mounted = mount.docs.get(kind);
        if (change.value === null) {
            if (mounted?.id !== change.record.id)
                continue;
            mount.docs.delete(kind);
            docOps.push(["d", path]);
        }
        else if (mounted?.id === change.record.id && mounted.version === change.version) {
            for (const op of change.ops)
                docOps.push(prefixed(op, path));
        }
        else {
            mount.docs.set(kind, { id: change.record.id, version: change.version });
            docOps.push(["s", path, change.value]);
        }
    }
    const before = mount.value;
    const ops = [...docOps, ...entryOps];
    const frameContext = withoutAbortSignal(context);
    if (ops.length > 0) {
        const value = docOps.length === 0 ? mount.value : applyImmutable(mount.value, docOps);
        mount.value = entries === value.entries ? value : { ...value, entries };
        for (const observer of [...mount.observers]) {
            contained(() => observer.advance?.(mount.value, ops, frameContext), report);
        }
    }
    for (const observer of [...mount.observers]) {
        contained(() => observer.publication?.(before, mount.value, ops, publication, frameContext), report);
    }
}
/** `op` moved under `prefix`; a root replacement becomes a set of the prefix. */
function prefixed(op, prefix) {
    const at = (path) => [...prefix, ...path];
    switch (op[0]) {
        case "r":
            return ["s", prefix, op[1]];
        case "p":
            return ["p", at(op[1]), op[2], op[3], op[4]];
        case "m":
            return ["m", at(op[1]), op[2]];
        case "s":
            return ["s", at(op[1]), op[2]];
        case "d":
            return ["d", at(op[1])];
        case "a":
            return ["a", at(op[1]), op[2]];
        case "t":
            return ["t", at(op[1]), op[2]];
    }
}
//# sourceMappingURL=view.js.map