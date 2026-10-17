import { copyJson } from "@earendil-works/chord";
import { isContextOverflow } from "@earendil-works/pi-ai/utils/overflow";
import { isRetryableAssistantError, retryDelayMs } from "@earendil-works/pi-ai/utils/retry";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { AssistantEntry, ResetEntry, SystemEntry, UserEntry } from "../entries.js";
import { defineTask } from "../tasks.js";
import { addTools } from "./agent.js";
import { compactionPolicy, createCompaction, estimateContext, selectCut } from "./compaction.js";
import { applyBoundary, prepareBoundary } from "./inbox.js";
import { assignJson } from "./json.js";
import { endRun, LiveDoc } from "./live.js";
import { planSystemEntries, renderSections, replaySections } from "./prompt.js";
import { ensureProviderSessionId } from "./provider.js";
import { appendToolResult, harnessError, ToolTask } from "./tool.js";
import { recordUsage } from "./usage.js";
const DEFAULT_POLL_AFTER_MS = 5000;
/**
 * Built-in generation task: prepares the positional system prompt and tool loadout, requests or polls the model,
 * retries, and classifies the response. The run's inputs live in `pi.live.run`.
 */
export const GenerationTask = defineTask({
    name: "pi.generation",
    version: 1,
    initial: () => ({ phase: "prepare", attempt: 1 }),
    phases: {
        /**
         * Render the system prompt and tool loadout and append the positional `pi.system` entries they need, then move to
         * `request`. The agent and settings resolved here are fixed for this request. Only the Harness writes model
         * context to a busy conversation, so the context read here is still current at the commit; display-only entries
         * may land meanwhile.
         */
        prepare: async (task, runtime, context) => {
            const { conversationId } = runtime;
            const agent = await runtime.agent(context);
            const settings = runtime.settings;
            const { model, thinkingLevel } = agent;
            const resolved = model === undefined ? undefined : runtime.models.getModel(model.provider, model.modelId);
            if (model === undefined || resolved === undefined)
                return failNoModel(runtime, model, context);
            const { attempt, compacted, overflow, threshold: blocked } = task.state.checkpoint;
            if (compacted !== undefined && overflow !== undefined) {
                const [outcome] = await runtime.outcomes([compacted], context);
                if (outcome?.status !== "completed" || outcome.result.entryId === undefined) {
                    return failModelError(runtime, overflow, context);
                }
            }
            // A threshold compaction that found nothing to compact or was declined leaves a request that may still fit. One
            // that failed left a context it judged too large: sending it would at best leave no room for the answer.
            if (compacted !== undefined && blocked === true) {
                const [outcome] = await runtime.outcomes([compacted], context);
                if (outcome !== undefined && outcome.status !== "completed") {
                    return failModelError(runtime, compactionFailure(outcome), context);
                }
            }
            const view = await runtime.context(conversationId, context);
            const shown = replaySections(view.messages);
            const report = (error) => runtime.report(error);
            let env;
            try {
                env = await runtime.env(context);
            }
            catch (error) {
                if (context.abortSignal?.aborted)
                    throw error;
                report(error);
            }
            const input = { conversationId, agent, env, shown: Object.fromEntries(shown), read: runtime };
            const desired = await renderSections(agent.sections, input, shown, report, context);
            const entries = planSystemEntries(view, desired, agent.tools, runtime.now());
            const threshold = compacted === undefined
                ? thresholdCompaction(view, entries, resolved.contextWindow, compactionPolicy(settings, model))
                : undefined;
            if (threshold === "blocking") {
                // Compact first and prepare again; the transcript is unchanged until the compaction appends.
                await runtime.commit(async (tx) => {
                    const child = await createCompaction(tx, conversationId, { reason: "threshold" }, runtime.taskId);
                    const checkpoint = { phase: "prepare", attempt, compacted: child, threshold: true };
                    return { status: "waiting", checkpoint, on: [child], policy: "allSettled" };
                }, context);
                return;
            }
            await runtime.commit(async (tx) => {
                let cutoff = (await tx.scanEntries({ conversationId }, 1)).items[0]?.id;
                for (const entry of entries)
                    cutoff = (await tx.appendEntry(SystemEntry, conversationId, entry)).id;
                if (cutoff === undefined)
                    throw new Error(`Conversation ${conversationId} has no entries to send`);
                // Checked in this commit, so a compaction admitted during preparation counts.
                if (threshold === "background" && (await tx.doc(LiveDoc, conversationId)).compactions === undefined) {
                    await createCompaction(tx, conversationId, { reason: "threshold" });
                }
                const request = {
                    attempt,
                    ...(compacted === undefined ? {} : { compacted }),
                    model,
                    thinkingLevel,
                    streamOptions: settings.stream,
                    cutoff,
                };
                return { status: "running", checkpoint: { phase: "request", ...request } };
            }, context);
        },
        request: async (task, runtime, context) => {
            const { attempt, compacted, model: ref, thinkingLevel, streamOptions, cutoff } = task.state.checkpoint;
            const conversationId = runtime.conversationId;
            await runtime.commit(async (tx) => {
                const live = await tx.doc(LiveDoc, conversationId);
                await convertPartial(tx, live, conversationId);
                live.generation = { attempt };
                return undefined;
            }, context);
            const model = runtime.models.getModel(ref.provider, ref.modelId);
            if (model === undefined)
                return failNoModel(runtime, ref, context);
            const view = await runtime.context(conversationId, context, { at: cutoff });
            let messages = view.messages;
            await runtime.hooks.each("beforeRequest", async (hook) => {
                const replaced = await hook({ messages }, runtime, context);
                if (replaced !== undefined)
                    messages = replaced.messages;
            });
            const options = {
                ...streamOptions,
                signal: runtime.signal,
                sessionId: await ensureProviderSessionId(runtime, context),
                ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
            };
            const message = await streamResponse(runtime, model, messages, options, attempt, context);
            const request = { attempt, compacted, model: ref, cutoff, messages: view.messages };
            await classify(runtime, request, message, context);
        },
        retry: async (task, runtime, context) => {
            const { attempt, compacted, until } = task.state.checkpoint;
            await runtime.sleep(until, context);
            await runtime.commit(async (tx) => {
                (await tx.doc(LiveDoc, runtime.conversationId)).generation = { attempt: attempt + 1 };
                const checkpoint = {
                    phase: "prepare",
                    attempt: attempt + 1,
                    ...(compacted === undefined ? {} : { compacted }),
                };
                return { status: "running", checkpoint };
            }, context);
        },
        poll: async (task, runtime, context) => {
            const { attempt, compacted, model: ref, cutoff, handle, pollAt } = task.state.checkpoint;
            const model = runtime.models.getModel(ref.provider, ref.modelId);
            if (model === undefined)
                return failNoModel(runtime, ref, context);
            await runtime.sleep(pollAt, context);
            const message = await runtime.models.fetchDeferred(model, handle, { signal: runtime.signal });
            const request = { attempt, compacted, model: ref, cutoff, pollAt };
            await classify(runtime, request, message, context);
        },
        tools: async (task, runtime, context) => {
            const { assistant, tools, pending } = task.state.checkpoint;
            const [next, ...rest] = pending;
            if (next === undefined)
                return finishToolRound(runtime, assistant, tools, context);
            // Sequential round: start the next call and wait for it.
            await runtime.commit(async (tx) => {
                const live = await tx.doc(LiveDoc, runtime.conversationId);
                const taskId = await createToolTask(tx, runtime, assistant, next);
                const slot = live.tools?.find((slot) => slot.callId === next && slot.taskId === undefined);
                if (slot !== undefined)
                    slot.taskId = taskId;
                const checkpoint = {
                    phase: "tools",
                    assistant,
                    tools: [...tools, taskId],
                    pending: rest,
                };
                return { status: "waiting", checkpoint, on: [taskId], policy: "allSettled" };
            }, context);
        },
    },
    abort: async (task, runtime, context) => {
        const checkpoint = task.state.checkpoint;
        if (checkpoint.phase === "poll") {
            const model = runtime.models.getModel(checkpoint.model.provider, checkpoint.model.modelId);
            if (model !== undefined) {
                try {
                    await runtime.models.cancelDeferred(model, checkpoint.handle, { signal: runtime.signal });
                }
                catch (error) {
                    runtime.report(error);
                }
            }
        }
        const conversationId = runtime.conversationId;
        // Runs after the round's tool tasks are terminal; calls never started get `aborted` results (spec §8.5).
        const unstarted = checkpoint.phase === "tools"
            ? await readCalls(runtime, checkpoint.assistant, checkpoint.pending, context)
            : [];
        await runtime.commit(async (tx) => {
            const live = await tx.doc(LiveDoc, conversationId);
            await convertPartial(tx, live, conversationId);
            for (const call of unstarted) {
                const result = harnessError("aborted", `Tool ${call.name} was aborted`);
                await appendToolResult(tx, conversationId, call, result, { timestamp: runtime.now() });
            }
            endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "aborted" });
            return { status: "terminal", outcome: { status: "aborted" } };
        }, context);
    },
});
/** The calls `callIds` of the assistant entry, in the given order. */
async function readCalls(runtime, assistant, callIds, context) {
    const message = (await runtime.entry(AssistantEntry, assistant, context))?.model?.[0];
    const calls = message?.role === "assistant" ? message.content.filter((content) => content.type === "toolCall") : [];
    return callIds.flatMap((id) => calls.filter((call) => call.id === id).slice(0, 1));
}
/** A tool task for call `callId`, owned by the generation. */
function createToolTask(tx, runtime, assistant, callId) {
    return tx.createTask(ToolTask, { kind: "model", assistant, callId }, { ownership: { kind: "task", taskId: runtime.taskId } });
}
/**
 * Which threshold compaction preparation starts before its request (spec §8.3): `blocking` above
 * `contextWindow - reserveTokens`, `background` above the background threshold, and only when range selection finds a
 * cut. The caller starts a background one only while no compaction is listed.
 */
