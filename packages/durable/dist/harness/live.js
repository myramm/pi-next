import { defineDoc } from "../documents.js";
import { convertPartial } from "./generation.js";
export const LiveDoc = defineDoc({
    kind: "pi.live",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({}),
    // REMINDER: a complete base whenever nothing runs (spec §8.2): no generation and no running tool slot. That holds
    // while idle, in the commit handing a generation over to its tool round, and between tools, so the delta chain
    // spans at most one generation or the overlapping execution of one round's tools. A slot holds output only while
    // running, so every base is small; a nested call's result lives in its caller's task documents, never here. Do not
    // add a delta-count bound; the tool output benchmark checks this rule.
    checkpointWhen: (value) => value.generation === undefined &&
        !(value.tools ?? []).some((slot) => slot.status === "running") &&
        !(value.nestedTools ?? []).some((slot) => slot.status === "running"),
});
/** Built-in task kinds that can own `pi.live.run`. */
const RUN_TASK_KINDS = new Set(["pi.generation"]);
const TOOL_TASK_KIND = "pi.tool";
const COMPACTION_TASK_KIND = "pi.compaction";
/**
 * End the run owned by `taskId`: settle each of its inputs and remove `run`. Always removes `generation`, `tools`, and
 * `nestedTools`, whose presentation belongs to the ending run.
 */
export function endRun(tx, live, taskId, settlement) {
    if (live.run?.taskId === taskId) {
        for (const id of live.run.inputs)
            tx.settleSubmission(id, settlement);
        delete live.run;
    }
    delete live.generation;
    delete live.tools;
    delete live.nestedTools;
}
/** Add the status of a compaction task created in this commit; statuses stay in task ID order. */
export function addCompactionStatus(live, status) {
    live.compactions ??= [];
    live.compactions.push(status);
}
/** The status of compaction task `taskId`, if listed. */
export function compactionStatus(live, taskId) {
    return live.compactions?.find((status) => status.taskId === taskId);
}
/** Remove the status of compaction task `taskId`, and the list once empty. */
export function removeCompactionStatus(live, taskId) {
    const statuses = live.compactions;
    if (statuses === undefined)
        return;
    const index = statuses.findIndex((status) => status.taskId === taskId);
    if (index >= 0)
        statuses.splice(index, 1);
    if (statuses.length === 0)
        delete live.compactions;
}
/** Remove the status of compaction task `taskId` and record that it failed with `error`. */
export function failCompactionStatus(live, taskId, error) {
    const status = compactionStatus(live, taskId);
    if (status !== undefined)
        live.compactionFailure = { taskId: status.taskId, reason: status.reason, error };
    removeCompactionStatus(live, taskId);
}
/**
 * The slot of tool task `taskId`, model-issued or nested, if `pi.live` still lists it. Nested slots are found by binary
 * search: a tool may make thousands of nested calls, each of which looks up its slot in several commits, and every
 * element a search reads costs a node in the draft's change tracker. Their task IDs ascend: each slot is appended in
 * the commit that creates its task, task IDs ascend in commit order, and removal keeps the order.
 */
export function toolSlot(live, taskId) {
    const slot = live.tools?.find((each) => each.taskId === taskId);
    if (slot !== undefined || live.nestedTools === undefined)
        return slot;
    const nested = live.nestedTools;
    let low = 0;
    let high = nested.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const candidate = nested[middle];
        if (candidate.taskId === taskId)
            return candidate;
        if (candidate.taskId < taskId)
            low = middle + 1;
        else
            high = middle - 1;
    }
    return undefined;
}
/**
 * Mark a slot done and clear its running output; the caller sets a model-issued call's result `entry`, or a nested
 * call's `summary`. Neither is set when the task faulted or was orphaned.
 */
export function finishSlot(slot) {
    slot.status = "done";
    clearProgress(slot);
}
/** Remove the nested slots below tool task `taskId`, transitively; the list holds parents before their children. */
export function removeNestedSlots(live, taskId) {
    const nested = live.nestedTools;
    if (nested === undefined)
        return;
    const removed = new Set([taskId]);
    for (const slot of nested)
        if (removed.has(slot.parentTaskId))
            removed.add(slot.taskId);
    for (let index = nested.length - 1; index >= 0; index--) {
        if (removed.has(nested[index].parentTaskId))
            nested.splice(index, 1);
    }
    if (nested.length === 0)
        delete live.nestedTools;
}
/** Remove what a tool published while running; its result entry or a rerun replaces it. */
export function clearProgress(slot) {
    delete slot.output;
    delete slot.droppedBytes;
    delete slot.droppedLines;
    delete slot.details;
    delete slot.diagnostics;
}
/**
 * Harness cleanup for a terminal outcome the scheduler writes itself (`faulted` or `orphaned`). A run task ends its
 * run; a tool task's slot is marked done without an entry, and context derivation synthesizes the missing result; a
 * compaction task's status is removed and its failure recorded.
 * Ignores other kinds so it never creates `pi.live` elsewhere. The scheduler calls this without knowing task kinds;
 * the Harness passes it in (spec §5.4).
 * REMINDER: a committed generation partial becomes an aborted assistant entry here, exactly as in the generation abort
 * handler, so the transcript keeps what the model produced and `pi.usage` counts its spend. The scheduler's commit has
 * no task scope, so that entry has no `byTaskId`. Faults come from task bugs
 * or malformed provider data (a non-JSON value in a response), or a commit the Storage rejected without effect; an
 * uncertain storage failure poisons the Session instead and writes no outcome.
 */
export async function settleSchedulerOutcome(tx, record, outcome) {
    if (record.kind === TOOL_TASK_KIND) {
        const live = await tx.doc(LiveDoc, record.conversationId);
        const slot = toolSlot(live, record.id);
        if (slot !== undefined)
            finishSlot(slot);
        removeNestedSlots(live, record.id);
        return;
    }
    if (record.kind === COMPACTION_TASK_KIND) {
        const error = outcome.status === "faulted" ? outcome.error.message : outcome.reason;
        failCompactionStatus(await tx.doc(LiveDoc, record.conversationId), record.id, error);
        return;
    }
    if (!RUN_TASK_KINDS.has(record.kind))
        return;
    const live = await tx.doc(LiveDoc, record.conversationId);
    if (live.run?.taskId !== record.id)
        return;
    await convertPartial(tx, live, record.conversationId);
    endRun(tx, live, record.id, outcome.status === "faulted"
        ? { status: "unanswered", reason: "faulted", detail: outcome.error.message }
        : { status: "unanswered", reason: outcome.reason });
}
//# sourceMappingURL=live.js.map