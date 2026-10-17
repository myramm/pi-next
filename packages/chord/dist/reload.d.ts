import type { Cell } from "./cell.ts";
import { ChordError } from "./errors.ts";
import type { Facet, HostImpl, PluginRef } from "./host.ts";
import { type ObjectImpl, type ResourceImpl, type Run, type Service, type StagedListeners } from "./object.ts";
import type { RegistryTable } from "./registry.ts";
export interface ReloadOptions {
    /** Facet names to remove. */
    readonly remove?: readonly string[];
    /** Milliseconds the gate waits for grandfathered roots (default 5000). Missed: the reload aborts. */
    readonly gateDeadline?: number;
    /** Milliseconds to wait for the previous code version to retire first (default 5000). Missed: it is retired anyway. */
    readonly retireDeadline?: number;
    /** Server: facet modules for child hosts by host-name prefix (longest wins). Every connected host participates. */
    readonly remote?: Readonly<Record<string, readonly string[]>>;
    /** Server: facet names to remove on child hosts, by the same host-name prefix rules. */
    readonly remoteRemove?: Readonly<Record<string, readonly string[]>>;
    /** Server: milliseconds to wait for every child's vote (default: gate + retire deadlines + 5000). */
    readonly voteDeadline?: number;
}
export interface ReloadReport {
    readonly codeVersion: number;
    readonly previous: number;
    readonly changed: readonly string[];
    readonly removed: readonly string[];
    /** Addresses of objects whose new factory was installed. */
    readonly prepared: readonly string[];
    /** Addresses of objects that went through the gate. */
    readonly gated: readonly string[];
    /**
     * Cluster reloads: what each participating child host prepared, by host name (its vote; the child commits it after
     * the server). Absent for local reloads.
     */
    readonly children?: Readonly<Record<string, ReloadReport>>;
}
interface Candidate {
    readonly object: ObjectImpl;
    readonly service: Service;
    readonly run: Run;
    /** Why the object needs the gate (empty: compatible). */
    readonly reasons: string[];
    /** New exclusive resources and their new dependents, opened at the gate. */
    readonly atGate: ResourceImpl[];
    /** Old exclusive resources closed at the gate. */
    readonly replaced: ResourceImpl[];
    readonly migrated: Map<Cell<unknown>, unknown>;
    /** Values of the run's derivations over the candidate (migrated) values, validated. */
    derived: Map<unknown, unknown>;
    /** Listener subscriptions made at the end of prepare, activated by the commit. */
    staged: StagedListeners | undefined;
}
/** A reload error keeps the underlying code (`contract_mismatch`, `invalid`, ...) and says it aborted the reload. */
export declare function reloadError(error: unknown): ChordError;
/** Serialized: a second reload while one runs is rejected. */
export declare function runReload(host: HostImpl, plugins: readonly PluginRef[], options: ReloadOptions): Promise<ReloadReport>;
/** Takes the host's reload slot and loads the plugin modules. Pair with `endReload`. */
export declare function beginReload(host: HostImpl, plugins: readonly PluginRef[], options: ReloadOptions, codeVersion?: number): Promise<Reload>;
export declare function endReload(host: HostImpl): void;
/** One reload on one host: `prepare` (load, prepare, gate), then `commit` or `rollback`. */
export declare class Reload {
    #private;
    readonly host: HostImpl;
    readonly facets: readonly Facet[];
    readonly options: ReloadOptions;
    /** Code version id to commit (issued by the coordinating server); a local reload allocates one. */
    readonly codeVersion: number | undefined;
    readonly candidates: Map<ObjectImpl, Candidate>;
    readonly abort: AbortController;
    readonly closed: [ObjectImpl, ResourceImpl][];
    services: Map<string, Service>;
    changed: Set<string>;
    removed: Set<string>;
    tables: Map<string, RegistryTable<unknown>>;
    gated: Candidate[];
    rolledBack: boolean;
    /** Objects of types this reload adds, with their staged listeners: their runtime starts at commit. */
    readonly deferred: Map<ObjectImpl, StagedListeners>;
    /** This reload's run of each facet it loads (`FacetApi.signal`): installed at commit, aborted at rollback. */
    readonly facetRuns: Map<string, AbortController>;
    constructor(host: HostImpl, facets: readonly Facet[], options: ReloadOptions, codeVersion?: number);
    /** Everything up to the commit. On failure the host is rolled back and the underlying error is thrown. */
    prepare(): Promise<void>;
    /** What a successful prepare will commit (a child sends it with its vote). */
    summary(): ReloadReport;
    /**
     * Retires the previous code version before loading the next one (a host keeps two). Waits until its roots ended and,
     * on a child host, its parent retired it too (`retire` frame), at most `retireDeadline`. Past the deadline it is
     * retired anyway: its remaining roots are aborted first and get a short grace to stop, so they see cancellation
     * before the resources only that code version used are closed; their next call is `superseded`.
     */
    waitForRetirement(): Promise<void>;
    /** Builds the candidate service table: unchanged services plus everything the given facets serve. */
    load(): void;
    withDeadline<T>(promise: Promise<T>, what: string): Promise<T>;
    /** Same contract version must cover the old description (forgotten bump); facets' `uses` must bind. */
    checkProviders(): void;
    /**
     * Prepares every live object of a changed type, including objects that activate meanwhile, to a fixpoint. Objects
     * already running the new code (types this reload adds) are skipped.
     */
    prepareAll(): Promise<void>;
    /** Runs the new factory in recording mode and opens what can be opened without the gate. */
    prepareObject(object: ObjectImpl): Promise<void>;
    /**
     * Every reference that survives into the new code version must bind to the new provider. Browser references don't block a
     * reload: after the commit they get `upgrade_required` instead.
     */
    checkRefs(): void;
    entries(): [ObjectImpl, Run["decls"]][];
    /**
     * Admission cut, wait for grandfathered roots (deadline), replace exclusive resources, migrate into private
     * copies. Old tasks of gated objects are stopped at the cut; listener events are queued until commit or abort.
     */
    gate(): Promise<void>;
    migrate(candidate: Candidate): void;
    rollback(): Promise<void>;
    /**
     * Publishes the new code version in one synchronous step. Everything fallible ran in prepare (factories, opens,
     * migration and derivation checks against the prospective schemas, listener subscriptions), so this only installs.
     * Observers (state, shapes, registries, listener roots) are notified after the whole step. If an install still
     * throws, the code version is half-published: the host fails terminally and admits no more work.
     */
    commit(beforeStart?: () => void): ReloadReport;
    install(candidate: Candidate, codeVersion: number): void;
}
export {};
//# sourceMappingURL=reload.d.ts.map