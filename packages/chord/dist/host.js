import { ChildReloads, reconcileChild, runClusterReload } from "./cluster.js";
import { Connection } from "./connection.js";
import { bind, contractFromDescription, placedOn, placementText, resolveHost, } from "./contract.js";
import { ChordError, invalid, runAll } from "./errors.js";
import { awaitReady, CtxImpl, hostLifetime, makeService, ObjectImpl, RefImpl, } from "./object.js";
import { enqueue } from "./publish.js";
import { runReload } from "./reload.js";
import { RemoteBinding, RemoteRef } from "./remote.js";
import { canonicalIdentity, canonicalJson, deepEqual, normalize } from "./schema.js";
/** `defineFacet<P>(…)`: an app passes its principal type, so factories and contexts see `P`. */
export const defineFacet = (setup, options = {}) => ({ setup, uses: options.uses });
const isFacet = (ref) => typeof ref === "object" && !(ref instanceof URL);
const EMPTY_TABLE = new Map();
/** A host whose principals are `P` (the app's type; `unknown` if not given). */
export function createHost(options) {
    return new HostImpl(options);
}
export class HostImpl {
    name;
    dev;
    principal;
    inFactory = 0;
    failed;
    objects = new Map();
    codeVersions = new Map();
    facets = new Map();
    /** The host's own references to its `lifetime: "host"` objects, by type name. */
    hostObjects = new Map();
    kind;
    connections = new Set();
    upstream;
    /** Shared bindings of this host's remote references, by key (re-held after an upstream reconnect). */
    bindings = new Map();
    /** Bindings without references that linger, least recently released first. */
    #lingering = new Map();
    #lingerTypes;
    #lingerCap;
    #originSeq = 0;
    #routes = new Map();
    #childReloads = new ChildReloads(this);
    /** Child facet modules by host-name prefix, from every committed cluster reload (for reconciling children). */
    remoteModules = {};
    /** Removal tombstones also reconcile children that connected during a transaction. */
    remoteRemoved = {};
    /** Highest code version the parent has retired. */
    #retireAllowed = 0;
    /** Roots that came over a link, by the link they came from. */
    /** Foreign roots (started on another host), by the links they came over. */
    #foreign = new Map();
    /** Roots started on this host that have not ended. */
    #local = new Set();
    #incarnation = Math.random().toString(36).slice(2, 8);
    /** Links each root's calls went out on. */
    #rootLinks = new Map();
    current;
    previous;
    /** The code version a running reload will commit; new types activated during prepare install their implementation for it. */
    pending;
    /** Activations of these types wait (reload gate). */
    /** Types behind a reload gate: new objects of these types are rejected `upgrade_conflict` until commit/abort. */
    gating;
    reloading = false;
    taskStopDeadline;
    readyTimeout;
    #principalKey;
    /** `principalKey(self)`: an equal principal is the host's own, whatever object carries it. */
    #selfKey;
    /** Called when a root ends, the parent allows a retirement, or the previous code version retires. */
    #retirementWatchers = new Set();
    /** Child hosts whose hello arrived while a reload ran: synced or reconciled once it ends. */
    #deferredHellos = new Map();
    /** Resolved when the running reload ends. */
    #reloadWaiters = [];
    /** Aborted when the installed run of a facet (by name) is replaced, removed, or the host closes. */
    #facetRuns = new Map();
    #onError;
    #loader;
    #dying = new Map();
    #touches = new Map();
    #order = new Map();
    #subscribers = new Map();
    #codeVersionSeq = 1;
    #rootSeq = 0;
    constructor(options) {
        this.name = options.name ?? "host";
        this.dev = options.dev ?? false;
        if (!("self" in options))
            throw new TypeError("createHost needs `self`: the principal of the host's own code");
        this.principal = options.self;
        this.#principalKey = options.principalKey ?? canonicalJson;
        this.#selfKey = this.#principalKey(options.self);
        this.#onError = options.onError ?? ((error) => console.error("chord:", error));
        this.#loader = options.loader;
        this.taskStopDeadline = options.taskStopDeadline ?? 5000;
        this.readyTimeout = options.readyTimeout ?? 60_000;
        this.#lingerTypes = options.linger?.types ?? {};
        this.#lingerCap = options.linger?.cap ?? 4;
        this.current = {
            id: this.#codeVersionSeq,
            services: new Map(),
            tables: new Map(),
            roots: new Map(),
            abort: new AbortController(),
        };
        this.codeVersions.set(this.current.id, this.current);
        this.kind = options.kind ?? "host";
        if (options.upstream !== undefined)
            this.connect(options.upstream.link, options.upstream);
    }
    /** Whether `principal` is the host's own: the same key as `self`. */
    isSelf(principal) {
        return principal === this.principal || this.#principalKey(principal) === this.#selfKey;
    }
    get codeVersion() {
        return this.current.id;
    }
    get previousCodeVersion() {
        return this.previous?.id;
    }
    /** Allocates the next code version id, or adopts one issued by the coordinating server. */
    nextCodeVersionId(given) {
        if (given !== undefined && given <= this.current.id)
            throw new Error(`code version ${given} is not newer than ${this.current.id}`);
        this.#codeVersionSeq = given ?? this.#codeVersionSeq + 1;
        return this.#codeVersionSeq;
    }
    report(error) {
        this.#onError(error);
    }
    // ─── serving ───
    serve = ((type, factory, options = {}) => {
        if (this.reloading)
            throw new Error("host.serve during a reload; serve from a facet passed to reload()");
        this.serveInto(this.current.services, makeService(type, factory, options, ""));
        if (options.lifetime === "host")
            this.startHostObject(this.current.services.get(type.name));
    });
    install(facet, options = {}) {
        if (this.reloading)
            throw new Error("host.install during a reload");
        if (this.facets.has(facet.name))
            throw new Error(`facet ${facet.name} is already installed; use reload()`);
        const added = [];
        const run = new AbortController();
        try {
            facet.setup(this.facetApi(((type, factory, options = {}) => {
                const service = makeService(type, factory, options, facet.name);
                this.serveInto(this.current.services, service);
                added.push(service);
            }), run.signal));
        }
        catch (error) {
            run.abort(error);
            throw error;
        }
        this.facets.set(facet.name, facet);
        this.facetRunChanged(facet.name, run);
        const refs = added.filter(hostLifetime).map((service) => this.startHostObject(service));
        return options.awaitHostObjects === false ? Promise.resolve() : this.#hostObjectsReady(refs);
    }
    async load(plugins, options = {}) {
        const facets = await this.resolve(plugins);
        // No await between installs: a host object's factory may consume a type served by a later facet.
        await Promise.all(facets.map((facet) => this.install(facet, options)));
    }
    ready() {
        return this.#hostObjectsReady(this.hostObjects.values());
    }
    #hostObjectsReady(refs) {
        const ready = Promise.all([...refs].map((ref) => ref.ready)).then(() => { });
        // Ignoring install's return still reports through onError without an unhandled rejection.
        ready.catch(() => { });
        return ready;
    }
    /** Turns plugin references into facets, importing modules through the loader. */
    async resolve(plugins) {
        const modules = plugins.filter((ref) => !isFacet(ref));
        if (modules.length > 0 && this.#loader === undefined) {
            throw new Error("loading modules needs createHost({ loader }), e.g. nodeLoader from @earendil-works/chord/node");
        }
        const loaded = modules.length > 0 && this.#loader !== undefined ? await this.#loader(modules) : [];
        return plugins.map((ref) => (isFacet(ref) ? ref : loaded.shift()));
    }
    facetApi(serve, signal) {
        return {
            serve,
            name: this.name,
            root: (fn, options) => this.root(fn, options),
            registry: (registry) => this.registry(registry),
            signal,
        };
    }
    /** The installed run of facet `name` is now `run` (or none): the run it replaces is aborted. */
    facetRunChanged(name, run) {
        const replaced = this.#facetRuns.get(name);
        if (run === undefined)
            this.#facetRuns.delete(name);
        else
            this.#facetRuns.set(name, run);
        if (replaced !== run)
            replaced?.abort(new ChordError("gone", `facet ${name} was replaced or removed`));
    }
    serveInto(services, service) {
        if (services.has(service.contract.name))
            throw new Error(`${service.contract.name} is already served`);
        const placement = service.contract.description.host;
        if (placement !== undefined && !placedOn(placement, this.name)) {
            throw new TypeError(`${service.contract.name} is declared for ${placementText(placement)}, but ${this.name} serves it`);
        }
        services.set(service.contract.name, service);
    }
    startHostObject(service) {
        const ref = this.acquire(service.contract, {}, undefined, "host");
        this.hostObjects.set(service.contract.name, ref);
        ref.ready.catch((error) => this.report(error));
        return ref;
    }
    // ─── HostCore ───
    currentCodeVersion() {
        return this.current.id;
    }
    hasCodeVersion(codeVersion) {
        return this.codeVersions.has(codeVersion);
    }
    *retainedCodeVersions() {
        for (const [id, state] of this.codeVersions)
            yield [id, state.services];
        if (this.pending !== undefined)
            yield [this.pending.id, this.pending.services];
    }
    pendingCodeVersion() {
        return this.pending?.id;
    }
    /** The current code for a type; a type a running reload adds is served from the pending code version. */
    service(typeName) {
        return this.current.services.get(typeName) ?? this.pending?.services.get(typeName);
    }
    addressOf(type, input, principal, candidate = false) {
        const elsewhere = this.#elsewhere(type, input);
        if (elsewhere !== undefined)
            return this.#remoteKey(type, elsewhere.input, principal);
        const service = this.#bindingService(type.name, candidate);
        if (service === undefined)
            throw unknownType(type.name, this.name);
        return this.#locate(service, input, principal).address;
    }
    /**
     * Where an object of a remote type lives when that is another host: its name and the input normalized with the
     * caller's contract (the placement is read from it). `undefined`: here (and every local type).
     */
    #elsewhere(type, input) {
        const placement = type.description.host;
        if (type.scope !== "remote" || placement === undefined)
            return undefined;
        const normalized = normalize(type.input, input, `${type.name} input`);
        const at = resolveHost(type.name, placement, normalized);
        return at === this.name ? undefined : { at, input: normalized };
    }
    /**
     * The address of `input` for `principal`, normalized. A `lifetime: "host"` type has one object: the empty input, for
     * the host principal, whoever asks; another input is invalid.
     */
    #locate(service, input, principal) {
        const { name, input: schema } = service.contract;
        const normalized = normalize(schema, input, `${name} input`);
        const identity = canonicalIdentity(schema, normalized);
        if (hostLifetime(service)) {
            if (identity !== canonicalIdentity(schema, normalize(schema, {}, `${name} input`)))
                throw invalid("input", `${name} has lifetime "host": its one object has the empty input`);
            principal = this.principal;
        }
        return { address: `${name}\u0000${identity}\u0000${this.#principalPart(principal)}`, normalized, principal };
    }
    #principalPart(principal) {
        return this.isSelf(principal) ? "host" : `p:${this.#principalKey(principal)}`;
    }
    /**
     * The key of a remote binding: type, input identity (fields equal to their defaults omitted, as for local objects),
     * principal key and the consumer's contract fingerprint. No host name: the type and the input decide where it lives.
     */
    #remoteKey(type, normalized, principal) {
        const identity = canonicalIdentity(type.input, normalized);
        return `@${type.name}\u0000${identity}\u0000${this.#principalPart(principal)}\u0000${type.fingerprint}`;
    }
    acquire(type, input, options, owner, from, candidate = false) {
        const elsewhere = this.#elsewhere(type, input);
        if (elsewhere !== undefined)
            return this.#acquireRemote(type, elsewhere.at, elsewhere.input, options, owner);
        const service = this.#bindingService(type.name, candidate);
        if (service === undefined)
            throw unknownType(type.name, this.name);
        bind(service.contract, service.options.accepts, type);
        const { address, normalized, principal } = this.#locate(service, input, options?.principal ?? this.principal);
        // The provider's own placement decides, never where a request says it is going (a client picks that).
        const placement = service.contract.description.host;
        if (placement !== undefined && resolveHost(type.name, placement, normalized) !== this.name) {
            throw invalid("placement", `${type.name} with this input lives on ${resolveHost(type.name, placement, normalized)}, not ${this.name}`);
        }
        let object = this.objects.get(address);
        if (from !== undefined && object !== undefined && (object === from || reaches(object, from))) {
            throw invalid("cycle", `${from.address} -> ${address} would create a ref cycle`);
        }
        if (object === undefined) {
            if (this.gating?.has(type.name)) {
                throw new ChordError("upgrade_conflict", `${type.name} is being upgraded; retry`, { reason: "gate" });
            }
            const dying = this.#dying.get(address);
            if (dying?.status === "disposed")
                this.#dying.delete(address);
            object = new ObjectImpl(this, {
                address,
                typeName: type.name,
                input: normalized,
                principal,
                hostLifetime: hostLifetime(service),
            });
            this.objects.set(address, object);
            // A new object for an address still being disposed waits for that cleanup (exclusive resources).
            object.start(dying?.status === "disposing" ? dying.dispose(false) : undefined);
        }
        const ref = new RefImpl(object, type, owner);
        object.addRef(ref);
        return ref;
    }
    forget(object) {
        if (this.objects.get(object.address) === object)
            this.objects.delete(object.address);
        if (object.status === "disposing")
            this.#dying.set(object.address, object);
    }
    disposed(object) {
        if (this.#dying.get(object.address) === object)
            this.#dying.delete(object.address);
    }
    touch(rootId, object) {
        let touched = this.#touches.get(rootId);
        if (touched === undefined) {
            touched = new Set();
            this.#touches.set(rootId, touched);
        }
        touched.add(object);
    }
    // ─── roots ───
    async root(fn, options = {}) {
        // The incarnation keeps root ids unique across restarts of a host with the same name.
        const rootId = `${this.name}#${this.#incarnation}:${++this.#rootSeq}`;
        this.#local.add(rootId);
        return this.joinRoot(rootId, options.codeVersion ?? this.current.id, fn, options);
    }
    /**
     * Runs `fn` inside root `rootId` of `codeVersion`. A root counts as running here (for retirement) while any of its
     * calls runs here. A root that started here ends when its last call here settles, even if it went out and came back
     * over a link meanwhile. A foreign root (started elsewhere, arriving `from` a link) keeps its leases on objects
     * until every link it came over announced its end (`root_end`) or closed, so its re-entry stays grandfathered.
     */
    async joinRoot(rootId, codeVersionId, fn, options = {}) {
        const codeVersion = this.codeVersions.get(codeVersionId);
        if (codeVersion === undefined) {
            this.#local.delete(rootId);
            throw new ChordError("superseded", `code version ${codeVersionId} is not retained by ${this.name}`);
        }
        if (options.from !== undefined && !this.#local.has(rootId)) {
            let links = this.#foreign.get(rootId);
            if (links === undefined) {
                links = new Set();
                this.#foreign.set(rootId, links);
            }
            links.add(options.from);
        }
        codeVersion.roots.set(rootId, (codeVersion.roots.get(rootId) ?? 0) + 1);
        const ctx = new CtxImpl(this, {
            // Forced retirement aborts what still runs on a code version before closing what only it used.
            signals: options.signal === undefined ? [codeVersion.abort.signal] : [options.signal, codeVersion.abort.signal],
            rootId,
            codeVersion: codeVersion.id,
            principal: options.principal ?? this.principal,
        });
        try {
            return await fn(ctx);
        }
        finally {
            ctx.close();
            const count = (codeVersion.roots.get(rootId) ?? 1) - 1;
            if (count > 0)
                codeVersion.roots.set(rootId, count);
            else {
                codeVersion.roots.delete(rootId);
                if (!this.#foreign.has(rootId))
                    this.endRoot(rootId);
                this.maybeRetire();
                this.#retirementChanged();
            }
        }
    }
    /** Remembers that calls of `rootId` went out on `connection`, which must hear when the root ends. */
    rootSent(rootId, connection) {
        let links = this.#rootLinks.get(rootId);
        if (links === undefined) {
            links = new Set();
            this.#rootLinks.set(rootId, links);
        }
        links.add(connection);
    }
    /** A root ended (here, or announced by its origin): end its leases and tell the links it went out on. */
    endRoot(rootId) {
        this.#local.delete(rootId);
        this.#foreign.delete(rootId);
        for (const object of this.#touches.get(rootId) ?? [])
            object.rootEnded(rootId);
        this.#touches.delete(rootId);
        for (const connection of this.#rootLinks.get(rootId) ?? [])
            connection.send({ t: "root_end", rootId });
        this.#rootLinks.delete(rootId);
    }
    /**
     * `from` announced the end of a foreign root (or closed). Honored only if the root came over `from`: a peer cannot
     * end leases of roots it never carried. The root ends when no link that brought it remains.
     */
    foreignRootEnded(rootId, from) {
        const links = this.#foreign.get(rootId);
        if (links === undefined || !links.delete(from) || links.size > 0)
            return;
        const running = [...this.codeVersions.values()].some((codeVersion) => codeVersion.roots.has(rootId));
        // Still running here (a call in flight): the lease ends when it settles.
        if (running)
            this.#foreign.delete(rootId);
        else
            this.endRoot(rootId);
    }
    /**
     * Retires the previous code version once no local roots of it remain. A child also waits for its parent to retire
     * it: roots span hosts, and an old root on the server may still call in.
     */
    maybeRetire() {
        if (this.retirable())
            this.retire();
    }
    /** The previous code version has no roots left here and, on a child host, the parent has retired it. */
    retirable() {
        const previous = this.previous;
        if (previous === undefined || previous.roots.size > 0)
            return false;
        return this.kind === "client" || this.upstream === undefined || previous.id <= this.#retireAllowed;
    }
    allowRetire(codeVersion) {
        this.#retireAllowed = Math.max(this.#retireAllowed, codeVersion);
        this.maybeRetire();
        this.#retirementChanged();
    }
    /** Calls `watcher` whenever a root ends, the parent allows a retirement, or a code version retires. */
    watchRetirement(watcher) {
        this.#retirementWatchers.add(watcher);
        return () => this.#retirementWatchers.delete(watcher);
    }
    #retirementChanged() {
        for (const watcher of [...this.#retirementWatchers])
            watcher();
    }
    /**
     * Tells a child that is now in step which code versions this host retired before: every id below the oldest one it
     * retains (ids only grow). Without it, a child reconciled after those retirements would never hear a `retire` frame for
     * its own previous code version and would wait for the retire deadline at every reload.
     */
    announceRetired(connection) {
        const retired = (this.previous ?? this.current).id - 1;
        if (retired > 0)
            connection.send({ t: "retire", codeVersion: retired });
    }
    /** Drops the previous code version: its implementations and the declarations only it used. */
    retire() {
        const previous = this.previous;
        if (previous === undefined)
            return;
        this.previous = undefined;
        this.codeVersions.delete(previous.id);
        for (const object of [...this.objects.values()])
            this.retireImplementation(object, previous.id);
        for (const connection of this.connections) {
            if (connection.role === "downstream" && connection.peer?.kind === "host")
                connection.send({ t: "retire", codeVersion: previous.id });
        }
        this.#retirementChanged();
    }
    /**
     * Drops an object's implementation for `codeVersion` and what only that implementation declared, in disposal order:
     * resources close (reverse open order) before its references are released.
     */
    retireImplementation(object, codeVersion) {
        const installed = object.implementations.get(codeVersion);
        object.implementations.delete(codeVersion);
        if (installed === undefined || installed.decls === object.decls)
            return;
        const kept = object.allDecls();
        const keep = (pick) => new Set([...kept].flatMap((decls) => [...pick(decls)]));
        const refs = keep((decls) => decls.refs.values());
        const resources = keep((decls) => decls.resources.values());
        const derives = keep((decls) => decls.derives.values());
        for (const derived of installed.decls.derives.values())
            if (!derives.has(derived))
                derived.detach();
        const closing = [...installed.decls.resources.values()]
            .filter((resource) => !resources.has(resource))
            .sort((a, b) => object.openOrder.indexOf(b) - object.openOrder.indexOf(a));
        const releasing = [...installed.decls.refs.values()].filter((ref) => !refs.has(ref));
        object.refreshSchemas();
        runAll([
            ...closing.map((resource) => () => resource.close(object.openOrder)),
            ...releasing.map((ref) => () => ref.release()),
        ], `${object.address}: retiring code version ${codeVersion} failed`).catch((error) => this.report(error));
    }
    // ─── registries ───
    registry(registry) {
        const table = (ctx) => {
            const codeVersion = ctx === undefined ? this.current : this.codeVersions.get(ctx.codeVersion);
            if (codeVersion === undefined)
                throw new ChordError("superseded", `code version ${ctx?.codeVersion} is retired`);
            return (codeVersion.tables.get(registry.name) ?? EMPTY_TABLE);
        };
        return {
            table,
            get: (key, ctx) => table(ctx).get(key),
            subscribe: (listener) => {
                let set = this.#subscribers.get(registry.name);
                if (set === undefined) {
                    set = new Set();
                    this.#subscribers.set(registry.name, set);
                }
                const wrapped = listener;
                set.add(wrapped);
                wrapped(table(), this.current.id);
                return () => set.delete(wrapped);
            },
        };
    }
    /** Builds registry tables from (object, declarations) pairs. Throws registry_conflict. */
    buildTables(entries) {
        const byRegistry = new Map();
        for (const [object, decls] of entries) {
            for (const { registry, key, value } of decls.registrations.values()) {
                let entries = byRegistry.get(registry.name);
                if (entries === undefined) {
                    entries = new Map();
                    byRegistry.set(registry.name, entries);
                }
                const existing = entries.get(key);
                if (existing !== undefined && existing.object !== object && registry.conflict === "error") {
                    throw invalid("registry_conflict", `${registry.name}: ${key} registered by ${existing.object.address} and ${object.address}`);
                }
                entries.set(key, { value, object });
                let order = this.#order.get(registry.name);
                if (order === undefined) {
                    order = new Map();
                    this.#order.set(registry.name, order);
                }
                if (!order.has(key))
                    order.set(key, order.size);
            }
        }
        const tables = new Map();
        for (const [name, entries] of byRegistry) {
            const order = this.#order.get(name);
            const sorted = [...entries].sort(([a], [b]) => order.get(a) - order.get(b));
            tables.set(name, new Map(sorted.map(([key, entry]) => [key, entry.value])));
        }
        return tables;
    }
    /**
     * The service a reference binds against: the current one, or for a prepare rerun (`candidate`) the running reload's
     * pending one, so consumer and provider of a breaking change can reload in one batch.
     */
    #bindingService(typeName, candidate) {
        return (candidate ? this.pending?.services.get(typeName) : undefined) ?? this.service(typeName);
    }
    /** Live objects with their current declarations; objects waiting for a reload's commit only with `candidates`. */
    liveDecls(candidates = false) {
        return [...this.objects.values()]
            .filter((object) => object.status === "live" && (candidates || !object.deferredRuntime))
            .map((object) => [object, object.decls]);
    }
    checkRegistrations(object, decls) {
        if (decls.registrations.size === 0)
            return;
        this.buildTables([...this.liveDecls().filter(([other]) => other !== object), [object, decls]]);
    }
    registriesChanged(including) {
        const entries = this.liveDecls().filter(([object]) => object !== including);
        if (including !== undefined)
            entries.push([including, including.decls]);
        this.installTables(this.current, this.buildTables(entries));
    }
    /** A commit failed midway: from now on this host admits no work (calls fail `unavailable/host_failed`). */
    fail(error) {
        this.failed ??= error;
        this.report(error);
    }
    /** Installs tables for `codeVersion`; subscribers hear about changed tables of the current code version (all tables when `all`). */
    installTables(codeVersion, tables, all = false) {
        const before = codeVersion.tables;
        codeVersion.tables = tables;
        if (codeVersion !== this.current)
            return;
        for (const [name, listeners] of this.#subscribers) {
            const next = tables.get(name) ?? EMPTY_TABLE;
            if (!all && sameTable(before.get(name) ?? EMPTY_TABLE, next))
                continue;
            const current = [...listeners];
            enqueue(() => {
                for (const listener of current) {
                    try {
                        listener(next, codeVersion.id);
                    }
                    catch (error) {
                        this.report(error);
                    }
                }
            });
        }
    }
    // ─── public API ───
    async get(type, input, options) {
        const ref = this.acquire(type, input, options, "external");
        await awaitReady(ref, options?.signal === undefined ? [] : [options.signal], this.readyTimeout);
        return ref.proxy;
    }
    hold(type, input, options) {
        return this.acquire(type, input, options, "external").proxy;
    }
    async invalidatePrincipal(match) {
        const matches = typeof match === "function" ? match : (principal) => matchesPattern(match, principal);
        const reason = new ChordError("gone", "principal invalidated");
        // Links acting as a matching principal are re-stamped (if the acceptor can) or closed.
        for (const connection of [...this.connections]) {
            if (connection.role !== "downstream" || !matches(connection.principal))
                continue;
            // Relays under the old principal close at once, including those still resolving their route.
            connection.revoke(connection.restamp?.(connection.principal));
        }
        // Patterns propagate to child hosts, which dispose their own matching objects (e.g. relayed guests).
        if (typeof match !== "function") {
            for (const connection of this.connections) {
                if (connection.role === "downstream" && connection.peer.kind === "host") {
                    connection.send({ t: "invalidate", pattern: match });
                }
            }
        }
        const matching = [...this.objects.values()].filter((object) => !this.isSelf(object.principal) && matches(object.principal));
        await disposeHoldersFirst(matching, reason, "invalidatePrincipal: disposal failed");
    }
    // ─── links ───
    accept(link, options) {
        const kind = options.kind ?? "client";
        if (kind === "host" && options.name === undefined)
            throw new TypeError("accepting a host link needs its name");
        this.#addConnection(link, {
            ...options,
            role: "downstream",
            principal: options.principal,
            peer: { kind, name: kind === "host" ? options.name : undefined },
            // Holds over a client link carry its id as their origin (also when relayed), so hosts can tell clients apart.
            ...(kind === "client" ? { originId: `${this.#incarnation}:${++this.#originSeq}` } : {}),
        });
    }
    connect(link, options) {
        if (!("principal" in options))
            throw new TypeError("connect needs `principal`: what the parent's own requests act as");
        if (this.upstream?.open)
            this.upstream.link.close("replaced");
        const connection = this.#addConnection(link, {
            ...options,
            role: "upstream",
            principal: options.principal,
            peer: { kind: "host", name: undefined },
        });
        this.upstream = connection;
        // Bindings that lost their link re-hold over the new one (`again`: they keep their values meanwhile).
        for (const binding of this.bindings.values())
            if (binding.hold === undefined && !binding.ended)
                connection.hold(binding, binding.applied);
    }
    #addConnection(link, config) {
        const connection = new Connection(this, link, config);
        // A link that was already closed closed the connection in its constructor: keeping it would route to it forever.
        if (connection.open)
            this.connections.add(connection);
        return connection;
    }
    route(prefix, route) {
        if (typeof route.principal !== "function")
            throw new TypeError(`route ${prefix} needs \`principal\`: what the routed hosts act as when they call back`);
        this.#routes.set(prefix, route);
    }
    /**
     * A child host announced its code version. In step: usable. Behind: fenced (nothing is routed to it) and reconciled
     * by a reload of its modules to this host's code version, never by renumbering what it runs. Ahead: impossible,
     * refused.
     */
    peerHello(connection, codeVersion) {
        if (codeVersion > this.current.id) {
            this.report(new ChordError("invalid", `${connection.name} runs code version ${codeVersion}, ahead of ${this.current.id}`));
            connection.link.close("code version ahead of parent");
            return;
        }
        if (this.reloading) {
            // Not a participant of the running reload (participants are fixed when it starts): in step now, it would miss
            // the commit. Decided when the reload ends. A child already behind is fenced now, so the calls its roots make
            // meanwhile are admitted in this host's code version (never relabeled) instead of being `superseded`.
            connection.peerCodeVersion = codeVersion;
            if (codeVersion < this.current.id)
                connection.fencedCodeVersions.add(codeVersion);
            this.#deferredHellos.set(connection, codeVersion);
            return;
        }
        if (codeVersion === this.current.id) {
            connection.markSynced(codeVersion);
            this.announceRetired(connection);
            return;
        }
        connection.peerCodeVersion = codeVersion;
        connection.fencedCodeVersions.add(codeVersion);
        reconcileChild(this, connection).catch((error) => {
            this.report(error);
            connection.link.close("reconciliation failed");
        });
    }
    /** The host's reload slot was freed: children that said hello meanwhile are synced or reconciled now. */
    reloadEnded() {
        this.reloading = false;
        const deferred = [...this.#deferredHellos];
        this.#deferredHellos.clear();
        for (const [connection, codeVersion] of deferred)
            if (connection.open)
                this.peerHello(connection, codeVersion);
        for (const resolve of this.#reloadWaiters.splice(0))
            resolve();
        this.maybeRetire();
    }
    /** Resolves once no reload runs on this host. */
    whenReloadEnded() {
        if (!this.reloading)
            return Promise.resolve();
        return new Promise((resolve) => this.#reloadWaiters.push(resolve));
    }
    connectionClosed(connection) {
        this.connections.delete(connection);
        this.#deferredHellos.delete(connection);
        // Foreign roots that came over this link will never announce their end over it.
        for (const [rootId, links] of [...this.#foreign])
            if (links.has(connection))
                this.foreignRootEnded(rootId, connection);
        for (const links of this.#rootLinks.values())
            links.delete(connection);
        if (this.upstream === connection) {
            this.upstream = undefined;
            this.#childReloads.parentLost();
        }
    }
    /** The last reference to `binding` was released: it lingers if its type does (`HostOptions.linger`), else closes. */
    bindingIdle(binding) {
        const ms = Object.hasOwn(this.#lingerTypes, binding.contract.name)
            ? this.#lingerTypes[binding.contract.name]
            : 0;
        // A binding that never had a shape has nothing worth keeping.
        if (ms <= 0 || binding.ended || !binding.applied || this.#lingerCap <= 0) {
            binding.close();
            return;
        }
        binding.lingerTimer = setTimeout(() => binding.close(), ms);
        binding.lingerTimer.unref?.();
        this.#lingering.set(binding.key, binding);
        for (const oldest of this.#lingering.values()) {
            if (this.#lingering.size <= this.#lingerCap)
                break;
            oldest.close();
        }
    }
    forgetBinding(binding) {
        if (this.bindings.get(binding.key) === binding)
            this.bindings.delete(binding.key);
        if (this.#lingering.get(binding.key) === binding)
            this.#lingering.delete(binding.key);
    }
    /** A downstream host connection by its configured name (never by what a peer announced). */
    #childNamed(name) {
        return [...this.connections].find((connection) => connection.open &&
            connection.role === "downstream" &&
            connection.peer.kind === "host" &&
            connection.peer.name === name);
    }
    /**
     * A reference to an object on host `at`: a view onto the binding for its key, created (and held) if there is none.
     * `input` is normalized with `type` (the hold carries it so).
     */
    #acquireRemote(type, at, input, options, owner) {
        const principal = options?.principal === undefined || this.isSelf(options.principal) ? undefined : options.principal;
        const key = this.#remoteKey(type, input, principal ?? this.principal);
        let binding = this.bindings.get(key);
        const fresh = binding === undefined || binding.ended;
        if (binding === undefined || binding.ended) {
            binding = new RemoteBinding(this, { key, contract: type, at, input, principal });
            this.bindings.set(key, binding);
        }
        const ref = new RemoteRef(binding, owner, options?.state !== false);
        this.#lingering.delete(key);
        binding.addView(ref);
        if (fresh)
            this.#hold(binding);
        return ref;
    }
    /** Holds `binding` over the link to its host: the parent's, a child's, or one a route resolves. */
    #hold(binding) {
        const bindWhenSynced = (connection) => {
            connection.then((target) => {
                if (!binding.ended && binding.hold === undefined)
                    target.hold(binding, false);
            }, (error) => binding.gone(error));
        };
        const direct = this.#childNamed(binding.at);
        if (this.upstream !== undefined)
            this.upstream.hold(binding, false);
        else if (direct !== undefined)
            bindWhenSynced(direct.whenSynced().then(() => direct));
        else {
            const route = this.#routeFor(binding.at);
            if (route === undefined)
                binding.gone(new ChordError("unavailable", `no route to ${binding.at}`));
            else
                bindWhenSynced(this.#resolve(route, binding.at, binding.principal ?? this.principal));
        }
    }
    #routeFor(hostName) {
        let best;
        for (const entry of this.#routes) {
            if (hostName.startsWith(entry[0]) && (best === undefined || entry[0].length > best[0].length))
                best = entry;
        }
        return best?.[1];
    }
    /** Authorize, resolve (maybe spawn), authorize again; returns the synced connection to the host. */
    async #resolve(route, hostName, principal, still = () => true) {
        const refuse = () => new ChordError("forbidden", `${hostName} refused for this principal`);
        const revoked = () => new ChordError("gone", "principal invalidated while resolving");
        if (!(await route.authorize(principal, hostName)))
            throw refuse();
        if (!still())
            throw revoked();
        const link = await route.resolve(hostName);
        if (!still())
            throw revoked();
        if (!(await route.authorize(principal, hostName)))
            throw refuse();
        if (!still())
            throw revoked();
        let connection = [...this.connections].find((candidate) => candidate.link === link);
        connection ??= this.#addConnection(link, {
            role: "downstream",
            principal: route.principal(hostName),
            peer: { kind: "host", name: hostName },
        });
        await connection.whenSynced();
        if (!still())
            throw revoked();
        return connection;
    }
    /**
     * Relays a reference from `relay.origin` to the host it names. Relaying needs a route: it is where authorization
     * lives. The origin's authorization generation is re-checked after every await and right before forwarding, so a
     * revocation during resolution wins.
     */
    async relay(relay) {
        const at = relay.frame.at;
        // The hold names its target; its contract token says where the type lives. They must agree.
        const placement = contractFromDescription(relay.frame.token).description.host;
        if (placement === undefined || resolveHost(relay.frame.token.name, placement, relay.frame.input) !== at)
            throw invalid("placement", `${relay.frame.token.name} with this input does not live on ${at}`);
        const route = this.#routeFor(at);
        if (route === undefined) {
            throw this.#childNamed(at) === undefined
                ? new ChordError("unavailable", `no route to ${at}`)
                : new ChordError("forbidden", `no route authorizes ${at}`);
        }
        const down = await this.#resolve(route, at, relay.principal, () => relay.current);
        if (!relay.current)
            return;
        relay.open(down);
    }
    reload(plugins, options = {}) {
        // Client-local facet code versions never cross the parent link; only child hosts require cluster coordination.
        if (this.kind !== "client" && this.upstream !== undefined) {
            return Promise.reject(new ChordError("unavailable", "reloads are coordinated by the server", { reason: "not_coordinator" }));
        }
        const children = [...this.connections].some((connection) => connection.role === "downstream" && connection.peer.kind === "host");
        return children || options.remote !== undefined || options.remoteRemove !== undefined
            ? runClusterReload(this, plugins, options)
            : runReload(this, plugins, options);
    }
    onReloadFrame(connection, frame) {
        this.#childReloads.handle(connection, frame);
    }
    rememberRemoteModules(remote, remove) {
        for (const prefix of new Set([...Object.keys(remote ?? {}), ...Object.keys(remove ?? {})])) {
            const modules = remote?.[prefix] ?? [];
            const removed = remove?.[prefix] ?? [];
            this.remoteModules[prefix] = [...new Set([...(this.remoteModules[prefix] ?? []), ...modules])].filter((module) => !removed.includes(module));
            this.remoteRemoved[prefix] = [...new Set([...(this.remoteRemoved[prefix] ?? []), ...removed])].filter((module) => !modules.includes(module));
        }
    }
    /** The code version id the next reload would commit. */
    peekNextCodeVersion() {
        return this.#codeVersionSeq + 1;
    }
    /**
     * Disposes every object, holders before what they reference (a resource's `close` may still use the objects its object
     * references, local or remote), then closes the links.
     */
    async close() {
        for (const binding of [...this.#lingering.values()])
            binding.close();
        this.hostObjects.clear();
        for (const name of [...this.#facetRuns.keys()])
            this.facetRunChanged(name, undefined);
        const reason = new ChordError("gone", `host ${this.name} closed`);
        try {
            await disposeHoldersFirst([...this.objects.values()], reason, "host close: disposal failed");
        }
        finally {
            for (const connection of [...this.connections])
                connection.link.close("host closed");
        }
    }
}
/**
 * Force-disposes `objects` in waves: an object goes once no object of the set that references it is left, so holders are
 * disposed (and their resources closed) while what they reference is still live. In-host references are acyclic. Errors of
 * every disposal are collected.
 */
async function disposeHoldersFirst(objects, reason, message) {
    const remaining = new Set(objects);
    const held = (object) => {
        const result = new Set();
        for (const decls of object.allDecls()) {
            for (const ref of decls.refs.values())
                if (ref.object !== undefined)
                    result.add(ref.object);
        }
        return result;
    };
    const refs = new Map(objects.map((object) => [object, held(object)]));
    const errors = [];
    while (remaining.size > 0) {
        const heldByRemaining = new Set();
        for (const object of remaining)
            for (const target of refs.get(object) ?? [])
                heldByRemaining.add(target);
        let wave = [...remaining].filter((object) => !heldByRemaining.has(object));
        // A cycle cannot happen in-host; dispose the rest together rather than loop.
        if (wave.length === 0)
            wave = [...remaining];
        for (const object of wave)
            remaining.delete(object);
        const results = await Promise.allSettled(wave.map((object) => object.dispose(true, reason)));
        for (const result of results)
            if (result.status === "rejected")
                errors.push(result.reason);
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, message);
}
function sameTable(a, b) {
    if (a.size !== b.size)
        return false;
    const keys = [...a.keys()];
    return [...b].every(([key, value], index) => keys[index] === key && a.get(key) === value);
}
const matchesPattern = (pattern, principal) => principal !== null &&
    typeof principal === "object" &&
    Object.entries(pattern).every(([key, value]) => deepEqual(principal[key], value));
const unknownType = (type, host) => new ChordError("unavailable", `${type} is not served by ${host}`, { reason: "unknown_type" });
/** True if `from` references `to`, directly or transitively, through object-owned references on this host. */
function reaches(from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length > 0) {
        const object = stack.pop();
        if (object === to)
            return true;
        if (seen.has(object))
            continue;
        seen.add(object);
        // Remote references have no object here: cycles across hosts are avoided by convention.
        for (const decls of object.allDecls()) {
            for (const ref of decls.refs.values())
                if (ref.object !== undefined)
                    stack.push(ref.object);
        }
    }
    return false;
}
//# sourceMappingURL=host.js.map