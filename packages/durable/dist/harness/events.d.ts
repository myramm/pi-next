import type { Context, JsonValue } from "@earendil-works/chord";
import type { AssistantMessage, Message, Usage } from "@earendil-works/pi-ai";
import type { ConversationId, EntryRecord, JsonObject, SubmissionId, SubmissionRecord, TaskId, WatchEnd } from "../types.ts";
import type { InboxItem } from "./inbox.ts";
import type { CompactionFailure, CompactionStatus, NestedToolSlot, ToolSlot } from "./live.ts";
import type { AgentState, CompactionReason, Harness, NestedToolExecutionResult, ToolDiagnostic } from "./types.ts";
import { type UsageState } from "./usage.ts";
type Block = AssistantMessage["content"][number];
type QueuedItem = {
    id: SubmissionId;
    mode: InboxItem["mode"];
};
/** One change to the in-flight assistant message, relative to that message. */
export type MessageChange = {
    type: "text_start" | "thinking_start" | "toolcall_start";
    contentIndex: number;
    block: Block;
} | {
    type: "text_delta" | "thinking_delta";
    contentIndex: number;
    delta: string;
} | {
    type: "toolcall_delta";
    contentIndex: number;
    path: readonly (string | number)[];
    delta: string;
} | {
    type: "block";
    contentIndex: number;
    block: Block;
} | {
    type: "message";
    message: AssistantMessage;
};
export type SnapshotEvent = {
    type: "snapshot";
    entries: readonly EntryRecord[];
    run?: {
        inputs: readonly SubmissionId[];
    };
    /** Current generation attempt: its in-flight partial, retry backoff, or deferred poll. */
    generation?: {
        attempt: number;
        message?: AssistantMessage;
        retry?: {
            at: number;
            error: string;
        };
        deferred?: {
            pollAt: number;
        };
    };
    tools: readonly ToolSlot[];
    /** `pi.live.nestedTools`: nested calls of running tool calls. */
    nestedTools: readonly NestedToolSlot[];
    /** `pi.live.compactions`: live compactions with their attempt and retry backoff. */
    compactions: readonly CompactionStatus[];
    /** `pi.live.compactionFailure`: the newest compaction failure since a compaction last produced a summary. */
    compactionFailure?: CompactionFailure;
    inbox: readonly QueuedItem[];
    /** `pi.agent`; `{}` when absent. */
    agent: AgentState;
    usage: UsageState;
};
/** Experimental agent event, shaped like the coding agent's session events (spec §9.4). */
export type AgentEvent = SnapshotEvent | {
    type: "run_start";
    inputs: readonly SubmissionId[];
} | {
    type: "run_end";
    inputs: readonly SubmissionId[];
} | {
    type: "turn_start";
} | {
    type: "turn_end";
} | {
    type: "message_start";
    message: Message;
}
/** `usage` is the partial's current usage, as in the coding agent's JSON mode. */
 | {
    type: "message_update";
    usage: Usage;
    changes: readonly MessageChange[];
} | {
    type: "message_end";
    entry: EntryRecord;
} | ({
    type: "tool_execution_start";
    args: JsonObject;
} & ToolEventCall) | ({
    type: "tool_execution_update";
    /** A front trim and then an append of the retained window, or its replacement. */
    output?: {
        trimStart?: number;
        append?: string;
    } | {
        set: string;
    };
    details?: JsonValue;
    diagnostics?: readonly ToolDiagnostic[];
} & ToolEventCall)
/**
 * A model-issued call ends with its result `entry`, a nested call with its `result`. Both are absent when the tool
 * task faulted or was orphaned, or when the call's slot left `pi.live` unfinished: its run ended, or its parent
 * settled first.
 */
 | ({
    type: "tool_execution_end";
    entry?: EntryRecord;
    result?: NestedToolExecutionResult;
} & ToolEventCall) | {
    type: "inbox_update";
    items: readonly QueuedItem[];
} | {
    type: "submission";
    record: SubmissionRecord;
} | {
    type: "auto_retry_start";
    attempt: number;
    at: number;
    errorMessage: string;
} | {
    type: "auto_retry_end";
    attempt: number;
} | {
    type: "deferred_poll";
    pollAt: number;
} | {
    type: "entry_appended";
    entry: EntryRecord;
} | {
    type: "agent_changed";
    agent: AgentState;
} | {
    type: "usage_changed";
    usage: UsageState;
} | {
    type: "task_failed";
    taskId: TaskId;
    kind: string;
    message: string;
} | {
    type: "compaction_start";
    taskId: TaskId;
    reason: CompactionReason;
    blocking: boolean;
}
/**
 * The task's receipt tells whether it produced a summary; the summary entry has its own events. `error` is set when
 * the compaction failed, faulted, or was orphaned, as in `pi.live.compactionFailure`.
 */
 | {
    type: "compaction_end";
    taskId: TaskId;
    reason: CompactionReason;
    error?: string;
};
/**
 * Which call a tool event is about. `toolCallId` is the call's ID in the transcript and in tool events: the provider's
 * ID for a model-issued call, `<parent call ID>/<key>` for a nested one. Match events by it; do not parse it. `taskId`
 * is the call's tool task, absent for a call that never got one (not offered, or not started in a sequential round).
 * A nested call also names the call that made it, by call ID and by tool task.
 */
export type ToolEventCall = {
    toolCallId: string;
    toolName: string;
    taskId?: TaskId;
    parentToolCallId?: string;
    parentTaskId?: TaskId;
};
/** Serialized stream of one conversation's event batches, one per commit. */
export interface AgentEventStream {
    /** The `snapshot` event at attachment. */
    readonly snapshot: SnapshotEvent;
    start(listener: (events: readonly AgentEvent[], context: Context) => Promise<void>): void;
    stop(): Promise<WatchEnd>;
    readonly closed: Promise<WatchEnd>;
}
/**
 * Experimental: attach to one conversation's agent events (spec §9.4). The snapshot and the registration for later
 * commits are captured atomically on the Session line; overflow replaces undelivered batches with one snapshot.
 */
export declare function watchEvents(harness: Harness, conversationId: ConversationId, context: Context): Promise<AgentEventStream>;
export {};
//# sourceMappingURL=events.d.ts.map