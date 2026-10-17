import { Value } from "typebox/value";
import { HYDRATION } from "./cell.js";
import { takesNoArgs } from "./contract.js";
import { applyImmutable, decoder } from "./delta/index.js";
import { ChordError, invalid } from "./errors.js";
import { CtxImpl, notifyStatus, REF_BASE, raceSignal, refsByProxy, } from "./object.js";
import { fromWireError } from "./wire.js";
const noop = () => { };
function deferred() {
    let resolve = noop;
    let reject = noop;
    const promise = new Promise((done, fail) => {
        resolve = done;
        reject = fail;
    });
    promise.catch(noop);
    return { promise, resolve, reject };
}
/**
 * One hold per host and key (type, normalized input, principal key, contract fingerprint), shared by every reference to
 * it: one hold over the link, one stream per state member, calls over the same hold. References are views onto it.
 *
 * A hold implies the state of its variant (unless no view wants state): the provider answers with a unit, the shape
 * followed by a snapshot of each state member the binding lacks. A shape is applied only once all of its snapshots are
 * here, so a live binding always has every state member of its variant. After the first hydration the values stay
 * readable while the binding re-holds (link loss): status `loading`, last values kept.
 */
export class RemoteBinding {
    host;
    key;
    contract;
    at;
    input;
    /** Forwarded principal (omitted for the host's own principal). */
    principal;
    /** `ended`: gone with `error`, or closed (no views, no linger). */
    status = "loading";
    error;
    /** The applied shape (kept while re-holding). */
    shape;
    /** Every state member of the applied shape has a value (stays true while re-holding). */
    hydrated = false;
    /** The current hold; undefined while resolving the route or after a link loss. */
    hold;
    /** What the provider was told: state for this hold (`state: false` / `sub` / `unsub`). */
    stateOn = false;
    views = new Set();
    members = new Map();
    /** Lingering since (no views): set by the host. */
    lingerTimer;
    #listeners = new Map();
    /** A shape waiting for its snapshots. */
    #pending;
    /** Resolved while a shape is applied for the current hold (calls wait for it). */
    #live = deferred();
    /** A shape was applied once (a re-hold says `again`). */
    #applied = false;
    /** Waiting for the first hydration (`whenHydrated`). */
    #hydrationWaiters = new Set();
    constructor(host, fields) {
        this.host = host;
        this.key = fields.key;
        this.contract = fields.contract;
        this.at = fields.at;
        this.input = fields.input;
        this.principal = fields.principal;
    }
    get ended() {
        return this.status === "ended";
    }
    /** Views that want state. */
    get stateViews() {
        let count = 0;
        for (const view of this.views)
            if (view.wantsState)
                count++;
        return count;
    }
    /** Whether the next hold should carry state: some view wants it, or nobody is left (lingering keeps it). */
    get wantsState() {
        return this.views.size === 0 ? this.stateOn : this.stateViews > 0;
    }
    /** Whether a re-hold is `again` (the binding already has a shape). */
    get applied() {
        return this.#applied;
    }
    // ─── views ───
    addView(view) {
        this.views.add(view);
        if (this.lingerTimer !== undefined) {
            clearTimeout(this.lingerTimer);
            this.lingerTimer = undefined;
        }
        this.#syncState();
        view.update();
    }
    removeView(view) {
        if (!this.views.delete(view))
            return;
        for (const set of this.#listeners.values())
            for (const readable of set)
                if (readable.view === view)
                    set.delete(readable);
        if (this.views.size === 0) {
            this.host.bindingIdle(this);
            return;
        }
        this.#syncState();
    }
    /** Tells the provider to start or stop state when the views' wish changed. */
    #syncState() {
        if (this.ended || this.views.size === 0)
            return;
        const wanted = this.stateViews > 0;
        if (wanted === this.stateOn)
            return;
        this.stateOn = wanted;
        if (!wanted) {
            this.hydrated = false;
            this.members.clear();
            if (this.#pending !== undefined)
                this.#pending.missing.clear();
        }
        if (this.hold !== undefined)
            this.hold.channel.wantState(this.hold.id, wanted);
        for (const view of this.views)
            view.update();
    }
    listen(name, readable) {
        let set = this.#listeners.get(name);
        if (set === undefined) {
            set = new Set();
            this.#listeners.set(name, set);
        }
        set.add(readable);
    }
    unlisten(name, readable) {
        this.#listeners.get(name)?.delete(readable);
    }
    /** Whether `name` is a state member of the applied variant (as the consumer's contract describes it). */
    inVariant(name) {
        const variant = this.shape?.variant;
        return variant !== undefined && this.contract.description.variants[variant]?.[name]?.kind === "state";
    }
    /** The members' value as views read it: throws `not_ready` before the first hydration, `not_in_variant` outside it. */
    read(name) {
        if (this.status === "ended")
            throw this.terminalError();
        if (!this.hydrated)
            throw new ChordError("not_ready", `${this.key}.${name} is not hydrated yet`);
        if (!this.inVariant(name))
            throw new ChordError("not_in_variant", `${this.key}: ${name} is not a state member of variant ${this.shape?.variant}`);
        return this.members.get(name)?.value;
    }
    /** Resolves once the binding has its state (rejects if it ends first). */
    whenHydrated() {
        if (this.hydrated)
            return Promise.resolve();
        if (this.ended)
            return Promise.reject(this.terminalError());
        return new Promise((resolve, reject) => this.#hydrationWaiters.add({ resolve, reject }));
    }
    #settleHydration(error) {
        const waiters = [...this.#hydrationWaiters];
        this.#hydrationWaiters.clear();
        for (const waiter of waiters) {
            if (error === undefined)
                waiter.resolve();
            else
                waiter.reject(error);
        }
    }
    readable(name) {
        return this.status !== "ended" && this.hydrated && this.inVariant(name);
    }
    terminalError() {
        return this.error ?? new ChordError("released", `reference ${this.key} released`);
    }
    // ─── driven by the host and the link ───
    bound(channel, id) {
        this.hold = { channel, id };
        this.stateOn = this.wantsState;
    }
    /** A unit begins: `listed` are the members whose snapshots follow. */
    shaped(shape, listed) {
        if (this.ended)
            return;
        const previous = this.#pending;
        const missing = new Set(listed);
        // A newer shape before the older one's snapshots (relays may reorder them): wait for both.
        if (previous !== undefined)
            for (const name of previous.missing)
                missing.add(name);
        const wanted = new Set(this.#stateMembers(shape));
        for (const name of [...missing])
            if (!wanted.has(name) || !this.stateOn)
                missing.delete(name);
        this.#pending = { shape, missing, values: previous?.values ?? new Map() };
        if (missing.size === 0)
            this.#apply();
    }
    /** A state frame for member `name` of the current hold. */
    state(name, frame) {
        if (this.ended)
            return;
        if (frame.as === "error") {
            const error = fromWireError(frame.error);
            // Before the first hydration nobody could read anything: the binding fails instead of waiting forever.
            if (!this.hydrated && this.stateOn) {
                this.gone(error);
                this.close();
            }
            else
                this.host.report(error);
            return;
        }
        const pending = this.#pending;
        if (frame.as === "ops") {
            const target = pending?.values.get(name) ?? this.members.get(name);
            if (target === undefined)
                return;
            const ops = target.decoder.decode(frame.ops ?? []);
            target.value = applyImmutable(target.value, ops);
            if (target === this.members.get(name))
                this.#deliver(name, { type: "ops", ops, value: target.value });
            return;
        }
        const fresh = { value: frame.value, decoder: decoder() };
        if (pending !== undefined && (pending.missing.has(name) || pending.values.has(name))) {
            pending.values.set(name, fresh);
            pending.missing.delete(name);
            if (pending.missing.size === 0)
                this.#apply();
            return;
        }
        if (!this.inVariant(name))
            return;
        this.members.set(name, fresh);
        this.#deliver(name, { type: "reset", value: fresh.value });
    }
    /** The provider ended the object (or refused the hold): every view is gone. */
    gone(error) {
        if (this.ended)
            return;
        this.status = "ended";
        this.error = error;
        this.hold = undefined;
        this.#pending = undefined;
        this.#live.reject(error);
        this.#settleHydration(error);
        for (const view of [...this.views])
            view.end(error);
        this.#listeners.clear();
        this.host.forgetBinding(this);
    }
    /** The link went down but may come back (upstream reconnect): keep the values, wait for the re-hold. */
    detached() {
        if (this.ended)
            return;
        this.hold = undefined;
        this.#pending = undefined;
        if (this.status === "live") {
            this.status = "loading";
            this.#live = deferred();
        }
        for (const view of this.views)
            view.update();
    }
    /** No views and no linger: releases the hold and forgets the binding. */
    close() {
        if (this.lingerTimer !== undefined)
            clearTimeout(this.lingerTimer);
        this.lingerTimer = undefined;
        if (this.hold !== undefined)
            this.hold.channel.release(this.hold.id);
        this.hold = undefined;
        if (this.status !== "ended") {
            this.status = "ended";
            const error = new ChordError("released", `reference ${this.key} released`);
            this.#live.reject(error);
            this.#settleHydration(error);
            for (const view of [...this.views])
                view.end(error);
        }
        this.#pending = undefined;
        this.#listeners.clear();
        this.host.forgetBinding(this);
    }
    /** Calls `name` over the current hold, waiting for it while the binding (re)holds. */
    async call(name, args, ctx) {
        for (;;) {
            if (this.ended)
                throw this.terminalError();
            if (this.status !== "live" || this.hold === undefined)
                await raceSignal(this.#live.promise, ctx.signal);
            const hold = this.hold;
            if (hold === undefined || this.status !== "live")
                continue;
            const variant = this.shape?.variant;
            const description = variant === undefined ? undefined : this.contract.description.variants[variant]?.[name];
            if (description?.kind !== "method") {
                throw new ChordError("not_in_variant", `${this.key}: ${name} is not a method of variant ${variant}`);
            }
            // Send only what the consumer's own schema knows (the additive rule's premise; see ObjectImpl.call).
            const sent = description.args === undefined ? undefined : Value.Clean(description.args, Value.Clone(args));
            return hold.channel.call(hold.id, name, sent, { rootId: ctx.rootId, codeVersion: ctx.codeVersion }, ctx.signal);
        }
    }
    #stateMembers(shape) {
        const members = shape.variant === undefined ? undefined : this.contract.description.variants[shape.variant];
        if (members === undefined)
            return [];
        return shape.members.filter((name) => members[name]?.kind === "state");
    }
    /** Applies the pending shape with its snapshots: members outside the variant go, new values are announced. */
    #apply() {
        const pending = this.#pending;
        if (pending === undefined)
            return;
        this.#pending = undefined;
        this.shape = pending.shape;
        const wanted = new Set(this.#stateMembers(pending.shape));
        for (const name of [...this.members.keys()])
            if (!wanted.has(name))
                this.members.delete(name);
        for (const [name, state] of pending.values)
            if (wanted.has(name))
                this.members.set(name, state);
        this.hydrated = this.stateOn && [...wanted].every((name) => this.members.has(name));
        if (this.hydrated)
            this.#settleHydration();
        this.status = "live";
        this.#applied = true;
        this.#live.resolve();
        for (const view of this.views)
            view.update();
        for (const [name, state] of pending.values) {
            if (wanted.has(name))
                this.#deliver(name, { type: "reset", value: state.value });
        }
        for (const view of [...this.views])
            view.shapeChanged();
    }
    #deliver(name, event) {
        const readables = this.#listeners.get(name);
        if (readables === undefined)
            return;
        for (const readable of [...readables])
            readable.deliver(event);
    }
}
/**
 * A state member of a remote reference: the binding's value. Reading throws `not_ready` before the first hydration and
 * `not_in_variant` outside the variant. A listener added before the hydration gets its snapshot then.
 */
class ViewReadable {
    view;
    #name;
    #values = new Set();
    #events = new Set();
    /** Event listeners that have not had their snapshot yet. */
    #unseen = new Set();
    constructor(view, name) {
        this.view = view;
        this.#name = name;
    }
    get value() {
        if (this.view.ended)
            throw this.view.terminalError();
        return this.view.binding.read(this.#name);
    }
    /** Not hydrated before the binding's first snapshots (a local object forwarding this member waits for them). */
    get [HYDRATION]() {
        const binding = this.view.binding;
        if (binding.hydrated)
            return undefined;
        return { hydrated: false, whenHydrated: () => binding.whenHydrated() };
    }
    subscribe(listener) {
        this.#values.add(listener);
        this.#attach();
        if (this.#readable())
            this.#safe(() => listener(this.view.binding.members.get(this.#name)?.value));
        return () => this.#remove(this.#values, listener);
    }
    events(listener) {
        this.#events.add(listener);
        this.#attach();
        if (this.#readable()) {
            const value = this.view.binding.members.get(this.#name)?.value;
            this.#safe(() => listener({ type: "snap", value }));
        }
        else
            this.#unseen.add(listener);
        return () => {
            this.#unseen.delete(listener);
            this.#remove(this.#events, listener);
        };
    }
    deliver(event) {
        for (const listener of [...this.#events]) {
            if (!this.#unseen.delete(listener))
                this.#safe(() => listener(event));
            else if (event.type !== "ops")
                this.#safe(() => listener({ type: "snap", value: event.value }));
        }
        for (const listener of [...this.#values])
            this.#safe(() => listener(event.value));
    }
    stop() {
        this.#values.clear();
        this.#events.clear();
        this.#unseen.clear();
        this.view.binding.unlisten(this.#name, this);
    }
    #readable() {
        return !this.view.ended && this.view.binding.readable(this.#name);
    }
    #attach() {
        if (!this.view.ended)
            this.view.binding.listen(this.#name, this);
    }
    #remove(set, listener) {
        set.delete(listener);
        if (this.#values.size + this.#events.size === 0)
            this.view.binding.unlisten(this.#name, this);
    }
    #safe(fn) {
        try {
            fn();
        }
        catch (error) {
            this.view.binding.host.report(error);
        }
    }
}
/**
 * A reference to an object on another host: a view onto the host's shared binding for its key. Each view has its own
 * owner, status, observers and `release`; ending by the provider and re-holding belong to the binding.
 */
export class RemoteRef {
    object = undefined;
    binding;
    owner;
    /** False: a method-only view (`state: false`), ready once live. */
    wantsState;
    proxy;
    ready;
    status = "loading";
    error;
    shapeListeners = new Set();
    #statusListeners = new Set();
    #readables = new Map();
    #callers = new Map();
    #settleReady;
    constructor(binding, owner, wantsState) {
        this.binding = binding;
        this.owner = owner;
        this.wantsState = wantsState;
        const ready = deferred();
        this.ready = ready.promise;
        this.#settleReady = ready;
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
        });
        refsByProxy.set(this.proxy, this);
    }
    get contract() {
        return this.binding.contract;
    }
    get address() {
        return this.binding.key;
    }
    get ended() {
        return this.status === "released" || this.status === "gone";
    }
    get variant() {
        return this.binding.shape?.variant;
    }
    get shape() {
        return this.binding.shape;
    }
    onShape(listener) {
        this.shapeListeners.add(listener);
        return () => this.shapeListeners.delete(listener);
    }
    onStatus(listener) {
        this.#statusListeners.add(listener);
        return () => this.#statusListeners.delete(listener);
    }
    terminalError() {
        return this.status === "gone" ? this.error : new ChordError("released", `reference ${this.address} released`);
    }
    release() {
        if (this.ended)
            return;
        this.status = "released";
        this.#notify();
        this.#settleReady?.reject(new ChordError("released", `reference ${this.address} released`));
        this.#settleReady = undefined;
        for (const readable of this.#readables.values())
            readable.stop();
        this.binding.removeView(this);
    }
    // ─── driven by the binding ───
    /** Follows the binding: live once it has a shape (and, for a state view, its state) over a current hold. */
    update() {
        if (this.ended)
            return;
        const binding = this.binding;
        const live = binding.status === "live" && binding.hold !== undefined && (!this.wantsState || binding.hydrated);
        const next = live ? "live" : "loading";
        if (next === this.status)
            return;
        this.status = next;
        this.#notify();
        if (live) {
            this.#settleReady?.resolve();
            this.#settleReady = undefined;
        }
    }
    end(error) {
        if (this.ended)
            return;
        const released = error instanceof ChordError && error.code === "released";
        this.status = released ? "released" : "gone";
        if (!released)
            this.error = error;
        this.#notify();
        this.#settleReady?.reject(error);
        this.#settleReady = undefined;
        for (const readable of this.#readables.values())
            readable.stop();
    }
    shapeChanged() {
        const shape = this.binding.shape;
        if (shape === undefined || this.ended)
            return;
        for (const listener of [...this.shapeListeners]) {
            try {
                listener(shape);
            }
            catch (error) {
                this.binding.host.report(error);
            }
        }
    }
    #notify() {
        notifyStatus(this.#statusListeners, this.status, this.error, (error) => this.binding.host.report(error));
    }
    // ─── members ───
    member(name) {
        const description = Object.values(this.contract.description.variants)
            .map((members) => members[name])
            .find((member) => member !== undefined);
        if (description?.kind === "method")
            return this.#caller(name);
        if (description?.kind === "state") {
            let readable = this.#readables.get(name);
            if (readable === undefined) {
                readable = new ViewReadable(this, name);
                this.#readables.set(name, readable);
            }
            return readable;
        }
        return undefined;
    }
    #caller(name) {
        let caller = this.#callers.get(name);
        if (caller === undefined) {
            const noArgs = takesNoArgs(this.contract, name);
            caller = (...given) => {
                // A method without arguments is called as `ref.name(ctx)`.
                const [args, ctx] = (noArgs ? [undefined, given[0]] : given);
                const host = this.binding.host;
                if (host.inFactory > 0)
                    throw new ChordError("not_ready", `${this.address}.${name} called inside a factory`);
                // The same checks as a local reference's caller (RefImpl.caller and ObjectImpl.call): a ctx from another host
                // or one not made by Chord would carry a root this host does not own over its link.
                if (ctx !== undefined && !(ctx instanceof CtxImpl)) {
                    return Promise.reject(invalid("foreign_ctx", "ctx must come from a Chord host"));
                }
                try {
                    ctx?.check(host);
                }
                catch (error) {
                    return Promise.reject(error);
                }
                if (ctx === undefined || ctx.holder) {
                    return host.root((root) => this.#call(name, args, root), { signal: ctx?.signal });
                }
                return this.#call(name, args, ctx);
            };
            this.#callers.set(name, caller);
        }
        return caller;
    }
    #call(name, args, ctx) {
        if (this.ended)
            return Promise.reject(this.terminalError());
        return this.binding.call(name, args, ctx);
    }
}
//# sourceMappingURL=remote.js.map