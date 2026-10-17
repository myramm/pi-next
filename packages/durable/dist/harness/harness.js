import { withAbortSignal, withoutAbortSignal } from "@earendil-works/chord/context";
import { ResetEntry } from "../entries.js";
import { contained, SessionImpl } from "../session/session.js";
import { ROOT_CONVERSATION_ID } from "../types.js";
import { AgentDoc, configure, createAgent, resolveAgent, resolveSettings } from "./agent.js";
import { createCompaction } from "./compaction.js";
import { readContext } from "./context.js";
import { InboxDoc, withdrawQueuedInputs } from "./inbox.js";
import { LiveDoc, settleSchedulerOutcome } from "./live.js";
import { ProviderDoc } from "./provider.js";
import { BUILTIN_TASKS } from "./registry.js";
import { TaskScheduler } from "./scheduler.js";
import { Submissions } from "./submissions.js";
import { TaskGraphView } from "./task-graph.js";
import { addUsageState, UsageDoc } from "./usage.js";
import { scanAll } from "./util.js";
import { ConversationViews } from "./view.js";
const SCAN_PAGE_SIZE = 256;
/** Key of the Harness's internal index-size getter, for tests. */
export const SCHEDULER_INDEX_SIZES = Symbol.for("pi-durable.schedulerIndexSizes");
class ConversationImpl {
    id;
    #host;
    constructor(id, host) {
        this.id = id;
        this.#host = host;
    }
    agent(context) {
        return this.#host.harness.resolveAgent(this.id, undefined, context);
    }
    configure(change, context) {
        return this.#host.harness.commitWith((tx) => configure(tx, this.id, change), context);
    }
    submit(submission, context) {
        return this.#host.submissions.submit(this.id, submission, context);
    }
    compact(instructions, context) {
        this.#host.tasks.resume();
        const input = { reason: "manual", ...(instructions === undefined ? {} : { instructions }) };
        return this.#host.harness.commitWith((tx) => createCompaction(tx, this.id, input), context);
    }
    async reset(handoff, context) {
        const model = handoff === undefined
            ? {}
            : { model: [{ role: "user", content: handoff, timestamp: this.#host.now() }] };
        const entry = { kind: ResetEntry.kind, head: "self", ...model };
        await this.#host.submissions.submit(this.id, { type: "write", entry }, context);
    }
    commit(change, context) {
        return this.#host.harness.commitWith(change, context, { conversationId: this.id });
    }
    context(context, options) {
        return readContext(this.#host.harness, this.#host.storage, this.id, context, options?.at);
    }
    entries(query, limit, cursor, context) {
        const bounded = {
            conversationId: this.id,
            ...(query.minEntryId === undefined ? {} : { minEntryId: query.minEntryId }),
            ...(query.maxEntryId === undefined ? {} : { maxEntryId: query.maxEntryId }),
            ...(query.order === undefined ? {} : { order: query.order }),
        };
        return this.#host.harness.readOnLine(() => this.#host.storage.scanEntries(bounded, limit, cursor, context));
    }
    fork(at, options, context) {
        return this.#host.create({ kind: "fork", parentId: this.id, at, ownership: options.ownership }, options, context);
    }
    abort(context, options) {
        this.#host.tasks.resume();
        return this.#host.tasks.abortConversation(this.id, options?.background === true, context);
    }
    waitForIdle(context) {
        this.#host.tasks.resume();
        return this.#host.tasks.waitForIdle(this.id, context);
    }
    viewState(context) {
        return this.#host.views.state(this.id, context);
    }
    watch(context) {
        return this.#host.views.watch(this.id, context);
    }
}
/** Session kernel extended with conversation handles and a registry. */
class HarnessImpl extends SessionImpl {
    #options;
    #report;
    #host;
    #tasks;
    #submissions;
    #taskGraph;
    constructor(rawStorage, options, context) {
        const report = safeReport(options.onReport);
        const now = safeNow(options.now, report);
        // Read at each use, as all settings are, but only this field: it is read on every commit.
        super(rawStorage, now, () => options.settings?.documentRetentionMs);
        // Every component reads and writes through the Session's failure guard: `rawStorage` serves only `super()`.
        const storage = this.storage;
        this.#options = options;
        this.#report = report;
        const settings = () => resolveSettings(options.settings);
        this.#tasks = new TaskScheduler({
            session: this,
            storage,
            registry: options.registry,
            models: options.models,
            agent: (id, snapshot, callContext) => this.resolveAgent(id, snapshot, callContext),
            settings,
            env: (id, callContext) => this.buildEnv(id, callContext),
            now,
            report: this.#report,
            settleOutcome: settleSchedulerOutcome,
            withdrawInputs: withdrawQueuedInputs,
            conversation: async (id, binding, callContext) => {
                const record = await this.readOnLine(() => storage.conversation(id, callContext));
                return record === undefined ? undefined : boundConversation(id, binding, this.#submissions, this.#tasks);
            },
            context: withoutAbortSignal(context),
        });
        this.#submissions = new Submissions(this, storage, now, settings, () => this.#tasks.resume());
        this.#taskGraph = new TaskGraphView(this, storage);
        this.#host = {
            harness: this,
            storage,
            tasks: this.#tasks,
            submissions: this.#submissions,
            views: new ConversationViews(this, storage),
            now,
            create: (target, createOptions, context) => this.#create(target, createOptions, context),
        };
    }
    /** Resolve a conversation's committed `pi.agent` against `snapshot`, or the current one, and the current settings. */
    async resolveAgent(id, snapshot, context) {
        const registry = snapshot ?? this.#options.registry.snapshot();
        const state = await this.snapshot(AgentDoc, id, context);
        return resolveAgent(state, registry, resolveSettings(this.#options.settings), this.#report);
    }
    /** Build a conversation's environment from its current `cwd`; `undefined` without an `env` option. */
    async buildEnv(id, context) {
        const build = this.#options.env;
        if (build === undefined)
            return undefined;
        const cwd = (await this.snapshot(AgentDoc, id, context))?.cwd;
        return build({ conversationId: id, ...(cwd === undefined ? {} : { cwd }), read: this }, context);
    }
    /** Reconcile surviving `running` tasks to `pending`; part of open. */
    openTasks(context) {
        return this.#tasks.open(context);
    }
    resume() {
        this.assertUsable();
        this.#tasks.resume();
    }
    getTask(id, context) {
        return this.readOnLine(() => this.storage.task(id, context));
    }
    /** Internal, for tests: sizes of the scheduler's ownership indexes. */
    get [SCHEDULER_INDEX_SIZES]() {
        return this.#tasks.indexSizes;
    }
    inspect(context) {
        return this.readOnLine(async () => {
            const { scheduling, tasks } = await this.#tasks.inspect(this.#options.registry.snapshot());
            const scan = (status) => scanAll((cursor) => this.storage.scanSubmissions({ status }, SCAN_PAGE_SIZE, cursor, context));
            const submissions = [...(await scan("queued")), ...(await scan("placed"))].sort((a, b) => a.id - b.id);
            return { scheduling, tasks, submissions };
        });
    }
    submission(id, context) {
        return this.#submissions.get(id, context);
    }
    abortSubmission(id, context, conversationId) {
        return this.#submissions.abort(id, context, conversationId);
    }
    abortTask(id, context) {
        return this.#tasks.abort(id, context);
    }
    waitForTask(id, context) {
        this.#tasks.resume();
        return this.#tasks.waitForTask(id, context);
    }
    waitForIdle(context) {
        this.#tasks.resume();
        return this.#tasks.waitForIdle(undefined, context);
    }
    /** Sum every conversation's committed `pi.usage`. Each document is read at its own point; totals only grow. */
    async usage(context) {
        const conversations = await this.readOnLine(() => scanAll((cursor) => this.storage.scanConversations({}, SCAN_PAGE_SIZE, cursor, context)));
        const total = UsageDoc.definition.initial();
        for (const { id } of conversations) {
            const state = await this.snapshot(UsageDoc, id, context);
            if (state !== undefined)
                addUsageState(total, state);
        }
        return total;
    }
    taskGraph(context) {
        return this.#taskGraph.state(context);
    }
    watchTaskGraph(context) {
        return this.#taskGraph.watch(context);
    }
    root(context, options) {
        return this.#create({ kind: "root" }, options ?? {}, context);
    }
    async conversation(id, context) {
        this.assertUsable();
        const record = await this.readOnLine(() => this.storage.conversation(id, context));
        return record === undefined ? undefined : new ConversationImpl(record.id, this.#host);
    }
    createConversation(options, context) {
        return this.#create({ kind: "independent", ownership: options.ownership }, options, context);
    }
    report(error) {
        this.#report(error);
    }
    /** Signal and join task invocations after the close listeners and before Storage closes; writes no task outcome. */
    beforeClose() {
        return this.#tasks.join();
    }
    async #create(target, options, context) {
        this.assertUsable();
        const id = await this.commitWith(async (tx) => {
            if (target.kind === "root" && (await tx.conversation(ROOT_CONVERSATION_ID)) !== undefined) {
                return ROOT_CONVERSATION_ID;
            }
            const record = target.kind === "root"
                ? await tx.createRootConversation()
                : target.kind === "fork"
                    ? await tx.forkConversation(target.parentId, target.at, { ownership: target.ownership })
                    : await tx.createConversation({ ownership: target.ownership });
            if (options.agent !== undefined)
                await configure(tx, record.id, options.agent);
            if (options.init !== undefined)
                await options.init(tx, record.id);
            return record.id;
        }, context);
        return new ConversationImpl(id, this.#host);
    }
    /**
     * The built-in creation hook, in every commit that creates or forks a conversation: empty `pi.live`, `pi.inbox`, and
     * `pi.usage`, a fresh `pi.provider`, the conversation's `pi.agent` (see `createAgent()`), then
     * `HarnessOptions.conversationCreated`.
     */
    async conversationCreated(tx, record) {
        await tx.doc(LiveDoc, record.id);
        await tx.doc(InboxDoc, record.id);
        await tx.doc(UsageDoc, record.id);
        await tx.doc(ProviderDoc, record.id);
        await createAgent(tx, record);
        await this.#options.conversationCreated?.(tx, record);
    }
}
/** `onReport` that cannot fail: it is the last place an error goes, so its own throw or rejection is dropped. */
function safeReport(onReport) {
    return (error) => contained(() => onReport?.(error), () => { });
}
/**
 * The host clock, falling back to `Date.now` when it throws: a broken clock must not stop commits. The first throw is
 * reported; the clock is read in every task change, so later ones are not.
 */
export function safeNow(now, report) {
    if (now === undefined)
        return Date.now;
    let reported = false;
    return () => {
        try {
            return now();
        }
        catch (error) {
            // Set first: a report handler that reads the clock again must not report again.
            if (!reported) {
                reported = true;
                report(error);
            }
            return Date.now();
        }
    };
}
/**
 * Invocation-bound handle for tasks and tools. Every operation, and every operation of a submission it returns, first
 * checks the invocation and runs under its signal, so it rejects once the invocation ends; admitted work stays durable.
 */
function boundConversation(id, binding, submissions, tasks) {
    const bind = (context) => withAbortSignal(binding.signal, context);
    const bound = (operation) => {
        return async (context) => {
            binding.check();
            return operation(bind(context));
        };
    };
    return {
        id,
        submit: async (draft, context) => {
            binding.check();
            const submission = await submissions.submit(id, draft, bind(context));
            return {
                id: submission.id,
                status: bound((callContext) => submission.status(callContext)),
                wait: bound((callContext) => submission.wait(callContext)),
                abort: bound((callContext) => submission.abort(callContext)),
            };
        },
        abort: async (context, options) => {
            binding.check();
            return tasks.abortConversation(id, options?.background === true, bind(context));
        },
        waitForIdle: bound((callContext) => tasks.waitForIdle(id, callContext)),
    };
}
export const Harness = {
    /** Open a Harness over storage. The registry may keep changing while the Harness runs. */
    async open(storage, options, context) {
        context.abortSignal?.throwIfAborted();
        const snapshot = options.registry.snapshot();
        const missing = BUILTIN_TASKS.filter((task) => snapshot.task(task.definition.name) === undefined);
        if (missing.length > 0) {
            const names = missing.map((task) => task.definition.name).join(", ");
            throw new Error(`Registry lacks built-in tasks ${names}; create it with createRegistry()`);
        }
        const harness = new HarnessImpl(storage, options, context);
        try {
            await harness.openTasks(context);
        }
        catch (error) {
            // The caller's context may be what failed open: close without it, and rethrow the open error.
            // A failing Storage close fails the Session, which reports it.
            await harness.close(withoutAbortSignal(context)).catch(() => { });
            throw error;
        }
        return harness;
    },
};
//# sourceMappingURL=harness.js.map