import { type Encoder } from "./delta/index.ts";
import type { HostImpl } from "./host.ts";
import { type Link } from "./link.ts";
import { RefImpl } from "./object.ts";
import type { RemoteBinding, RemoteChannel } from "./remote.ts";
import type { StateEvent } from "./types.ts";
import { type Frame, type RootRef } from "./wire.ts";
export interface LinkOptions {
    /** Milliseconds between pings (default 15000). */
    readonly pingInterval?: number;
    /** Close the link when nothing arrived for this long (default 45000). Everything held through it is released. */
    readonly pingTimeout?: number;
    /**
     * Unacknowledged frame bytes (JSON text length) beyond which state frames wait for the peer (default 256 KiB). Only
     * applies when both ends acknowledge frames and the link reports sizes; `Infinity` never holds state back.
     */
    readonly window?: number;
    /**
     * Bytes of state ops that may wait for the peer on this link (default 4 windows). Beyond, the oldest waiting streams
     * are replaced by their current value (a reset), so memory stays bounded however long the peer stalls.
     */
    readonly pendingCap?: number;
    /**
     * The peer speaks another link protocol version (`peer`: undefined if it did not say): the link closes, and should
     * not be reconnected with the same code. A browser reloads its page, for instance.
     */
    readonly onProtocolMismatch?: (versions: {
        readonly local: number;
        readonly peer: number | undefined;
    }) => void;
}
type StateFrame = Extract<Frame, {
    t: "state";
}>;
/**
 * How a waiting stream recovers when its ops must be dropped: the provider resends the current value as a reset at
 * flush; a relay (which has no value) asks downstream for one.
 */
type Overflow = {
    readonly resend: () => void;
} | {
    readonly resync: () => void;
};
export interface AcceptOptions<P = unknown> extends LinkOptions {
    /** The principal of whatever connects, from the app's authenticator. Every request on the link acts as it. */
    readonly principal: P;
    /**
     * What the peer is, decided here and never by its `hello`: `client` (default; a browser: no roots, no code versions,
     * not a reload participant, not addressable) or `host` (a child host; needs `name`).
     */
    readonly kind?: "host" | "client";
    /** A child host's name: its hello must match, and it is reachable `at` this name. */
    readonly name?: string;
    /** On `invalidatePrincipal`: a new principal keeps the link, `undefined` closes it (default: close). */
    restamp?(principal: P): P | undefined;
    /**
     * Calls the peer may have in progress on this link (default: no limit). Further ones never run: they are answered
     * at once with `unavailable` (reason `too_many_calls`), and the link stays open.
     */
    readonly maxCalls?: number;
}
export interface Peer {
    readonly kind: "host" | "client";
    /** Configured (downstream hosts) or announced by the trusted parent (upstream). */
    readonly name: string | undefined;
}
/** A state member's stream to the consumer: its subscription and delta encoder. */
interface Feed {
    unsubscribe: () => void;
    encoder: Encoder;
    /** Events that arrived while a unit or reset was being built (replayed after it is sent). */
    buffer: StateEvent<unknown>[] | undefined;
}
/** A hold the peer made on this host and serves locally. */
interface ServedLocal {
    readonly kind: "local";
    readonly id: number;
    readonly ref: RefImpl;
    readonly principal: unknown;
    /** The client connection it comes from (see `Frame` hold `origin`); undefined for a host's own holds. */
    readonly origin: string | undefined;
    /** The consumer wants state (hold without `state: false`, or `sub`). */
    wantsState: boolean;
    /** The consumer had values before (re-hold): its first unit waits for the window like any other. */
    readonly again: boolean;
    /** A unit was sent. */
    unitSent: boolean;
    /** The members whose snapshot the consumer has, with their streams. */
    readonly feeds: Map<string, Feed>;
}
/** A hold the peer made on this host: served locally or relayed to another link. */
type Served = ServedLocal | {
    readonly kind: "relay";
    readonly relay: RelayRef;
};
type Pending = {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: unknown) => void;
};
/**
 * A hold relayed from an origin link to a downstream link. It owns everything done through it: state and calls queued
 * while the route resolves, and the downstream twins once forwarded. `close` undoes all of it exactly once (cancels
 * calls downstream, drops what waits for the origin, releases the downstream hold, rejects waiters).
 */
