import type { Static, TSchema } from "typebox";
import { Cell, Derived, HYDRATION, type Hydration, type Sources, type SourceValues } from "./cell.ts";
import { type Accepts, type Adapter, type AnyContract, type ImplementationOf, type InputOf, type LocalContract, type MemberDescription, type Ref } from "./contract.ts";
import type { EventOf, ListenerDecl, Resource, ResourceDeclaration, Subscribable, ValueOf } from "./declare.ts";
import type { Registration, Registry } from "./registry.ts";
import type { RemoteHost } from "./remote.ts";
import type { Ctx, Exposed, GetOptions, Readable, RefStatus, Shape, StateEvent } from "./types.ts";
/**
 * `serve` options. `lifetime` says how long objects of the type live. `"referenced"` (default): created at the first
 * `get` of an address, disposed after the last reference is released (plus `linger`). `"host"`: one object, created when
 * its facet loads (loading waits until it is live) and kept until the host closes or a reload removes its facet. Only
 * local types whose input accepts `{}` may have it (`ServeOptionsFor` checks that at compile time, `serve` again at
 * runtime); every `get` reaches that one object, created for the host principal. Only such objects may register into
 * registries.
 */
export type ServeOptions = ReferencedServeOptions | HostServeOptions;
export interface ReferencedServeOptions {
    readonly lifetime?: "referenced";
    /** Milliseconds an object stays alive after its last reference is released. */
    readonly linger?: number;
    /** Adapters for consumers built against older contract versions. */
    readonly accepts?: Accepts;
}
export interface HostServeOptions {
    readonly lifetime: "host";
    /** An object of lifetime `"host"` lives as long as the host: it does not linger. */
    readonly linger?: undefined;
    /** Adapters for consumers built against older contract versions. */
    readonly accepts?: Accepts;
}
/**
 * The options `serve` accepts for `C`: `lifetime: "host"` only for a local type whose input has no required fields
 * (the type's one object has the empty input).
 */
export type ServeOptionsFor<C extends AnyContract> = C extends LocalContract ? Record<never, never> extends InputOf<C> ? ServeOptions : ReferencedServeOptions : ReferencedServeOptions;
export type Lifetime = "referenced" | "host";
/** A type's factory. `P` is the app's principal type: `principal` is the caller the object is created for. */
export type Factory<C extends AnyContract, P = unknown> = (input: InputOf<C>, principal: P, self: Self<P>) => ImplementationOf<C, P>;
type AnyFactory = (input: unknown, principal: unknown, self: Self) => unknown;
export interface Service {
    readonly contract: AnyContract;
    readonly factory: AnyFactory;
    readonly options: ServeOptions;
    readonly facet: string;
}
export declare const makeService: <C extends AnyContract>(contract: C, factory: Factory<C>, options: ServeOptions, facet: string) => Service;
/** Whether objects of `service` have `lifetime: "host"`. */
export declare const hostLifetime: (service: Service) => boolean;
/** Options of `self.state`. */
export interface StateOptions<T> {
    /** The meaning of the cell's value (default 1). A reload that raises it runs `migrate`. */
    readonly version?: number;
    /**
     * Maps the value of an older version (`from`) to this version's, at the reload that raised the version. The cell
     * may be several versions behind. Without it, the value is kept and must fit the new schema.
     */
    readonly migrate?: (old: unknown, from: number) => T;
}
/**
 * A cell's first value from its source: `init` runs after the object's resources are open and its references are live,
 * before the object goes live, so no call, listener or subscriber sees a value that is not from the source. It runs in
 * a root of its own (acting as the host principal) and may be async; the inits of one object run in parallel. Its
 * value is validated against the schema; a throw or an invalid value fails the activation.
 */
