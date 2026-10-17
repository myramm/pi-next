import { type AcceptOptions, Connection, type LinkOptions, type RelayRef } from "./connection.ts";
import { type AnyContract, type InputOf, type LocalContract, type LocalDef, type Ref, type RemoteContract, type RemoteDef } from "./contract.ts";
import type { Link } from "./link.ts";
import { type Decls, type Factory, type HostCore, ObjectImpl, type RefCore, type RefOwner, type ServeOptionsFor, type Service } from "./object.ts";
import type { Registry, RegistryTable, RegistryView } from "./registry.ts";
import { type ReloadOptions, type ReloadReport } from "./reload.ts";
import { RemoteBinding } from "./remote.ts";
import type { Ctx, GetOptions } from "./types.ts";
import type { Frame } from "./wire.ts";
/**
 * Registers a factory for a type. Overloaded on the contract's definition (not the contract type) so TypeScript
 * keeps literal `variant`s in factory returns. `P` is the app's principal type (see `createHost`).
 */
export interface Serve<P = unknown> {
    <D extends RemoteDef>(type: RemoteContract<D>, factory: Factory<RemoteContract<D>, P>, options?: ServeOptionsFor<RemoteContract<D>>): void;
    <D extends LocalDef>(type: LocalContract<D>, factory: Factory<LocalContract<D>, P>, options?: ServeOptionsFor<LocalContract<D>>): void;
}
/**
 * What a facet's `setup` gets. `serve` registers types; `root` and `registry` give the facet's code that is not a
 * Chord method, listener or task (Durable tools and hooks, callbacks of native libraries) access to its own host,
 * so plugins never need a process-global host. Both may be kept and used after `setup` returns.
 */