function thresholdCompaction(view, planned, contextWindow, policy) {
    if (!policy.enabled || contextWindow <= 0)
        return undefined;
    const tokens = estimateContext(view, planned.flatMap((entry) => entry.model ?? []));
    const blocking = contextWindow - policy.reserveTokens;
    const background = blocking - policy.backgroundTokens;
    const over = tokens > blocking ? "blocking" : policy.backgroundTokens > 0 && tokens > background ? "background" : undefined;
    if (over === undefined || selectCut(view, policy.keepRecentTokens) === undefined)
        return undefined;
    return over;
}
/** Error text for a generation whose blocking compaction ended without completing. */
function compactionFailure(outcome) {
    switch (outcome.status) {
        case "failed":
        case "faulted":
            return `Compaction failed: ${outcome.error.message}`;
        case "orphaned":
            return `Compaction failed: ${outcome.reason}`;
        case "aborted":
            return "Compaction was aborted";
    }
}
/** Settle the run's inputs `unanswered` with `model_error` and fail with `text`. */
async function failModelError(runtime, text, context) {
    await runtime.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, runtime.conversationId);
        endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "model_error", detail: text });
        return {
            status: "terminal",
            outcome: { status: "failed", error: { message: text, detail: { reason: "model_error" } } },
        };
    }, context);
}
/** Settle the run's inputs `unanswered` with `no_model` and fail. */
async function failNoModel(runtime, ref, context) {
    const message = ref === undefined ? "No model is configured" : `Model ${ref.provider}/${ref.modelId} is not available`;
    await runtime.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, runtime.conversationId);
        endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "no_model" });
        return { status: "terminal", outcome: { status: "failed", error: { message, detail: { reason: "no_model" } } } };
    }, context);
}
/**
 * Append a committed partial left by an interrupted, aborted, faulted, or orphaned attempt as an aborted assistant
 * entry; the caller replaces or removes `generation`.
 */
