import { HYDRATION, type Hydration } from "./cell.ts";
import { type AnyContract } from "./contract.ts";
import { type Decoder } from "./delta/index.ts";
import { type RefCore, type RefOwner, type StatusListener } from "./object.ts";
import type { Ctx, Readable, RefStatus, Shape, StateEvent } from "./types.ts";
import { type RootRef, type WireError } from "./wire.ts";
/** One state frame for a member, as the binding receives it (payload unpacked). */
export interface StateIn {
    readonly as: "snap" | "reset" | "ops" | "error";
    readonly value?: unknown;
    readonly ops?: readonly unknown[];
    readonly error?: WireError;
}
/** What a binding needs from the link it is bound to (implemented by Connection). */
export interface RemoteChannel {
    /** Sends a hold for `binding`; `again`: the binding already has values (a re-hold), its unit is not urgent. */
    hold(binding: RemoteBinding, again: boolean): number;
    release(id: number): void;
    call(hold: number, member: string, args: unknown, root: RootRef | undefined, signal: AbortSignal): Promise<unknown>;
    /** Starts (`sub`) or stops (`unsub`) the state of a hold. */
    wantState(hold: number, wanted: boolean): void;
}
/** What a binding needs from its host. */
export interface RemoteHost {
    readonly inFactory: number;
    report(error: unknown): void;
    root<T>(fn: (ctx: Ctx) => T | Promise<T>, options?: {
        signal?: AbortSignal;
    }): Promise<T>;
    /** The binding has no views left: the host lingers it or closes it. */
    bindingIdle(binding: RemoteBinding): void;
    /** The binding ended or was closed: the host forgets it. */
    forgetBinding(binding: RemoteBinding): void;
}
/** A member's value with the decoder of its current stream. */
interface MemberState {
    value: unknown;
    decoder: Decoder;
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
export declare class RemoteBinding {
    #private;
    readonly host: RemoteHost;
    readonly key: string;
    readonly contract: AnyContract;
    readonly at: string;
    readonly input: unknown;
    /** Forwarded principal (omitted for the host's own principal). */
    readonly principal: unknown | undefined;
    /** `ended`: gone with `error`, or closed (no views, no linger). */
    status: "loading" | "live" | "ended";
    error: unknown;
    /** The applied shape (kept while re-holding). */
    shape: Shape | undefined;
    /** Every state member of the applied shape has a value (stays true while re-holding). */
    hydrated: boolean;
    /** The current hold; undefined while resolving the route or after a link loss. */
    hold: {
        readonly channel: RemoteChannel;
        readonly id: number;
    } | undefined;
    /** What the provider was told: state for this hold (`state: false` / `sub` / `unsub`). */
    stateOn: boolean;
    readonly views: Set<RemoteRef>;
    readonly members: Map<string, MemberState>;
    /** Lingering since (no views): set by the host. */
    lingerTimer: ReturnType<typeof setTimeout> | undefined;
    constructor(host: RemoteHost, fields: {
        key: string;
        contract: AnyContract;
        at: string;
        input: unknown;
        principal: unknown | undefined;
    });
    get ended(): boolean;
    /** Views that want state. */
    get stateViews(): number;
    /** Whether the next hold should carry state: some view wants it, or nobody is left (lingering keeps it). */
    get wantsState(): boolean;
    /** Whether a re-hold is `again` (the binding already has a shape). */
    get applied(): boolean;
    addView(view: RemoteRef): void;
    removeView(view: RemoteRef): void;
    listen(name: string, readable: ViewReadable): void;
    unlisten(name: string, readable: ViewReadable): void;
    /** Whether `name` is a state member of the applied variant (as the consumer's contract describes it). */
    inVariant(name: string): boolean;
    /** The members' value as views read it: throws `not_ready` before the first hydration, `not_in_variant` outside it. */
    read(name: string): unknown;
    /** Resolves once the binding has its state (rejects if it ends first). */
    whenHydrated(): Promise<void>;
    readable(name: string): boolean;
    terminalError(): unknown;
    bound(channel: RemoteChannel, id: number): void;
    /** A unit begins: `listed` are the members whose snapshots follow. */
    shaped(shape: Shape, listed: readonly string[]): void;
    /** A state frame for member `name` of the current hold. */
    state(name: string, frame: StateIn): void;
    /** The provider ended the object (or refused the hold): every view is gone. */
    gone(error: unknown): void;
    /** The link went down but may come back (upstream reconnect): keep the values, wait for the re-hold. */
    detached(): void;
    /** No views and no linger: releases the hold and forgets the binding. */
    close(): void;
    /** Calls `name` over the current hold, waiting for it while the binding (re)holds. */
    call(name: string, args: unknown, ctx: Ctx): Promise<unknown>;
}
/**
 * A state member of a remote reference: the binding's value. Reading throws `not_ready` before the first hydration and
 * `not_in_variant` outside the variant. A listener added before the hydration gets its snapshot then.
 */
declare class ViewReadable implements Readable<unknown> {
    #private;
    readonly view: RemoteRef;
    constructor(view: RemoteRef, name: string);
    get value(): unknown;
    /** Not hydrated before the binding's first snapshots (a local object forwarding this member waits for them). */
    get [HYDRATION](): Hydration | undefined;
    subscribe(listener: (value: unknown) => void): () => void;
    events(listener: (event: StateEvent<unknown>) => void): () => void;
    deliver(event: StateEvent<unknown>): void;
    stop(): void;
}
/**
 * A reference to an object on another host: a view onto the host's shared binding for its key. Each view has its own
 * owner, status, observers and `release`; ending by the provider and re-holding belong to the binding.
 */
export declare class RemoteRef implements RefCore {
    #private;
    readonly object: undefined;
    readonly binding: RemoteBinding;
    readonly owner: RefOwner;
    /** False: a method-only view (`state: false`), ready once live. */
    readonly wantsState: boolean;
    readonly proxy: object;
    readonly ready: Promise<void>;
    status: RefStatus;
    error: unknown;
    readonly shapeListeners: Set<(shape: Shape) => void>;
    constructor(binding: RemoteBinding, owner: RefOwner, wantsState: boolean);
    get contract(): AnyContract;
    get address(): string;
    get ended(): boolean;
    get variant(): string | undefined;
    get shape(): Shape | undefined;
    onShape(listener: (shape: Shape) => void): () => void;
    onStatus(listener: StatusListener): () => void;
    terminalError(): unknown;
    release(): void;
    /** Follows the binding: live once it has a shape (and, for a state view, its state) over a current hold. */
    update(): void;
    end(error: unknown): void;
    shapeChanged(): void;
    member(name: string): unknown;
}
export {};
//# sourceMappingURL=remote.d.ts.map