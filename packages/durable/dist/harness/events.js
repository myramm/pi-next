import { CommittedWatch } from "../session/observation.js";
import { AgentDoc } from "./agent.js";
import { NestedCallDoc } from "./tool.js";
import { UsageDoc } from "./usage.js";
import { scanAll } from "./util.js";
import { conversationViews } from "./view.js";
function parts(view) {
    return {
        live: (view.docs["pi.live"] ?? {}),
        inbox: view.docs["pi.inbox"],
        agent: view.docs["pi.agent"],
        usage: view.docs["pi.usage"],
    };
}
function snapshotOf(view) {
    const { live, inbox, agent, usage } = parts(view);
    return {
        type: "snapshot",
        entries: view.entries,
        ...(live.run === undefined ? {} : { run: { inputs: live.run.inputs } }),
        ...(live.generation === undefined ? {} : { generation: live.generation }),
        tools: live.tools ?? [],
        nestedTools: live.nestedTools ?? [],
        compactions: live.compactions ?? [],
        ...(live.compactionFailure === undefined ? {} : { compactionFailure: live.compactionFailure }),
        inbox: queued(inbox),
        agent: agent ?? AgentDoc.definition.initial(),
        usage: usage ?? UsageDoc.definition.initial(),
    };
}
function queued(inbox) {
    return (inbox?.items ?? []).map((item) => ({ id: item.id, mode: item.mode }));
}
/**
 * Experimental: attach to one conversation's agent events (spec §9.4). The snapshot and the registration for later
 * commits are captured atomically on the Session line; overflow replaces undelivered batches with one snapshot.
 */