export declare class RelayRef {
    #private;
    readonly origin: Connection;
    readonly frame: Extract<Frame, {
        t: "hold";
    }>;
    readonly principal: unknown;
    /** The client connection the hold comes from (forwarded downstream); undefined for a host's own holds. */
    readonly originTag: string | undefined;
    /** The origin's authorization generation when the hold arrived; a revocation bumps it. */
    readonly generation: number;
    down: Connection | undefined;
    downId: number;
    closed: boolean;
    /** The origin wants state (forwarded as `state: false`, `sub`, `unsub`). */
    stateWanted: boolean;
    /** The members of the first unit, still to forward past the origin's window. */
    urgent: Set<string> | undefined;
    /** Members whose ops this relay dropped: downstream ops are ignored until their reset arrives. */
    readonly awaiting: Set<string>;
    readonly calls: Map<number, RelayCall>;
    constructor(origin: Connection, frame: Extract<Frame, {
        t: "hold";
    }>, principal: unknown, originTag: string | undefined);
    get originId(): number;
    get client(): boolean;
    /** Still authorized as it was when it arrived. */
    get current(): boolean;
    /** The downstream connection once the route resolved; rejects if the relay closes first. */
    ready(): Promise<Connection>;
    /** Forwards the hold to `down`. */
    open(down: Connection): void;
    /** The origin starts or stops the hold's state. */
    wantState(wanted: boolean): void;
    /**
     * The origin could not keep up and dropped what waited for member `m` (or asked for it again): ask downstream for a
     * reset, and ignore its ops until the reset arrives.
     */
    resync(m: string): void;
    /** A shape from downstream: forwarded at once; the members of the first unit then skip the origin's window. */
    shape(frame: Extract<Frame, {
        t: "shape";
    }>): void;
    /** A state frame from downstream. */
    state(frame: StateFrame): void;
    /**
     * Closes the relay. `releaseDown`: the downstream hold is still there (origin released, disconnected, or was
     * revoked): cancel its calls and release it. `notify`: tell the origin the hold is gone.
     */
    close(error: unknown, options: {
        readonly releaseDown: boolean;
        readonly notify: boolean;
    }): void;
}
/** One relayed call: settles once, by result, cancellation or the relay closing; removes both mappings. */
export declare class RelayCall {
    #private;
    readonly relay: RelayRef;
    readonly originId: number;
    readonly downId: number;
    constructor(relay: RelayRef, originId: number, downId: number, pending: Pending);
    finish(error: unknown, value?: unknown): void;
    /** Cancels downstream (when the downstream hold still exists) and settles with `error`. */
    cancel(error: unknown, forward: boolean): void;
}
/**
 * One end of a link on a host: consumer of remote references, provider for the peer's holds, and relay.
 *
 * State
 * -----
 *
 * A hold implies the state of its variant (unless it says `state: false`). The provider answers with a unit: the shape,
 * then a snapshot of each state member the consumer does not have yet (`shape.state` lists them), then the members'
 * ops and resets. A reload or a variant change sends another unit with the members that are new; members that left the
 * variant stop. The consumer applies a shape once its snapshots are here (`RemoteBinding`).
 *
 * Flow control
 * ------------
 *
 * Problem: state is pushed as fast as it changes, but a peer may read slowly (a phone behind a relay), and a relay may
 * hide that: Cloudflare forwards to browsers without backpressure. Everything sent then queues in front of the next
 * call result. Example: a browser opens three long transcripts (500 KiB of snapshots each) over a 5 Mbit/s path; a
 * result sent next waits 2.4 s, and the snapshot of a transcript the user already left is still sent in full.
 *
 * Solution: the peer acknowledges what it processed (`ack`, a cumulative frame count), and the sender counts the sizes
 * of the frames not yet acknowledged. While they exceed the window, state waits here in slots, flushed in creation
 * order as acknowledgements come:
 * - a member's stream has one slot: ops are appended (encoded batches of one stream may be concatenated, see
 *   `encoder`), a snapshot, reset or error replaces it;
 * - a hold's unit has one slot, built lazily from the current values when it is sent, so a newer unit merges into it;
 *   while it waits, the members it introduces have no stream yet.
 *
 * The first unit of a hold that is not a re-hold (`again`) is sent at once, past the window: a `get` waits for it, and
 * must not wait behind other holds' state. Results, shapes, gone, reload control and pings are sent at once too: they
 * are bounded by the requests the peer makes. Hence the one ordering exception of a link: while state waits, a result
 * can arrive before state changes made before it. Frames of one stream stay in order.
 *
 * Waiting ops are capped per link (`pendingCap`): beyond, the oldest streams are replaced by their current value (a
 * reset built at flush), or, on a relay, by a reset asked of the provider (`resync`), so memory stays bounded however
 * long the peer stalls. The window bounds what is unacknowledged when a frame is sent, so one frame (a large snapshot)
 * may exceed it. Both hellos must announce `acks`; with an older peer nothing is acknowledged and nothing waits. Links
 * that do not report sizes (IPC) never fill the window.
 */