export async function convertPartial(tx, live, conversationId) {
    const partial = live.generation?.message;
    if (partial === undefined)
        return;
    const message = copyJson(partial);
    await appendAssistant(tx, conversationId, { ...message, stopReason: "aborted" });
}
/**
 * Stream one request and return the terminal message. Partials commit as trailing writes at most every
 * `progress.partialIntervalMs` (default 100 ms) with one commit in flight; `finally` stops the throttle and awaits that
 * commit, so no stale partial lands after the outcome.
 */
async function streamResponse(runtime, model, messages, options, attempt, context) {
    const interval = runtime.settings.progress.partialIntervalMs;
    let pending;
    let timer;
    let inFlight;
    let stopped = false;
    const flush = () => {
        timer = undefined;
        const partial = pending;
        pending = undefined;
        if (partial === undefined || stopped)
            return;
        inFlight = (async () => {
            // Copy synchronously: the provider keeps mutating its partial.
            const message = copyJson(partial, { omitUndefinedProperties: true });
            await runtime.commit(async (tx) => {
                const live = await tx.doc(LiveDoc, runtime.conversationId);
                live.generation ??= { attempt };
                assignJson(live.generation, "message", message);
                return undefined;
            }, context);
        })()
            .catch((error) => {
            // Rejections after an abort mark or close are expected; the committed state stays consistent.
            if (!runtime.signal.aborted)
                runtime.report(error);
        })
            .finally(() => {
            inFlight = undefined;
            if (pending !== undefined && !stopped)
                timer = setTimeout(flush, interval);
        });
    };
    try {
        const events = runtime.models.streamSimple(model, { messages: [...messages] }, options);
        for await (const event of events) {
            // A partial without content, such as pi-ai's opening `start` event, shows nothing; a deferred response
            // never gets past it, so it never leaves a partial.
            if (event.type === "done" || event.type === "error" || event.partial.content.length === 0)
                continue;
            pending = event.partial;
            if (timer === undefined && inFlight === undefined)
                timer = setTimeout(flush, interval);
        }
        return await events.result();
    }
    finally {
        stopped = true;
        clearTimeout(timer);
        await inFlight;
    }
}
/** Classify a terminal provider message in one commit that also clears the partial. */
async function classify(runtime, request, message, context) {
    // An abort mark or close: the abort invocation or the reopened run handles the committed state.
    runtime.signal.throwIfAborted();
    const conversationId = runtime.conversationId;
    const { attempt, compacted, model: ref, cutoff } = request;
    if (message.stopReason === "deferred" && message.deferred !== undefined) {
        const handle = message.deferred;
        const pollAt = Math.max(runtime.now() + (handle.pollAfterMs ?? DEFAULT_POLL_AFTER_MS), request.pollAt === undefined ? Number.NEGATIVE_INFINITY : request.pollAt + 1);
        await runtime.commit(async (tx) => {
            (await tx.doc(LiveDoc, conversationId)).generation = { attempt, deferred: { pollAt } };
            const checkpoint = {
                phase: "poll",
                attempt,
                ...(compacted === undefined ? {} : { compacted }),
                model: ref,
                cutoff,
                handle,
                pollAt,
            };
            return { status: "running", checkpoint };
        }, context);
        return;
    }
    await runtime.hooks.each("afterResponse", (hook) => hook(message, runtime, context));
    const calls = message.content.filter((content) => content.type === "toolCall");
    if (message.stopReason === "toolUse" && calls.length > 0) {
        return startToolRound(runtime, request, message, calls, context);
    }
    if (message.stopReason === "stop" || message.stopReason === "length" || message.stopReason === "toolUse") {
        return answer(runtime, message, context);
    }
    // The retry and compaction policies govern the next attempt, so they are read now rather than pinned at preparation.
    const settings = runtime.settings;
    const overflow = message.stopReason === "error" && isContextOverflow(message);
    const compaction = compactionPolicy(settings, ref);
    if (overflow && compacted === undefined && compaction.enabled) {
        const view = await runtime.context(conversationId, context, { at: cutoff });
        if (selectCut(view, compaction.keepRecentTokens) !== undefined) {
            const text = message.errorMessage ?? "Context overflow";
            await runtime.commit(async (tx) => {
                const live = await tx.doc(LiveDoc, conversationId);
                await appendAssistant(tx, conversationId, message);
                delete live.generation;
                const child = await createCompaction(tx, conversationId, { reason: "overflow" }, runtime.taskId);
                const checkpoint = { phase: "prepare", attempt, compacted: child, overflow: text };
                return { status: "waiting", checkpoint, on: [child], policy: "allSettled" };
            }, context);
            return;
        }
    }
    const policy = settings.retry;
    // An overflow is never retried: only a compaction can make the next request fit.
    const retry = message.stopReason === "error" &&
        !overflow &&
        isRetryableAssistantError(message) &&
        policy.enabled &&
        attempt <= policy.maxRetries;
    const until = retry ? runtime.now() + retryDelayMs(policy, attempt) : 0;
    await runtime.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, conversationId);
        await appendAssistant(tx, conversationId, message);
        if (retry) {
            live.generation = { attempt, retry: { at: until, error: message.errorMessage ?? "" } };
            const checkpoint = {
                phase: "retry",
                attempt,
                ...(compacted === undefined ? {} : { compacted }),
                until,
            };
            return { status: "running", checkpoint };
        }
        const text = message.errorMessage ?? `Model response ended with stop reason ${message.stopReason}`;
        endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "model_error", detail: text });
        return {
            status: "terminal",
            outcome: { status: "failed", error: { message: text, detail: { reason: "model_error" } } },
        };
    }, context);
}
/**
 * A final answer; the final boundary places queued items (spec §6). The first `onYield` continuation appends a user
 * message and hands the run to a successor generation, but only when the boundary selected no user item and no reset.
 * Otherwise the run's inputs settle `done`, and selected user items start the next run.
 */
