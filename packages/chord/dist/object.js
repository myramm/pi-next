import { Value } from "typebox/value";
import { Cell, Derived, HYDRATION, hydrationOf, isSource, notReady, unhydrated, } from "./cell.js";
import { bind, LOCAL_VARIANT, takesNoArgs, } from "./contract.js";
import { asChordError, ChordError, invalid, runAll } from "./errors.js";
import { enqueue } from "./publish.js";
import { assertValid, normalize } from "./schema.js";
const noop = () => { };
export const makeService = (contract, factory, options, facet) => {
    checkLifetime(contract, options);
    return {
        contract,
        factory: factory,
        options: options,
        facet,
    };
};
/** Whether objects of `service` have `lifetime: "host"`. */
export const hostLifetime = (service) => service.options.lifetime === "host";
/** Refuses lifetimes the type cannot have, when it is served. */
function checkLifetime(contract, options) {
    const lifetime = options.lifetime ?? "referenced";
    if (lifetime !== "referenced" && lifetime !== "host")
        throw new TypeError(`${contract.name}: unknown lifetime ${String(lifetime)}`);
    if (lifetime !== "host")
        return;
    if (contract.scope !== "local")
        throw new TypeError(`${contract.name}: lifetime "host" needs a local type (remote types are referenced)`);
    if (options.linger !== undefined)
        throw new TypeError(`${contract.name}: an object of lifetime "host" does not linger (it lives as long as the host)`);
    try {
        normalize(contract.input, {}, `${contract.name} input`);
    }
    catch {
        throw new TypeError(`${contract.name}: lifetime "host" needs an input that accepts {} (the object's one address)`);
    }
}
/** Runtime form of `Exposed<T>`. */
class ExposedImpl {
    resource;
    constructor(resource) {
        this.resource = resource;
    }
}
export class ResourceImpl {
    key;
    /** The declaration of the factory run whose code is current: a kept resource adopts the new one at commit. */
    spec;
    deps;
    /** `unavailable`: a close/reopen failed during a reload rollback; the value is gone for good. */
    state = "closed";
    #value;
    constructor(key, spec, deps) {
        this.key = key;
        this.spec = spec;
        this.deps = deps;
    }
    get value() {
        if (this.state === "unavailable")
            throw new ChordError("unavailable", `resource ${this.key} could not be restored`);
        if (this.state !== "open")
            throw notReady(`resource ${this.key}`);
        return this.#value;
    }
    get exclusive() {
        return this.spec.exclusive === true;
    }
    /**
     * Opens the resource. An open that completes after `signal` aborted (rollback, abandonment) closes the value it
     * produced at once: nobody owns it any more.
     */
    async open(signal, order) {
        if (this.state !== "closed")
            return;
        this.state = "opening";
        let value;
        try {
            value = await this.spec.open({ signal });
        }
        catch (error) {
            this.state = "closed";
            throw error;
        }
        if (signal.aborted) {
            this.state = "closed";
            await this.spec.close?.(value);
            throw new ChordError("aborted", `resource ${this.key} opened after abort`);
        }
        this.#value = value;
        this.state = "open";
        order.push(this);
    }
    async close(order) {
        if (this.state !== "open")
            return;
        this.state = "closed";
        const index = order.indexOf(this);
        if (index !== -1)
            order.splice(index, 1);
        const value = this.#value;
        this.#value = undefined;
        await this.spec.close?.(value);
    }
    markUnavailable() {
        this.state = "unavailable";
        this.#value = undefined;
    }
    /**
     * A reload kept this resource (same version, deps and exclusivity): its later `close` is the new declaration's, and
     * the old declaration (with the old code it closes over) is no longer referenced.
     */
    adopt(spec) {
        this.spec = spec;
    }
}
/**
 * What `self.resources` returns: the resource, except that `.value` throws `not_ready` while any factory runs, even
 * if the resource is open (a reload's prepare rerun must not touch the native resource the old code uses).
 */
