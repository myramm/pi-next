import { copyJson } from "@earendil-works/chord";
import { awaitWithContext, withAbortSignal } from "@earendil-works/chord/context";
import { errorMessage } from "../errors.js";
import { agentHooks } from "./agent.js";
import { readContextFrom } from "./context.js";
import { closedError, scanAll, Waiters } from "./util.js";
const SCAN_PAGE_SIZE = 256;
/** Longest delay `setTimeout` supports; longer sleeps wait in several steps. */
const MAX_TIMER_DELAY = 2_147_483_647;
const LIVE_STATUSES = ["pending", "running", "waiting", "completing"];
function conversationNode(id) {
    return `c${id}`;
}
function conversationOf(node) {
    return Number(node.slice(1));
}
/** The node a task hangs from: its owner task, or its conversation. */
function parentNode(node) {
    return node.owner ?? conversationNode(node.conversationId);
}
/**
 * Durable task scheduler of one Harness.
 *
 * `#live` mirrors every committed non-terminal task record: pending, running, waiting, and completing. The synchronous
 * commit listener updates it on the Session line, so code running on the line reads exactly the committed state from it.
 *
 * Tasks and conversations form one ownership tree (spec §5.5): a task's parent is its owner task, or its conversation;
 * a conversation's parent is its owner task, if any. Walks up that tree decide what reaches one task: a cancelling
 * owner, a scope. `#below` lists the tree downward around live work, so what lies below one node is a walk down from
 * it: a task's live ordinary owned work, which holds its outcome as `completing` and delays its abort handler, a
 * scope's tasks, a cascade's reach. No pass visits every live task; the sets below hold each pass's candidates.
 *
 * The ownership indexes are bounded by live work: an owner edge and an ended task's ownership fields are kept only while
 * something is listed below them in `#below`, so only the chains above live tasks are known, whole. Work that appears
 * later below a dropped node finds it unknown and loads its chain from storage again.
 *
 * Invariant: every task transition is decided and written by one callback serialized on the Session line. That covers
 * reservation, marks, runtime commits, finalization, and the synchronous step before each phase, which applies the
 * precedence rules and writes a fault or handover. Handlers and joins run off the line. An invocation ends inside the
 * step that decides its end, so a runtime commit it queued either lands before that decision or is rejected.
 */