async function answer(runtime, message, context) {
    let continuation;
    await runtime.hooks.each("onYield", async (hook) => {
        if (continuation !== undefined)
            return;
        continuation = (await hook(message, runtime, context))?.continue;
    });
    const conversationId = runtime.conversationId;
    await runtime.commit(async (tx) => {
        // Queue modes are read on the Session line, when the boundary is decided.
        const boundary = await prepareBoundary(tx, conversationId, runtime.settings);
        const live = await tx.doc(LiveDoc, conversationId);
        const entry = await appendAssistant(tx, conversationId, message);
        const result = { status: "terminal", outcome: { status: "completed", result: { entryId: entry.id } } };
        const { users, reset } = await applyBoundary(tx, boundary, "final", runtime.now());
        if (continuation !== undefined && users.length === 0 && !reset) {
            const user = { role: "user", content: continuation, timestamp: runtime.now() };
            await tx.appendEntry(UserEntry, conversationId, { model: [user] });
            handOver(live, runtime.taskId, await createGeneration(tx, conversationId));
            delete live.generation;
            return result;
        }
        endRun(tx, live, runtime.taskId, { status: "done", answer: entry.id });
        if (users.length > 0)
            await startRun(tx, conversationId, live, users);
        return result;
    }, context);
}
/**
 * Append the tool-calling answer and start its tool round in one commit (spec §8.3). A call to a tool the request did
 * not offer gets its `tool_unavailable` result here; every other call gets a tool task owned by the generation, only the
 * first one now when the round is sequential. The generation then waits for them in its `tools` phase, keeping the run.
 */
