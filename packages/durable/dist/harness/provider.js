import { uuidv7 } from "@earendil-works/pi-ai/utils/uuid";
import { defineDoc } from "../documents.js";
/** Built-in provider state; every fork starts with a fresh identity instead of copying its parent. */
export const ProviderDoc = defineDoc({
    kind: "pi.provider",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "initial",
    initial: () => ({ sessionId: uuidv7() }),
    checkpointWhen: () => true,
});
/**
 * Return the persisted identity without writing in the normal path. A legacy conversation without `pi.provider` gets
 * one migration commit whose `tx.doc()` runs `initial()` before the provider request starts.
 */
export async function ensureProviderSessionId(runtime, context) {
    const existing = await runtime.snapshot(ProviderDoc, runtime.conversationId, context);
    if (existing !== undefined)
        return existing.sessionId;
    let created;
    await runtime.commit(async (tx) => {
        created = (await tx.doc(ProviderDoc, runtime.conversationId)).sessionId;
        return undefined;
    }, context);
    if (created === undefined)
        throw new Error(`Conversation ${runtime.conversationId} has no provider session ID`);
    return created;
}
//# sourceMappingURL=provider.js.map