export async function watchEvents(harness, conversationId, context) {
    const views = conversationViews(harness);
    let watch;
    let snapshot;
    await views.attach(conversationId, async (initial, release, storage) => {
        // Generations whose held outcome already ended their turn, read on the line with the snapshot.
        const query = { conversationId, kind: "pi.generation", status: "completing" };
        const completing = await scanAll((cursor) => storage.scanTasks(query, 100, cursor, context));
        const held = new Set(completing.map((record) => record.id));
        let current = initial;
        snapshot = snapshotOf(initial);
        // Batches are the watch's values; an overflow delivers a snapshot of the newest view instead.
        watch = new CommittedWatch([], release, (error) => views.report(error), () => [snapshotOf(current)]);
        return {
            publication: (before, after, ops, publication, commitContext) => {
                current = after;
                const events = translate(conversationId, before, after, ops, publication, held);
                if (events.length > 0)
                    watch.advance(events, [], commitContext);
            },
            closeSession: (failure) => watch.closeSession(failure),
        };
    }, context);
    // Like a watch, the acquisition context governs the stream's lifetime.
    const signal = context.abortSignal;
    if (signal?.aborted) {
        watch.cancel();
        throw signal.reason;
    }
    if (signal !== undefined)
        watch.observeCancellation(signal);
    return {
        snapshot,
        start: (listener) => watch.start((events, _ops, deliveryContext) => listener(events, deliveryContext)),
        stop: () => watch.stop(),
        closed: watch.closed,
    };
}
/** The tool result for `callId` among `entries`. */
function resultOf(entries, callId) {
    return entries.find((entry) => {
        const message = entry.model?.[0];
        return message?.role === "toolResult" && message.toolCallId === callId;
    });
}
/** Every event one publication causes, in the order of spec §9.4. */
function translate(conversationId, before, after, viewOps, publication, held) {
    const entries = [];
    const tasks = new Map();
    const submissions = [];
    // Nested results this commit stored, by nested task ID; read now, since the caller's documents may retire next.
    const nestedResults = new Map();
    for (const change of publication.changes) {
        if (change.type === "document" &&
            change.record.kind === NestedCallDoc.definition.kind &&
            change.value !== null &&
            change.conversationId === conversationId) {
            const state = change.value;
            if (state.taskId !== undefined && state.result !== undefined) {
                nestedResults.set(state.taskId, state.result);
            }
        }
        if (change.type === "entry" && change.value.conversationId === conversationId)
            entries.push(change.value);
        if (change.type === "task" && change.value.conversationId === conversationId)
            tasks.set(change.value.id, change.value);
        if (change.type === "submission" && change.value.conversationId === conversationId) {
            submissions.push(change.value);
        }
    }
    if (viewOps.length === 0 && entries.length === 0 && tasks.size === 0 && submissions.length === 0)
        return [];
    // Entries are appended in ID order; submission records are published in the order the commit first touched them.
    submissions.sort((a, b) => a.id - b.id);
    const was = parts(before);
    const now = parts(after);
    const events = [];
    // Progress: tool starts, the in-flight message, tool updates, retry and deferred state.
    const slotsBefore = new Map((was.live.tools ?? []).map((slot) => [slot.callId, slot]));
    const slots = now.live.tools ?? [];
    const nestedBefore = new Map((was.live.nestedTools ?? []).map((slot) => [slot.taskId, slot]));
    const nested = now.live.nestedTools ?? [];
    for (const slot of [...slots, ...nested]) {
        const previous = "parentCallId" in slot ? nestedBefore.get(slot.taskId) : slotsBefore.get(slot.callId);
        if (slot.status !== "running" || previous?.status === "running")
            continue;
        // A nested slot carries the arguments the call runs with; a model-issued call's are in its intent checkpoint.
        const checkpoint = slot.taskId === undefined ? undefined : tasks.get(slot.taskId)?.state.checkpoint;
        const args = "parentCallId" in slot
            ? slot.arguments
            : (checkpoint?.arguments ?? {});
        events.push({ type: "tool_execution_start", ...callOf(slot), args });
    }
    const partialBefore = was.live.generation?.message;
    const partial = now.live.generation?.message;
    if (partial !== undefined && partialBefore === undefined)
        events.push({ type: "message_start", message: partial });
    else if (partial !== undefined && partial !== partialBefore) {
        events.push({ type: "message_update", usage: partial.usage, changes: messageChanges(viewOps, partial) });
    }
    for (const [index, slot] of slots.entries()) {
        const previous = slotsBefore.get(slot.callId);
        if (slot.status !== "running" || previous?.status !== "running")
            continue;
        const update = toolUpdate(viewOps, ["tools", index], slot, previous);
        if (update === undefined)
            continue;
        events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
    }
    for (const [index, slot] of nested.entries()) {
        const previous = nestedBefore.get(slot.taskId);
        if (slot.status !== "running" || previous?.status !== "running")
            continue;
        const update = toolUpdate(viewOps, ["nestedTools", index], slot, previous);
        if (update === undefined)
            continue;
        events.push({ type: "tool_execution_update", ...callOf(slot), ...update });
    }
    const generation = now.live.generation;
    const generationBefore = was.live.generation;
    if (generation?.retry !== undefined && generationBefore?.retry === undefined) {
        const { at, error } = generation.retry;
        events.push({ type: "auto_retry_start", attempt: generation.attempt, at, errorMessage: error });
    }
    if (generationBefore?.retry !== undefined && generation?.retry === undefined) {
        events.push({ type: "auto_retry_end", attempt: generationBefore.attempt });
    }
    if (generation?.deferred !== undefined && generation.deferred.pollAt !== generationBefore?.deferred?.pollAt) {
        events.push({ type: "deferred_poll", pollAt: generation.deferred.pollAt });
    }
    // Tools that end in this commit: a slot that becomes done, one created done (a call not offered), or an unfinished
    // one that vanishes because its run ended. A done slot that vanishes ended earlier.
    const toolEnds = [];
    const endTool = (slot, entryId) => {
        const entry = entries.find((candidate) => candidate.id === entryId);
        toolEnds.push({ type: "tool_execution_end", ...callOf(slot), ...(entry === undefined ? {} : { entry }) });
    };
    for (const previous of slotsBefore.values()) {
        if (previous.status === "done")
            continue;
        const slot = slots.find((candidate) => candidate.callId === previous.callId);
        if (slot?.status === "done")
            endTool(slot, slot.entry);
        // A slot whose run ended in this commit may have had its result appended with it, as for unstarted calls.
        else if (slot === undefined)
            endTool(previous, resultOf(entries, previous.callId)?.id);
    }
    for (const slot of slots) {
        if (slot.status === "done" && !slotsBefore.has(slot.callId))
            endTool(slot, slot.entry);
    }
    // Nested calls that end in this commit, the same way, children before the calls that made them: the lists hold
    // parents first, so walk them backwards.
    const endNested = (slot) => {
        const result = nestedResults.get(slot.taskId);
        events.push({ type: "tool_execution_end", ...callOf(slot), ...(result === undefined ? {} : { result }) });
    };
    const nestedNow = new Map(nested.map((slot) => [slot.taskId, slot]));
    for (const previous of [...nestedBefore.values()].reverse()) {
        if (previous.status === "done")
            continue;
        const slot = nestedNow.get(previous.taskId);
        if (slot?.status === "done" || slot === undefined)
            endNested(slot ?? previous);
    }
    for (const slot of [...nested].reverse()) {
        if (slot.status === "done" && !nestedBefore.has(slot.taskId))
            endNested(slot);
    }
    // Entries in append order; a tool's end directly precedes its result's message, as in the coding agent.
    let assistantAppended = false;
    for (const entry of entries) {
        events.push(...toolEnds.filter((end) => end.entry === entry));
        const message = entry.model?.[0];
        if (message === undefined) {
            events.push({ type: "entry_appended", entry });
            continue;
        }
        // A streamed answer already started with its first partial.
        const streamed = message.role === "assistant" && partialBefore !== undefined && !assistantAppended;
        if (message.role === "assistant")
            assistantAppended = true;
        if (!streamed)
            events.push({ type: "message_start", message });
        events.push({ type: "message_end", entry });
    }
    // Ends without a result entry: a faulted or orphaned tool, or one whose run ended.
    events.push(...toolEnds.filter((end) => end.entry === undefined));
    // Compaction ends, task failures, then turn and run ends.
    const compactionsBefore = was.live.compactions ?? [];
    const compactions = now.live.compactions ?? [];
    const failure = now.live.compactionFailure;
    for (const { taskId, reason } of compactionsBefore) {
        if (!compactions.some((status) => status.taskId === taskId)) {
            const error = failure?.taskId === taskId ? failure.error : undefined;
            events.push({ type: "compaction_end", taskId, reason, ...(error === undefined ? {} : { error }) });
        }
    }
    // A generation's turn ends when its outcome is committed: at a `completing` hold or at terminal, whichever comes
    // first, so a successor created at the hold starts after it.
    let turnEnded = false;
    for (const task of tasks.values()) {
        const status = task.state.status;
        if (task.kind === "pi.generation" && status === "completing" && !held.has(task.id)) {
            held.add(task.id);
            turnEnded = true;
        }
        if (status !== "terminal")
            continue;
        if (task.kind === "pi.generation" && !held.delete(task.id))
            turnEnded = true;
        const outcome = task.state.outcome;
        if (outcome.status === "faulted" || outcome.status === "orphaned") {
            const message = outcome.status === "faulted" ? outcome.error.message : outcome.reason;
            events.push({ type: "task_failed", taskId: task.id, kind: task.kind, message });
        }
    }
    if (turnEnded)
        events.push({ type: "turn_end" });
    const run = now.live.run;
    const runBefore = was.live.run;
    const runChanged = run?.inputs[0] !== runBefore?.inputs[0];
    if (runBefore !== undefined && runChanged)
        events.push({ type: "run_end", inputs: runBefore.inputs });
    // Submissions, document state, then what began.
    for (const record of submissions)
        events.push({ type: "submission", record });
    if (now.inbox !== was.inbox)
        events.push({ type: "inbox_update", items: queued(now.inbox) });
    // A retired document reads as its initial value, as in a snapshot.
    if (now.agent !== was.agent) {
        events.push({ type: "agent_changed", agent: now.agent ?? AgentDoc.definition.initial() });
    }
    if (now.usage !== was.usage)
        events.push({ type: "usage_changed", usage: now.usage ?? UsageDoc.definition.initial() });
    for (const { taskId, reason, blocking } of compactions) {
        if (!compactionsBefore.some((status) => status.taskId === taskId)) {
            events.push({ type: "compaction_start", taskId, reason, blocking });
        }
    }
    if (run !== undefined && runChanged)
        events.push({ type: "run_start", inputs: run.inputs });
    if (run !== undefined && run.taskId !== runBefore?.taskId && tasks.get(run.taskId)?.kind === "pi.generation") {
        events.push({ type: "turn_start" });
    }
    return events;
}
const PARTIAL_PATH = ["docs", "pi.live", "generation", "message"];
/** Translate the view operations on the in-flight message into message changes (spec §9.4). */
function messageChanges(viewOps, message) {
    const changes = [];
    // A block sent whole already holds every later change to it in this batch.
    const whole = new Set();
    for (const op of viewOps) {
        // View operations never replace the root.
        const path = op[1];
        if (!startsWith(path, PARTIAL_PATH)) {
            // The whole message or generation was replaced.
            if (startsWith(PARTIAL_PATH, path))
                return [{ type: "message", message }];
            continue;
        }
        const rest = path.slice(PARTIAL_PATH.length);
        if (rest[0] === "usage")
            continue;
        if (rest[0] !== "content")
            return [{ type: "message", message }];
        if (rest.length === 1) {
            if (op[0] !== "p" || op[3] !== 0)
                return [{ type: "message", message }];
            for (const [offset, block] of op[4].entries()) {
                const type = block.type === "text" ? "text_start" : block.type === "thinking" ? "thinking_start" : "toolcall_start";
                changes.push({ type, contentIndex: op[2] + offset, block });
            }
            continue;
        }
        const contentIndex = rest[1];
        const field = rest[2];
        if (whole.has(contentIndex))
            continue;
        if (op[0] === "a" && rest.length === 3 && (field === "text" || field === "thinking")) {
            changes.push({ type: field === "text" ? "text_delta" : "thinking_delta", contentIndex, delta: op[2] });
        }
        else if (op[0] === "a" && field === "arguments") {
            changes.push({ type: "toolcall_delta", contentIndex, path: rest.slice(3), delta: op[2] });
        }
        else {
            whole.add(contentIndex);
            changes.push({ type: "block", contentIndex, block: message.content[contentIndex] });
        }
    }
    return changes;
}
/** The identifying fields of a slot's tool events. */
function callOf(slot) {
    return {
        toolCallId: slot.callId,
        toolName: slot.name,
        ...(slot.taskId === undefined ? {} : { taskId: slot.taskId }),
        ...("parentCallId" in slot ? { parentToolCallId: slot.parentCallId, parentTaskId: slot.parentTaskId } : {}),
    };
}
/** Output, details, and diagnostics changes of a running slot at `at` in `pi.live`, from the view operations on it. */
function toolUpdate(viewOps, at, slot, previous) {
    const outputPath = ["docs", "pi.live", ...at, "output"];
    let trimStart = 0;
    let append = "";
    let set = false;
    for (const op of viewOps) {
        if (!startsWith(op[1], outputPath))
            continue;
        if (op[0] === "t")
            trimStart += op[2];
        else if (op[0] === "a")
            append += op[2];
        else
            set = true;
    }
    let output;
    if (set || (slot.output !== previous.output && trimStart === 0 && append === ""))
        output = { set: slot.output ?? "" };
    else if (trimStart > 0 || append !== "") {
        output = { ...(trimStart > 0 ? { trimStart } : {}), ...(append === "" ? {} : { append }) };
    }
    // A safe replay clears a running slot's progress: removed details send `null`, removed diagnostics `[]`.
    const update = {
        ...(output === undefined ? {} : { output }),
        ...(slot.details === previous.details ? {} : { details: slot.details ?? null }),
        ...(slot.diagnostics === previous.diagnostics ? {} : { diagnostics: slot.diagnostics ?? [] }),
    };
    return Object.keys(update).length === 0 ? undefined : update;
}
function startsWith(path, prefix) {
    return prefix.length <= path.length && prefix.every((segment, index) => path[index] === segment);
}
//# sourceMappingURL=events.js.map