async function startToolRound(runtime, request, message, calls, context) {
    const conversationId = runtime.conversationId;
    const messages = request.messages ?? (await runtime.context(conversationId, context, { at: request.cutoff })).messages;
    const offered = new Set(getCurrentTools(messages).map((tool) => tool.name));
    // Read as the round starts; a tool is resolved as its tool task resolves it.
    const tools = (await runtime.agent(context)).tools;
    const sequential = runtime.settings.toolExecution === "sequential" ||
        calls.some((call) => offered.has(call.name) && tools.find((tool) => tool.name === call.name)?.executionMode === "sequential");
    await runtime.commit(async (tx) => {
        const live = await tx.doc(LiveDoc, conversationId);
        const entry = await appendAssistant(tx, conversationId, message);
        const slots = [];
        const tools = [];
        const pending = [];
        for (const call of calls) {
            if (!offered.has(call.name)) {
                const unavailable = harnessError("tool_unavailable", `Tool ${call.name} is not available`);
                const result = await appendToolResult(tx, conversationId, call, unavailable, { timestamp: runtime.now() });
                slots.push({ callId: call.id, name: call.name, status: "done", entry: result.id });
                continue;
            }
            if (sequential && tools.length > 0) {
                pending.push(call.id);
                slots.push({ callId: call.id, name: call.name, status: "pending" });
                continue;
            }
            const taskId = await createToolTask(tx, runtime, entry.id, call.id);
            tools.push(taskId);
            slots.push({ callId: call.id, name: call.name, taskId, status: "pending" });
        }
        delete live.generation;
        live.tools = slots;
        const checkpoint = { phase: "tools", assistant: entry.id, tools, pending };
        return { status: "waiting", checkpoint, on: tools, policy: "allSettled" };
    }, context);
}
/**
 * The round's tools are terminal: apply their controls and either end the run at the final boundary (`terminate`,
 * `handoff`, or a queued reset) or hand it to the next generation at the `postTools` boundary (spec §8.5).
 */
