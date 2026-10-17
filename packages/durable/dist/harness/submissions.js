import { copyJson } from "@earendil-works/chord";
import { ConversationBusy } from "../errors.js";
import { startRun } from "./generation.js";
import { appendInput, applyBoundary, hasQueuedReset, InboxDoc, isDisplayOnly, isStale, pickInputEntry, prepareBoundary, removeInboxItem, } from "./inbox.js";
import { LiveDoc } from "./live.js";
import { closedError, Waiters } from "./util.js";
/** Admission, waits, and withdrawal of the durable submissions of one Harness. */
export class Submissions {
    #session;
    #storage;
    #now;
    /** Read at each admission, on the Session line. */
    #queueModes;
    /** Enable task scheduling; submitting or waiting asks for progress. */
    #resume;
    #waiters = new Waiters();
    #closed = false;
    constructor(session, storage, now, queueModes, resume) {
        this.#session = session;
        this.#storage = storage;
        this.#now = now;
        this.#queueModes = queueModes;
        this.#resume = resume;
        session.observeCommits((publication) => this.#observe(publication));
        session.subscribeClose(() => {
            this.#closed = true;
            this.#waiters.rejectAll(closedError(this.#session));
        });
    }
    /** Admit a submission in one commit; see `admitSubmission()`. */
    async submit(conversationId, draft, context) {
        this.#resume();
        const id = await this.#session.commitWith((tx) => admitSubmission(tx, conversationId, draft, this.#now(), this.#queueModes()), context);
        return new SubmissionHandle(id, this);
    }
    /** Handle for an existing submission, or `undefined`. */
    async get(id, context) {
        const record = await this.#session.readOnLine(() => this.#storage.submission(id, context));
        return record === undefined ? undefined : new SubmissionHandle(record.id, this);
    }
    async status(id, context) {
        const record = await this.#session.readOnLine(() => this.#storage.submission(id, context));
        if (record === undefined)
            throw new Error(`Submission ${id} does not exist`);
        return record;
    }
    async wait(id, context) {
        this.#resume();
        // Check and register on the line so no settling publication falls between them.
        const found = await this.#session.readOnLine(async () => {
            const record = await this.#storage.submission(id, context);
            if (record === undefined)
                throw new Error(`Submission ${id} does not exist`);
            if (isSettled(record))
                return { promise: Promise.resolve(record) };
            // Close rejects registered waiters synchronously and may begin during the read.
            if (this.#closed)
                throw closedError(this.#session);
            return { promise: this.#waiters.add(id, context) };
        });
        return found.promise;
    }
    /** Withdraw a queued submission and remove its inbox item; placed inputs and settled submissions are reported. */
    abort(id, context, conversationId) {
        return this.#session.commitWith(async (tx) => {
            const record = await tx.submission(id);
            if (record === undefined || (conversationId !== undefined && record.conversationId !== conversationId)) {
                return "not_found";
            }
            if (record.status === "queued") {
                tx.settleSubmission(id, { status: "unanswered", reason: "aborted" });
                await removeInboxItem(tx, record.conversationId, id);
                return "aborted";
            }
            return record.status === "placed" ? "already_placed" : "settled";
        }, context);
    }
    #observe(publication) {
        for (const change of publication.changes) {
            if (change.type !== "submission" || !isSettled(change.value))
                continue;
            this.#waiters.resolve(change.value.id, change.value);
        }
    }
}
class SubmissionHandle {
    id;
    #submissions;
    constructor(id, submissions) {
        this.id = id;
        this.#submissions = submissions;
    }
    status(context) {
        return this.#submissions.status(this.id, context);
    }
    wait(context) {
        return this.#submissions.wait(this.id, context);
    }
    async abort(context) {
        const result = await this.#submissions.abort(this.id, context);
        if (result === "not_found")
            throw new Error(`Submission ${this.id} does not exist`);
        return result;
    }
}
function isSettled(record) {
    return record.status === "done" || record.status === "unanswered";
}
/** Reject an input entry an untyped caller got wrong: its kind must be a non-empty string outside the `pi.` prefix. */
function checkInputEntry(entry) {
    const { kind } = entry;
    if (typeof kind !== "string" || kind.length === 0 || kind.startsWith("pi.")) {
        throw new TypeError(`An input entry's kind must be a non-empty string not starting with "pi.", got ${String(kind)}`);
    }
}
/**
 * Admit a submission inside a commit (spec §6); `Conversation.submit()` and conversation-owned compactions share it. A
 * known request ID returns its existing submission without writing. A display-only write (only `kind` and `data`) is
 * appended and settled `done` at once, busy or not, as it changes nothing the model sees; only behind a queued reset it
 * queues, so it lands after the reset instead of before it in the context the reset ends. A busy conversation queues anything else in
 * `pi.inbox`, or rejects `whenBusy: "reject"` input with `ConversationBusy`. An idle conversation with queued items
 * queues it behind them and runs a final boundary. Otherwise idle input places its entry (`pi.user`, or the input's
 * own) and starts a run, and an idle write appends its entry and settles `done`, or `stale` when its head reaches
 * before the active range.
 */
