/**
 * Replicated state: an immutable JSON value with ordered, serialized change notifications. Either authoritative and
 * mutable (`replicatedState(initial)`) or a publication-only view of an external revision source
 * (`replicatedState(source)`).
 */
import { type Context } from "./context/index.ts";
import { type Draft, type Op } from "./delta/index.ts";
export interface ReplicatedStateDelivery {
    readonly kind: "hydrate" | "update";
    readonly sequence: number;
}
export interface ReplicatedState<T> {
    /**
     * Contract-immutable value, or undefined until hydration. It is not frozen and may share containers with an
     * in-process provider; consumers must not mutate it. Later updates do not mutate previously returned values.
     */
    readonly value: T | undefined;
    /**
     * Each subscription serializes callbacks, awaiting hydration before updates. Values are immutable and may
     * share unchanged revision data. At most 100 deliveries wait behind the running callback; overflow keeps
     * only the newest pending value/context/delivery, so update sequences may skip. Failures are reported in
     * isolation and delivery continues. Unsubscribe discards pending work without aborting or joining a callback.
     */
    subscribe(listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => Promise<void>): () => void;
    subscribe(listener: (value: T, context: Context, delivery: ReplicatedStateDelivery) => void): () => void;
}
export interface MutableReplicatedState<T extends object> extends ReplicatedState<T> {
    readonly value: T;
    /**
     * Atomically publish one synchronous overlay mutation. Draft handles are unusable after the callback returns.
     * Values placed through the draft are cloned by value; assigning `undefined` to an object property deletes it.
     */
    change(context: Context, mutate: (draft: Draft<T>) => void): void;
    /**
     * Atomically take immutable ownership of an alias-free strict-JSON replacement.
     * The caller must not mutate the transferred root after this call.
     */
    replace(context: Context, value: T): void;
}
/** One immutable authoritative revision committed after an attachment snapshot. */
export interface ReplicatedStateSourceFrame<T> {
    /** Monotonic source cursor. The first frame after a snapshot must be `snapshot.cursor + 1`. */
    readonly cursor: number;
    /** The exact immutable value produced by this commit. */
    readonly value: T;
    /** The exact immutable operation batch that produced `value` from the preceding source revision. */
    readonly ops: readonly Op[];
    readonly context: Context;
}
export interface ReplicatedStateSourceAttachment<T> {
    /** Fixed immutable snapshot captured at the atomic attachment boundary. */
    readonly snapshot: {
        readonly value: T;
        readonly cursor: number;
    };
    /**
     * Install the sole listener and synchronously drain every buffered frame in source commit order.
     * This method is single-use. After it begins, every new committed frame must also be delivered in order
     * until disposal, including commits made reentrantly while a prior frame is being delivered.
     */
    activate(listener: (frame: ReplicatedStateSourceFrame<T>) => void): void;
    /** Stop delivery and release source resources. Disposal must be idempotent. */
    dispose(): void;
}
/**
 * An authoritative immutable revision source.
 *
 * `attach()` must synchronously and atomically capture one snapshot and register the returned attachment to buffer
 * every later committed frame. The snapshot must include every commit before that boundary; buffered frames must
 * include every commit after it, with no overlap or gap. Snapshot values, frame values, and operation batches are
 * immutable and remain valid after delivery. Chord only publishes these references; it never applies or re-diffs them.
 */
export interface ReplicatedStateSource<T> {
    attach(): ReplicatedStateSourceAttachment<T>;
}
export interface ReplicatedStateSourceOptions {
    /** Receives source-contract and publication-listener failures without throwing them into the source. */
    readonly onError?: (error: Error) => void;
}
/** A synchronously hydrated publication-only state backed by one source attachment. */
export interface AttachedReplicatedState<T> extends ReplicatedState<T> {
    readonly value: T;
    /** Idempotently release the source attachment. The last published value remains readable. */
    dispose(): void;
}
export declare function replicatedState<T>(source: ReplicatedStateSource<T>, options?: ReplicatedStateSourceOptions): AttachedReplicatedState<T>;
/**
 * Create authoritative state by taking immutable ownership of an alias-free strict-JSON root.
 * The caller must not mutate `initial` after this call.
 */
export declare function replicatedState<T extends object>(initial: T): MutableReplicatedState<T>;
//# sourceMappingURL=state.d.ts.map