async function finishToolRound(runtime, assistant, tools, context) {
    const conversationId = runtime.conversationId;
    const controls = new Map();
    const outcomes = await runtime.outcomes(tools, context);
    tools.forEach((id, index) => {
        const outcome = outcomes[index];
        // Version 1 results have no kind; every result a generation's round reads is a model-issued call's.
        controls.set(id, outcome.status === "completed" && outcome.result.kind !== "nested" ? outcome.result.control : undefined);
    });
    const slots = (await runtime.snapshot(LiveDoc, conversationId, context))?.tools ?? [];
    const results = slots.flatMap((slot) => (slot.entry === undefined ? [] : [slot.entry]));
    await runtime.hooks.each("afterTools", (hook) => hook(assistant, results, runtime, context));
    // Every call of the round, including those answered without a task, must ask to terminate.
    const terminate = slots.length > 0 &&
        slots.every((slot) => slot.taskId !== undefined && controls.get(slot.taskId)?.terminate === true);
    const added = [...controls.values()].flatMap((control) => control?.addTools ?? []);
    // The last handoff in call order wins.
    const handoff = [...controls.values()].findLast((control) => control?.handoff !== undefined)?.handoff;
    await runtime.commit(async (tx) => {
        const boundary = await prepareBoundary(tx, conversationId, runtime.settings);
        if (added.length > 0)
            await addTools(tx, conversationId, added);
        const live = await tx.doc(LiveDoc, conversationId);
        const now = runtime.now();
        if (terminate || handoff !== undefined) {
            if (handoff !== undefined) {
                const message = { role: "user", content: handoff, timestamp: now };
                const entry = await tx.appendEntry(ResetEntry, conversationId, { head: "self", model: [message] });
                boundary.head = entry.id;
            }
            const { users } = await applyBoundary(tx, boundary, "final", now);
            endRun(tx, live, runtime.taskId, { status: "done", answer: assistant });
            if (users.length > 0)
                await startRun(tx, conversationId, live, users);
        }
        else {
            const { users, reset } = await applyBoundary(tx, boundary, "postTools", now);
            if (reset) {
                // The queued reset cut the run's context before an answer.
                endRun(tx, live, runtime.taskId, { status: "unanswered", reason: "reset" });
                if (users.length > 0)
                    await startRun(tx, conversationId, live, users);
            }
            else {
                delete live.tools;
                delete live.nestedTools;
                if (live.run?.taskId === runtime.taskId)
                    live.run.inputs.push(...users);
                handOver(live, runtime.taskId, await createGeneration(tx, conversationId));
            }
        }
        return { status: "terminal", outcome: { status: "completed", result: { entryId: assistant } } };
    }, context);
}
/**
 * Append a provider result and add its usage to `pi.usage` in the same commit.
 * REMINDER: every built-in writer of assistant entries goes through here, so the usage ledger stays complete.
 */
async function appendAssistant(tx, conversationId, message) {
    await recordUsage(tx, conversationId, "models", `${message.provider}/${message.model}`, message.usage);
    return tx.appendEntry(AssistantEntry, conversationId, { model: [message] });
}
/** Start a run for `inputs`, placed input submissions: a new generation takes `pi.live.run`. */
export async function startRun(tx, conversationId, live, inputs) {
    live.run = { taskId: await createGeneration(tx, conversationId), inputs };
}
/** A generation owned by its conversation. */
function createGeneration(tx, conversationId) {
    return tx.createTask(GenerationTask, {}, { ownership: { kind: "conversation" }, conversationId });
}
/** Hand run control from `from` to `to`; the run's inputs move with it. */
export function handOver(live, from, to) {
    if (live.run?.taskId === from)
        live.run.taskId = to;
}
//# sourceMappingURL=generation.js.map