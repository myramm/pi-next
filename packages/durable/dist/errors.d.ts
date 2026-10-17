import type { ConversationId } from "./types.ts";
/**
 * The message of a thrown value, without throwing itself: `String()` throws for values such as `Object.create(null)`,
 * and code that formats an error must not fail for the value it formats.
 */
export declare function errorMessage(error: unknown): string;
/** A transaction read a table after its first table write. Read every required row before writing. */
export declare class ReadAfterWrite extends Error {
    constructor(method: string);
}
/**
 * A Storage read rejected an invalid request, such as an unknown conversation or a cursor from another scan, with no
 * durable effect. Unlike any other error a Storage throws, it fails only that read, not the Session; from `commit()` it is
 * fatal like any other.
 */
export declare class StorageRequestError extends Error {
    constructor(message: string);
}
/**
 * The Session failed, so nothing runs or commits any more. It fails when a Storage method throws, a commit cannot be
 * adopted, or the Harness's own bookkeeping throws (a scheduler commit, an internal commit listener, a registry whose
 * `snapshot()` throws). `cause` is that first error. Reopen the Session; reopening recovers from what was committed.
 */
export declare class SessionFailed extends Error {
    constructor(cause: unknown);
}
/** A submission reached a busy conversation and was not admitted. */
export declare class ConversationBusy extends Error {
    readonly conversationId: ConversationId;
    constructor(conversationId: ConversationId);
}
//# sourceMappingURL=errors.d.ts.map