export interface StateInit<T, P = unknown> {
    readonly init: (ctx: Ctx<P>) => T | Promise<T>;
}
/** What a factory declares through. `P` is the app's principal type (`ctx.principal` of its listeners and tasks). */
export interface Self<P = unknown> {
    /**
     * A state cell named `name`: its schema (required: there is no TypeScript at runtime) and its initial value
     * (validated), or `{ init }` to read the first value from its source before the object goes live. The name identifies
     * the cell across reloads: a reload keeps the cell and its value (`initial` is ignored, `init` does not run), migrates
     * it when its version rises, and refuses a schema change without a version bump. A cell a reload adds runs its `init`
     * while the reload prepares.
     */
    state<S extends TSchema>(name: string, schema: S, initial: Static<S> | StateInit<Static<S>, P>, options?: StateOptions<Static<S>>): Cell<Static<S>>;
    /** An object-owned reference, identified by its address. */
    get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions<P>): Ref<C>;
    /**
     * A resource named `name`: opened before the object goes live, closed after it is disposed. A reload keeps it unless
     * its `version`, `deps` or `exclusive` changed.
     */
    resource<T>(name: string, declaration: ResourceDeclaration<T>): Resource<T>;
    /**
     * Reacts to `source` once the object is live: a readable (cell, derivation, reference state member) delivers its
     * current value, then every new value; an event source (or a resource whose value is one) delivers its events.
     * With `select`, subscribes to `select(value)` instead (the opened value for a resource). Each event runs `handler`
     * in a fresh root. The name keeps the subscription across reloads while its source and `select` are unchanged; a
     * listener on state whose source the reload replaced (a derivation is new at every reload) subscribes again and
     * gets the current value again, so a handler of state must reconcile, not count.
     */
    on<S>(name: string, source: S, handler: (event: EventOf<S>, ctx: Ctx<P>) => void | Promise<void>): void;
    on<S, E>(name: string, source: S, select: (value: ValueOf<S>) => Subscribable<E>, handler: (event: E, ctx: Ctx<P>) => void | Promise<void>): void;
    /** Long-running work of the live object (a code holder: its calls start fresh roots), restarted at every reload. */
    task(fn: (ctx: Ctx<P>) => Promise<void>): void;
    /** A synchronous projection of readables, recomputed when they change; a new one at every reload. */
    derive<const S extends Sources, T>(sources: S, fn: (...values: SourceValues<S>) => T): Readable<T>;
    /** Objects of lifetime `"host"` only. Keys are the registry's own keys. */
    register<V>(registry: Registry<V>, entries: Readonly<Record<string, V>>): void;
    /**
     * A member backed by one of this object's resources, for local contracts: references read the resource's value once
     * the object is live (`undefined` before). Typically an `opaque` member: `{ harness: self.expose(durable) }`.
     */
    expose<T>(resource: Resource<T>): Exposed<T>;
}
export declare class ResourceImpl<T = unknown> implements Resource<T> {
    #private;
    readonly key: string;
    /** The declaration of the factory run whose code is current: a kept resource adopts the new one at commit. */
    spec: ResourceDeclaration<T>;
    readonly deps: readonly (RefCore | ResourceImpl)[];
    /** `unavailable`: a close/reopen failed during a reload rollback; the value is gone for good. */
    state: "closed" | "opening" | "open" | "unavailable";
    constructor(key: string, spec: ResourceDeclaration<T>, deps: readonly (RefCore | ResourceImpl)[]);
    get value(): T;
    get exclusive(): boolean;
    /**
     * Opens the resource. An open that completes after `signal` aborted (rollback, abandonment) closes the value it
     * produced at once: nobody owns it any more.
     */
    open(signal: AbortSignal, order: ResourceImpl[]): Promise<void>;
    close(order: ResourceImpl[]): Promise<void>;
    markUnavailable(): void;
    /**
     * A reload kept this resource (same version, deps and exclusivity): its later `close` is the new declaration's, and
     * the old declaration (with the old code it closes over) is no longer referenced.
     */
    adopt(spec: ResourceDeclaration<T>): void;
}
type TaskFn = (ctx: Ctx) => Promise<void>;
/** Everything one factory run declared, by kind and key. */
export declare class Decls {
    readonly cells: Map<string, Cell<unknown>>;
    readonly cellSchemas: Map<string, TSchema>;
    readonly cellVersions: Map<string, number>;
    readonly cellMigrations: Map<string, (old: unknown, from: number) => unknown>;
    readonly refs: Map<string, RefCore>;
    readonly resources: Map<string, ResourceImpl<unknown>>;
    /** Resources this run kept from the previous one, with this run's declarations (adopted at commit). */
    readonly adopted: Map<ResourceImpl<unknown>, ResourceDeclaration<unknown>>;
    readonly listeners: Map<string, ListenerDecl>;
    /** By position (`#0`, `#1`, …): tasks have no names. */
    readonly tasks: Map<string, TaskFn>;
    /** By position: derivations have no names and are new at every run. */
    readonly derives: Map<string, Derived<unknown>>;
    readonly registrations: Map<string, Registration>;
}
type InitFn = (ctx: Ctx) => unknown;
/** One factory run: its implementation, declarations and the objects it created (not reused from the previous run). */
export interface Run {
    readonly implementation: Record<string, unknown>;
    readonly decls: Decls;
    readonly created: {
        readonly refs: RefCore[];
        readonly resources: ResourceImpl[];
        readonly derives: Derived<unknown>[];
        /** Cells this run created with `init`, which fills them before they are used. */
        readonly inits: (readonly [Cell<unknown>, InitFn])[];
    };
}
export interface Installed {
    readonly codeVersion: number;
    readonly service: Service;
    readonly implementation: Record<string, unknown>;
    readonly decls: Decls;
}
export interface HostCore {
    readonly name: string;
    readonly dev: boolean;
    readonly principal: unknown;
    inFactory: number;
    /** Set when a commit failed midway: the host admits no more work (terminal). */
    readonly failed: unknown;
    report(error: unknown): void;
    currentCodeVersion(): number;
    hasCodeVersion(codeVersion: number): boolean;
    retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, Service>]>;
    pendingCodeVersion(): number | undefined;
    service(typeName: string): Service | undefined;
    acquire(type: AnyContract, input: unknown, options: GetOptions | undefined, owner: RefOwner, from?: ObjectImpl, candidate?: boolean): RefCore;
    addressOf(type: AnyContract, input: unknown, principal: unknown, candidate?: boolean): string;
    root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: {
        codeVersion?: number;
        signal?: AbortSignal;
    }): Promise<T>;
    touch(rootId: string, object: ObjectImpl): void;
    forget(object: ObjectImpl): void;
    /** The object finished its disposal. */
    disposed(object: ObjectImpl): void;
    /** Milliseconds a reload waits for aborted tasks to finish before starting their replacements. */
    readonly taskStopDeadline: number;
    /**
     * Milliseconds an activation or a reload's prepare waits for its references to be ready and hydrated before it fails
     * (`unavailable/ready_timeout`; a reference cycle across hosts never resolves).
     */
    readonly readyTimeout: number;
    checkRegistrations(object: ObjectImpl, decls: Decls): void;
    /** Rebuilds the current registry tables from live objects (plus `including`, which is finishing activation). */
    registriesChanged(including?: ObjectImpl): void;
}
export declare class CtxImpl implements Ctx {
    #private;
    readonly host: HostCore;
    readonly signal: AbortSignal;
    readonly rootId: string;
    readonly codeVersion: number;
    readonly principal: unknown;
    /** Code holders (tasks): every call they make starts a fresh root. */
    readonly holder: boolean;
    /** True after the call or root that received this ctx settled: it may no longer start work. */
    get closed(): boolean;
    /** Throws unless this ctx may start work on `host` (the called reference's host) now: not expired, aborted or foreign. */
    check(host: HostCore | RemoteHost): void;
    /** `signals`: the ctx is aborted with the first of them; it stops following them when it closes. */
    constructor(host: HostCore, fields: {
        signals: readonly AbortSignal[];
        rootId: string;
        codeVersion: number;
        principal: unknown;
        holder?: boolean;
    });
    get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Promise<Ref<C>>;
    /**
     * A context for a call into `object`: same root and code version, its own call-owned references, aborted on forced
     * disposal. Code inside an object acts as the host principal.
     */
    child(object: ObjectImpl): CtxImpl;
    close(): void;
}
/**
 * A signal aborted with the first of `sources` to abort, until `release()`. Not `AbortSignal.any`: Node keeps a
 * dependant of a long-lived source (an object's or a code version's) reachable while it has abort listeners, so every
 * call or task context would keep its listeners, and the code they close over, alive as long as the source.
 */