class ResourceFacade {
    #resource;
    #host;
    constructor(resource, host) {
        this.#resource = resource;
        this.#host = host;
        facades.set(this, resource);
    }
    get key() {
        return this.#resource.key;
    }
    get value() {
        if (this.#host.inFactory > 0)
            throw notReady(`resource ${this.key} (inside a factory)`);
        return this.#resource.value;
    }
}
const facades = new WeakMap();
const resourceOf = (value) => value instanceof ResourceImpl ? value : value !== null && typeof value === "object" ? facades.get(value) : undefined;
/** Everything one factory run declared, by kind and key. */
export class Decls {
    cells = new Map();
    cellSchemas = new Map();
    cellVersions = new Map();
    cellMigrations = new Map();
    refs = new Map();
    resources = new Map();
    /** Resources this run kept from the previous one, with this run's declarations (adopted at commit). */
    adopted = new Map();
    listeners = new Map();
    /** By position (`#0`, `#1`, …): tasks have no names. */
    tasks = new Map();
    /** By position: derivations have no names and are new at every run. */
    derives = new Map();
    registrations = new Map();
}
const isStateInit = (value) => value !== null && typeof value === "object" && typeof value.init === "function";
// ─── Contexts ────────────────────────────────────────────────────────────────
export class CtxImpl {
    host;
    signal;
    rootId;
    codeVersion;
    principal;
    /** Code holders (tasks): every call they make starts a fresh root. */
    holder;
    #refs = [];
    #release;
    /** Aborted when the ctx closes: awaited `get`s give up. */
    #closing = new AbortController();
    #closed = false;
    /** True after the call or root that received this ctx settled: it may no longer start work. */
    get closed() {
        return this.#closed;
    }
    /** Throws unless this ctx may start work on `host` (the called reference's host) now: not expired, aborted or foreign. */
    check(host) {
        if (this.host !== host)
            throw invalid("foreign_ctx", "ctx belongs to another host");
        if (this.#closed)
            throw new ChordError("aborted", "ctx expired: its call already settled", { reason: "expired" });
        if (this.signal.aborted) {
            const reason = this.signal.reason;
            // A forced retirement aborted the root: its code version is gone, so the next call is `superseded` (retryable).
            if (reason instanceof ChordError && reason.code === "superseded")
                throw new ChordError("superseded", reason.message, { cause: reason });
            throw new ChordError("aborted", "ctx aborted", { cause: reason });
        }
    }
    /** `signals`: the ctx is aborted with the first of them; it stops following them when it closes. */
    constructor(host, fields) {
        this.host = host;
        const linked = linkedSignal(fields.signals);
        this.signal = linked.signal;
        this.#release = linked.release;
        this.rootId = fields.rootId;
        this.codeVersion = fields.codeVersion;
        this.principal = fields.principal;
        this.holder = fields.holder ?? false;
    }
    async get(type, input, options) {
        this.check(this.host);
        const ref = this.host.acquire(type, input, { principal: this.principal, ...options }, "call");
        this.#refs.push(ref);
        await awaitReady(ref, [this.signal, this.#closing.signal], this.host.readyTimeout);
        return ref.proxy;
    }
    /**
     * A context for a call into `object`: same root and code version, its own call-owned references, aborted on forced
     * disposal. Code inside an object acts as the host principal.
     */
    child(object) {
        return new CtxImpl(this.host, {
            signals: [this.signal, object.callAbort.signal],
            rootId: this.rootId,
            codeVersion: this.codeVersion,
            principal: this.host.principal,
        });
    }
    close() {
        this.#closed = true;
        this.#closing.abort(new ChordError("aborted", "ctx expired: its call already settled", { reason: "expired" }));
        this.#release();
        for (const ref of this.#refs.splice(0))
            ref.release();
    }
}
/**
 * A signal aborted with the first of `sources` to abort, until `release()`. Not `AbortSignal.any`: Node keeps a
 * dependant of a long-lived source (an object's or a code version's) reachable while it has abort listeners, so every
 * call or task context would keep its listeners, and the code they close over, alive as long as the source.
 */
export function linkedSignal(sources) {
    const controller = new AbortController();
    const detach = [];
    const release = () => {
        for (const remove of detach.splice(0))
            remove();
    };
    for (const source of sources) {
        if (source.aborted) {
            release();
            controller.abort(source.reason);
            break;
        }
        const forward = () => {
            release();
            controller.abort(source.reason);
        };
        source.addEventListener("abort", forward, { once: true });
        detach.push(() => source.removeEventListener("abort", forward));
    }
    return { signal: controller.signal, release };
}
/**
 * Waits until `ref` is ready, at most `ms` and until a signal aborts; on failure the reference is released (only it: a
 * binding other references share stays) and the error is rethrown: the activation error, `aborted`, or
 * `unavailable/ready_timeout`.
 */
export async function awaitReady(ref, signals, ms) {
    const timeout = new AbortController();
    const timer = Number.isFinite(ms)
        ? setTimeout(() => timeout.abort(new ChordError("unavailable", `${ref.address} was not ready after ${ms} ms`, {
            reason: "ready_timeout",
        })), ms)
        : undefined;
    timer?.unref?.();
    const linked = linkedSignal([...signals, timeout.signal]);
    try {
        await raceSignal(ref.ready, linked.signal);
    }
    catch (error) {
        ref.release();
        const reason = linked.signal.reason;
        throw reason instanceof ChordError && reason.reason === "ready_timeout" ? reason : error;
    }
    finally {
        clearTimeout(timer);
        linked.release();
    }
}
export async function raceSignal(promise, signal) {
    if (signal.aborted)
        throw new ChordError("aborted", "call aborted", { cause: signal.reason });
    let onAbort = noop;
    const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new ChordError("aborted", "call aborted", { cause: signal.reason }));
        signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
        return await Promise.race([promise, aborted]);
    }
    finally {
        signal.removeEventListener("abort", onAbort);
    }
}
export const REF_BASE = new Set([
    "contract",
    "status",
    "ready",
    "variant",
    "shape",
    "error",
    "onShape",
    "onStatus",
    "release",
]);
/** Queues a status notification (after the change that caused it is complete, like every publication). */
export function notifyStatus(listeners, status, error, report) {
    if (listeners.size === 0)
        return;
    const current = [...listeners];
    enqueue(() => {
        for (const listener of current) {
            try {
                listener(status, error);
            }
            catch (thrown) {
                report(thrown);
            }
        }
    });
}
/** Proxy → reference, for `deps: [ref]` and links. */
export const refsByProxy = new WeakMap();
export const refOf = (value) => value !== null && typeof value === "object" ? refsByProxy.get(value) : undefined;
/**
 * A reference's state member: a stable readable that follows whatever source the current implementation exposes under
 * that name. Reading throws `not_ready` until the reference is live, `not_in_variant` while the variant lacks the
 * member. A listener added before the member is readable gets its snapshot then. Rebinding (reload, variant) delivers a
 * reset. Upstream is subscribed only while someone listens.
 */
class MemberReadable {
    #ref;
    #name;
    #values = new Set();
    #events = new Set();
    /** Event listeners that have not had their snapshot yet (added while the member was not readable). */
    #unseen = new Set();
    #source;
    #upstream = noop;
    /** The value listeners last saw; a first upstream snapshot equal to it is not re-announced. */
    #seen;
    constructor(ref, name) {
        this.#ref = ref;
        this.#name = name;
    }
    get value() {
        const ref = this.#ref;
        if (ref.status === "released" || ref.status === "gone")
            throw ref.terminalError();
        if (ref.status !== "live")
            throw notReady(`${ref.address}.${this.#name}`);
        const view = ref.currentView();
        if (view === undefined)
            throw notReady(`${ref.address}.${this.#name}`);
        const source = this.#current();
        if (source === undefined) {
            throw new ChordError("not_in_variant", `${ref.address}: ${this.#name} is not a state member of variant ${variantOf(view) ?? "(local)"}`);
        }
        return source.value;
    }
    /** Not hydrated while the reference is not live, or while its source (a forwarded remote member) is not. */
    get [HYDRATION]() {
        const ref = this.#ref;
        if (ref.status === "live")
            return hydrationOf(this.#current());
        return {
            hydrated: false,
            whenHydrated: async () => {
                await ref.ready;
                await hydrationOf(this.#current())?.whenHydrated();
            },
        };
    }
    subscribe(listener) {
        this.#values.add(listener);
        const source = this.#readable();
        if (source !== undefined) {
            this.#seen = { value: source.value };
            this.#safe(() => listener(source.value));
        }
        this.bind();
        return () => this.#remove(this.#values, listener);
    }
    events(listener) {
        this.#events.add(listener);
        const source = this.#readable();
        if (source !== undefined) {
            const value = source.value;
            this.#seen = { value };
            this.#safe(() => listener({ type: "snap", value }));
        }
        else
            this.#unseen.add(listener);
        this.bind();
        return () => {
            this.#unseen.delete(listener);
            this.#remove(this.#events, listener);
        };
    }
    /** (Re)subscribes upstream to the current source; a changed source is announced as a reset. */
    bind() {
        const source = this.#values.size + this.#events.size > 0 ? this.#current() : undefined;
        if (source === this.#source)
            return;
        this.#upstream();
        this.#upstream = noop;
        this.#source = source;
        if (source === undefined)
            return;
        let first = true;
        this.#upstream = source.events((event) => {
            const isFirst = first;
            first = false;
            if (isFirst && this.#unseen.size === 0 && this.#seen !== undefined && event.value === this.#seen.value)
                return;
            this.#seen = { value: event.value };
            const translated = isFirst ? { type: "reset", value: event.value } : event;
            const events = [...this.#events];
            const values = [...this.#values];
            const unseen = new Set(this.#unseen);
            this.#unseen.clear();
            // Queued: a rebind during a commit must not run observers before the commit completes.
            enqueue(() => {
                for (const listener of events) {
                    if (!this.#events.has(listener))
                        continue;
                    const delivered = unseen.has(listener)
                        ? { type: "snap", value: event.value }
                        : translated;
                    this.#safe(() => listener(delivered));
                }
                for (const listener of values)
                    if (this.#values.has(listener))
                        this.#safe(() => listener(event.value));
            });
        });
    }
    stop() {
        this.#values.clear();
        this.#events.clear();
        this.#unseen.clear();
        this.bind();
    }
    #current() {
        const view = this.#ref.currentView();
        if (view === undefined || !this.#ref.inVariant(view, this.#name))
            return undefined;
        const value = view[this.#name];
        // Cells and derivations, or any readable an `accepts` adapter maps them to.
        return isSource(value) || isReadableLike(value) ? value : undefined;
    }
    /** The current source if its value can be read now (live, in the variant, hydrated). */
    #readable() {
        const source = this.#current();
        return source === undefined || hydrationOf(source)?.hydrated === false ? undefined : source;
    }
    #remove(set, listener) {
        set.delete(listener);
        this.bind();
    }
    #safe(fn) {
        try {
            fn();
        }
        catch (error) {
            this.#ref.object.host.report(error);
        }
    }
}
/** One reference on an object. Exposed through a Proxy so members bind late to the current implementation. */
export class RefImpl {
    object;
    contract;
    owner;
    address;
    proxy;
    ready;
    status;
    error;
    shapeListeners = new Set();
    /** Internal: notified when the reference becomes gone (links forward it). */
    goneListeners = new Set();
    readables = new Map();
    /** Weak: a retired code version's service (and the factory code it holds) must not be kept alive by its consumers. */
    bindings = new WeakMap();
    views = new WeakMap();
    callers = new Map();
    constructor(object, contract, owner) {
        this.object = object;
        this.contract = contract;
        this.owner = owner;
        this.address = object.address;
        this.status = object.status === "live" ? "live" : "loading";
        this.ready = object.ready.then(() => {
            if (this.status === "gone")
                throw this.error;
            if (this.status === "released")
                throw new ChordError("released", `reference ${this.address} released`);
        });
        this.ready.catch(noop);
        this.proxy = new Proxy(this, {
            get: (target, property) => {
                if (REF_BASE.has(property)) {
                    const value = Reflect.get(target, property, target);
                    return typeof value === "function" ? value.bind(target) : value;
                }
                if (typeof property !== "string" || property === "then")
                    return undefined;
                return target.member(property);
            },
            has: (target, property) => REF_BASE.has(property) || target.member(String(property)) !== undefined,
        });
        refsByProxy.set(this.proxy, this);
    }
    get variant() {
        const view = this.currentView();
        return view === undefined ? undefined : variantOf(view);
    }
    get shape() {
        const installed = this.status === "live" ? this.object.currentInstalled() : undefined;
        const view = installed === undefined ? undefined : this.#safeView(installed);
        if (installed === undefined || view === undefined)
            return undefined;
        return {
            variant: variantOf(view),
            members: Object.keys(view).filter((key) => key !== "variant"),
            contract: installed.service.contract.fingerprint,
        };
    }
    onShape(listener) {
        this.shapeListeners.add(listener);
        return () => this.shapeListeners.delete(listener);
    }
    onStatus(listener) {
        this.#statusListeners.add(listener);
        return () => this.#statusListeners.delete(listener);
    }
    #statusListeners = new Set();
    #statusChanged() {
        notifyStatus(this.#statusListeners, this.status, this.error, (error) => this.object.host.report(error));
    }
    release() {
        if (this.status === "released" || this.status === "gone")
            return;
        this.status = "released";
        this.#stopReadables();
        this.#statusChanged();
        this.object.release(this);
    }
    // ─── internal ───
    live() {
        if (this.status !== "loading")
            return;
        this.status = "live";
        this.#statusChanged();
        this.shapeChanged();
    }
    gone(error) {
        if (this.status === "released" || this.status === "gone")
            return;
        this.status = "gone";
        this.error = error;
        this.#stopReadables();
        this.#statusChanged();
        for (const listener of [...this.goneListeners])
            listener(error);
    }
    shapeChanged() {
        for (const readable of this.readables.values())
            readable.bind();
        const shape = this.shape;
        if (shape === undefined)
            return;
        const listeners = [...this.shapeListeners];
        enqueue(() => {
            for (const listener of listeners) {
                try {
                    listener(shape);
                }
                catch (error) {
                    this.object.host.report(error);
                }
            }
        });
    }
    terminalError() {
        return this.status === "gone" ? this.error : new ChordError("released", `reference ${this.address} released`);
    }
    /** The implementation as this consumer sees it (through an accepts adapter when bound to another version). */
    viewOf(installed) {
        let adapter = this.bindings.get(installed.service);
        if (!this.bindings.has(installed.service)) {
            adapter = bind(installed.service.contract, installed.service.options.accepts, this.contract);
            this.bindings.set(installed.service, adapter);
        }
        if (adapter === undefined)
            return installed.implementation;
        let view = this.views.get(installed.implementation);
        if (view === undefined) {
            view = adapter(installed.implementation);
            this.views.set(installed.implementation, view);
        }
        return view;
    }
    currentView() {
        if (this.status !== "live")
            return undefined;
        const installed = this.object.currentInstalled();
        return installed === undefined ? undefined : this.#safeView(installed);
    }
    /** The view, or undefined when this consumer no longer binds (reported; calls reject with the bind error). */
    #safeView(installed) {
        try {
            return this.viewOf(installed);
        }
        catch (error) {
            this.object.host.report(error);
            return undefined;
        }
    }
    describe(variant, member) {
        const variants = this.contract.description.variants;
        if (variant !== undefined)
            return variants[variant]?.[member];
        for (const members of Object.values(variants))
            if (members[member] !== undefined)
                return members[member];
        return undefined;
    }
    /** Remote consumers see only the members their contract lists for the current variant. */
    inVariant(view, name) {
        return this.contract.scope !== "remote" || this.describe(variantOf(view), name) !== undefined;
    }
    member(name) {
        const declared = this.describe(undefined, name);
        const view = this.currentView();
        const value = view?.[name];
        if (declared?.kind === "method" || (declared === undefined && typeof value === "function")) {
            return this.caller(name);
        }
        if (declared?.kind === "state" || (declared === undefined && (isSource(value) || isReadableLike(value)))) {
            let readable = this.readables.get(name);
            if (readable === undefined) {
                readable = new MemberReadable(this, name);
                this.readables.set(name, readable);
            }
            return readable;
        }
        if (view === undefined || !this.inVariant(view, name))
            return undefined;
        return value instanceof ExposedImpl ? value.resource.value : value;
    }
    caller(name) {
        let caller = this.callers.get(name);
        if (caller === undefined) {
            const noArgs = takesNoArgs(this.contract, name);
            caller = (...given) => {
                // A method without arguments is called as `ref.name(ctx)`.
                const [args, ctx] = (noArgs ? [undefined, given[0]] : given);
                if (this.object.host.inFactory > 0) {
                    throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
                }
                if (ctx !== undefined && !(ctx instanceof CtxImpl)) {
                    return Promise.reject(invalid("foreign_ctx", "ctx must come from a Chord host"));
                }
                if (ctx === undefined || ctx.holder) {
                    // A code holder (task) starts a fresh root per call, cancelled with the holder.
                    try {
                        ctx?.check(this.object.host);
                    }
                    catch (error) {
                        return Promise.reject(error);
                    }
                    return this.object.host.root((root) => this.object.call(this, name, args, root), {
                        signal: ctx?.signal,
                    });
                }
                return this.object.call(this, name, args, ctx);
            };
            this.callers.set(name, caller);
        }
        return caller;
    }
    #stopReadables() {
        for (const readable of this.readables.values())
            readable.stop();
    }
}
export const variantOf = (implementation) => typeof implementation.variant === "string" ? implementation.variant : undefined;
/**
 * Two `select` functions are the same if they are identical or have the same source text: an inline arrow is a new
 * object on every factory run, but its code is what matters. (A select whose implementation depends on captured values
 * that change between runs is not detected; such a listener keeps its old subscription until its source changes.)
 */
const sameSelect = (a, b) => a === b || (a !== undefined && b !== undefined && String(a) === String(b));
export class ObjectImpl {
    host;
    address;
    typeName;
    input;
    principal;
    /** The one object of a `lifetime: "host"` type: only such objects may register. */
    hostLifetime;
    status = "activating";
    ready = Promise.resolve();
    service;
    /** Calls carrying an older code version are rejected upgrade_conflict (state bump or exclusive resource replaced). */
    minCodeVersion = 0;
    decls = new Decls();
    /** Declarations of a factory run that has not been installed yet (activation or reload candidate). */
    pending = new Set();
    implementations = new Map();
    refs = new Set();
    leases = new Map();
    openOrder = [];
    callAbort = new AbortController();
    activationAbort = new AbortController();
    gate;
    /** Served only by a running reload's pending code version: listeners, tasks and registrations start at its commit. */
    deferredRuntime = false;
    #subscriptions = new Map();
    #invocations = new Set();
    #tasks = new Map();
    /** Aborted task runs that have not finished yet. */
    #stopped = new Set();
    /** Bumped by every start and stop of the tasks: a delayed start that is no longer the latest is dropped. */
    #taskRuns = 0;
    #linger;
    #disposal;
    constructor(host, identity) {
        this.host = host;
        this.address = identity.address;
        this.typeName = identity.typeName;
        this.input = identity.input;
        this.principal = identity.principal;
        this.hostLifetime = identity.hostLifetime;
    }
    start(after) {
        this.ready = this.#activate(after).then(() => {
            for (const ref of this.refs)
                ref.live();
            this.#maybeIdle();
        }, (cause) => {
            if (this.status === "activating")
                this.status = "failed";
            this.host.forget(this);
            // A ChordError (forbidden, a dependency's error, ...) keeps its code; anything else is `unavailable`.
            const error = asChordError(cause, `activating ${this.address}`);
            for (const ref of this.refs)
                ref.gone(error);
            throw error;
        });
        this.ready.catch(noop);
    }
    /**
     * Activation as one transaction: factory, opens, then a synchronous finalization (registry check and publication,
     * implementations, runtime). Every failure, including one during finalization or a release while listeners start,
     * unwinds everything this activation did.
     */
    async #activate(after) {
        await after?.catch(noop);
        const signal = this.activationAbort.signal;
        const abandoned = () => new ChordError("aborted", `${this.address} abandoned`);
        if (signal.aborted)
            throw abandoned();
        const service = this.host.service(this.typeName);
        if (service === undefined)
            throw new ChordError("unavailable", `${this.typeName} is not served`, { reason: "unknown_type" });
        this.service = service;
        const run = this.run(service, undefined);
        try {
            await this.open(run.created.resources, run.created.refs, signal);
            if (signal.aborted)
                throw abandoned();
            await this.waitHydrated(run);
            if (signal.aborted)
                throw abandoned();
            await this.initCells(run, signal);
            if (signal.aborted)
                throw abandoned();
            this.host.checkRegistrations(this, run.decls);
            this.decls = run.decls;
            for (const [retained, services] of this.host.retainedCodeVersions()) {
                if (services.get(this.typeName) === service) {
                    this.implementations.set(retained, {
                        codeVersion: retained,
                        service,
                        implementation: run.implementation,
                        decls: run.decls,
                    });
                }
            }
            const pending = this.host.pendingCodeVersion();
            if (!this.implementations.has(this.host.currentCodeVersion()) &&
                (pending === undefined || !this.implementations.has(pending))) {
                throw new ChordError("superseded", `${this.address}: code changed during activation`);
            }
            for (const derived of run.created.derives)
                derived.attach();
            this.refreshSchemas();
            // Served only by a running reload's pending code version: new code must not run (listeners, tasks,
            // registrations) before that reload commits.
            this.deferredRuntime = !this.implementations.has(this.host.currentCodeVersion());
            if (!this.deferredRuntime) {
                if (run.decls.registrations.size > 0)
                    this.host.registriesChanged(this);
                this.startRuntime();
            }
            // A listener starting up may have released the last reference synchronously: no resurrection.
            if (signal.aborted)
                throw abandoned();
            this.status = "live";
        }
        catch (error) {
            // Invocations started during finalization (listener roots) end before their resources close.
            this.callAbort.abort(error);
            this.stopListeners();
            this.stopTasks();
            const registered = this.decls.registrations.size > 0 && !this.deferredRuntime;
            this.implementations.clear();
            this.decls = new Decls();
            if (registered)
                this.host.registriesChanged();
            await Promise.allSettled([...this.#invocations, ...this.#stopped]);
            await this.unwind(run).catch((cleanup) => this.host.report(cleanup));
            throw error;
        }
        finally {
            this.pending.delete(run.decls);
        }
    }
    /**
     * Runs the factory synchronously. With `previous`, runs in recording mode for a reload prepare. The run's
     * declarations stay in `pending` (visible to the cycle check) until the caller installs or discards them.
     */
    run(service, previous) {
        const self = new SelfImpl(this, previous);
        const discard = (run) => {
            this.pending.delete(run.decls);
            void this.unwind(run).catch((cleanup) => this.host.report(cleanup));
        };
        this.pending.add(self.run(undefined).decls);
        this.host.inFactory++;
        let implementation;
        try {
            implementation = service.factory(this.input, this.principal, self);
        }
        catch (error) {
            this.host.inFactory--;
            discard(self.run(undefined));
            throw error;
        }
        this.host.inFactory--;
        const run = self.run(implementation);
        try {
            if (implementation instanceof Promise)
                throw invalid("implementation", `${this.typeName}: factories must be synchronous`);
            validateImplementation(service, run.implementation);
        }
        catch (error) {
            discard(run);
            throw error;
        }
        return run;
    }
    /** Opens resources (dependencies first) and waits for references; settles all before failing. */
    async open(resources, refs, signal) {
        const opening = new Map();
        const openOne = (resource) => {
            let promise = opening.get(resource);
            if (promise === undefined) {
                promise = (async () => {
                    await Promise.all(resource.deps.map((dep) => !(dep instanceof ResourceImpl) ? dep.ready : resources.includes(dep) ? openOne(dep) : undefined));
                    await resource.open(signal, this.openOrder);
                })();
                opening.set(resource, promise);
            }
            return promise;
        };
        const ready = this.withinReadyTimeout(Promise.all(refs.map((ref) => ref.ready)), () => refs.filter((ref) => ref.status === "loading").map((ref) => ref.address));
        const results = await Promise.allSettled([...resources.map(openOne), ready]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure !== undefined)
            throw failure.reason;
    }
    /**
     * Waits until the state sources a run exposes or derives from have their values: a local object goes live only with
     * its state, also where it forwards or derives from a remote reference's member.
     */
    async waitHydrated(run) {
        const exposed = Object.entries(run.implementation ?? {});
        const pending = unhydrated([...run.created.derives, ...exposed.map(([, value]) => value)]);
        if (pending.length === 0)
            return;
        await this.withinReadyTimeout(Promise.all(pending.map((hydration) => hydration.whenHydrated())), () => [
            ...exposed
                .filter(([, value]) => hydrationOf(value)?.hydrated === false)
                .map(([name]) => `${this.address}.${name}`),
            ...run.created.derives
                .filter((derived) => hydrationOf(derived) !== undefined)
                .map((derived) => `derive ${derived.key}`),
        ]);
    }
    /** `work` within the host's `readyTimeout`; a timeout names what is still awaited. */
    async withinReadyTimeout(work, waiting) {
        const ms = this.host.readyTimeout;
        if (!Number.isFinite(ms))
            return work;
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const list = waiting();
                reject(new ChordError("unavailable", `${this.address} was not ready after ${ms} ms${list.length === 0 ? "" : `, waiting on ${list.join(", ")}`} (a reference cycle across hosts?)`, { reason: "ready_timeout" }));
            }, ms);
            timer.unref?.();
        });
        timeout.catch(noop);
        try {
            return await Promise.race([work, timeout]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    /**
     * Fills the cells `run` created with `init`, each in a root of its own, in parallel; settles all before failing. Runs
     * after the run's resources are open and its references live, before anything reads the cells.
     */
    async initCells(run, signal) {
        if (run.created.inits.length === 0)
            return;
        const results = await Promise.allSettled(run.created.inits.map(async ([cell, init]) => {
            const value = await this.host.root((ctx) => init(ctx), { signal });
            if (!signal.aborted)
                cell.initialize(value);
        }));
        const failure = results.find((result) => result.status === "rejected");
        if (failure !== undefined)
            throw failure.reason;
    }
    /** Undoes the objects a run created: closes its resources (reverse order) and releases its references. */
    async unwind(run) {
        for (const derived of run.created.derives)
            derived.detach();
        const resources = [...run.created.resources].sort((a, b) => this.openOrder.indexOf(b) - this.openOrder.indexOf(a));
        await runAll([
            ...resources.map((resource) => () => resource.close(this.openOrder)),
            ...run.created.refs.map((ref) => () => ref.release()),
        ], `${this.address}: cleanup failed`);
    }
    currentInstalled() {
        return this.implementations.get(this.host.currentCodeVersion()) ?? [...this.implementations.values()].at(-1);
    }
    /** Every state source exposed as a remote state member gets that member's schema (checked per write in dev mode). */
    refreshSchemas() {
        const schemas = new Map();
        for (const installed of this.implementations.values()) {
            for (const [source, list] of memberSchemas(installed.service, installed.implementation)) {
                schemas.set(source, [...(schemas.get(source) ?? []), ...list]);
            }
        }
        for (const decls of this.allDecls()) {
            for (const source of [...decls.cells.values(), ...decls.derives.values()])
                source.schemas = schemas.get(source) ?? [];
        }
    }
    allDecls() {
        const result = new Set([this.decls, ...this.pending]);
        for (const installed of this.implementations.values())
            result.add(installed.decls);
        return result;
    }
    // ─── runtime: listeners and tasks of the current declarations ───
    /** The resource a listener is declared on, or its source itself. */
    #origin(decl) {
        return resourceOf(decl.source) ?? decl.source;
    }
    /** Resolves a listener's subscribable: `select(resource value)`, `select(source)` or the source itself. */
    #listenSource(key, decl) {
        const resource = resourceOf(decl.source);
        const value = resource === undefined ? decl.source : resource.value;
        const source = (decl.select === undefined ? value : decl.select(value));
        if (typeof source?.subscribe !== "function")
            throw invalid("implementation", `listener ${key}: source has no subscribe()`);
        return source;
    }
    /**
     * Subscribes the listeners of `decls` without delivering: events are buffered until `activate`. A listener declared
     * on the same resource (or source) with the same `select` keeps its subscription without calling `select` again
     * (only its function is swapped, by name), so sources that accept a single subscriber survive reloads. Throws, with
     * nothing left subscribed, if any source fails.
     */
    stageListeners(decls) {
        const fresh = new Map();
        const kept = new Set();
        try {
            for (const [key, decl] of decls.listeners) {
                const origin = this.#origin(decl);
                const previous = this.#subscriptions.get(key);
                if (previous !== undefined && previous.origin === origin && sameSelect(previous.select, decl.select)) {
                    kept.add(key);
                    continue;
                }
                const source = this.#listenSource(key, decl);
                const entry = {
                    origin,
                    select: decl.select,
                    unsubscribe: noop,
                    buffer: [],
                };
                fresh.set(key, entry);
                // State (a readable) is subscribed when the listener activates: it delivers the value current then, not one
                // of the candidate before the commit (a new derivation computes its value at the commit).
                if (isSource(source) || isReadableLike(source)) {
                    entry.buffer = undefined;
                    entry.subscribe = () => {
                        entry.unsubscribe = source.subscribe((event) => this.#deliver(key, event));
                    };
                    continue;
                }
                entry.unsubscribe = source.subscribe((event) => {
                    if (entry.buffer !== undefined)
                        entry.buffer.push(event);
                    else
                        this.#deliver(key, event);
                });
            }
        }
        catch (error) {
            for (const entry of fresh.values())
                entry.unsubscribe();
            throw error;
        }
        return {
            activate: () => {
                for (const [key, subscription] of this.#subscriptions) {
                    if (kept.has(key))
                        continue;
                    subscription.unsubscribe();
                    this.#subscriptions.delete(key);
                }
                for (const [key, entry] of fresh) {
                    this.#subscriptions.set(key, entry);
                    entry.subscribe?.();
                    const buffered = entry.buffer ?? [];
                    entry.buffer = undefined;
                    for (const event of buffered)
                        this.#deliver(key, event);
                }
            },
            discard: () => {
                for (const entry of fresh.values())
                    entry.unsubscribe();
            },
        };
    }
    startRuntime() {
        this.stageListeners(this.decls).activate();
        this.startTasks();
    }
    /**
     * Starts the tasks of the current declarations. Runs aborted by `stopTasks` (a reload, a gate) may still be finishing:
     * their replacements start once they all finished, or after `taskStopDeadline` (reported), so the old and the new run
     * of a task never work side by side. A later start or stop, or the object leaving `live`, cancels a delayed start.
     */
    startTasks() {
        const run = ++this.#taskRuns;
        const start = () => {
            for (const key of this.decls.tasks.keys())
                this.#startTask(key, this.host.currentCodeVersion());
        };
        if (this.#stopped.size === 0) {
            start();
            return;
        }
        const deadline = this.host.taskStopDeadline;
        let timer;
        const late = new Promise((resolve) => {
            timer = setTimeout(() => resolve(true), deadline);
        });
        const stopped = Promise.allSettled([...this.#stopped]).then(() => false);
        void Promise.race([stopped, late]).then((missed) => {
            clearTimeout(timer);
            if (run !== this.#taskRuns || this.status !== "live")
                return;
            if (missed) {
                this.host.report(new ChordError("aborted", `${this.address}: aborted tasks still running after ${deadline} ms; starting their replacements anyway`));
            }
            start();
        });
    }
    stopListeners() {
        for (const subscription of this.#subscriptions.values())
            subscription.unsubscribe();
        this.#subscriptions.clear();
    }
    #startTask(key, codeVersion) {
        const fn = this.decls.tasks.get(key);
        if (fn === undefined)
            return;
        const controller = new AbortController();
        const ctx = new CtxImpl(this.host, {
            signals: [controller.signal, this.callAbort.signal],
            rootId: `task:${this.address}:${key}`,
            codeVersion,
            principal: this.host.principal,
            holder: true,
        });
        const done = (async () => {
            try {
                await fn(ctx);
            }
            catch (error) {
                if (!ctx.signal.aborted)
                    this.host.report(error);
            }
            finally {
                ctx.close();
                if (this.#tasks.get(key)?.controller === controller)
                    this.#tasks.delete(key);
            }
        })();
        this.#tasks.set(key, { controller, done });
    }
    /**
     * Aborts running tasks (and cancels a delayed start). Their completion is awaited by the next `startTasks` and at
     * disposal; each leaves `#stopped` when it finishes.
     */
    stopTasks() {
        this.#taskRuns++;
        for (const task of this.#tasks.values()) {
            task.controller.abort(new ChordError("aborted", "task stopped"));
            const done = task.done;
            this.#stopped.add(done);
            void done.finally(() => this.#stopped.delete(done));
        }
        this.#tasks.clear();
    }
    /**
     * Delivers one listener event, in publication order. The invocation is a root that references a lease on this object
     * (a reload gate waits for it like for any other root that touched the object), counts as an invocation (disposal
     * waits for it) and is cancelled by forced disposal.
     */
    #deliver(key, event) {
        enqueue(() => {
            if (this.gate !== undefined) {
                this.gate.queue.push({ key, event });
                return;
            }
            const decl = this.decls.listeners.get(key);
            if (decl === undefined || (this.status !== "live" && this.status !== "activating"))
                return;
            const invocation = this.host.root((root) => {
                this.lease(root);
                const child = root.child(this);
                return this.#invoke(async () => {
                    try {
                        await decl.fn(event, child);
                    }
                    finally {
                        child.close();
                    }
                });
            });
            invocation.catch((error) => this.host.report(error));
        });
    }
    /** Opens the object's gate and replays queued listener events through the current listeners. */
    openGate() {
        const gate = this.gate;
        this.gate = undefined;
        for (const { key, event } of gate?.queue ?? [])
            this.#deliver(key, event);
    }
    // ─── calls ───
    /** Admission for a call or write carrying `ctx`. */
    admit(ctx) {
        if (this.host.failed !== undefined) {
            throw new ChordError("unavailable", `${this.host.name} failed and admits no work`, { reason: "host_failed" });
        }
        if (!this.host.hasCodeVersion(ctx.codeVersion))
            throw new ChordError("superseded", `code version ${ctx.codeVersion} is retired`);
        if (ctx.codeVersion < this.minCodeVersion) {
            throw new ChordError("upgrade_conflict", `${this.address} was upgraded in code version ${this.minCodeVersion}`);
        }
        if (this.gate !== undefined && !this.gate.grandfathered.has(ctx.rootId)) {
            throw new ChordError("upgrade_conflict", `${this.address} is being upgraded`);
        }
    }
    /** Records that the root of `ctx` touched this object (a reload gate grandfathers it). */
    lease(ctx) {
        if (this.leases.has(ctx.rootId))
            return;
        this.leases.set(ctx.rootId, ctx.codeVersion);
        this.host.touch(ctx.rootId, this);
    }
    guard = (ctx) => {
        if (this.host.inFactory > 0)
            throw invalid("read_only", "cells cannot be written while a factory runs");
        if (ctx instanceof CtxImpl)
            ctx.check(this.host);
        if (ctx.signal.aborted)
            throw new ChordError("aborted", "write with an aborted ctx");
        if (this.status === "disposed")
            throw new ChordError("gone", `${this.address} is disposed`);
        if (ctx.rootId.startsWith("task:"))
            return;
        this.admit(ctx);
    };
    async call(ref, name, args, ctx) {
        ctx.check(this.host);
        if (ref.status === "released" || ref.status === "gone")
            throw ref.terminalError();
        if (ref.status === "loading")
            await raceSignal(ref.ready, ctx.signal);
        if (ref.status !== "live" || this.status !== "live") {
            throw ref.status === "live"
                ? new ChordError("gone", `${this.address} is ${this.status}`)
                : ref.terminalError();
        }
        this.admit(ctx);
        const installed = this.implementations.get(ctx.codeVersion);
        if (installed === undefined)
            throw new ChordError("superseded", `${this.address} has no implementation for code version ${ctx.codeVersion}`);
        const view = ref.viewOf(installed);
        const variant = variantOf(view);
        const wanted = ref.describe(ref.contract.scope === "remote" ? variant : LOCAL_VARIANT, name);
        const fn = view[name];
        if (typeof fn !== "function" || (ref.contract.scope === "remote" && wanted?.kind !== "method")) {
            throw new ChordError("not_in_variant", `${this.address}: ${name} is not a method of variant ${variant ?? "(local)"}`);
        }
        const direct = view === installed.implementation;
        const schema = direct
            ? installed.service.contract.description.variants[variant ?? LOCAL_VARIANT]?.[name]
            : wanted;
        const method = schema?.kind === "method" ? schema : undefined;
        const validated = ref.contract.scope === "remote" ? method : undefined;
        // No arguments: the handler takes only ctx. No result (void): the caller gets undefined, whatever it returned.
        const takesArgs = method === undefined || method.args !== undefined;
        const returns = method === undefined || method.result !== undefined;
        let input;
        if (takesArgs) {
            // The additive rule assumes a consumer sends only what its own schema knows, and a provider sees only what its
            // schema knows: strip with both before validating.
            const own = ref.contract.scope === "remote" && wanted?.kind === "method" ? wanted.args : undefined;
            const sent = own === undefined ? args : Value.Clean(own, Value.Clone(args));
            input = validated?.args ? Value.Clean(validated.args, Value.Clone(sent)) : sent;
            if (validated?.args)
                assertValid("args", `${this.address}.${name} args`, validated.args, input);
        }
        this.lease(ctx);
        const child = ctx.child(this);
        let result;
        try {
            result = await this.#invoke(() => takesArgs
                ? fn(input, child)
                : fn(child));
        }
        finally {
            child.close();
        }
        if (!returns)
            return undefined;
        if (validated?.result)
            assertValid("result", `${this.address}.${name} result`, validated.result, result);
        return result;
    }
    /** Runs an invocation (method or listener) that keeps the object alive until it settles. */
    #invoke(fn) {
        const invocation = (async () => fn())();
        this.#invocations.add(invocation);
        const done = () => {
            this.#invocations.delete(invocation);
            if (this.#invocations.size === 0)
                this.#maybeIdle();
        };
        invocation.then(done, done);
        return invocation;
    }
    rootEnded(rootId) {
        this.leases.delete(rootId);
        const gate = this.gate;
        if (gate?.grandfathered.delete(rootId) && gate.grandfathered.size === 0)
            gate.drained();
    }
    // ─── lifetime ───
    addRef(ref) {
        this.refs.add(ref);
        if (this.#linger !== undefined)
            clearTimeout(this.#linger);
        this.#linger = undefined;
    }
    release(ref) {
        if (this.refs.delete(ref))
            this.#maybeIdle();
    }
    /** No references and no invocations: dispose (after `linger` for a live object). */
    #maybeIdle() {
        if (this.refs.size > 0 || this.#invocations.size > 0 || this.#linger !== undefined)
            return;
        if (this.status === "activating") {
            this.#background(this.dispose(false));
            return;
        }
        if (this.status !== "live")
            return;
        const linger = this.service?.options.linger ?? 0;
        if (linger <= 0) {
            this.#background(this.dispose(false));
            return;
        }
        this.#linger = setTimeout(() => {
            this.#linger = undefined;
            if (this.refs.size === 0 && this.#invocations.size === 0 && this.status === "live") {
                this.#background(this.dispose(false));
            }
        }, linger);
        this.#linger.unref?.();
    }
    #background(disposal) {
        disposal.catch((error) => this.host.report(error));
    }
    /**
     * Disposes the object. Forced: references become gone at once (new calls are rejected) and running invocations are
     * cancelled. Either way, resources close only after every invocation settled.
     */
    dispose(forced, reason) {
        this.#disposal ??= this.#dispose(forced, reason);
        return this.#disposal;
    }
    async #dispose(forced, reason) {
        const wasActivating = this.status === "activating";
        this.status = "disposing";
        this.host.forget(this);
        if (this.#linger !== undefined)
            clearTimeout(this.#linger);
        this.#linger = undefined;
        const error = reason ?? new ChordError("gone", `${this.address} was disposed`);
        if (forced) {
            for (const ref of this.refs)
                ref.gone(error);
            this.callAbort.abort(error);
        }
        this.activationAbort.abort(error);
        if (wasActivating)
            await this.ready.catch(noop);
        for (const ref of this.refs)
            ref.gone(error);
        const decls = this.allDecls();
        this.stopTasks();
        this.stopListeners();
        await Promise.allSettled([...this.#invocations]);
        const registered = [...decls].some((set) => set.registrations.size > 0) && !this.deferredRuntime;
        this.implementations.clear();
        this.decls = new Decls();
        if (registered)
            this.host.registriesChanged();
        const refs = new Set();
        for (const set of decls) {
            for (const derived of set.derives.values())
                derived.detach();
            for (const ref of set.refs.values())
                refs.add(ref);
        }
        try {
            await runAll([
                () => Promise.allSettled([...this.#stopped]),
                ...[...this.openOrder].reverse().map((resource) => () => resource.close(this.openOrder)),
                ...[...refs].map((ref) => () => ref.release()),
            ], `${this.address}: disposal failed`);
        }
        finally {
            this.status = "disposed";
            this.host.disposed(this);
        }
    }
}
const isReadableLike = (value) => value !== null &&
    typeof value === "object" &&
    typeof value.events === "function" &&
    typeof value.subscribe === "function";
/** The remote state-member schemas an implementation exposes, by source. */
export function memberSchemas(service, implementation) {
    const schemas = new Map();
    const contract = service.contract;
    if (contract.scope !== "remote")
        return schemas;
    const members = contract.description.variants[variantOf(implementation) ?? ""] ?? {};
    for (const [name, description] of Object.entries(members)) {
        const source = implementation[name];
        if (description.kind !== "state" || !isSource(source))
            continue;
        schemas.set(source, [...(schemas.get(source) ?? []), description.schema]);
    }
    return schemas;
}
function validateImplementation(service, implementation) {
    const contract = service.contract;
    const fail = (message) => {
        throw invalid("implementation", `${contract.name}: ${message}`);
    };
    if (implementation === null || typeof implementation !== "object")
        fail("factory must return an object");
    let members;
    if (contract.scope === "remote") {
        const variant = implementation.variant;
        if (typeof variant !== "string" || contract.description.variants[variant] === undefined)
            fail(`unknown variant ${String(variant)}`);
        members = contract.description.variants[variant];
        for (const key of Object.keys(implementation))
            if (key !== "variant" && members[key] === undefined)
                fail(`${key} is not in variant ${String(variant)}`);
    }
    else {
        members = contract.description.variants[LOCAL_VARIANT] ?? {};
    }
    for (const [name, description] of Object.entries(members)) {
        const value = implementation[name];
        if (description.kind === "method" && typeof value !== "function")
            fail(`${name} must be a method`);
        if (description.kind === "state" && !isSource(value) && !isReadableLike(value)) {
            fail(`${name} must be a cell, a derivation or a held object's state member`);
        }
        if (description.kind === "opaque" && value === undefined)
            fail(`${name} is missing`);
    }
}
// ─── The factory's `self` ────────────────────────────────────────────────────
class SelfImpl {
    #object;
    #previous;
    #decls = new Decls();
    #created = { refs: [], resources: [], derives: [], inits: [] };
    constructor(object, previous) {
        this.#object = object;
        this.#previous = previous;
    }
    run(implementation) {
        return { implementation: implementation, decls: this.#decls, created: this.#created };
    }
    /** Refuses a second declaration of `name` of one kind in this run (TypeScript cannot see string names). */
    #unique(map, kind, name) {
        if (typeof name !== "string" || name === "")
            throw new TypeError(`${kind} needs a name`);
        if (map.has(name))
            throw invalid("duplicate", `${this.#object.typeName}: duplicate ${kind} name ${name}`);
    }
    state(name, schema, initial, options = {}) {
        this.#unique(this.#decls.cells, "state", name);
        const version = options.version ?? 1;
        if (!Number.isInteger(version) || version < 1)
            throw new TypeError(`state ${name}: version must be a positive integer`);
        const host = this.#object.host;
        // A JSON value never holds a function: an object with a function `init` is the initializer, not a value.
        const init = isStateInit(initial) ? initial.init : undefined;
        let cell = this.#previous?.cells.get(name);
        if (cell === undefined) {
            cell = new Cell(name, schema, init === undefined ? { value: initial } : undefined, this.#object.guard, {
                dev: host.dev,
                report: (error) => host.report(error),
            });
            if (init !== undefined)
                this.#created.inits.push([cell, init]);
        }
        this.#decls.cells.set(name, cell);
        this.#decls.cellSchemas.set(name, schema);
        this.#decls.cellVersions.set(name, version);
        if (options.migrate !== undefined)
            this.#decls.cellMigrations.set(name, options.migrate);
        return cell;
    }
    get(type, input, options) {
        const host = this.#object.host;
        // A prepare rerun (recording mode) binds new references against the reload's pending contracts: a breaking provider
        // change and its updated consumer reload together.
        const candidate = this.#previous !== undefined;
        const address = host.addressOf(type, input, options?.principal ?? host.principal, candidate);
        const declared = this.#decls.refs.get(address);
        if (declared !== undefined) {
            if (declared.contract.fingerprint !== type.fingerprint) {
                throw invalid("duplicate", `${this.#object.typeName}: ${type.name} held twice with different contracts`);
            }
            return declared.proxy;
        }
        const existing = this.#previous?.refs.get(address);
        if (existing !== undefined &&
            existing.contract.fingerprint === type.fingerprint &&
            existing.status !== "gone" &&
            existing.status !== "released") {
            this.#decls.refs.set(address, existing);
            return existing.proxy;
        }
        const ref = host.acquire(type, input, options, "object", this.#object, candidate);
        this.#decls.refs.set(address, ref);
        this.#created.refs.push(ref);
        return ref.proxy;
    }
    resource(name, declaration) {
        this.#unique(this.#decls.resources, "resource", name);
        if (!Number.isInteger(declaration.version))
            throw new TypeError(`resource ${name}: version must be an integer`);
        const deps = (declaration.deps ?? []).map((dep) => {
            const resolved = refOf(dep) ?? resourceOf(dep);
            if (resolved === undefined) {
                throw new TypeError(`resource ${name}: deps must be references or resources of this object`);
            }
            return resolved;
        });
        const existing = this.#previous?.resources.get(name);
        const kept = existing !== undefined &&
            existing.spec.version === declaration.version &&
            existing.exclusive === (declaration.exclusive === true) &&
            existing.deps.length === deps.length &&
            existing.deps.every((dep, index) => dep === deps[index]);
        const resource = kept ? existing : new ResourceImpl(name, declaration, deps);
        if (kept)
            this.#decls.adopted.set(existing, declaration);
        else
            this.#created.resources.push(resource);
        this.#decls.resources.set(name, resource);
        return new ResourceFacade(resource, this.#object.host);
    }
    on(name, source, ...rest) {
        this.#unique(this.#decls.listeners, "listener", name);
        const [select, fn] = rest.length === 1 ? [undefined, rest[0]] : [rest[0], rest[1]];
        if (typeof fn !== "function")
            throw new TypeError(`listener ${name}: the handler must be a function`);
        if (select !== undefined && typeof select !== "function")
            throw new TypeError(`listener ${name}: select must be a function`);
        this.#decls.listeners.set(name, {
            source,
            select: select,
            fn: fn,
        });
    }
    task(fn) {
        if (typeof fn !== "function")
            throw new TypeError("a task must be a function");
        this.#decls.tasks.set(`#${this.#decls.tasks.size}`, fn);
    }
    derive(sources, fn) {
        if (typeof fn !== "function")
            throw new TypeError("a derivation needs a function");
        const host = this.#object.host;
        const key = `#${this.#decls.derives.size}`;
        const derived = new Derived(key, sources, fn, {
            dev: host.dev,
            report: (error) => host.report(error),
        });
        this.#created.derives.push(derived);
        this.#decls.derives.set(key, derived);
        return derived;
    }
    expose(resource) {
        const resolved = resourceOf(resource);
        if (resolved === undefined || ![...this.#decls.resources.values()].includes(resolved)) {
            throw new TypeError("expose takes a resource declared by this object");
        }
        return new ExposedImpl(resolved);
    }
    register(registry, entries) {
        if (!this.#object.hostLifetime)
            throw invalid("not_host_lifetime", `${this.#object.typeName}: only objects of lifetime "host" may register`);
        for (const [key, value] of Object.entries(entries)) {
            const id = `${registry.name}\u0000${key}`;
            this.#unique(this.#decls.registrations, "register", id);
            this.#decls.registrations.set(id, { registry: registry, key, value });
        }
    }
}
//# sourceMappingURL=object.js.map