export class TaskScheduler {
    #session;
    #storage;
    #registry;
    #models;
    #agent;
    #settings;
    #env;
    #now;
    #report;
    #settleOutcome;
    #withdrawInputs;
    #conversation;
    #context;
    #live = new Map();
    /**
     * Context range last read through a task runtime, per conversation: a later read, by any of its tasks, scans only
     * newer entries. `idleSince` is the Harness time it was first seen idle. Derived and never persisted; dropped at the
     * first idle check after `settings.contextRetentionMs` of idleness, and at close.
     */
    #contexts = new Map();
    /** Timer for the earliest expiry of an idle context, only where timers can be unreferenced (see `#scheduleExpiry`). */
    #expiry;
    #invocations = new Map();
    #taskWaiters = new Waiters();
    /** Idle waiters by conversation; `undefined` waits for the whole Harness. */
    #idleWaiters = new Waiters();
    /** Definition whose migration failed per task; retried only once the registry resolves another definition. */
    #failedMigrations = new Map();
    /** Owner task of each known conversation, `null` when ownerless. */
    #edges = new Map();
    /** Ownership fields of the known terminal tasks, which walks pass through. */
    #settled = new Map();
    /**
     * Ended tasks and conversations found unneeded, dropped by `#sweep()` at the end of the commit's publication unless
     * needed again by then: a chain load installs nodes before the work below them is listed.
     */
    #dropQueue = new Set();
    /**
     * The tree downward around live work: each node's child nodes that are live tasks or have nodes listed below them.
     * A conversation's parent is its owner task; ownerless ones with work are in `#roots`.
     */
    #below = new Map();
    #roots = new Set();
    /** Known tasks whose chain may not be loaded; every other known task's chain is, and stays, loaded. */
    #unloaded = new Set();
    /** Live tasks with cancellation intent, the sources of abort cascades (spec §5.4). */
    #intent = new Set();
    /** Live tasks that are not `completing`, the candidates of a reservation pass; ones found waiting leave it. */
    #runnable = new Set();
    /** `completing` tasks the next finalize pass checks: those that started holding, and holders of ended work. */
    #finalizeChecks = new Set();
    /** Live waiting tasks by each task in their `on`. */
    #waiters = new Map();
    /**
     * `failFast` waiters the next reconcile checks for a failed task in `on`: at open, when they start waiting, and when
     * one of their tasks fails.
     */
    #failFastChecks = new Set();
    /**
     * Live tasks with `abandonOnRestart` found at open, from an earlier Harness. The first reservation pass abort-marks
     * them with reason `restart`, so nothing of them or below them runs a phase again.
     */
    #abandoned = new Set();
    #reconcileScheduled = false;
    #sweepScheduled = false;
    #cascadePending = false;
    #unsubscribeRegistry = () => { };
    #enabled = false;
    #closing = false;
    #dirty = false;
    #draining = false;
    constructor(options) {
        this.#session = options.session;
        this.#storage = options.storage;
        this.#registry = options.registry;
        this.#models = options.models;
        this.#agent = options.agent;
        this.#settings = options.settings;
        this.#env = options.env;
        this.#now = options.now;
        this.#report = options.report;
        this.#settleOutcome = options.settleOutcome;
        this.#withdrawInputs = options.withdrawInputs;
        this.#conversation = options.conversation;
        this.#context = options.context;
    }
    /** Load live tasks and change surviving `running` tasks back to `pending`. Dispatches nothing. */
    async open(context) {
        this.#session.observeCommits((publication) => this.#observe(publication));
        this.#session.subscribeClose(() => this.#seal());
        this.#unsubscribeRegistry = this.#registry.subscribe(() => this.#kick());
        await this.#session.commitWith(async (tx) => {
            // Every table read before the first write.
            const scans = [];
            for (const status of LIVE_STATUSES) {
                scans.push(await scanAll((cursor) => tx.scanTasks({ status }, SCAN_PAGE_SIZE, cursor)));
            }
            for (const records of scans) {
                for (const record of records) {
                    this.#track(undefined, record);
                    if (record.abandonOnRestart === true)
                        this.#abandoned.add(record.id);
                    if (record.state.status === "running") {
                        tx.setTask(withState(record, { status: "pending", checkpoint: record.state.checkpoint }));
                    }
                    if (record.state.status === "waiting" && record.state.policy === "failFast") {
                        this.#failFastChecks.add(record.id);
                    }
                }
            }
        }, context);
        // Derive abort marks a crash left unapplied below cancelled owners, and finalize held outcomes.
        this.#cascadePending = true;
        this.#scheduleReconcile();
    }
    /** Enable scheduling. Idempotent; the kick does nothing once closing. */
    resume() {
        this.#enabled = true;
        this.#kick();
    }
    /**
     * Signal every invocation and wait for them; writes nothing. Close calls this after every close listener has run, so
     * waits, watches, and streams a task holds end with the Session's reason, not as cancelled by its signal.
     */
    async join() {
        for (const invocation of this.#invocations.values())
            invocation.controller.abort();
        await Promise.allSettled([...this.#invocations.values()].map((invocation) => invocation.done));
    }
    /**
     * Commit the abort mark, or settle a task that no registered definition can take as `orphaned` when nothing it owns
     * is live, then join the run invocation seen on the line; the commit listener signalled it. The abort invocation
     * starts once the task's ordinary owned work is gone. A `completing` task is only marked. A request replaces a
     * `restart` mark, so a task abandoned after a restart that waits for its definition is orphaned; with `keepRestart`,
     * as for an owner's own cleanup, such a task keeps its mark and waits on.
     */
    async abort(id, context, keepRestart = false) {
        const marked = await this.#session.commitWith(async (tx) => {
            const current = await tx.task(id);
            if (current === undefined)
                throw new Error(`Task ${id} does not exist`);
            if (current.state.status === "terminal")
                return { result: "terminal" };
            const invocation = this.#invocations.get(id);
            // A restart-marked task has no run invocation; it only waits for its abort.
            if (keepRestart && current.abortReason === "restart")
                return { result: "marked" };
            if (invocation === undefined && current.state.status !== "completing") {
                await this.#loadScopes(false);
                if (!this.#hasOwnedLive(id)) {
                    const resolution = this.#resolve(current, this.#registry.snapshot());
                    if (resolution.kind === "blocked") {
                        await this.#terminate(tx, current, { status: "orphaned", reason: resolution.reason });
                        return { result: "marked" };
                    }
                }
            }
            if (!current.abortRequested || current.abortReason !== undefined)
                tx.setTask(withAbortMark(current));
            return { result: "marked", run: invocation?.mode === "run" ? invocation : undefined };
        }, context);
        // The commit listener signalled the run; join it. A run that ignores its signal can outlive a failed Session,
        // which ends the wait instead.
        if (marked.run !== undefined) {
            await awaitWithContext(Promise.race([marked.run.done, this.#session.failed]), context);
        }
        return marked.result;
    }
    async waitForTask(id, context) {
        // Check and register on the line so no terminal publication falls between them.
        const found = await this.#session.readOnLine(async () => {
            if (this.#closing)
                throw closedError(this.#session);
            if (this.#live.has(id))
                return { promise: this.#taskWaiters.add(id, context) };
            const record = await this.#storage.task(id, context);
            if (record === undefined)
                throw new Error(`Task ${id} does not exist`);
            return { promise: Promise.resolve(record) };
        });
        return found.promise;
    }
    /**
     * Resolve when ordinary traversal from the conversation, or from every ownerless conversation, reaches no live
     * non-background task.
     */
    waitForIdle(conversationId, context) {
        if (this.#closing)
            return Promise.reject(closedError(this.#session));
        if (this.#idle(conversationId))
            return Promise.resolve();
        this.#scheduleReconcile();
        return this.#idleWaiters.add(conversationId, context);
    }
    /**
     * `Conversation.abort()`: in one commit, withdraw the queued inputs and mark every live non-background task that
     * ordinary traversal from the conversation reaches; resolves once the scope is idle. With `background`, traversal
     * crosses background boundaries, and the wait also covers every task it reached.
     */
    async abortConversation(conversationId, background, context) {
        const reached = await this.#session.commitWith(async (tx) => {
            const queued = await this.#loadScopes(true);
            const scope = { conversation: conversationId };
            const reached = [];
            const walk = this.#walkDown(conversationNode(conversationId), { crossBackground: background });
            for (const { node, live } of walk) {
                if (live === undefined || (node.background && !background))
                    continue;
                reached.push(live.id);
                if (!live.abortRequested || live.abortReason !== undefined)
                    tx.setTask(withAbortMark(live));
            }
            for (const id of queued) {
                if (this.#inScope({ conversation: id }, scope, background) === true)
                    await this.#withdrawInputs(tx, id);
            }
            return reached;
        }, context);
        if (background)
            for (const id of reached)
                await this.waitForTask(id, context);
        await this.waitForIdle(conversationId, context);
    }
    // ─── Scheduling ────────────────────────────────────────────────────────
    #observe(publication) {
        const updated = [];
        const failed = [];
        let changed = false;
        // Edges first, so the tasks a commit creates in a new conversation hang from it.
        for (const change of publication.changes) {
            if (change.type === "conversation" && !this.#edges.has(change.value.id)) {
                this.#setEdge(change.value.id, change.value.owner?.taskId ?? null);
            }
        }
        for (const change of publication.changes) {
            if (change.type !== "task")
                continue;
            changed = true;
            const record = change.value;
            const previous = this.#live.get(record.id);
            if (failedOutcome(record) && (previous === undefined || !failedOutcome(previous)))
                failed.push(record.id);
            this.#track(previous, record);
            if (record.state.status === "terminal") {
                this.#failedMigrations.delete(record.id);
                this.#failFastChecks.delete(record.id);
                this.#taskWaiters.resolve(record.id, record);
                // Its owner may finalize now.
                this.#scheduleReconcile();
                continue;
            }
            if (record.abortRequested && previous?.abortRequested !== true) {
                this.#cascadePending = true;
                // Signal a run invocation of the newly marked task; its next step ends it.
                const invocation = this.#invocations.get(record.id);
                if (invocation?.mode === "run")
                    invocation.controller.abort();
            }
            // A request replacing a `restart` mark upgrades the marks of the work below.
            if (previous?.abortReason !== undefined && record.abortReason === undefined)
                this.#cascadePending = true;
            const status = record.state.status;
            if (status === "completing" && previous?.state.status !== "completing") {
                if (cancellationIntent(record))
                    this.#cascadePending = true;
                this.#scheduleReconcile();
            }
            if (status === "waiting" && record.state.policy === "failFast" && previous?.state.status !== "waiting") {
                this.#failFastChecks.add(record.id);
                this.#scheduleReconcile();
            }
            // Its owners and place never change: what is above it is checked once, when it becomes live.
            if (previous === undefined)
                updated.push(record);
        }
        for (const id of failed) {
            for (const waiter of this.#waiters.get(id) ?? []) {
                const state = this.#live.get(waiter)?.state;
                if (state?.status === "waiting" && state.policy === "failFast") {
                    this.#failFastChecks.add(waiter);
                    this.#scheduleReconcile();
                }
            }
        }
        for (const change of publication.changes) {
            // A queued input below a cancelled owner is withdrawn, even after its cascade.
            if (change.type !== "submission" || change.value.status !== "queued" || change.value.type !== "input")
                continue;
            // Only an owner with cancellation intent withdraws it; a later intent's mark runs the cascade then.
            if (this.#intent.size === 0)
                continue;
            const conversation = change.value.conversationId;
            if (!this.#known(conversationNode(conversation)) || this.#belowCancelled({ conversation })) {
                this.#cascadePending = true;
            }
        }
        for (const record of updated) {
            // Work created below a cancelled owner, even after its cascade, is aborted too.
            if (this.#unloaded.has(record.id))
                this.#scheduleReconcile();
            else if (!record.background && !record.abortRequested && this.#belowCancelled(parentOf(record))) {
                this.#cascadePending = true;
            }
        }
        // A cascade that a reservation or step found pending runs with the next commit of any kind.
        if (this.#cascadePending)
            this.#scheduleReconcile();
        this.#sweep();
        if (!changed)
            return;
        this.#settleIdle();
        this.#kick();
    }
    /**
     * `settings.contextRetentionMs`, or 0 when the host's settings throw. Kept contexts are only a cache, so dropping them
     * is safe, while a throw here would escape commit listeners, reconciliation, and the expiry timer.
     */
    #contextRetentionMs() {
        try {
            return this.#settings().contextRetentionMs;
        }
        catch (error) {
            this.#report(error);
            return 0;
        }
    }
    /** Resolve idle waiters, and drop each kept context whose conversation has been idle for the retention period. */
    #settleIdle() {
        for (const conversationId of this.#idleWaiters.keys()) {
            if (this.#idle(conversationId))
                this.#idleWaiters.resolve(conversationId);
        }
        const now = this.#now();
        const retention = this.#contextRetentionMs();
        for (const [conversationId, kept] of this.#contexts) {
            if (kept.idleSince !== undefined && now - kept.idleSince >= retention) {
                this.#contexts.delete(conversationId);
            }
            else if (!this.#idle(conversationId)) {
                kept.idleSince = undefined;
            }
            else if (retention > 0) {
                kept.idleSince ??= now;
            }
            else {
                this.#contexts.delete(conversationId);
            }
        }
        this.#scheduleExpiry();
    }
    /**
     * Run `#settleIdle()` when the earliest idle context expires. The timer is unreferenced, so it never keeps the process
     * alive. Where timers cannot be unreferenced, as in Cloudflare Workers, none is kept: a pending timer could keep a
     * Durable Object from being evicted, and eviction frees the contexts. There, task changes alone check expiry.
     */
    #scheduleExpiry() {
        const retention = this.#contextRetentionMs();
        let at;
        for (const kept of this.#contexts.values()) {
            if (kept.idleSince !== undefined && (at === undefined || kept.idleSince + retention < at)) {
                at = kept.idleSince + retention;
            }
        }
        if (this.#expiry !== undefined && this.#expiry.at === at)
            return;
        if (this.#expiry !== undefined)
            clearTimeout(this.#expiry.timer);
        this.#expiry = undefined;
        if (at === undefined || this.#closing)
            return;
        const timer = setTimeout(() => {
            this.#expiry = undefined;
            this.#settleIdle();
        }, Math.min(Math.max(0, at - this.#now()), MAX_TIMER_DELAY));
        const unref = timer.unref;
        if (typeof unref !== "function") {
            clearTimeout(timer);
            return;
        }
        unref.call(timer);
        this.#expiry = { at, timer };
    }
    // ─── Ownership ───────────────────────────────────────────────────────────
    #scheduleReconcile() {
        if (this.#reconcileScheduled || this.#closing)
            return;
        this.#reconcileScheduled = true;
        queueMicrotask(() => void this.#reconcile());
    }
    /**
     * One commit that applies what committed records imply: abort marks below live owners with cancellation intent
     * (spec §5.4), `failFast` marks (spec §5.5), withdrawn queued inputs below cancelled owners, and the final terminal
     * record of every `completing` task whose ordinary owned work is gone. The durable records are the intent, so this
     * also repairs whatever a crash left unapplied. Resolves idle waiters that the loaded edges decide.
     */
    async #reconcile() {
        this.#reconcileScheduled = false;
        const cascade = this.#cascadePending;
        this.#cascadePending = false;
        const checks = [...this.#failFastChecks];
        this.#failFastChecks.clear();
        try {
            await this.#session.commitWith(async (tx) => {
                if (this.#closing)
                    return;
                const queued = await this.#loadScopes(cascade);
                // A cascade from an abandoned owner passes its `restart` reason on; any other intent marks, or upgrades a
                // `restart` mark, as a request. Collected first, so a request wins over a `restart` mark of the same pass.
                const marks = new Map();
                const mark = (record, reason) => {
                    const staged = marks.get(record.id);
                    if (staged !== undefined && staged.reason === undefined)
                        return;
                    if (record.abortRequested && (record.abortReason === undefined || reason !== undefined))
                        return;
                    marks.set(record.id, { record, reason });
                };
                // Every live foreground task below a live owner with cancellation intent, which is its nearest one: a walk down
                // from each owner with intent does not enter another, whose own walk covers what is below it. Derived again on
                // every pass, as loading edges can reveal a cancelled owner.
                for (const id of this.#intent) {
                    const owner = this.#live.get(id);
                    // Only an owner abandoned after a restart, and nothing else, passes its reason on.
                    const restart = owner.abortReason === "restart" && !failedOutcome(owner);
                    for (const { node, live } of this.#walkDown(id, { enter: (below) => !this.#intent.has(below) })) {
                        if (live !== undefined && !node.background)
                            mark(live, restart ? "restart" : undefined);
                    }
                }
                for (const id of checks) {
                    const waiter = this.#live.get(id);
                    if (waiter?.state.status !== "waiting" || !(await this.#anyFailed(waiter.state.on)))
                        continue;
                    // Every other live task: the failed one keeps its own outcome.
                    for (const member of waiter.state.on) {
                        const record = this.#live.get(member);
                        if (record !== undefined && !failedOutcome(record))
                            mark(record, undefined);
                    }
                }
                for (const { record, reason } of marks.values())
                    tx.setTask(withAbortMark(record, reason));
                for (const id of queued)
                    if (this.#belowCancelled({ conversation: id }))
                        await this.#withdrawInputs(tx, id);
                await this.#finalize(tx);
            }, this.#context);
        }
        catch (error) {
            // No extension code runs in this commit: a throw is a storage failure, a host callback, or a bug. None is fixed by
            // running the pass again, so it fails the Session, which reports it.
            this.#failSession(error);
        }
        this.#settleIdle();
    }
    /** Whether any of `ids` holds or ended with an outcome other than `completed`. */
    async #anyFailed(ids) {
        for (const id of ids) {
            const record = this.#live.get(id) ?? (await this.#storage.task(id, this.#context));
            if (record !== undefined && failedOutcome(record))
                return true;
        }
        return false;
    }
    /**
     * Write the terminal record of every `completing` task without live ordinary owned work. Finalizing one can free its
     * owner, so this repeats over the commit's candidates until nothing changes. A held scheduler outcome gets its
     * Harness cleanup here.
     */
    async #finalize(tx) {
        // A worklist: the tasks that started holding, and the holders of work that ended. Finalizing one can free the
        // nearest live task above it, which goes on the list. Tasks finalized here have no live work below them, so walks
        // down skip them.
        // In rounds: the holders the tasks of one round free are checked once, in the next, so a holder of many tasks that
        // end together is walked once, not once per task.
        let round = [...this.#finalizeChecks];
        this.#finalizeChecks.clear();
        const done = new Set();
        const overlay = overlayOf(tx);
        while (round.length > 0) {
            const next = new Set();
            for (const id of round) {
                const record = overlay.tasks.get(id) ?? this.#live.get(id);
                if (record?.state.status !== "completing" || done.has(id))
                    continue;
                if (this.#hasOwnedLive(id, overlay, done))
                    continue;
                const outcome = record.state.outcome;
                const terminal = withState(record, { status: "terminal", outcome });
                tx.setTask(terminal);
                overlay.tasks.set(id, terminal);
                done.add(id);
                // REMINDER: only the scheduler writes `faulted` and `orphaned` (spec §5.4); their cleanup waits for this commit.
                if (outcome.status === "faulted" || outcome.status === "orphaned") {
                    await this.#settleOutcome(tx, record, outcome);
                }
                const above = this.#nearestLiveAbove(record, overlay);
                if (above?.state.status === "completing")
                    next.add(above.id);
            }
            round = [...next];
        }
    }
    /**
     * Load the owner chains of the tasks in `#unloaded` and, with `queued`, of every conversation with queued inputs,
     * on the Session line; returns the latter. Reads committed Storage directly, so it may run inside a commit callback.
     */
    async #loadScopes(queued) {
        for (const id of [...this.#unloaded]) {
            // An earlier load in this loop may have passed it.
            if (this.#unloaded.has(id))
                await this.#loadChain({ task: id });
        }
        if (!queued)
            return [];
        const submissions = await scanAll((cursor) => this.#storage.scanSubmissions({ status: "queued" }, SCAN_PAGE_SIZE, cursor, this.#context));
        const inputs = submissions.filter((submission) => submission.type === "input");
        const conversations = [...new Set(inputs.map((submission) => submission.conversationId))];
        for (const id of conversations)
            await this.#loadChain({ conversation: id });
        return conversations;
    }
    /**
     * Load the owner edges and task nodes from `start` up to its ownerless root. A known task outside `#unloaded` ends the
     * walk, as its chain is loaded; the `#unloaded` tasks passed have a loaded chain afterwards. Loading a node can reveal
     * a cancelled owner, so it makes the next reconcile derive cascade marks.
     */
    async #loadChain(start, overlay) {
        const passed = [];
        let at = start;
        while (at !== undefined) {
            if ("task" in at) {
                const id = at.task;
                let node = this.#live.get(id) ?? this.#settled.get(id);
                // Created in this commit: the load from its own record covers what is above it.
                if (node === undefined && overlay?.tasks.has(id) === true)
                    break;
                if (node !== undefined && !this.#unloaded.has(id))
                    break;
                if (node === undefined) {
                    const record = await this.#storage.task(id, this.#context);
                    if (record === undefined)
                        return;
                    node = nodeOf(record);
                    if (record.state.status === "terminal")
                        this.#settle(id, node);
                    // A loaded node can reveal a cancelling owner: the next reconcile derives marks again.
                    this.#scheduleReconcile();
                }
                passed.push(id);
                at = parentOf(node);
            }
            else {
                let edge = this.#edge(at.conversation, overlay);
                if (edge === undefined) {
                    const record = await this.#storage.conversation(at.conversation, this.#context);
                    edge = record?.owner?.taskId ?? null;
                    this.#setEdge(at.conversation, edge);
                    // A loaded node can reveal a cancelling owner: the next reconcile derives marks again.
                    this.#scheduleReconcile();
                }
                at = edge === null ? undefined : { task: edge };
            }
        }
        for (const id of passed)
            this.#unloaded.delete(id);
    }
    #setEdge(conversationId, owner) {
        this.#edges.set(conversationId, owner);
        // The conversation now hangs from its owner, or is a root; with nothing below it, it waits for the sweep.
        this.#relist(conversationNode(conversationId));
        this.#dropIfUnneeded(conversationNode(conversationId));
    }
    /** Know a terminal task a chain load read, so walks pass through it; its own chain is not loaded yet. */
    #settle(id, node) {
        this.#settled.set(id, node);
        this.#unloaded.add(id);
        this.#relist(id);
        this.#dropIfUnneeded(id);
    }
    /** Queue an ended task or a conversation for the sweep when nothing is listed below it. */
    #dropIfUnneeded(node) {
        if (typeof node !== "string" && this.#live.has(node))
            return;
        if (this.#below.has(node))
            return;
        this.#dropQueue.add(node);
        this.#scheduleSweep();
    }
    /**
     * Sweep in a job of its own on the Session line, after the operation underway: a rejected commit, one with nothing to
     * write, and a read publish nothing, so the sweep at the end of `#observe` would not run for what they loaded.
     */
    #scheduleSweep() {
        if (this.#sweepScheduled || this.#closing)
            return;
        this.#sweepScheduled = true;
        this.#session
            .readOnLine(async () => {
            this.#sweepScheduled = false;
            this.#sweep();
        })
            // Rejected only once the Session is closing or failed, when nothing is kept anyway.
            .catch(() => { });
    }
    /**
     * Drop the queued nodes that are still unneeded: not live, nothing listed below. Runs once a publication is fully
     * tracked, and as a job of its own on the line, never inside an operation: work a commit creates below a chain its
     * own callback loaded keeps that chain. A flat loop: unlisting already queued every node on the way up that lost its
     * last listed node.
     */
    #sweep() {
        for (const node of this.#dropQueue) {
            if (this.#below.has(node))
                continue;
            if (typeof node === "string") {
                this.#edges.delete(conversationOf(node));
                this.#roots.delete(conversationOf(node));
            }
            else if (!this.#live.has(node)) {
                this.#settled.delete(node);
                this.#unloaded.delete(node);
            }
        }
        this.#dropQueue.clear();
    }
    /**
     * Bring the scheduler's sets in line with a task's committed record. A task that ended may free the nearest live task
     * above it: one holding its outcome finalizes, an abort-marked one runs its abort handler; its waiters may run.
     */
    #track(previous, record) {
        const id = record.id;
        if (previous?.state.status === "waiting")
            for (const on of previous.state.on)
                deleteFrom(this.#waiters, on, id);
        if (record.state.status === "terminal") {
            const node = nodeOf(record);
            this.#live.delete(id);
            this.#intent.delete(id);
            this.#runnable.delete(id);
            this.#finalizeChecks.delete(id);
            this.#settled.set(id, node);
            // Before anything is forgotten: the walk up to the task it held passes the ended tasks between them. Its chain is
            // loaded, as every commit that ends a task loads the chains of `#unloaded` first.
            this.#release(node);
            for (const waiter of this.#waiters.get(id) ?? [])
                this.#runnable.add(waiter);
            this.#relist(id);
            this.#dropIfUnneeded(id);
            return;
        }
        this.#live.set(id, record);
        if (previous === undefined) {
            if (!this.#known(parentNode(record)))
                this.#unloaded.add(id);
            this.#relist(id);
        }
        if (cancellationIntent(record))
            this.#intent.add(id);
        else
            this.#intent.delete(id);
        if (record.state.status === "completing") {
            this.#runnable.delete(id);
            this.#finalizeChecks.add(id);
        }
        else {
            this.#runnable.add(id);
        }
        if (record.state.status === "waiting")
            for (const on of record.state.on)
                addTo(this.#waiters, on, id);
    }
    /** The nearest live task above ended ordinary work may be free now: one holding its outcome, or an aborting one. */
    #release(node, overlay) {
        const above = this.#nearestLiveAbove(node, overlay);
        if (above?.state.status === "completing")
            this.#finalizeChecks.add(above.id);
        else if (above?.abortRequested === true)
            this.#runnable.add(above.id);
        return above;
    }
    /**
     * List `start` under its parent node in `#below` while it is a live task or has nodes listed below it, and unlist it
     * otherwise; then its parent, as far up as that changes. So `#below` holds exactly the tree around live work; a
     * parent that loses its last listed node is queued for the sweep. A loop, as ownership chains can be deeper than the
     * call stack.
     */
    #relist(start) {
        let node = start;
        for (;;) {
            const needed = (typeof node !== "string" && this.#live.has(node)) || this.#below.has(node);
            let parent;
            if (typeof node === "string") {
                parent = this.#edges.get(conversationOf(node));
            }
            else {
                const known = this.#live.get(node) ?? this.#settled.get(node);
                if (known === undefined)
                    return;
                parent = parentNode(known);
            }
            if (parent === undefined)
                return;
            if (parent === null) {
                const root = conversationOf(node);
                if (needed)
                    this.#roots.add(root);
                else
                    this.#roots.delete(root);
                return;
            }
            if ((this.#below.get(parent)?.has(node) === true) === needed)
                return;
            if (needed) {
                const first = !this.#below.has(parent);
                addTo(this.#below, parent, node);
                if (!first)
                    return;
            }
            else {
                deleteFrom(this.#below, parent, node);
                if (this.#below.has(parent))
                    return;
                this.#dropIfUnneeded(parent);
            }
            node = parent;
        }
    }
    /**
     * The nearest live task above ended ordinary work `node`, in the overlay's view: the one that work held, if any. Work
     * at or below a background task holds nothing above it.
     */
    #nearestLiveAbove(node, overlay) {
        for (let current = node; !current.background;) {
            const owner = current.owner ?? this.#edge(current.conversationId, overlay);
            if (owner === undefined || owner === null)
                return undefined;
            const record = overlay?.tasks.get(owner) ?? this.#live.get(owner);
            if (record !== undefined && record.state.status !== "terminal")
                return record;
            const above = record ?? this.#settled.get(owner);
            if (above === undefined)
                return undefined;
            current = above;
        }
        return undefined;
    }
    /** Whether the chain above `node` is loaded, without walking: known tasks outside `#unloaded` have a loaded chain. */
    #known(node) {
        if (typeof node !== "string") {
            return (this.#live.has(node) || this.#settled.has(node)) && !this.#unloaded.has(node);
        }
        const owner = this.#edges.get(conversationOf(node));
        return owner === null || (owner !== undefined && this.#known(owner));
    }
    /** Owner task of a conversation, `null` when ownerless, `undefined` while not loaded. */
    #edge(id, overlay) {
        return overlay?.edges.has(id) === true ? overlay.edges.get(id) : this.#edges.get(id);
    }
    #node(id, overlay) {
        return overlay?.tasks.get(id) ?? this.#live.get(id) ?? this.#settled.get(id);
    }
    /** Walk up from `start`: owner tasks and conversations, ending at an ownerless root or an edge not loaded yet. */
    *#above(start, overlay) {
        let at = start;
        while (at !== undefined) {
            if ("task" in at) {
                const node = this.#node(at.task, overlay);
                if (node === undefined) {
                    yield { unknown: true };
                    return;
                }
                yield { task: at.task, node };
                at = parentOf(node);
            }
            else {
                yield { conversation: at.conversation };
                const edge = this.#edge(at.conversation, overlay);
                if (edge === undefined) {
                    yield { unknown: true };
                    return;
                }
                at = edge === null ? undefined : { task: edge };
            }
        }
    }
    /**
     * The tasks below `start` that a walk down reaches: those `#below` lists and, under an overlay, the commit's new tasks,
     * with its candidates in place of committed records. Background tasks are reached but not entered, unless
     * `crossBackground`, and neither are the tasks `enter` rejects. A loop, as chains can be deeper than the call stack.
     */
    *#walkDown(start, options = {}) {
        const { overlay, crossBackground = false, enter } = options;
        const links = overlay === undefined ? undefined : this.#links(overlay);
        const pending = [start];
        for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
            for (const children of [this.#below.get(at), links?.get(at)]) {
                for (const child of children ?? []) {
                    if (typeof child === "string") {
                        pending.push(child);
                        continue;
                    }
                    const record = overlay?.tasks.get(child) ?? this.#live.get(child);
                    const node = record ?? this.#settled.get(child);
                    if (node === undefined)
                        continue;
                    const live = record !== undefined && record.state.status !== "terminal" ? record : undefined;
                    yield { id: child, node, live };
                    if ((crossBackground || !node.background) && (enter === undefined || enter(child)))
                        pending.push(child);
                }
            }
        }
    }
    /**
     * The links walks down need for the commit's new tasks: each one under its parent node, then each node above it that
     * `#below` does not list yet, until one it lists, a live task (always listed), or the chain's end.
     */
    #links(overlay) {
        if (overlay.links !== undefined)
            return overlay.links;
        const links = new Map();
        for (const record of overlay.tasks.values()) {
            if (this.#live.has(record.id) || this.#settled.has(record.id))
                continue;
            let child = record.id;
            let parent = parentNode(record);
            while (parent !== undefined && parent !== null && links.get(parent)?.has(child) !== true) {
                addTo(links, parent, child);
                if (typeof parent !== "string" && (this.#live.has(parent) || overlay.tasks.has(parent)))
                    break;
                let above;
                if (typeof parent === "string") {
                    above = this.#edge(conversationOf(parent), overlay);
                }
                else {
                    const fields = this.#settled.get(parent);
                    above = fields === undefined ? undefined : parentNode(fields);
                }
                if (above !== undefined && above !== null && this.#below.get(above)?.has(parent) === true)
                    break;
                child = parent;
                parent = above;
            }
        }
        overlay.links = links;
        return links;
    }
    /**
     * The live ordinary owned work of `owner` (spec §5.5): the live non-background tasks below it that a walk down reaches
     * without entering a background task; with `first`, only the first. Candidates in `overlay` replace committed records;
     * the walk does not enter tasks in `done`, which have none. Owner chains must be loaded.
     */
    #ownedLive(owner, options = {}) {
        const { overlay, first = false, done } = options;
        const found = [];
        const walk = this.#walkDown(owner, {
            ...(overlay === undefined ? {} : { overlay }),
            ...(done === undefined ? {} : { enter: (id) => !done.has(id) }),
        });
        for (const { id, node, live } of walk) {
            if (live === undefined || node.background)
                continue;
            found.push(id);
            if (first)
                break;
        }
        return found;
    }
    #hasOwnedLive(owner, overlay, done) {
        const options = {
            first: true,
            ...(overlay === undefined ? {} : { overlay }),
            ...(done === undefined ? {} : { done }),
        };
        return this.#ownedLive(owner, options).length > 0;
    }
    /**
     * Whether ordinary traversal from `scope` reaches `start`: walking up reaches the scope's conversation, or an
     * ownerless one for `roots`, without crossing a background owner, unless `crossBackground`. `undefined` while an
     * edge is not loaded.
     */
    #inScope(start, scope, crossBackground = false) {
        for (const step of this.#above(start)) {
            if ("unknown" in step)
                return undefined;
            if ("conversation" in step) {
                if ("conversation" in scope && step.conversation === scope.conversation)
                    return true;
            }
            else if (step.node.background && !crossBackground) {
                return false;
            }
        }
        return "roots" in scope;
    }
    /**
     * Whether a live owner's cancellation intent reaches `start`: walking up finds an owner with intent before a
     * background owner without it. Terminal owners never cascade (spec §5.4).
     */
    #belowCancelled(start) {
        return this.#cancellingOwner(start) !== undefined;
    }
    /** The nearest live owner above `start` whose cancellation intent reaches it, if any; see `#belowCancelled`. */
    #cancellingOwner(start) {
        // Nothing cancels, the common case: no walk.
        if (this.#intent.size === 0)
            return undefined;
        for (const step of this.#above(start)) {
            if ("unknown" in step)
                return undefined;
            if (!("task" in step))
                continue;
            const live = this.#live.get(step.task);
            if (live !== undefined && cancellationIntent(live))
                return live;
            if (step.node.background)
                return undefined;
        }
        return undefined;
    }
    /** Fail the Session, which reports it, for a throw in one of the scheduler's own commits; ignored once closing. */
    #failSession(error) {
        if (!this.#closing)
            this.#session.fail(error);
    }
    /** Close listener: runs synchronously once admission is sealed, before `join()`, or when the Session fails. */
    #seal() {
        this.#closing = true;
        try {
            this.#unsubscribeRegistry();
        }
        catch (error) {
            this.#report(error);
        }
        const error = closedError(this.#session);
        this.#taskWaiters.rejectAll(error);
        this.#idleWaiters.rejectAll(error);
        this.#contexts.clear();
        if (this.#expiry !== undefined)
            clearTimeout(this.#expiry.timer);
        this.#expiry = undefined;
    }
    #kick() {
        this.#dirty = true;
        if (this.#draining || !this.#enabled || this.#closing)
            return;
        this.#draining = true;
        // Never commit synchronously from a commit or registry listener.
        queueMicrotask(() => void this.#drain());
    }
    async #drain() {
        try {
            while (this.#dirty && this.#enabled && !this.#closing) {
                this.#dirty = false;
                for (const reservation of await this.#reserve())
                    this.#start(reservation);
            }
        }
        catch (error) {
            // As in `#reconcile()`: the reservation commit runs no extension code.
            this.#failSession(error);
        }
        finally {
            this.#draining = false;
            // A wakeup that arrived after the loop's last check still needs its pass.
            if (this.#dirty)
                this.#kick();
        }
    }
    /**
     * Reserve every eligible task in one commit; orphan abort-marked tasks no definition can take, unless abandoned after
     * a restart. The first pass after open only abort-marks the abandoned tasks, so later passes see the marks.
     */
    async #reserve() {
        const reservations = [];
        let abandoned = [];
        try {
            await this.#session.commitWith(async (tx) => {
                if (!this.#enabled || this.#closing)
                    return;
                for (const id of this.#abandoned) {
                    const record = this.#live.get(id);
                    if (record !== undefined && !record.abortRequested)
                        tx.setTask(withAbortMark(record, "restart"));
                }
                if (this.#abandoned.size > 0) {
                    abandoned = [...this.#abandoned];
                    return;
                }
                await this.#loadScopes(false);
                // Taken once per pass, and only when some task is a candidate.
                let snapshot;
                for (const id of [...this.#runnable]) {
                    const record = this.#live.get(id);
                    if (record === undefined || record.state.status === "completing" || this.#invocations.has(id)) {
                        this.#runnable.delete(id);
                        continue;
                    }
                    // It returns once what it waits for ends, its record changes, or the work below it ends.
                    if (this.#waitingOn(record, true).length > 0) {
                        this.#runnable.delete(id);
                        continue;
                    }
                    const runnable = record;
                    const mode = record.abortRequested ? "abort" : "run";
                    // Work below an owner with cancellation intent waits for its cascade mark instead of running a phase; schedule
                    // the cascade, which may not have run yet.
                    if (mode === "run" && !record.background && this.#belowCancelled(parentOf(record))) {
                        this.#cascadePending = true;
                        this.#scheduleReconcile();
                        continue;
                    }
                    snapshot ??= this.#registry.snapshot();
                    const resolution = this.#resolve(runnable, snapshot);
                    if (resolution.kind === "blocked") {
                        // An abandoned task waits for its definition, so its abort handler can clean up.
                        if (mode === "abort" && record.abortReason === undefined) {
                            await this.#terminate(tx, record, { status: "orphaned", reason: resolution.reason });
                        }
                        continue;
                    }
                    if (resolution.record !== runnable || record.state.status !== "running") {
                        tx.setTask(withState(resolution.record, {
                            status: "running",
                            checkpoint: resolution.record.state.checkpoint,
                        }));
                    }
                    // Registered on the line, so marks and later reservations see it and close joins it; `#end` makes it a
                    // candidate again.
                    this.#runnable.delete(id);
                    const invocation = this.#createInvocation(record, mode);
                    reservations.push({ invocation, task: resolution.task, snapshot });
                }
            }, this.#context);
        }
        catch (error) {
            for (const { invocation } of reservations) {
                this.#invocations.delete(invocation.taskId);
                this.#runnable.add(invocation.taskId);
                invocation.finish();
            }
            throw error;
        }
        // Marked, or already marked or gone: done with them. Reserve again, now seeing the marks.
        for (const id of abandoned)
            this.#abandoned.delete(id);
        if (abandoned.length > 0)
            this.#dirty = true;
        return reservations;
    }
    /**
     * Live tasks a task waits for before its next invocation: its live ordinary owned work when abort-marked, since
     * abort runs bottom-up, otherwise the live part of the `on` of a wait.
     */
    #waitingOn(record, first = false) {
        if (record.abortRequested)
            return this.#ownedLive(record.id, { first });
        if (record.state.status !== "waiting")
            return [];
        if (!first)
            return record.state.on.filter((id) => this.#live.has(id));
        const live = record.state.on.find((id) => this.#live.has(id));
        return live === undefined ? [] : [live];
    }
    /** Resolve the record's definition by kind, migrating an older stored version. */
    #resolve(record, snapshot) {
        const fit = this.#fit(record, snapshot.task(record.kind));
        if ("reason" in fit)
            return { kind: "blocked", reason: fit.reason };
        if (!fit.migrates)
            return { kind: "ready", task: fit.task, record };
        const definition = erased(fit.task);
        try {
            if (definition.migrate === undefined)
                throw missingMigration(record, definition);
            const migrated = definition.migrate(record.input, record.state.checkpoint, record.version);
            const state = { ...record.state, checkpoint: copyJson(migrated.checkpoint) };
            const migratedRecord = { ...record, version: definition.version, input: copyJson(migrated.input), state };
            return { kind: "ready", task: fit.task, record: migratedRecord };
        }
        catch (error) {
            this.#failedMigrations.set(record.id, { task: fit.task, error });
            this.#report(error);
            return { kind: "blocked", reason: "migration_failed" };
        }
    }
    #fit(record, task) {
        if (task === undefined)
            return { reason: "missing_task" };
        const version = task.definition.version;
        if (version === record.version)
            return { task, migrates: false };
        if (version < record.version)
            return { reason: "task_too_old" };
        const failed = this.#failedMigrations.get(record.id);
        if (failed?.task === task)
            return { reason: "migration_failed", error: failed.error };
        return { task, migrates: true };
    }
    /** Sizes of the ownership indexes, for tests that bound the scheduler's memory. */
    get indexSizes() {
        let below = 0;
        for (const children of this.#below.values())
            below += children.size;
        return {
            live: this.#live.size,
            settled: this.#settled.size,
            edges: this.#edges.size,
            below,
            roots: this.#roots.size,
            unloaded: this.#unloaded.size,
            dropQueue: this.#dropQueue.size,
        };
    }
    /**
     * Scheduling state and every live task with its derived state, read on the Session line. Runs no task code: a
     * pending migration shows as `ready` with `migrates`, and only a migration the scheduler already tried, or one that
     * cannot exist, shows as failed.
     */
    async inspect(snapshot) {
        await this.#loadScopes(false);
        const tasks = [];
        for (const record of this.#live.values())
            tasks.push({ record, state: this.#inspectTask(record, snapshot) });
        const scheduling = this.#closing ? "closing" : this.#enabled ? "running" : "paused";
        return { scheduling, tasks };
    }
    #inspectTask(record, snapshot) {
        if (this.#invocations.has(record.id))
            return { kind: "running" };
        if (record.state.status === "completing")
            return { kind: "completing" };
        const on = this.#waitingOn(record);
        if (on.length > 0)
            return { kind: "waiting", on };
        const fit = this.#fit(record, snapshot.task(record.kind));
        if ("reason" in fit)
            return { kind: "blocked", ...fit };
        if (fit.migrates && fit.task.definition.migrate === undefined) {
            return { kind: "blocked", reason: "migration_failed", error: missingMigration(record, erased(fit.task)) };
        }
        return { kind: "ready", migrates: fit.migrates };
    }
    #createInvocation(record, mode) {
        const controller = new AbortController();
        const { promise: done, resolve: finish } = Promise.withResolvers();
        const invocation = {
            taskId: record.id,
            conversationId: record.conversationId,
            mode,
            controller,
            context: withAbortSignal(controller.signal, this.#context),
            watches: new Set(),
            ended: false,
            done,
            finish: () => finish(),
        };
        this.#invocations.set(record.id, invocation);
        return invocation;
    }
    #start(reservation) {
        const invocation = reservation.invocation;
        void (async () => {
            try {
                if (invocation.mode === "run")
                    await this.#run(reservation);
                else
                    await this.#runAbort(reservation);
            }
            catch (error) {
                this.#report(error);
            }
            finally {
                this.#end(invocation);
                invocation.finish();
                this.#kick();
            }
        })();
    }
    /** Run phase handlers, each preceded by a step that decides on the line whether the invocation continues. */
    async #run(reservation) {
        const invocation = reservation.invocation;
        const state = { task: reservation.task, snapshot: reservation.snapshot, reported: undefined };
        const phase = { snapshot: () => state.snapshot, task: () => state.task, agent: undefined };
        const runtime = this.#runtime(invocation, phase);
        let previous;
        for (;;) {
            const current = await this.#step(invocation, (tx, current) => this.#decide(tx, current, previous, state));
            // Close may seal between the decision and dispatch.
            if (current === undefined || this.#closing)
                return;
            const checkpoint = current.state.checkpoint;
            // Each phase handler resolves its agent afresh, at first use.
            phase.agent = undefined;
            try {
                await erased(state.task).phases[checkpoint.phase](current, runtime, invocation.context);
                previous = { checkpoint };
            }
            catch (error) {
                previous = { checkpoint, failure: { error } };
            }
        }
    }
    /**
     * Precedence rules for a run invocation, on the line. Rules 1 (terminal, `completing`, or `waiting`) and 2 (closing)
     * are applied by `#step`. Returns whether the invocation continues with the next phase.
     */
    #decide(tx, current, previous, state) {
        // 3. abort mark: end; a fresh abort invocation starts once the task's ordinary owned work is gone.
        if (current.abortRequested)
            return false;
        // An owner's cancellation intent ends it too, before its cascade marks it; reservation then holds it back.
        if (!current.background && this.#belowCancelled(parentOf(current))) {
            this.#cascadePending = true;
            this.#scheduleReconcile();
            return false;
        }
        if (previous === undefined)
            return true;
        // 4. uncaught error.
        if (previous.failure !== undefined)
            return { fault: previous.failure.error };
        // 6. no durable progress.
        if (jsonEqual(current.state.checkpoint, previous.checkpoint)) {
            const message = `Task ${current.kind} phase ${previous.checkpoint.phase} returned without durable progress`;
            return { fault: new Error(message) };
        }
        // 5. progress: refresh the snapshot; hand over to a replacement definition that can take the task.
        state.snapshot = this.#registry.snapshot();
        const next = state.snapshot.task(current.kind);
        if (next !== state.task) {
            if (next !== undefined && canReserve(next, current)) {
                tx.setTask(withState(current, { status: "pending", checkpoint: current.state.checkpoint }));
                return false;
            }
            if (state.reported === undefined || state.reported.task !== next) {
                state.reported = { task: next };
                const cause = next === undefined ? "missing_task" : "incompatible_task";
                this.#report(new Error(`Task ${current.id} keeps running under its old ${current.kind} definition`, { cause }));
            }
        }
        return true;
    }
    /** Run the abort handler once; rules 1, 2, and 4 apply, and returning without an outcome faults. */
    async #runAbort(reservation) {
        const invocation = reservation.invocation;
        const current = this.#live.get(invocation.taskId);
        if (current === undefined || this.#closing)
            return;
        let failure;
        try {
            const phase = { snapshot: () => reservation.snapshot, task: () => reservation.task, agent: undefined };
            const runtime = this.#runtime(invocation, phase);
            await erased(reservation.task).abort(current, runtime, invocation.context);
        }
        catch (error) {
            failure = { error };
        }
        const message = `Abort handler of task ${invocation.taskId} returned without a terminal outcome`;
        await this.#step(invocation, () => ({ fault: failure?.error ?? new Error(message) }));
    }
    /**
     * One synchronous decision on the Session line. A task that is no longer running (rule 1: terminal, `completing`, or
     * `waiting`) or a closing Harness (rule 2) ends the invocation without a write; otherwise `decide` may stage a write
     * and returns whether the invocation continues. Ending happens inside the callback, before a fault's Harness
     * cleanup. A rejected step, such as admission after close, also ends the invocation.
     */
    async #step(invocation, decide) {
        try {
            return await this.#session.commitWith(async (tx) => {
                const found = this.#live.get(invocation.taskId);
                const current = found?.state.status === "running" ? found : undefined;
                const decision = current !== undefined && !this.#closing ? decide(tx, current) : false;
                if (decision === true)
                    return current;
                this.#end(invocation);
                if (decision !== false) {
                    const message = errorMessage(decision.fault);
                    await this.#terminate(tx, current, { status: "faulted", error: { message } });
                }
                return undefined;
            }, this.#context);
        }
        catch (error) {
            // The step writes the scheduler's own decision, a fault or a terminal record; a throw there would otherwise
            // leave the task running, to be reserved and run again.
            this.#end(invocation);
            this.#failSession(error);
            return undefined;
        }
    }
    /**
     * Write an outcome the scheduler decided. While the task's ordinary owned work is live it holds as `completing` and
     * its Harness cleanup waits for the final commit (spec §5.5, rule 4); otherwise it is terminal with its cleanup.
     */
    async #terminate(tx, record, outcome) {
        await this.#loadScopes(false);
        if (this.#hasOwnedLive(record.id, overlayOf(tx))) {
            tx.setTask(withState(record, { status: "completing", outcome }));
            return;
        }
        tx.setTask(withState(record, { status: "terminal", outcome }));
        await this.#settleOutcome(tx, record, outcome);
    }
    /**
     * Replace a running task's state with what it committed. A terminal state holds as `completing` while ordinary owned
     * work is live, judged on the commit's candidates, so work the same commit creates below the task counts. A wait is
     * validated first.
     */
    async #commitState(tx, invocation, current, next) {
        if (next.status === "waiting")
            await this.#validateWait(tx, invocation, current, next.on, next.policy);
        if (next.status === "terminal") {
            const overlay = overlayOf(tx);
            await this.#loadScopes(false);
            for (const record of overlay.tasks.values())
                await this.#loadChain(parentOf(record), overlay);
            if (this.#hasOwnedLive(current.id, overlay)) {
                tx.setTask(withState(current, { status: "completing", outcome: next.outcome }));
                return;
            }
        }
        tx.setTask(withState(current, next));
    }
    /**
     * A wait names existing tasks, and `failFast` only tasks the waiter owns. It may not close a cycle in the wait-for
     * graph, whose edges run from each task to what it waits on and to its live ordinary owned work (spec §5.5); waiting
     * on itself or on an owner holding it are the shortest such cycles. An abort handler cannot wait.
     *
     * Invariant: the wait-for graph is acyclic. Only a wait adds an edge between existing tasks, as a new task has only
     * incoming edges, so checking each wait maintains it.
     */
    async #validateWait(tx, invocation, current, on, policy) {
        if (invocation.mode === "abort")
            throw new Error(`Abort handler of task ${current.id} cannot wait`);
        const overlay = overlayOf(tx);
        const targets = [];
        for (const id of on) {
            const member = overlay.tasks.get(id) ?? this.#live.get(id) ?? (await this.#storage.task(id, this.#context));
            if (member === undefined)
                throw new Error(`Task ${id} does not exist`);
            if (policy === "failFast" && member.owner !== current.id) {
                throw new Error(`Task ${current.id} can wait failFast only on tasks it owns; ${id} is not one`);
            }
            // A live child already holds the waiter (task-owned tasks are never background): waiting on it adds no edge. A
            // terminal task has no edges.
            if (member.state.status !== "terminal" && member.owner !== current.id)
                targets.push(id);
        }
        if (targets.length === 0)
            return;
        const cycle = await this.#waitCycle(current.id, targets, overlay);
        if (cycle !== undefined) {
            throw new Error(`Task ${current.id} cannot wait on ${cycle[0]}: ${[current.id, ...cycle].join(" -> ")} is a wait cycle`);
        }
    }
    /**
     * The path from a member of `on` back to `task` in the wait-for graph, if the wait would close a cycle (spec §5.1).
     * An edge X -> Y means X cannot settle before Y: Y is in the `on` of waiting X that is not abort-marked, or Y is live
     * ordinary owned work of X,
     * which holds X as `completing`. Each task is visited once and each subtree walked once, so a check is bounded by the
     * live work it reaches.
     */
    async #waitCycle(task, on, overlay) {
        // Owned work is found by walks down, which need the chains of every live task loaded.
        await this.#loadScopes(false);
        const from = new Map();
        const walked = new Set();
        const pending = [];
        const reach = (id, via) => {
            if (from.has(id))
                return;
            from.set(id, via);
            pending.push(id);
        };
        const path = (end) => {
            const steps = [];
            for (let at = end; at !== undefined; at = from.get(at))
                steps.unshift(at);
            return steps;
        };
        for (const id of on)
            reach(id, undefined);
        for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
            if (id === task)
                return path(id);
            const record = overlay.tasks.get(id) ?? this.#live.get(id);
            if (record === undefined || record.state.status === "terminal")
                continue;
            // An abort-marked task waits only for its owned work, as abort runs bottom-up (`#waitingOn`).
            if (record.state.status === "waiting" && !record.abortRequested) {
                for (const member of record.state.on)
                    reach(member, id);
            }
            if (walked.has(id))
                continue;
            walked.add(id);
            // Below a walked task the walk does not go again: its own walk covered what lies below.
            const found = [];
            const walk = this.#walkDown(id, { overlay, enter: (below) => !walked.has(below) });
            for (const { id: below, node, live } of walk) {
                if (live === undefined || node.background)
                    continue;
                found.push(below);
                reach(below, id);
            }
            for (const below of found)
                walked.add(below);
        }
        return undefined;
    }
    /** End an invocation: its runtime operations reject from now on, its signal aborts, its watches stop, and its task is free. */
    #end(invocation) {
        if (invocation.ended)
            return;
        invocation.ended = true;
        if (this.#invocations.get(invocation.taskId) === invocation) {
            this.#invocations.delete(invocation.taskId);
            if (this.#live.has(invocation.taskId))
                this.#runnable.add(invocation.taskId);
        }
        for (const watch of invocation.watches)
            void watch.stop();
        // Pending waits bound to the invocation, such as a tool's waitForTask(), reject with it.
        invocation.controller.abort(endedError(invocation));
    }
    /** No live non-background task in the scope; a task whose owner edges are not loaded yet counts as inside. */
    #idle(conversationId) {
        const scope = conversationId === undefined ? { roots: true } : { conversation: conversationId };
        // Tasks whose chain is not loaded are not listed below their scope yet; one counts as inside unless its walk up
        // decides otherwise.
        for (const id of this.#unloaded) {
            const record = this.#live.get(id);
            if (record !== undefined && !record.background && this.#inScope(parentOf(record), scope) !== false)
                return false;
        }
        const starts = conversationId === undefined ? this.#roots : [conversationId];
        for (const start of starts) {
            for (const { node, live } of this.#walkDown(conversationNode(start))) {
                if (live !== undefined && !node.background)
                    return false;
            }
        }
        return true;
    }
    // ─── Invocation runtime ──────────────────────────────────────────────────
    #runtime(invocation, phase) {
        // Resolved at most once per phase handler, at first use, with the invocation's context; fixed for the phase.
        const agent = () => {
            if (invocation.ended)
                return Promise.reject(endedError(invocation));
            if (phase.agent === undefined) {
                phase.agent = this.#agent(invocation.conversationId, phase.snapshot(), invocation.context);
                // A caller that stops waiting must not leave the shared resolution's failure unobserved.
                phase.agent.catch(() => { });
            }
            return phase.agent;
        };
        const hooks = {
            each: async (name, invoke) => {
                for (const handlers of agentHooks(await agent(), phase.task().definition.name)) {
                    const handler = handlers[name];
                    if (typeof handler !== "function")
                        continue;
                    try {
                        await invoke(handler.bind(handlers));
                    }
                    catch (error) {
                        if (invocation.controller.signal.aborted)
                            throw error;
                        this.#report(error);
                    }
                }
            },
        };
        const settings = this.#settings;
        return {
            taskId: invocation.taskId,
            conversationId: invocation.conversationId,
            signal: invocation.controller.signal,
            models: this.#models,
            agent: (context) => invocation.ended ? Promise.reject(endedError(invocation)) : awaitWithContext(agent(), context),
            get settings() {
                return settings();
            },
            env: (context) => this.#read(invocation, () => this.#env(invocation.conversationId, context)),
            hooks: hooks,
            get registry() {
                return phase.snapshot();
            },
            commit: (change, context) => this.#gated(invocation, async (tx, current) => {
                const next = await change(tx, current);
                if (next !== undefined)
                    await this.#commitState(tx, invocation, current, next);
            }, context),
            memo: ((name, ...rest) => {
                if (rest.length === 1) {
                    return this.#read(invocation, async () => memoOf(this.#live.get(invocation.taskId), name));
                }
                const candidate = rest[0];
                return this.#gated(invocation, (tx, current) => {
                    const winner = memoOf(current, name);
                    if (winner !== undefined)
                        return winner;
                    tx.setTask({ ...current, memos: { ...current.memos, [name]: candidate } });
                    return candidate;
                }, rest[1]);
            }),
            sleep: (until, context) => this.#sleep(invocation, until, context),
            watchDoc: ((...args) => this.#watchDoc(invocation, args)),
            snapshot: ((...args) => this.#read(invocation, () => sessionMethod(this.#session, "snapshot")(...args))),
            snapshotAsOf: ((...args) => this.#read(invocation, () => sessionMethod(this.#session, "snapshotAsOf")(...args))),
            getTask: ((id, context) => this.#read(invocation, () => this.#session.readOnLine(() => this.#storage.task(id, context)))),
            waitForTask: ((id, context) => this.#read(invocation, () => this.waitForTask(id, withAbortSignal(invocation.controller.signal, context)))),
            ownedTasks: (context) => this.#read(invocation, () => this.#session.readOnLine(async () => {
                // The step that ends the invocation may have run on the line before this.
                if (invocation.ended)
                    throw endedError(invocation);
                context.abortSignal?.throwIfAborted();
                // Every live task is listed under its parent node, its owner task when it has one.
                const owned = [];
                for (const node of this.#below.get(invocation.taskId) ?? []) {
                    const record = typeof node === "string" ? undefined : this.#live.get(node);
                    if (record?.owner === invocation.taskId)
                        owned.push(record);
                }
                // Copies, as from storage: the scheduler reads its own.
                return owned
                    .sort((a, b) => a.id - b.id)
                    .map((record) => copyJson(record));
            })),
            abortOwned: (id, context) => this.#read(invocation, async () => {
                const bound = withAbortSignal(invocation.controller.signal, context);
                const record = await this.#session.readOnLine(() => this.#storage.task(id, bound));
                if (record?.owner !== invocation.taskId) {
                    throw new Error(`Task ${id} is not owned by task ${invocation.taskId}`);
                }
                if (record.state.status === "terminal")
                    return;
                await this.abort(id, bound, true);
                await this.waitForTask(id, bound);
            }),
            outcomes: ((ids, context) => this.#read(invocation, () => this.#session.readOnLine(async () => {
                const outcomes = [];
                for (const id of ids) {
                    const state = (await this.#storage.task(id, context))?.state;
                    if (state?.status !== "terminal")
                        throw new Error(`Task ${id} is not terminal`);
                    outcomes.push(state.outcome);
                }
                return outcomes;
            }))),
            conversation: (id, context) => this.#read(invocation, () => this.#conversation(id, {
                signal: invocation.controller.signal,
                check: () => {
                    if (invocation.ended)
                        throw endedError(invocation);
                },
            }, context)),
            entry: ((...args) => {
                const [token, id, context] = args.length === 2
                    ? [undefined, args[0], args[1]]
                    : [args[0], args[1], args[2]];
                return this.#read(invocation, async () => {
                    const found = await this.#session.readOnLine(() => this.#storage.entry(invocation.conversationId, id, context));
                    const entry = found?.entry;
                    return token === undefined || entry?.kind === token.kind ? entry : undefined;
                });
            }),
            context: (conversationId, context, options) => this.#read(invocation, async () => {
                const { view, range } = await readContextFrom(this.#session, this.#storage, conversationId, context, options?.at, this.#contexts.get(conversationId)?.range);
                // Keep it unless the invocation ended or a concurrent read already kept a newer range.
                const kept = this.#contexts.get(conversationId);
                if (range !== undefined &&
                    !this.#closing &&
                    !invocation.ended &&
                    (kept === undefined || kept.range.bounds.tail <= range.bounds.tail)) {
                    // A read of another, idle conversation starts or continues its retention period.
                    if (!this.#idle(conversationId)) {
                        this.#contexts.set(conversationId, { range, idleSince: undefined });
                    }
                    else if (this.#contextRetentionMs() > 0) {
                        this.#contexts.set(conversationId, { range, idleSince: kept?.idleSince ?? this.#now() });
                        this.#scheduleExpiry();
                    }
                }
                return view;
            }),
            now: () => {
                if (invocation.ended)
                    throw endedError(invocation);
                return this.#now();
            },
            report: (error) => {
                if (invocation.ended)
                    throw endedError(invocation);
                this.#report(error);
            },
        };
    }
    /** Run a committed-state read unless the invocation has ended. */
    async #read(invocation, read) {
        if (invocation.ended)
            throw endedError(invocation);
        return read();
    }
    /** Commit after rereading the task on the line and gating the invocation. */
    #gated(invocation, change, context) {
        if (invocation.ended)
            return Promise.reject(endedError(invocation));
        return this.#session.commitWith(async (tx) => {
            if (invocation.ended)
                throw endedError(invocation);
            if (this.#closing)
                throw closedError(this.#session);
            const found = this.#live.get(invocation.taskId);
            if (found === undefined)
                throw new Error(`Task ${invocation.taskId} is terminal`);
            if (found.state.status !== "running")
                throw new Error(`Task ${invocation.taskId} is ${found.state.status}`);
            const current = found;
            if (invocation.mode === "run" && current.abortRequested) {
                throw new Error(`Task ${invocation.taskId} has a durable abort mark`);
            }
            return change(tx, current);
        }, context, { conversationId: invocation.conversationId, taskId: invocation.taskId });
    }
    /** Wait until the Harness clock reaches `until`, rechecking it after every timer. */
    async #sleep(invocation, until, context) {
        if (invocation.ended)
            throw endedError(invocation);
        const signals = [invocation.controller.signal];
        if (context.abortSignal !== undefined)
            signals.push(context.abortSignal);
        const signal = AbortSignal.any(signals);
        for (;;) {
            signal.throwIfAborted();
            const remaining = until - this.#now();
            if (remaining <= 0)
                return;
            await delay(Math.min(remaining, MAX_TIMER_DELAY), signal);
        }
    }
    async #watchDoc(invocation, args) {
        if (invocation.ended)
            throw endedError(invocation);
        const watch = (await sessionMethod(this.#session, "watchDoc")(...args));
        if (watch === undefined)
            return undefined;
        if (invocation.ended) {
            void watch.stop();
            throw endedError(invocation);
        }
        invocation.watches.add(watch);
        void watch.closed.then(() => invocation.watches.delete(watch));
        return watch;
    }
}
/** The record with an abort mark: `restart` for an abandonment; without a reason, a request, which replaces `restart`. */
function withAbortMark(record, reason) {
    const { abortReason: _reason, ...rest } = record;
    return { ...rest, abortRequested: true, ...(reason === undefined ? {} : { abortReason: reason }) };
}
/** A live owner's durable cancellation intent: its abort mark, or a held outcome other than `completed`. */
function cancellationIntent(record) {
    return record.state.status !== "terminal" && (record.abortRequested || failedOutcome(record));
}
/** Whether the record holds or ends with an outcome other than `completed`. */
function failedOutcome(record) {
    const state = record.state;
    return (state.status === "completing" || state.status === "terminal") && state.outcome.status !== "completed";
}
function parentOf(node) {
    return node.owner !== undefined ? { task: node.owner } : { conversation: node.conversationId };
}
function nodeOf(record) {
    return {
        conversationId: record.conversationId,
        ...(record.owner === undefined ? {} : { owner: record.owner }),
        background: record.background,
    };
}
function overlayOf(tx) {
    const tasks = new Map(tx.stagedTasks().map((record) => [record.id, record]));
    const edges = new Map(tx.stagedConversations().map((record) => [record.id, record.owner?.taskId ?? null]));
    return { tasks, edges };
}
function addTo(map, key, value) {
    const values = map.get(key);
    if (values === undefined)
        map.set(key, new Set([value]));
    else
        values.add(value);
}
function deleteFrom(map, key, value) {
    const values = map.get(key);
    if (values === undefined)
        return;
    values.delete(value);
    if (values.size === 0)
        map.delete(key);
}
/** Own memo entry only; memo names such as `toString` must not resolve to inherited properties. */
function memoOf(record, name) {
    const memos = record?.memos;
    return memos !== undefined && Object.hasOwn(memos, name) ? memos[name] : undefined;
}
/** Overloaded Session method bound for forwarding an argument list unchanged. */
function sessionMethod(session, name) {
    return session[name].bind(session);
}
function missingMigration(record, definition) {
    return new Error(`Task ${record.kind} version ${definition.version} has no migration from ${record.version}`);
}
function erased(task) {
    return task.definition;
}
function endedError(invocation) {
    return new Error(`Task ${invocation.taskId} invocation has ended`);
}
/** Replace a live record's state; memos disappear once an outcome is decided. */
function withState(record, state) {
    if (state.status !== "terminal" && state.status !== "completing")
        return { ...record, state };
    const { memos: _memos, ...rest } = record;
    return { ...rest, state };
}
/** Whether a definition can take the task at reservation: same version, or newer with a migration. */
function canReserve(task, record) {
    const definition = task.definition;
    return (definition.version === record.version || (definition.version > record.version && definition.migrate !== undefined));
}
function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
/** Structural equality of two JSON values; object key order is ignored. */
function jsonEqual(left, right) {
    if (left === right)
        return true;
    if (typeof left !== "object" || typeof right !== "object" || left === null || right === null)
        return false;
    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
            return false;
        return left.every((value, index) => jsonEqual(value, right[index]));
    }
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length)
        return false;
    return keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
}
//# sourceMappingURL=scheduler.js.map