export declare class Connection implements RemoteChannel {
    #private;
    readonly host: HostImpl;
    readonly link: Link;
    /** `upstream`: the link to this host's parent. `downstream`: a link this host accepted. */
    readonly role: "upstream" | "downstream";
    readonly peer: Peer;
    /** A client connection's opaque id: holds that come over it (directly or relayed) carry it as their `origin`. */
    readonly originId: string | undefined;
    principal: unknown;
    readonly restamp: ((principal: unknown) => unknown | undefined) | undefined;
    /** Bumped when the stamped principal is revoked or re-stamped: relays from before are refused. */
    generation: number;
    /** The code version a downstream host peer runs (from its hello, then from commits). */
    peerCodeVersion: number | undefined;
    /** A downstream host peer is usable once it runs this host's current code version (see `HostImpl.peerHello`). */
    synced: boolean;
    /** Code versions this child announced while behind this host (fenced): this host never ran them. */
    readonly fencedCodeVersions: Set<number>;
    readonly remotes: Map<number, RemoteBinding>;
    readonly calls: Map<number, Pending>;
    readonly served: Map<number, Served>;
    readonly incoming: Map<number, AbortController>;
    readonly relayedRefs: Map<number, RelayRef>;
    readonly relayedCalls: Map<number, RelayCall>;
    /** Reload votes awaited from this (child) peer. */
    readonly votes: Map<number, Pending>;
    constructor(host: HostImpl, link: Link, config: {
        readonly role: "upstream" | "downstream";
        readonly principal: unknown;
        readonly peer: Peer;
        readonly originId?: string;
        readonly restamp?: (principal: unknown) => unknown | undefined;
        readonly maxCalls?: number;
    } & LinkOptions);
    get open(): boolean;
    /** The peer's name: configured for downstream hosts, announced by the parent upstream. */
    get name(): string | undefined;
    send(frame: Frame): void;
    /** Sends a state frame, or keeps it waiting (see the class comment). */
    sendState(frame: StateFrame, overflow: Overflow): void;
    /** Forgets what waits for a stream that ended. */
    dropState(hold: number, m: string): void;
    /** Forgets everything that waits for a hold (released, closed, or its state stopped). */
    dropHoldState(hold: number): void;
    /** What waits for the peer: slots and bytes of ops (for tests and diagnostics). */
    get waiting(): {
        readonly slots: number;
        readonly bytes: number;
    };
    nextId(): number;
    /** Resolves once the peer is usable (a host peer runs this host's code version); rejects if the link closes first. */
    whenSynced(): Promise<void>;
    markSynced(codeVersion: number): void;
    /** Revokes the stamped principal: relays made under it close at once (also those still resolving a route). */
    revoke(next: unknown | undefined): void;
    hold(binding: RemoteBinding, again: boolean): number;
    release(id: number): void;
    wantState(hold: number, wanted: boolean): void;
    call(hold: number, member: string, args: unknown, root: RootRef | undefined, signal: AbortSignal): Promise<unknown>;
}
export {};
//# sourceMappingURL=connection.d.ts.map