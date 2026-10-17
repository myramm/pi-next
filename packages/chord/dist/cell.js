import { diffRevisions, track } from "./delta/index.js";
import { ChordError } from "./errors.js";
import { enqueue, holdPublications } from "./publish.js";
import { assertValid } from "./schema.js";
let sequence = 0;
/** Fans out values and delta events; listener errors are reported, not thrown to the writer. */
class Fanout {
    #values = new Set();
    #events = new Set();
    #report;
    constructor(report) {
        this.#report = report;
    }
    subscribe(listener, current) {
        this.#values.add(listener);
        this.#call(listener, current);
        return () => this.#values.delete(listener);
    }
    events(listener, current) {
        this.#events.add(listener);
        this.#call(listener, { type: "snap", value: current });
        return () => this.#events.delete(listener);
    }
    /**
     * Queues delivery to the listeners subscribed now. A listener that subscribes later already got this revision in
     * its snapshot; one that unsubscribes before delivery is skipped.
     */
    emit(event) {
        const events = [...this.#events];
        const values = [...this.#values];
        enqueue(() => {
            for (const listener of events)
                if (this.#events.has(listener))
                    this.#call(listener, event);
            for (const listener of values)
                if (this.#values.has(listener))
                    this.#call(listener, event.value);
        });
    }
    #call(listener, value) {
        try {
            listener(value);
        }
        catch (error) {
            this.#report(error);
        }
    }
}
/**
 * Whether a state source has its value (entry 8): a remote reference's member before its first snapshot has none, and
 * neither has anything derived from or forwarding it. Sources without this symbol always have their value.
 */
export const HYDRATION = Symbol("chord.hydration");
/** The hydration of a readable, or undefined for a source that always has its value. */
export function hydrationOf(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    return value[HYDRATION];
}
/** The hydrations of `sources` that are not hydrated yet. */
export const unhydrated = (sources) => [...sources].map(hydrationOf).filter((hydration) => hydration?.hydrated === false);
/** An object-owned state source (cell or derivation). Writes recompute dependents atomically. */
export class Source {
    key;
    seq = ++sequence;
    dependents = new Set();
    /** Schemas of remote state members currently exposing this source (checked per write in dev mode). */
    schemas = [];
    options;
    fanout;
    constructor(key, options) {
        this.key = key;
        this.options = options;
        this.fanout = new Fanout(options.report);
    }
    subscribe(listener) {
        return this.fanout.subscribe(listener, this.value);
    }
    events(listener) {
        return this.fanout.events(listener, this.value);
    }
    /** Per-write validation, dev mode only. */
    validate(value) {
        if (!this.options.dev)
            return;
        for (const schema of this.ownSchemas())
            assertValid("state", `state ${this.key}`, schema, value);
        for (const schema of this.schemas)
            assertValid("state", `state ${this.key}`, schema, value);
    }
    ownSchemas() {
        return [];
    }
}
function unbox(ops, value) {
    const result = [];
    for (const op of ops) {
        if (op[0] === "r" || op[1].length === 0)
            return [["r", value]];
        const path = op[1].slice(1);
        switch (op[0]) {
            case "p":
                result.push(["p", path, op[2], op[3], op[4]]);
                break;
            case "m":
                result.push(["m", path, op[2]]);
                break;
            default:
                // s/d/a/t on the value itself replace it.
                if (path.length === 0)
                    return [["r", value]];
                if (op[0] === "d")
                    result.push(["d", path]);
                else
                    result.push([op[0], path, op[2]]);
        }
    }
    return result;
}
/** A state cell holding any JSON value, validated against its schema at creation and (dev mode) on writes. */
export class Cell extends Source {
    /** Replaced at a reload commit that changes the schema (state-version bump). */
    schema;
    #tracker;
    #guard;
    /** False until `initialize` for a cell declared with `init`: reads and writes throw `not_ready`. */
    #initialized;
    /**
     * `initial` is always validated against `schema`; ownership moves to the cell. Without `initial`, the cell has no
     * value until `initialize` (a cell declared with `init`, filled before its object goes live).
     */
    constructor(key, schema, initial, guard, options) {
        super(key, options);
        if (initial !== undefined)
            assertValid("state", `initial value of state ${key}`, schema, initial.value);
        this.schema = schema;
        this.#tracker = track({ v: (initial?.value ?? null) });
        this.#guard = guard;
        this.#initialized = initial !== undefined;
    }
    /** Sets the first value of a cell declared with `init` (validated; ownership moves to the cell). Publishes nothing. */
    initialize(value) {
        if (this.#initialized)
            throw new Error(`state ${this.key} is already initialized`);
        assertValid("state", `initial value of state ${this.key}`, this.schema, value);
        this.#tracker = track({ v: value });
        this.#initialized = true;
    }
    ownSchemas() {
        return [this.schema];
    }
    get value() {
        if (!this.#initialized)
            throw notReady(`state ${this.key} (its init has not run)`);
        return this.#tracker.value.v;
    }
    change(ctx, fn) {
        this.#guard(ctx);
        if (!this.#initialized)
            throw notReady(`state ${this.key} (its init has not run)`);
        const change = this.#tracker.beginChange();
        let prepared;
        try {
            const draft = change.state;
            const result = fn(draft.v);
            if (result instanceof Promise)
                throw new TypeError("cell.change callbacks must be synchronous");
            if (result !== undefined) {
                if (result !== draft.v)
                    assertValid("state", `state ${this.key}`, this.schema, result);
                draft.v = result;
            }
            prepared = change.prepare();
        }
        catch (error) {
            change.abort();
            throw error;
        }
        this.#publish(prepared, "ops");
    }
    /**
     * Replaces the whole value. Ownership of `value` moves to the cell: never mutate it afterwards.
     *
     * Subscribers get a structural diff (`diffRevisions`) when `diff` is true, or by default when the new value shares
     * containers with the old one (a new immutable revision of the same state, e.g. mirrored from another store);
     * otherwise a single `r` op. The resulting value is the same either way; only the ops differ.
     */
    replace(ctx, value, options = {}) {
        this.#guard(ctx);
        if (!this.#initialized)
            throw notReady(`state ${this.key} (its init has not run)`);
        const before = this.value;
        const diff = options.diff ?? sharesStructure(before, value);
        const ops = diff ? diffRevisions(before, value) : undefined;
        this.#publish(this.#tracker.prepareReplace({ v: value }), "ops", true, ops);
    }
    /**
     * Installs a migrated value and its schema (reload commit). The caller validated the value and the derivations
     * over it against every schema that will apply, so nothing is checked here. Subscribers receive a reset.
     */
    reset(value, schema) {
        this.schema = schema;
        this.#publish(this.#tracker.prepareReplace({ v: value }), "reset", false);
    }
    /** Adopts this revision and every derived one, then queues all notifications (cell first, then derivations). */
    #publish(prepared, type, validate = true, ops) {
        if (prepared.ops.length === 0 && type === "ops") {
            this.#tracker.adopt(prepared);
            return;
        }
        const value = prepared.value.v;
        let candidates;
        try {
            if (validate)
                this.validate(value);
            candidates = computeDependents(this, value, validate);
        }
        catch (error) {
            prepared.abort();
            throw error;
        }
        holdPublications(() => {
            this.#tracker.adopt(prepared);
            const published = ops !== undefined && ops.length > 0 ? ops : unbox(prepared.ops, value);
            this.fanout.emit(type === "reset" ? { type, value } : { type, ops: published, value });
            for (const [derived, next] of candidates)
                derived.install(next);
        });
    }
}
/** True if `b` reuses at least one container of `a` at the same key: a new revision of the same state. */
function sharesStructure(a, b) {
    if (a === null || b === null || typeof a !== "object" || typeof b !== "object" || a === b)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    for (const [key, child] of Object.entries(b)) {
        if (child !== null && typeof child === "object" && a[key] === child)
            return true;
    }
    return false;
}
/** Recomputes every transitive dependent of `changed` against candidate values and validates them. */
function computeDependents(changed, value, validate = true) {
    const pending = new Set();
    const visit = (source) => {
        for (const derived of source.dependents) {
            if (pending.has(derived))
                continue;
            pending.add(derived);
            visit(derived);
        }
    };
    visit(changed);
    const values = new Map([[changed, value]]);
    const result = new Map();
    for (const derived of [...pending].sort((a, b) => a.seq - b.seq)) {
        const next = derived.compute((source) => (values.has(source) ? values.get(source) : source.value));
        if (validate)
            derived.validate(next);
        values.set(derived, next);
        result.set(derived, next);
    }
    return result;
}
const isReadable = (value) => value !== null &&
    typeof value === "object" &&
    typeof value.subscribe === "function" &&
    "value" in value;
/**
 * A synchronous derivation. Sources are object cells/derivations (recomputed atomically with the write) or other
 * readables such as reference state members (recomputed when they publish). Subscribers receive diffs.
 */
export class Derived extends Source {
    sources;
    #fn;
    #value;
    #external = [];
    constructor(key, sources, fn, options) {
        super(key, options);
        this.sources = sources.map((source) => {
            if (!isReadable(source))
                throw new TypeError(`derive ${key}: sources must be readables`);
            return source;
        });
        this.#fn = fn;
        this.#value = undefined;
    }
    get value() {
        return this.#value;
    }
    /** Hydrated once every source is (a derivation over a remote member waits for its snapshot). */
    get [HYDRATION]() {
        const pending = unhydrated(this.sources);
        if (pending.length === 0)
            return undefined;
        return {
            hydrated: false,
            whenHydrated: () => Promise.all(pending.map((hydration) => hydration.whenHydrated())).then(() => { }),
        };
    }
    /**
     * Computes the first value (or takes it from `precomputed`, a reload's validated dry run) and starts following
     * the sources (at install, never inside a factory).
     */
    attach(precomputed) {
        this.#value = precomputed?.has(this) ? precomputed.get(this) : this.compute((source) => source.value);
        for (const source of this.sources) {
            if (source instanceof Source)
                source.dependents.add(this);
            else
                this.#external.push(source.subscribe(() => this.refresh()));
        }
    }
    detach() {
        for (const source of this.sources)
            if (source instanceof Source)
                source.dependents.delete(this);
        for (const unsubscribe of this.#external.splice(0))
            unsubscribe();
    }
    compute(read) {
        const result = this.#fn(...this.sources.map(read));
        if (result instanceof Promise)
            throw new TypeError(`derive ${this.key}: fn must be synchronous`);
        return result;
    }
    /** Recomputes and republishes, including dependents. Errors are reported (the source write already happened). */
    refresh() {
        try {
            const next = this.compute((source) => source.value);
            const dependents = computeDependents(this, next);
            holdPublications(() => {
                this.install(next);
                for (const [derived, value] of dependents)
                    derived.install(value);
            });
        }
        catch (error) {
            this.options.report(error);
        }
    }
    install(next) {
        const before = this.#value;
        this.#value = next;
        const ops = before === undefined || next === undefined
            ? [["r", (next ?? null)]]
            : diffRevisions(before, next);
        if (ops.length > 0)
            this.fanout.emit({ type: "ops", ops, value: next });
    }
}
export const isSource = (value) => value instanceof Source;
/** Thrown by placeholders used before activation finished. */
export const notReady = (what) => new ChordError("not_ready", `${what} is not ready`);
//# sourceMappingURL=cell.js.map