import type { Draft, JsonRepresentation, JsonValue } from "@earendil-works/chord";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { Transaction } from "../session/transaction.ts";
import type { EntryId, JsonObject, SubmissionId, SubmissionSettlement, TaskId, TaskRecord, Tx } from "../types.ts";
import type { SchedulerOutcome } from "./scheduler.ts";
import type { CompactionReason, CompactionResult, ToolDiagnostic } from "./types.ts";
/** What a running tool call publishes, shared by model-issued and nested calls. */
type SlotProgress = {
    callId: string;
    name: string;
    status: "pending" | "running" | "done";
    /** Retained running output and what the bounds dropped. */
    output?: string;
    droppedBytes?: number;
    droppedLines?: number;
    /** Last `details()` value. */
    details?: JsonValue;
    /** Diagnostics recorded through `api.diagnostic()`. */
    diagnostics?: ToolDiagnostic[];
};
/** Presentation of one tool call of the current round. */
export type ToolSlot = SlotProgress & {
    /**
     * Absent for a call not started yet (sequential round) and for a call its request did not offer, which starts `done`
     * with the `entry` generation wrote.
     */
    taskId?: TaskId;
    /** Result entry once done; absent when the tool task faulted or was orphaned. */
    entry?: EntryId;
};
/**
 * Presentation of one nested call: a call a running tool made through `executeTool()`. `callId` is
 * `<parentCallId>/<key>`, the call's ID in tool events and unique because keys contain no `/`. The Harness relates
 * slots by task ID: `taskId` is the call's tool task, `parentTaskId` the calling one, model-issued or nested.
 */
export type NestedToolSlot = SlotProgress & {
    parentCallId: string;
    parentTaskId: TaskId;
    taskId: TaskId;
    /**
     * What the call was made with, replaced by the arguments it runs with, after repair, `beforeTool`, and coercion,
     * once it starts executing. A model-issued call's arguments are in its assistant entry instead.
     */
    arguments: JsonObject;
    /** Once done: how the call ended, for a status line. The result itself is in the caller's `NestedCallDoc`. */
    summary?: NestedToolSummary;
};
/** How a nested call ended: an error flag, its execution time, its spend, and up to 500 characters of error text. */
export type NestedToolSummary = {
    isError: boolean;
    durationMs?: number;
    usage?: JsonRepresentation<Usage>;
    error?: string;
};
/** Presentation of one live compaction task (spec §8.7). */
export type CompactionStatus = {
    taskId: TaskId<CompactionResult>;
    reason: CompactionReason;
    /** Whether a generation waits for it: a compaction the generation owns. */
    blocking: boolean;
    attempt: number;
    /** Durable backoff before the next summarization attempt. */
    retry?: {
        at: number;
        error: string;
    };
};
/** The newest compaction that failed since a compaction last produced a summary (spec §8.7). */
export type CompactionFailure = {
    taskId: TaskId<CompactionResult>;
    reason: CompactionReason;
    /** The failed or faulted outcome's error message, or why the scheduler orphaned the task. */
    error: string;
};
/** Built-in live conversation state: run control and presentation of the current generation and tool round. */
export type LiveState = {
    /** Run control: the task that settles the run's inputs, and those inputs; present exactly while busy. */
    run?: {
        taskId: TaskId;
        inputs: SubmissionId[];
    };
    /** Presentation of the current generation attempt. */
    generation?: {
        attempt: number;
        /** Committed throttled partial of the in-flight response. */
        message?: JsonRepresentation<AssistantMessage>;
        /** Durable backoff before the next attempt. */
        retry?: {
            at: number;
            error: string;
        };
        /** Provider-side deferred response being polled. */
        deferred?: {
            pollAt: number;
        };
    };
    /** The current tool round in call order, from the tool-calling answer until the generation's `tools` phase ends it. */
    tools?: ToolSlot[];
    /**
     * Nested calls of running tool calls, in creation order, so a parent precedes its children and task IDs ascend. A
     * call's nested slots are removed when the call settles.
     */
    nestedTools?: NestedToolSlot[];
    /** Live compaction tasks in task ID order; absent when none. */
    compactions?: CompactionStatus[];
    /**
     * The newest compaction failure, so a client can show it after the task ended. A compaction that produces a summary
     * removes it; one that is aborted or finds nothing to compact leaves it.
     */
    compactionFailure?: CompactionFailure;
};
export declare const LiveDoc: import("../types.ts").ConversationDocToken<LiveState>;
/**
 * End the run owned by `taskId`: settle each of its inputs and remove `run`. Always removes `generation`, `tools`, and
 * `nestedTools`, whose presentation belongs to the ending run.
 */
export declare function endRun(tx: Tx, live: Draft<LiveState>, taskId: TaskId, settlement: SubmissionSettlement): void;
/** Add the status of a compaction task created in this commit; statuses stay in task ID order. */
export declare function addCompactionStatus(live: Draft<LiveState>, status: CompactionStatus): void;
/** The status of compaction task `taskId`, if listed. */
export declare function compactionStatus(live: Draft<LiveState>, taskId: TaskId): Draft<CompactionStatus> | undefined;
/** Remove the status of compaction task `taskId`, and the list once empty. */
export declare function removeCompactionStatus(live: Draft<LiveState>, taskId: TaskId): void;
/** Remove the status of compaction task `taskId` and record that it failed with `error`. */
export declare function failCompactionStatus(live: Draft<LiveState>, taskId: TaskId, error: string): void;
/**
 * The slot of tool task `taskId`, model-issued or nested, if `pi.live` still lists it. Nested slots are found by binary
 * search: a tool may make thousands of nested calls, each of which looks up its slot in several commits, and every
 * element a search reads costs a node in the draft's change tracker. Their task IDs ascend: each slot is appended in
 * the commit that creates its task, task IDs ascend in commit order, and removal keeps the order.
 */
export declare function toolSlot(live: Draft<LiveState>, taskId: TaskId): Draft<ToolSlot | NestedToolSlot> | undefined;
/**
 * Mark a slot done and clear its running output; the caller sets a model-issued call's result `entry`, or a nested
 * call's `summary`. Neither is set when the task faulted or was orphaned.
 */
export declare function finishSlot(slot: Draft<ToolSlot | NestedToolSlot>): void;
/** Remove the nested slots below tool task `taskId`, transitively; the list holds parents before their children. */
export declare function removeNestedSlots(live: Draft<LiveState>, taskId: TaskId): void;
/** Remove what a tool published while running; its result entry or a rerun replaces it. */
export declare function clearProgress(slot: Draft<SlotProgress>): void;
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
export declare function settleSchedulerOutcome(tx: Transaction, record: TaskRecord<JsonValue, JsonValue, JsonValue>, outcome: SchedulerOutcome): Promise<void>;
export {};
//# sourceMappingURL=live.d.ts.map