export declare function linkedSignal(sources: readonly AbortSignal[]): {
    readonly signal: AbortSignal;
    release(): void;
};
/**
 * Waits until `ref` is ready, at most `ms` and until a signal aborts; on failure the reference is released (only it: a
 * binding other references share stays) and the error is rethrown: the activation error, `aborted`, or
 * `unavailable/ready_timeout`.
 */
export declare function awaitReady(ref: RefCore, signals: readonly AbortSignal[], ms: number): Promise<void>;
export declare function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
/** Who a reference belongs to. `connection`: a peer host over a link; `client`: a browser (not a reload participant). */
export type RefOwner = "object" | "call" | "host" | "external" | "connection" | "client";
/** A claim on an object: a local `RefImpl`, or a `RemoteRef` on another host (no object here). */
export interface RefCore {
    readonly address: string;
    readonly contract: AnyContract;
    readonly status: RefStatus;
    readonly ready: Promise<void>;
    readonly proxy: object;
    readonly object: ObjectImpl | undefined;
    release(): void;
}
export declare const REF_BASE: ReadonlySet<PropertyKey>;
export type StatusListener = (status: RefStatus, error: unknown) => void;
/** Queues a status notification (after the change that caused it is complete, like every publication). */
export declare function notifyStatus(listeners: ReadonlySet<StatusListener>, status: RefStatus, error: unknown, report: (error: unknown) => void): void;
/** Proxy → reference, for `deps: [ref]` and links. */
export declare const refsByProxy: WeakMap<object, RefCore>;
export declare const refOf: (value: unknown) => RefCore | undefined;
/**
 * A reference's state member: a stable readable that follows whatever source the current implementation exposes under
 * that name. Reading throws `not_ready` until the reference is live, `not_in_variant` while the variant lacks the
 * member. A listener added before the member is readable gets its snapshot then. Rebinding (reload, variant) delivers a
 * reset. Upstream is subscribed only while someone listens.
 */
