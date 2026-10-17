import { type Static, type TSchema, Type } from "typebox";
import { ChordError } from "./errors.ts";
/**
 * The link protocol version, announced in `hello`. Peers of different versions do not talk: the side that notices
 * closes the link with reason `protocol-version <its version>`, so the other side learns it too
 * (`LinkOptions.onProtocolMismatch`).
 */
export declare const PROTOCOL_VERSION = 4;
declare const RootRefSchema: Type.TObject<{
    rootId: Type.TString;
    codeVersion: Type.TInteger;
}>;
export type RootRef = Static<typeof RootRefSchema>;
declare const WireErrorSchema: Type.TObject<{
    code: Type.TEnum<["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"]>;
    message: Type.TString;
    reason: Type.TOptional<Type.TString>;
}>;
export type WireError = Static<typeof WireErrorSchema>;
declare const WireReloadOptionsSchema: Type.TObject<{
    remove: Type.TOptional<Type.TImmutable<Type.TArray<Type.TString>>>;
    gateDeadline: Type.TOptional<Type.TNumber>;
    retireDeadline: Type.TOptional<Type.TNumber>;
}>;
export type WireReloadOptions = Static<typeof WireReloadOptionsSchema>;
/** A child's prepared reload, sent with its vote (same fields as `ReloadReport`, without children). */
declare const WireReloadReportSchema: Type.TObject<{
    codeVersion: Type.TInteger;
    previous: Type.TInteger;
    changed: Type.TImmutable<Type.TArray<Type.TString>>;
    removed: Type.TImmutable<Type.TArray<Type.TString>>;
    prepared: Type.TImmutable<Type.TArray<Type.TString>>;
    gated: Type.TImmutable<Type.TArray<Type.TString>>;
}>;
export type WireReloadReport = Static<typeof WireReloadReportSchema>;
declare const FrameSchema: Type.TUnion<[Type.TObject<{
    t: Type.TLiteral<"hello">;
    /** The link protocol version (`PROTOCOL_VERSION`; absent: 1). Peers of another version close the link. */
    protocol: Type.TOptional<Type.TInteger>;
    name: Type.TString;
    kind: Type.TUnion<[Type.TLiteral<"host">, Type.TLiteral<"client">]>;
    codeVersion: Type.TInteger;
    /** The sender acknowledges what it receives (`ack`). Flow control applies only when both hellos say so. */
    acks: Type.TOptional<Type.TBoolean>;
}>, Type.TObject<{
    t: Type.TLiteral<"ack">;
    n: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"hold">;
    id: Type.TInteger;
    /**
     * Target host name, resolved by the consumer from the token's `host` and `input`. Relays route on it after
     * checking it against both; the target refuses an input its own contract places elsewhere.
     */
    at: Type.TString;
    /** The consumer's contract token; the provider checks that it covers it. Remote tokens carry `host`. */
    token: Type.TObject<{
        name: Type.TString;
        scope: Type.TUnion<[Type.TLiteral<"remote">, Type.TLiteral<"local">]>;
        version: Type.TInteger;
        input: Type.TUnsafe<TSchema>;
        host: Type.TOptional<Type.TUnion<[Type.TObject<{
            name: Type.TString;
        }>, Type.TObject<{
            prefix: Type.TString;
            key: Type.TString;
        }>]>>;
        variants: Type.TRecord<"^.*$", Type.TRecord<"^.*$", Type.TUnion<[Type.TObject<{
            kind: Type.TLiteral<"method">;
            args: Type.TOptional<Type.TUnsafe<TSchema>>;
            result: Type.TOptional<Type.TUnsafe<TSchema>>;
        }>, Type.TObject<{
            kind: Type.TLiteral<"state">;
            schema: Type.TUnsafe<TSchema>;
        }>, Type.TObject<{
            kind: Type.TLiteral<"opaque">;
            id: Type.TString;
        }>]>>>;
    }>;
    /** Normalized with the consumer's contract. */
    input: Type.TUnknown;
    /** A forwarded principal. Honored only on frames from the parent link. */
    principal: Type.TOptional<Type.TUnknown>;
    /**
     * The client connection the hold comes from: an opaque id the server assigned to it, forwarded by relays. Honored
     * only on frames from the parent link; present means the hold is a client's (not a reload participant).
     */
    origin: Type.TOptional<Type.TString>;
    /** False: no state for this hold until `sub` (a method-only binding). */
    state: Type.TOptional<Type.TLiteral<false>>;
    /** The consumer already has values (a re-hold after a link loss): its unit is not urgent. */
    again: Type.TOptional<Type.TLiteral<true>>;
}>, Type.TObject<{
    t: Type.TLiteral<"release">;
    id: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"shape">;
    id: Type.TInteger;
    variant: Type.TOptional<Type.TString>;
    members: Type.TImmutable<Type.TArray<Type.TString>>;
    contract: Type.TString;
    /** The state members whose snapshots follow this frame; the consumer applies the shape once they are here. */
    state: Type.TImmutable<Type.TArray<Type.TString>>;
}>, Type.TObject<{
    t: Type.TLiteral<"gone">;
    id: Type.TInteger;
    error: Type.TObject<{
        code: Type.TEnum<["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"]>;
        message: Type.TString;
        reason: Type.TOptional<Type.TString>;
    }>;
}>, Type.TObject<{
    t: Type.TLiteral<"call">;
    id: Type.TInteger;
    hold: Type.TInteger;
    member: Type.TString;
    args: Type.TOptional<Type.TUnknown>;
    /** Absent: the receiving host starts a root (browsers never carry roots). */
    root: Type.TOptional<Type.TObject<{
        rootId: Type.TString;
        codeVersion: Type.TInteger;
    }>>;
}>, Type.TObject<{
    t: Type.TLiteral<"result">;
    id: Type.TInteger;
    value: Type.TOptional<Type.TUnknown>;
    error: Type.TOptional<Type.TObject<{
        code: Type.TEnum<["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"]>;
        message: Type.TString;
        reason: Type.TOptional<Type.TString>;
    }>>;
}>, Type.TObject<{
    t: Type.TLiteral<"cancel">;
    id: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"sub">;
    hold: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"unsub">;
    hold: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"resync">;
    hold: Type.TInteger;
    m: Type.TString;
}>, Type.TObject<{
    t: Type.TLiteral<"state">;
    hold: Type.TInteger;
    m: Type.TString;
    /** `snap`/`reset` without `value`: the value is `undefined`. */
    as: Type.TUnion<[Type.TLiteral<"snap">, Type.TLiteral<"reset">, Type.TLiteral<"ops">, Type.TLiteral<"error">]>;
    value: Type.TOptional<Type.TUnknown>;
    /** Encoded with the stream's delta encoder; the decoder validates each op. */
    ops: Type.TOptional<Type.TImmutable<Type.TArray<Type.TImmutable<Type.TArray<Type.TUnknown>>>>>;
    error: Type.TOptional<Type.TObject<{
        code: Type.TEnum<["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"]>;
        message: Type.TString;
        reason: Type.TOptional<Type.TString>;
    }>>;
}>, Type.TObject<{
    t: Type.TLiteral<"ping">;
    n: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"pong">;
    n: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"bye">;
    reason: Type.TOptional<Type.TString>;
}>, Type.TObject<{
    t: Type.TLiteral<"root_end">;
    rootId: Type.TString;
}>, Type.TObject<{
    t: Type.TLiteral<"invalidate">;
    pattern: Type.TRecord<"^.*$", Type.TUnknown>;
}>, Type.TObject<{
    t: Type.TLiteral<"prepare">;
    reload: Type.TInteger;
    codeVersion: Type.TInteger;
    plugins: Type.TImmutable<Type.TArray<Type.TString>>;
    options: Type.TObject<{
        remove: Type.TOptional<Type.TImmutable<Type.TArray<Type.TString>>>;
        gateDeadline: Type.TOptional<Type.TNumber>;
        retireDeadline: Type.TOptional<Type.TNumber>;
    }>;
}>, Type.TObject<{
    t: Type.TLiteral<"vote">;
    reload: Type.TInteger;
    error: Type.TOptional<Type.TObject<{
        code: Type.TEnum<["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"]>;
        message: Type.TString;
        reason: Type.TOptional<Type.TString>;
    }>>;
    report: Type.TOptional<Type.TObject<{
        codeVersion: Type.TInteger;
        previous: Type.TInteger;
        changed: Type.TImmutable<Type.TArray<Type.TString>>;
        removed: Type.TImmutable<Type.TArray<Type.TString>>;
        prepared: Type.TImmutable<Type.TArray<Type.TString>>;
        gated: Type.TImmutable<Type.TArray<Type.TString>>;
    }>>;
}>, Type.TObject<{
    t: Type.TLiteral<"commit">;
    reload: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"retire">;
    codeVersion: Type.TInteger;
}>, Type.TObject<{
    t: Type.TLiteral<"abort">;
    reload: Type.TInteger;
}>]>;
export type Frame = Static<typeof FrameSchema>;
/** A frame that passes validation; anything else is a protocol violation. */
export declare const isFrame: (value: unknown) => value is Frame;
export declare function toWireError(error: unknown): WireError;
export declare const fromWireError: (error: WireError) => ChordError;
export {};
//# sourceMappingURL=wire.d.ts.map