export interface FacetApi<P = unknown> {
    readonly serve: Serve<P>;
    /** The host's name (`server`, `session:S1`, ...). */
    readonly name: string;
    /** Starts a root on the facet's host (in its current code version at call time). */
    root<T>(fn: (ctx: Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
    /** The facet's host's registry view (`get(key, ctx)` reads the table of `ctx.codeVersion`). */
    registry<V>(registry: Registry<V>): RegistryView<V>;
    /**
     * Aborted when this run of the facet is no longer installed: a reload that replaced or removed it committed, the reload
     * that loaded it aborted, or the host closed. While a reload prepares, the installed and the candidate run are both
     * live.
     */
    readonly signal: AbortSignal;
}
/** What a facet module exports (default export): the code that serves its types on one host kind. */
export interface FacetDefinition<P = unknown> {
    /** Contract tokens this facet consumes; checked against providers at reload. */
    readonly uses?: readonly AnyContract[];
    setup(api: FacetApi<P>): void;
}
/** A named facet. Modules are named by their URL; reloading a facet replaces everything it served. */
export interface Facet<P = unknown> extends FacetDefinition<P> {
    readonly name: string;
}
/** `defineFacet<P>(…)`: an app passes its principal type, so factories and contexts see `P`. */
export declare const defineFacet: <P = unknown>(setup: (api: FacetApi<P>) => void, options?: {
    readonly uses?: readonly AnyContract[];
}) => FacetDefinition<P>;
/** Imports facet modules (fresh copies on every call) and names them by module URL. */
export type FacetLoader = (modules: readonly (string | URL)[]) => Promise<Facet[]>;
/** A facet object, or a module (path or URL) whose default export is a FacetDefinition. */
export type PluginRef<P = unknown> = Facet<P> | string | URL;
/**
 * `P` is the app's principal type: who a caller is, JSON-serializable. Chord never makes one up: the app supplies the
 * host's own (`self`), the one its parent's own requests act as (`connect`), the ones links act as (`accept`) and the
 * ones routed hosts act as (`Route.principal`).
 */
export interface HostOptions<P = unknown> {
    readonly name?: string;
    /**
     * The principal of the host's own code: roots it starts, code inside its objects, and its `lifetime: "host"` objects.
     * Compared by `principalKey`, so an equal principal from elsewhere reaches the same objects. Not used to infer `P`:
     * pass the app's type as `createHost<P>(…)`.
     */
    readonly self: NoInfer<P>;
    /** Maps a principal to its object key (should include connection provenance and grant revision). */
    readonly principalKey?: (principal: P) => string;
    /** Validates every cell write and exposed state value against its schemas. */
    readonly dev?: boolean;
    /** Errors from background work (disposal, listeners, tasks). Defaults to console.error. */
    readonly onError?: (error: unknown) => void;
    /**
     * Milliseconds a reload waits for an object's aborted tasks to finish before it starts their replacements anyway
     * (reported). Default 5000.
     */
    readonly taskStopDeadline?: number;
    /**
     * Milliseconds an activation (or a reload's prepare) waits for its references to be ready and hydrated, and an
     * awaited `get` for its reference, before failing with `unavailable/ready_timeout`. Default 60000.
     */
    readonly readyTimeout?: number;
    /**
     * Consumer-side linger of remote references: when the last reference to a remote object is released, its binding
     * stays held, and hydrated, for `types[typeName]` milliseconds, so a reference taken again meanwhile costs nothing
     * on the link. At most `cap` bindings (default 4) linger; beyond, the least recently released go first. Types not
     * listed do not linger. (The provider's own `serve(…, { linger })` keeps its object after the last reference.)
     */
    readonly linger?: {
        readonly types?: Readonly<Record<string, number>>;
        readonly cap?: number;
    };
    /** Needed for `load`/`reload` with modules; `nodeLoader` from loader.ts in Node. */
    readonly loader?: FacetLoader;
    /** `client` (browser): never a reload participant, never carries roots or code versions. Default `host`. */
    readonly kind?: "host" | "client";
    /** The link to this host's parent (server). Can also be set later with `connect`. */
    readonly upstream?: {
        readonly link: Link;
    } & ConnectOptions<P>;
}
/** `connect` options: the link's, and the principal its parent's own requests act as. */
export interface ConnectOptions<P = unknown> extends LinkOptions {
    /** What a request from the parent acts as when the parent does not forward its caller's principal (its own code). */
    readonly principal: P;
}
/** Where requests for hosts named `prefix…` go (on the server). */
export interface Route<P = unknown> {
    /** Checked before resolving (or spawning) and again after: grants may change meanwhile. */
    authorize(principal: P, hostName: string): boolean | Promise<boolean>;
    /** A link to the host, spawned if needed. */
    resolve(hostName: string): Promise<Link>;
    /** The principal the resolved host acts as when it calls back. */
    readonly principal: (hostName: string) => P;
}
/** Fields a principal must have, equal (`deepEqual`), for an `invalidatePrincipal` pattern. */
export type PrincipalPattern<P> = P extends object ? {
    readonly [K in keyof P]?: P[K];
} : Readonly<Record<string, unknown>>;
/** `invalidatePrincipal` matches: a predicate (this host only), or a pattern (fields that must be equal; propagates). */
export type PrincipalMatch<P = unknown> = ((principal: P) => boolean) | PrincipalPattern<P>;
export interface RootOptions<P = unknown> {
    readonly principal?: P;
    readonly signal?: AbortSignal;
    /** Start the root in a retained code version (links carry code versions). Defaults to the current code version. */
    readonly codeVersion?: number;
}
export interface LoadOptions {
    /**
     * Await the activation of the `lifetime: "host"` objects the facets serve (default true). False starts them but
     * leaves readiness to `host.ready()` (a child host whose objects need its parent, which admits it only later).
     */
    readonly awaitHostObjects?: boolean;
}
export interface Host<P = unknown> {
    readonly name: string;
    readonly codeVersion: number;
    readonly previousCodeVersion: number | undefined;
    readonly serve: Serve<P>;
    /** Installs synchronously, then awaits this facet's host objects unless `awaitHostObjects` is false. */
    install(facet: Facet<P>, options?: LoadOptions): Promise<void>;
    /** Installs all facets before awaiting their host objects; referenced objects are created when first referenced. */
    load(plugins: readonly PluginRef<P>[], options?: LoadOptions): Promise<void>;
    /** Awaits the host objects present at call time, including those started by `serve` or deferred loads. */
    ready(): Promise<void>;
    /**
     * A reference held until `release()`. Resolves once it is ready: live, with every state member of its variant
     * (unless `state: false`). Rejects with the activation error, `aborted` (`signal`), or `unavailable/ready_timeout`
     * after `readyTimeout`; the reference is released then.
     */
    get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions<P> & {
        readonly signal?: AbortSignal;
    }): Promise<Ref<C>>;
    /**
     * The same reference, synchronously, possibly still `loading`: for UI runtimes that render its status (hooks, a
     * TUI watch). Its state members throw `not_ready` until it is live.
     */
    hold<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions<P>): Ref<C>;
    root<T>(fn: (ctx: Ctx<P>) => T | Promise<T>, options?: RootOptions<P>): Promise<T>;
    registry<V>(registry: Registry<V>): RegistryView<V>;
    /**
     * Force-disposes every object whose principal matches (never the host's own principal), re-stamps or closes
     * matching links, and propagates pattern matches to child hosts.
     */
    invalidatePrincipal(match: PrincipalMatch<P>): Promise<void>;
    /** Accepts a child link (a worker or a browser); requests on it act as `options.principal`. */
    accept(link: Link, options: AcceptOptions<P>): void;
    /**
     * Sets (or replaces, after a reconnect) the link to this host's parent; remote references re-hold over it. The
     * parent's own requests act as `options.principal`; requests it relays act as the principal it forwards.
     */
    connect(link: Link, options: ConnectOptions<P>): void;
    route(prefix: string, route: Route<P>): void;
    /** Reloads the given facets (modules are re-imported); facets not listed keep running unchanged. */
    reload(plugins: readonly PluginRef<P>[], options?: ReloadOptions): Promise<ReloadReport>;
    close(): Promise<void>;
}
export interface CodeVersionState {
    readonly id: number;
    readonly services: Map<string, Service>;
    tables: ReadonlyMap<string, RegistryTable<unknown>>;
    /** Running roots with the number of their calls running here. */
    readonly roots: Map<string, number>;
    /** Aborts every root of this code version (forced retirement). */
    readonly abort: AbortController;
}
/** A host whose principals are `P` (the app's type; `unknown` if not given). */
export declare function createHost<P = unknown>(options: HostOptions<P>): Host<P>;
export declare class HostImpl implements Host, HostCore {
    #private;
    readonly name: string;
    readonly dev: boolean;
    readonly principal: unknown;
    inFactory: number;
    failed: unknown;
    readonly objects: Map<string, ObjectImpl>;
    readonly codeVersions: Map<number, CodeVersionState>;
    readonly facets: Map<string, Facet<unknown>>;
    /** The host's own references to its `lifetime: "host"` objects, by type name. */
    readonly hostObjects: Map<string, RefCore>;
    readonly kind: "host" | "client";
    readonly connections: Set<Connection>;
    upstream: Connection | undefined;
    /** Shared bindings of this host's remote references, by key (re-held after an upstream reconnect). */
    readonly bindings: Map<string, RemoteBinding>;
    /** Child facet modules by host-name prefix, from every committed cluster reload (for reconciling children). */
    remoteModules: Record<string, string[]>;
    /** Removal tombstones also reconcile children that connected during a transaction. */
    remoteRemoved: Record<string, string[]>;
    current: CodeVersionState;
    previous: CodeVersionState | undefined;
    /** The code version a running reload will commit; new types activated during prepare install their implementation for it. */
    pending: CodeVersionState | undefined;
    /** Activations of these types wait (reload gate). */
    /** Types behind a reload gate: new objects of these types are rejected `upgrade_conflict` until commit/abort. */
    gating: ReadonlySet<string> | undefined;
    reloading: boolean;
    readonly taskStopDeadline: number;
    readonly readyTimeout: number;
    constructor(options: HostOptions);
    /** Whether `principal` is the host's own: the same key as `self`. */
    isSelf(principal: unknown): boolean;
    get codeVersion(): number;
    get previousCodeVersion(): number | undefined;
    /** Allocates the next code version id, or adopts one issued by the coordinating server. */
    nextCodeVersionId(given?: number): number;
    report(error: unknown): void;
    readonly serve: Serve;
    install(facet: Facet, options?: LoadOptions): Promise<void>;
    load(plugins: readonly PluginRef[], options?: LoadOptions): Promise<void>;
    ready(): Promise<void>;
    /** Turns plugin references into facets, importing modules through the loader. */
    resolve(plugins: readonly PluginRef[]): Promise<Facet[]>;
    facetApi(serve: Serve, signal: AbortSignal): FacetApi;
    /** The installed run of facet `name` is now `run` (or none): the run it replaces is aborted. */
    facetRunChanged(name: string, run: AbortController | undefined): void;
    serveInto(services: Map<string, Service>, service: Service): void;
    startHostObject(service: Service): RefCore;
    currentCodeVersion(): number;
    hasCodeVersion(codeVersion: number): boolean;
    retainedCodeVersions(): Iterable<readonly [number, ReadonlyMap<string, Service>]>;
    pendingCodeVersion(): number | undefined;
    /** The current code for a type; a type a running reload adds is served from the pending code version. */
    service(typeName: string): Service | undefined;
    addressOf(type: AnyContract, input: unknown, principal: unknown, candidate?: boolean): string;
    acquire(type: AnyContract, input: unknown, options: GetOptions | undefined, owner: RefOwner, from?: ObjectImpl, candidate?: boolean): RefCore;
    forget(object: ObjectImpl): void;
    disposed(object: ObjectImpl): void;
    touch(rootId: string, object: ObjectImpl): void;
    root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: RootOptions): Promise<T>;
    /**
     * Runs `fn` inside root `rootId` of `codeVersion`. A root counts as running here (for retirement) while any of its
     * calls runs here. A root that started here ends when its last call here settles, even if it went out and came back
     * over a link meanwhile. A foreign root (started elsewhere, arriving `from` a link) keeps its leases on objects
     * until every link it came over announced its end (`root_end`) or closed, so its re-entry stays grandfathered.
     */
    joinRoot<T>(rootId: string, codeVersionId: number, fn: (ctx: Ctx) => T | Promise<T>, options?: {
        readonly principal?: unknown;
        readonly signal?: AbortSignal;
        readonly from?: Connection;
    }): Promise<T>;
    /** Remembers that calls of `rootId` went out on `connection`, which must hear when the root ends. */
    rootSent(rootId: string, connection: Connection): void;
    /** A root ended (here, or announced by its origin): end its leases and tell the links it went out on. */
    endRoot(rootId: string): void;
    /**
     * `from` announced the end of a foreign root (or closed). Honored only if the root came over `from`: a peer cannot
     * end leases of roots it never carried. The root ends when no link that brought it remains.
     */
    foreignRootEnded(rootId: string, from: Connection): void;
    /**
     * Retires the previous code version once no local roots of it remain. A child also waits for its parent to retire
     * it: roots span hosts, and an old root on the server may still call in.
     */
    maybeRetire(): void;
    /** The previous code version has no roots left here and, on a child host, the parent has retired it. */
    retirable(): boolean;
    allowRetire(codeVersion: number): void;
    /** Calls `watcher` whenever a root ends, the parent allows a retirement, or a code version retires. */
    watchRetirement(watcher: () => void): () => void;
    /**
     * Tells a child that is now in step which code versions this host retired before: every id below the oldest one it
     * retains (ids only grow). Without it, a child reconciled after those retirements would never hear a `retire` frame for
     * its own previous code version and would wait for the retire deadline at every reload.
     */
    announceRetired(connection: Connection): void;
    /** Drops the previous code version: its implementations and the declarations only it used. */
    retire(): void;
    /**
     * Drops an object's implementation for `codeVersion` and what only that implementation declared, in disposal order:
     * resources close (reverse open order) before its references are released.
     */
    retireImplementation(object: ObjectImpl, codeVersion: number): void;
    registry<V>(registry: Registry<V>): RegistryView<V>;
    /** Builds registry tables from (object, declarations) pairs. Throws registry_conflict. */
    buildTables(entries: Iterable<readonly [ObjectImpl, Decls]>): Map<string, RegistryTable<unknown>>;
    /** Live objects with their current declarations; objects waiting for a reload's commit only with `candidates`. */
    liveDecls(candidates?: boolean): [ObjectImpl, Decls][];
    checkRegistrations(object: ObjectImpl, decls: Decls): void;
    registriesChanged(including?: ObjectImpl): void;
    /** A commit failed midway: from now on this host admits no work (calls fail `unavailable/host_failed`). */
    fail(error: unknown): void;
    /** Installs tables for `codeVersion`; subscribers hear about changed tables of the current code version (all tables when `all`). */
    installTables(codeVersion: CodeVersionState, tables: Map<string, RegistryTable<unknown>>, all?: boolean): void;
    get<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions & {
        readonly signal?: AbortSignal;
    }): Promise<Ref<C>>;
    hold<C extends AnyContract>(type: C, input: InputOf<C>, options?: GetOptions): Ref<C>;
    invalidatePrincipal(match: PrincipalMatch): Promise<void>;
    accept(link: Link, options: AcceptOptions): void;
    connect(link: Link, options: ConnectOptions): void;
    route(prefix: string, route: Route): void;
    /**
     * A child host announced its code version. In step: usable. Behind: fenced (nothing is routed to it) and reconciled
     * by a reload of its modules to this host's code version, never by renumbering what it runs. Ahead: impossible,
     * refused.
     */
    peerHello(connection: Connection, codeVersion: number): void;
    /** The host's reload slot was freed: children that said hello meanwhile are synced or reconciled now. */
    reloadEnded(): void;
    /** Resolves once no reload runs on this host. */
    whenReloadEnded(): Promise<void>;
    connectionClosed(connection: Connection): void;
    /** The last reference to `binding` was released: it lingers if its type does (`HostOptions.linger`), else closes. */
    bindingIdle(binding: RemoteBinding): void;
    forgetBinding(binding: RemoteBinding): void;
    /**
     * Relays a reference from `relay.origin` to the host it names. Relaying needs a route: it is where authorization
     * lives. The origin's authorization generation is re-checked after every await and right before forwarding, so a
     * revocation during resolution wins.
     */
    relay(relay: RelayRef): Promise<void>;
    reload(plugins: readonly PluginRef[], options?: ReloadOptions): Promise<ReloadReport>;
    onReloadFrame(connection: Connection, frame: Extract<Frame, {
        t: "prepare" | "commit" | "abort";
    }>): void;
    rememberRemoteModules(remote: Readonly<Record<string, readonly string[]>> | undefined, remove: Readonly<Record<string, readonly string[]>> | undefined): void;
    /** The code version id the next reload would commit. */
    peekNextCodeVersion(): number;
    /**
     * Disposes every object, holders before what they reference (a resource's `close` may still use the objects its object
     * references, local or remote), then closes the links.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=host.d.ts.map