declare class MemberReadable implements Readable<unknown> {
    #private;
    constructor(ref: RefImpl, name: string);
    get value(): unknown;
    /** Not hydrated while the reference is not live, or while its source (a forwarded remote member) is not. */
    get [HYDRATION](): Hydration | undefined;
    subscribe(listener: (value: unknown) => void): () => void;
    events(listener: (event: StateEvent<unknown>) => void): () => void;
    /** (Re)subscribes upstream to the current source; a changed source is announced as a reset. */
    bind(): void;
    stop(): void;
}
/** One reference on an object. Exposed through a Proxy so members bind late to the current implementation. */
export declare class RefImpl {
    #private;
    readonly object: ObjectImpl;
    readonly contract: AnyContract;
    readonly owner: RefOwner;
    readonly address: string;
    readonly proxy: object;
    readonly ready: Promise<void>;
    status: RefStatus;
    error: unknown;
    readonly shapeListeners: Set<(shape: Shape) => void>;
    /** Internal: notified when the reference becomes gone (links forward it). */
    readonly goneListeners: Set<(error: unknown) => void>;
    readonly readables: Map<string, MemberReadable>;
    /** Weak: a retired code version's service (and the factory code it holds) must not be kept alive by its consumers. */
    readonly bindings: WeakMap<Service, Adapter | undefined>;
    readonly views: WeakMap<Record<string, unknown>, Record<string, unknown>>;
    readonly callers: Map<string, (...given: unknown[]) => Promise<unknown>>;
    constructor(object: ObjectImpl, contract: AnyContract, owner: RefOwner);
    get variant(): string | undefined;
    get shape(): Shape | undefined;
    onShape(listener: (shape: Shape) => void): () => void;
    onStatus(listener: StatusListener): () => void;
    release(): void;
    live(): void;
    gone(error: unknown): void;
    shapeChanged(): void;
    terminalError(): unknown;
    /** The implementation as this consumer sees it (through an accepts adapter when bound to another version). */
    viewOf(installed: Installed): Record<string, unknown>;
    currentView(): Record<string, unknown> | undefined;
    describe(variant: string | undefined, member: string): MemberDescription | undefined;
    /** Remote consumers see only the members their contract lists for the current variant. */
    inVariant(view: Record<string, unknown>, name: string): boolean;
    member(name: string): unknown;
    caller(name: string): (...given: unknown[]) => Promise<unknown>;
}
export declare const variantOf: (implementation: Record<string, unknown>) => string | undefined;
export type ObjectStatus = "activating" | "live" | "failed" | "disposing" | "disposed";
interface Gate {
    readonly grandfathered: Set<string>;
    readonly queue: {
        readonly key: string;
        readonly event: unknown;
    }[];
    drained: () => void;
}
/** Listener subscriptions made ahead of a commit: `activate` switches over, `discard` drops them. */
export interface StagedListeners {
    activate(): void;
    discard(): void;
}
export interface ObjectIdentity {
    readonly address: string;
    readonly typeName: string;
    readonly input: unknown;
    readonly principal: unknown;
    /** The one object of a `lifetime: "host"` type. */
    readonly hostLifetime: boolean;
}
export declare class ObjectImpl {
    #private;
    readonly host: HostCore;
    readonly address: string;
    readonly typeName: string;
    readonly input: unknown;
    readonly principal: unknown;
    /** The one object of a `lifetime: "host"` type: only such objects may register. */
    readonly hostLifetime: boolean;
    status: ObjectStatus;
    ready: Promise<void>;
    service: Service | undefined;
    /** Calls carrying an older code version are rejected upgrade_conflict (state bump or exclusive resource replaced). */
    minCodeVersion: number;
    decls: Decls;
    /** Declarations of a factory run that has not been installed yet (activation or reload candidate). */
    readonly pending: Set<Decls>;
    readonly implementations: Map<number, Installed>;
    readonly refs: Set<RefImpl>;
    readonly leases: Map<string, number>;
    readonly openOrder: ResourceImpl[];
    readonly callAbort: AbortController;
    readonly activationAbort: AbortController;
    gate: Gate | undefined;
    /** Served only by a running reload's pending code version: listeners, tasks and registrations start at its commit. */
    deferredRuntime: boolean;
    constructor(host: HostCore, identity: ObjectIdentity);
    start(after: Promise<void> | undefined): void;
    /**
     * Runs the factory synchronously. With `previous`, runs in recording mode for a reload prepare. The run's
     * declarations stay in `pending` (visible to the cycle check) until the caller installs or discards them.
     */
    run(service: Service, previous: Decls | undefined): Run;
    /** Opens resources (dependencies first) and waits for references; settles all before failing. */
    open(resources: readonly ResourceImpl[], refs: readonly RefCore[], signal: AbortSignal): Promise<void>;
    /**
     * Waits until the state sources a run exposes or derives from have their values: a local object goes live only with
     * its state, also where it forwards or derives from a remote reference's member.
     */
    waitHydrated(run: Run): Promise<void>;
    /** `work` within the host's `readyTimeout`; a timeout names what is still awaited. */
    withinReadyTimeout<T>(work: Promise<T>, waiting: () => readonly string[]): Promise<T>;
    /**
     * Fills the cells `run` created with `init`, each in a root of its own, in parallel; settles all before failing. Runs
     * after the run's resources are open and its references live, before anything reads the cells.
     */
    initCells(run: Run, signal: AbortSignal): Promise<void>;
    /** Undoes the objects a run created: closes its resources (reverse order) and releases its references. */
    unwind(run: Run): Promise<void>;
    currentInstalled(): Installed | undefined;
    /** Every state source exposed as a remote state member gets that member's schema (checked per write in dev mode). */
    refreshSchemas(): void;
    allDecls(): Set<Decls>;
    /**
     * Subscribes the listeners of `decls` without delivering: events are buffered until `activate`. A listener declared
     * on the same resource (or source) with the same `select` keeps its subscription without calling `select` again
     * (only its function is swapped, by name), so sources that accept a single subscriber survive reloads. Throws, with
     * nothing left subscribed, if any source fails.
     */
    stageListeners(decls: Decls): StagedListeners;
    startRuntime(): void;
    /**
     * Starts the tasks of the current declarations. Runs aborted by `stopTasks` (a reload, a gate) may still be finishing:
     * their replacements start once they all finished, or after `taskStopDeadline` (reported), so the old and the new run
     * of a task never work side by side. A later start or stop, or the object leaving `live`, cancels a delayed start.
     */
    startTasks(): void;
    stopListeners(): void;
    /**
     * Aborts running tasks (and cancels a delayed start). Their completion is awaited by the next `startTasks` and at
     * disposal; each leaves `#stopped` when it finishes.
     */
    stopTasks(): void;
    /** Opens the object's gate and replays queued listener events through the current listeners. */
    openGate(): void;
    /** Admission for a call or write carrying `ctx`. */
    admit(ctx: Ctx): void;
    /** Records that the root of `ctx` touched this object (a reload gate grandfathers it). */
    lease(ctx: Ctx): void;
    guard: (ctx: Ctx) => void;
    call(ref: RefImpl, name: string, args: unknown, ctx: CtxImpl): Promise<unknown>;
    rootEnded(rootId: string): void;
    addRef(ref: RefImpl): void;
    release(ref: RefImpl): void;
    /**
     * Disposes the object. Forced: references become gone at once (new calls are rejected) and running invocations are
     * cancelled. Either way, resources close only after every invocation settled.
     */
    dispose(forced: boolean, reason?: unknown): Promise<void>;
}
/** The remote state-member schemas an implementation exposes, by source. */
export declare function memberSchemas(service: Service, implementation: Record<string, unknown>): Map<Readable<unknown>, TSchema[]>;
export {};
//# sourceMappingURL=object.d.ts.map