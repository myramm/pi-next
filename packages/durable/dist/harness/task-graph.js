import { replicatedState } from "@earendil-works/chord";
import { withoutAbortSignal } from "@earendil-works/chord/context";
import { applyImmutable } from "@earendil-works/chord/delta";
import { CommittedStateSource, CommittedWatch } from "../session/observation.js";
import { contained } from "../session/session.js";
import { closedError, scanAll } from "./util.js";
const LIVE_STATUSES = ["pending", "running", "waiting", "completing"];
const SCAN_PAGE_SIZE = 256;
/**
 * The Harness's task graph mount: built on the Session line by its first observer and dropped with its last. It
 * advances from the Session's commit publications, which are durable.
 */
export class TaskGraphView {
    #session;
    #storage;
    #mount;
    #closed = false;
    constructor(session, storage) {
        this.#session = session;
        this.#storage = storage;
        session.observeCommits((publication, context) => {
            if (this.#mount !== undefined)
                advance(this.#mount, publication, context, (error) => session.report(error));
        });
        session.subscribeClose(() => {
            this.#closed = true;
            for (const observer of [...(this.#mount?.observers ?? [])]) {
                contained(() => observer.closeSession(this.#session.failure), (error) => session.report(error));
            }
            this.#mount = undefined;
        });
    }
    /** A disposable read-only Chord state of the graph. */
    async state(context) {
        const { observer, detach } = await this.#attach((value, release) => new CommittedStateSource(value, release), context);
        try {
            return replicatedState(observer, { onError: (error) => this.#session.report(error) });
        }
        catch (error) {
            detach();
            throw error;
        }
    }
    /** A serialized exact-frame watch of the graph; cancelling `context` stops it. */
    async watch(context) {
        const { observer } = await this.#attach((value, release) => new CommittedWatch(value, release, (error) => this.#session.report(error)), context);
        const signal = context.abortSignal;
        if (signal?.aborted) {
            observer.cancel();
            throw signal.reason;
        }
        if (signal !== undefined)
            observer.observeCancellation(signal);
        return observer;
    }
    /** Register an observer created from the current revision, atomically on the Session line. */
    #attach(create, context) {
        return this.#session.readOnLine(async () => {
            const mount = this.#mount ?? { value: await this.#build(context), observers: new Set() };
            const detach = () => {
                mount.observers.delete(observer);
                if (mount.observers.size === 0 && this.#mount === mount)
                    this.#mount = undefined;
            };
            const observer = create(mount.value, detach);
            // Close or cancellation may begin while the mount builds; register nothing then.
            if (this.#closed)
                throw closedError(this.#session);
            context.abortSignal?.throwIfAborted();
            this.#mount = mount;
            mount.observers.add(observer);
            return { observer, detach };
        });
    }
    async #build(context) {
        const tasks = {};
        const records = [];
        for (const status of LIVE_STATUSES) {
            records.push(...(await scanAll((cursor) => this.#storage.scanTasks({ status }, SCAN_PAGE_SIZE, cursor, context))));
        }
        records.sort((a, b) => a.id - b.id);
        for (const record of records) {
            const owned = await scanAll((cursor) => this.#storage.scanConversations({ ownerTaskId: record.id }, SCAN_PAGE_SIZE, cursor, context));
            const conversations = owned.map((conversation) => conversation.id).sort((a, b) => a - b);
            tasks[String(record.id)] = nodeOf(record, conversations);
        }
        return { tasks };
    }
}
/**
 * Derive the mount's operations from one publication, apply them, and hand the revision to every observer; one that
 * throws is reported through `report`, and the others still get it.
 */
function advance(mount, publication, context, report) {
    const ops = [];
    // Nodes this publication set or deleted, over the mount's value.
    const changed = new Map();
    const node = (key) => changed.has(key) ? changed.get(key) : mount.value.tasks[key];
    for (const change of publication.changes) {
        if (change.type !== "task")
            continue;
        const record = change.value;
        const key = String(record.id);
        const previous = node(key);
        if (record.state.status === "terminal") {
            if (previous === undefined)
                continue;
            ops.push(["d", ["tasks", key]]);
            changed.set(key, undefined);
            continue;
        }
        const next = nodeOf(record, previous?.conversations ?? []);
        if (previous !== undefined && JSON.stringify(next) === JSON.stringify(previous))
            continue;
        ops.push(["s", ["tasks", key], next]);
        changed.set(key, next);
    }
    // After the tasks, so a conversation created with its owner task in one commit finds the owner's node. Change order
    // within a publication is unspecified, so each owner's list is sorted again.
    const created = new Map();
    for (const change of publication.changes) {
        if (change.type !== "conversation" || change.value.owner === undefined)
            continue;
        const key = String(change.value.owner.taskId);
        if (node(key) !== undefined)
            created.set(key, [...(created.get(key) ?? []), change.value.id]);
    }
    for (const [key, ids] of created) {
        const conversations = [...node(key).conversations, ...ids].sort((a, b) => a - b);
        ops.push(["s", ["tasks", key, "conversations"], conversations]);
    }
    if (ops.length === 0)
        return;
    mount.value = applyImmutable(mount.value, ops);
    const frameContext = withoutAbortSignal(context);
    for (const observer of [...mount.observers])
        contained(() => observer.advance(mount.value, ops, frameContext), report);
}
function nodeOf(record, conversations) {
    return {
        id: record.id,
        kind: record.kind,
        conversationId: record.conversationId,
        ...(record.owner === undefined ? {} : { owner: record.owner }),
        background: record.background,
        abortRequested: record.abortRequested,
        state: stateOf(record),
        conversations,
    };
}
function stateOf(record) {
    const state = record.state;
    switch (state.status) {
        case "pending":
        case "running":
            return { status: state.status, phase: phaseOf(state.checkpoint) };
        case "waiting":
            return { status: "waiting", phase: phaseOf(state.checkpoint), on: [...state.on], policy: state.policy };
        // Terminal records never reach here: they leave the graph.
        case "completing":
        case "terminal":
            return { status: "completing", outcome: state.outcome.status };
    }
}
function phaseOf(checkpoint) {
    return checkpoint.phase;
}
//# sourceMappingURL=task-graph.js.map