export async function admitSubmission(tx, conversationId, draft, now, queueModes) {
    if (draft.type === "input" && draft.entry !== undefined)
        checkInputEntry(draft.entry);
    if (draft.requestId !== undefined) {
        const existing = await tx.submissionByRequest(conversationId, draft.requestId);
        if (existing !== undefined) {
            if (existing.type !== draft.type) {
                throw new Error(`Request ${draft.requestId} already identifies a submission of type ${existing.type}`);
            }
            return existing.id;
        }
    }
    const requestId = draft.requestId === undefined ? {} : { requestId: draft.requestId };
    if (draft.type === "write" &&
        isDisplayOnly(draft.entry) &&
        !hasQueuedReset((await tx.doc(InboxDoc, conversationId)).items)) {
        const entry = await tx.appendEntry(conversationId, draft.entry);
        const write = { conversationId, ...requestId, type: "write", status: "done", entry: entry.id };
        return (await tx.createSubmission(write)).id;
    }
    const live = await tx.doc(LiveDoc, conversationId);
    const busy = live.run !== undefined;
    if (busy && draft.type === "input" && draft.whenBusy === "reject")
        throw new ConversationBusy(conversationId);
    // A boundary reads the table, so it is prepared before the first table write; a busy one needs none.
    const boundary = busy ? undefined : await prepareBoundary(tx, conversationId, queueModes);
    if (boundary === undefined || boundary.inbox.items.length > 0) {
        const { id } = await tx.createSubmission({
            conversationId,
            ...requestId,
            type: draft.type,
            status: "queued",
        });
        // Hosts may leave optional fields `undefined`; drafts take strict JSON.
        const value = copyJson(draft.type === "write" ? draft.entry : draft.content, {
            omitUndefinedProperties: true,
        });
        const items = (boundary?.inbox ?? (await tx.doc(InboxDoc, conversationId))).items;
        if (draft.type === "write")
            items.push({ id, mode: "write", entry: value });
        else {
            const mode = draft.whenBusy === "steer" ? "steer" : "followUp";
            const content = value;
            const entry = draft.entry === undefined ? {} : { entry: pickInputEntry(draft.entry) };
            items.push({ id, mode, content, ...entry });
        }
        if (boundary === undefined)
            return id;
        const { users } = await applyBoundary(tx, boundary, "final", now);
        if (users.length > 0)
            await startRun(tx, conversationId, live, users);
        return id;
    }
    if (draft.type === "write") {
        if (isStale(boundary, draft.entry)) {
            const stale = { status: "unanswered", reason: "stale" };
            return (await tx.createSubmission({ conversationId, ...requestId, type: "write", ...stale })).id;
        }
        const entry = await tx.appendEntry(conversationId, draft.entry);
        const write = { conversationId, ...requestId, type: "write", status: "done", entry: entry.id };
        return (await tx.createSubmission(write)).id;
    }
    const entry = await appendInput(tx, conversationId, draft.content, draft.entry, now);
    const input = { conversationId, ...requestId, type: "input", status: "placed", entry: entry.id };
    const { id } = await tx.createSubmission(input);
    await startRun(tx, conversationId, live, [id]);
    return id;
}
//# sourceMappingURL=submissions.js.map