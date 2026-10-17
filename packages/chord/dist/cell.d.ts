import type { TSchema } from "typebox";
import { type Draft } from "./delta/index.ts";
import { ChordError } from "./errors.ts";
import type { Ctx, Readable, StateEvent } from "./types.ts";
export interface SourceOptions {
    readonly dev: boolean;
    readonly report: (error: unknown) => void;
}
/** Checks that `ctx` may write an object's cells now; throws otherwise. */
export type WriteGuard = (ctx: Ctx) => void;
/** Fans out values and delta events; listener errors are reported, not thrown to the writer. */
declare class Fanout<T> {
    #private;
    constructor(report: (error: unknown) => void);
    subscribe(listener: (value: T) => void, current: T): () => void;
    events(listener: (event: StateEvent<T>) => void, current: T): () => void;
    /**
     * Queues delivery to the listeners subscribed now. A listener that subscribes later already got this revision in
     * its snapshot; one that unsubscribes before delivery is skipped.
     */
    emit(event: StateEvent<T>): void;
}
/**
 * Whether a state source has its value (entry 8): a remote reference's member before its first snapshot has none, and
 * neither has anything derived from or forwarding it. Sources without this symbol always have their value.
 */
export declare const HYDRATION: unique symbol;
export interface Hydration {
    readonly hydrated: boolean;
    /** Resolves once hydrated; rejects if the source ends first. */
    whenHydrated(): Promise<void>;
}
/** The hydration of a readable, or undefined for a source that always has its value. */
export declare function hydrationOf(value: unknown): Hydration | undefined;
/** The hydrations of `sources` that are not hydrated yet. */
export declare const unhydrated: (sources: Iterable<unknown>) => Hydration[];
/** An object-owned state source (cell or derivation). Writes recompute dependents atomically. */
export declare abstract class Source<T> implements Readable<T> {
    readonly key: string;
    readonly seq: number;
    readonly dependents: Set<Derived<unknown>>;
    /** Schemas of remote state members currently exposing this source (checked per write in dev mode). */
    schemas: readonly TSchema[];
    protected readonly options: SourceOptions;
    protected readonly fanout: Fanout<T>;
    constructor(key: string, options: SourceOptions);
    abstract get value(): T;
    subscribe(listener: (value: T) => void): () => void;
    events(listener: (event: StateEvent<T>) => void): () => void;
    /** Per-write validation, dev mode only. */
    validate(value: unknown): void;
    protected ownSchemas(): readonly TSchema[];
}
/** A state cell holding any JSON value, validated against its schema at creation and (dev mode) on writes. */
export declare class Cell<T> extends Source<T> {
    #private;
    /** Replaced at a reload commit that changes the schema (state-version bump). */
    schema: TSchema;
    /**
     * `initial` is always validated against `schema`; ownership moves to the cell. Without `initial`, the cell has no
     * value until `initialize` (a cell declared with `init`, filled before its object goes live).
     */
    constructor(key: string, schema: TSchema, initial: {
        readonly value: T;
    } | undefined, guard: WriteGuard, options: SourceOptions);
    /** Sets the first value of a cell declared with `init` (validated; ownership moves to the cell). Publishes nothing. */
    initialize(value: T): void;
    protected ownSchemas(): readonly TSchema[];
    get value(): T;
    /**
     * Mutates a draft (only mutated paths are published), or returns a new value (`n => n + 1`). A returned value is
     * always validated against the schema. The draft is unusable after `fn` returns.
     */
    change(ctx: Ctx, fn: (draft: Draft<T>) => T): void;
    change(ctx: Ctx, fn: (draft: Draft<T>) => void): void;
    /**
     * Replaces the whole value. Ownership of `value` moves to the cell: never mutate it afterwards.
     *
     * Subscribers get a structural diff (`diffRevisions`) when `diff` is true, or by default when the new value shares
     * containers with the old one (a new immutable revision of the same state, e.g. mirrored from another store);
     * otherwise a single `r` op. The resulting value is the same either way; only the ops differ.
     */
    replace(ctx: Ctx, value: T, options?: {
        readonly diff?: boolean;
    }): void;
    /**
     * Installs a migrated value and its schema (reload commit). The caller validated the value and the derivations
     * over it against every schema that will apply, so nothing is checked here. Subscribers receive a reset.
     */
    reset(value: T, schema: TSchema): void;
}
export type Sources = readonly Readable<unknown>[];
export type SourceValues<S extends Sources> = {
    [K in keyof S]: S[K] extends Readable<infer T> ? T : never;
};
/**
 * A synchronous derivation. Sources are object cells/derivations (recomputed atomically with the write) or other
 * readables such as reference state members (recomputed when they publish). Subscribers receive diffs.
 */
export declare class Derived<T> extends Source<T> {
    #private;
    readonly sources: readonly Readable<unknown>[];
    constructor(key: string, sources: Sources, fn: (...values: never[]) => unknown, options: SourceOptions);
    get value(): T;
    /** Hydrated once every source is (a derivation over a remote member waits for its snapshot). */
    get [HYDRATION](): Hydration | undefined;
    /**
     * Computes the first value (or takes it from `precomputed`, a reload's validated dry run) and starts following
     * the sources (at install, never inside a factory).
     */
    attach(precomputed?: ReadonlyMap<unknown, unknown>): void;
    detach(): void;
    compute(read: (source: Readable<unknown>) => unknown): T;
    /** Recomputes and republishes, including dependents. Errors are reported (the source write already happened). */
    refresh(): void;
    install(next: T): void;
}
export declare const isSource: (value: unknown) => value is Cell<unknown> | Derived<unknown>;
/** Thrown by placeholders used before activation finished. */
export declare const notReady: (what: string) => ChordError;
export {};
//# sourceMappingURL=cell.d.ts.map