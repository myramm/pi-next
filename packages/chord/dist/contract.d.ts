import { type Static, type TSchema, Type } from "typebox";
import type { Ctx, Exposed, Readable, RefBase, StateSource } from "./types.ts";
declare const MEMBER: unique symbol;
/** A method's arguments and result; `undefined`: it takes no arguments, or returns nothing (void). */
export interface MethodSpec<A extends TSchema | undefined = TSchema | undefined, R extends TSchema | undefined = TSchema | undefined> {
    readonly [MEMBER]: "method";
    readonly args: A;
    readonly result: R;
}
export interface OpaqueSpec<T = unknown> {
    readonly [MEMBER]: "opaque";
    readonly id: string;
    /** Type carrier only; never set. */
    readonly type?: T;
}
/**
 * A method. `method()`: no arguments (called as `ref.name(ctx)`, implemented as `(ctx) => …`) and no result.
 * `method(args)`: no result, the handler returns nothing (void). `method(args, result)`, or `method(undefined, result)`
 * for a method without arguments that returns something.
 */
export declare function method(): MethodSpec<undefined, undefined>;
export declare function method<A extends TSchema>(args: A): MethodSpec<A, undefined>;
export declare function method<A extends TSchema | undefined, R extends TSchema>(args: A, result: R): MethodSpec<A, R>;
/** A native in-process object identified by `name@version` (local contracts only). */
export declare const opaque: <T = unknown>(id: string) => OpaqueSpec<T>;
export interface VariantDef {
    readonly state?: Readonly<Record<string, TSchema>>;
    readonly methods?: Readonly<Record<string, MethodSpec>>;
}
/** Where objects of a remote type live: one named host. */
export interface HostNamed {
    readonly name: string;
}
/** Where objects of a remote type live: the host `prefix` + the input's string field `key` (`session:` + `session`). */
export interface HostFamily<K extends string = string> {
    readonly prefix: string;
    readonly key: K;
}
/** A remote type's placement: data only, so a description carries it and every host can check it. */
export type Placement = HostNamed | HostFamily;
/** Objects of the type live on the host named `name` (`hostNamed("server")`). */
export declare function hostNamed(name: string): HostNamed;
/**
 * Objects of the type live on `prefix` + the value of the input's string field `key`: `hostFamily("session:",
 * "session")` puts `{ session: "S1", … }` on `session:S1`. The field is required and must be a non-empty string.
 */
export declare function hostFamily<const K extends string>(prefix: string, key: K): HostFamily<K>;
/** Required string fields of `I`: what a `hostFamily` may name. */
type StringKeys<I> = {
    [K in keyof I]-?: I[K] extends string ? K : never;
}[keyof I] & string;
/** The placements a remote type with input `I` may have. */
export type PlacementFor<I> = HostNamed | HostFamily<StringKeys<I>>;
/** The host an object of `placement` with this (normalized) input lives on. Throws `invalid/placement`. */
export declare function resolveHost(typeName: string, placement: Placement, input: unknown): string;
/** Whether the host named `hostName` may serve a type of `placement`. */
export declare const placedOn: (placement: Placement, hostName: string) => boolean;
export declare const placementText: (placement: Placement) => string;
export interface RemoteDef {
    readonly version: number;
    readonly input: TSchema;
    /** Where its objects live: `hostNamed(…)` or `hostFamily(…)`. Part of the contract (and its fingerprint). */
    readonly host: Placement;
    readonly variants: Readonly<Record<string, VariantDef>>;
}
/** A local member: a method, an opaque native object, or a state member described by its schema. */
export type LocalMember = MethodSpec | OpaqueSpec | TSchema;
export interface LocalDef {
    readonly version: number;
    readonly input: TSchema;
    readonly members?: Readonly<Record<string, LocalMember>>;
}
declare const MemberDescriptionSchema: Type.TUnion<[Type.TObject<{
    kind: Type.TLiteral<"method">;
    args: Type.TOptional<Type.TUnsafe<TSchema>>;
    result: Type.TOptional<Type.TUnsafe<TSchema>>;
}>, Type.TObject<{
    kind: Type.TLiteral<"state">;
    schema: Type.TUnsafe<TSchema>;
}>, Type.TObject<{
    kind: Type.TLiteral<"opaque">;
    id: Type.TString;
}>]>;
export type MemberDescription = Static<typeof MemberDescriptionSchema>;
/** Local contracts have one unnamed variant. */
export declare const LOCAL_VARIANT = "";
export declare const DescriptionSchema: Type.TObject<{
    name: Type.TString;
    scope: Type.TUnion<[Type.TLiteral<"remote">, Type.TLiteral<"local">]>;
    version: Type.TInteger;
    input: Type.TUnsafe<TSchema>;
    /** Remote types only (required there): where their objects live. */
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
export type Description = Static<typeof DescriptionSchema>;
interface ContractBase {
    readonly name: string;
    readonly version: number;
    readonly input: TSchema;
    readonly description: Description;
    readonly fingerprint: string;
}
export interface RemoteContract<D extends RemoteDef = RemoteDef> extends ContractBase {
    readonly scope: "remote";
    readonly def: D;
}
export interface LocalContract<D extends LocalDef = LocalDef> extends ContractBase {
    readonly scope: "local";
    readonly def: D;
}
export type AnyContract = RemoteContract | LocalContract;
/** Names a reference uses itself; members may not use them. */
export declare const RESERVED_MEMBERS: ReadonlySet<string>;
export declare function remote<const D extends RemoteDef>(name: string, def: D & {
    readonly host: PlacementFor<Static<D["input"]>>;
}): RemoteContract<D>;
export declare function local<const D extends LocalDef>(name: string, def: D): LocalContract<D>;
/**
 * A consumer token received over a link (only its description travels). Has no `def`, so it is only good for binding
 * and validation, never for TypeScript types.
 */
export declare function contractFromDescription(description: Description): AnyContract;
/** Returns why `provider` does not cover `consumer`, or undefined when it does. */
export declare function coverage(provider: Description, consumer: Description): string | undefined;
/** Maps the provider's current implementation to the view a consumer of an older contract version expects. */
export type Adapter = (current: Record<string, unknown>) => Record<string, unknown>;
export type Accepts = Readonly<Record<number, Adapter>>;
/** How a consumer token binds to a provider: directly or through an `accepts` adapter. Throws contract_mismatch. */
export declare function bind(provider: AnyContract, accepts: Accepts | undefined, consumer: AnyContract): Adapter | undefined;
type Empty = Record<never, never>;
type StateOf<V> = V extends {
    readonly state: infer S extends Readonly<Record<string, TSchema>>;
} ? S : Empty;
type StaticOf<S> = S extends TSchema ? Static<S> : never;
type MethodsOf<V> = V extends {
    readonly methods: infer M extends Readonly<Record<string, MethodSpec>>;
} ? M : Empty;
/** What a handler returns: the result's value, or nothing for a void method. */
type Returned<R> = [R] extends [TSchema] ? Static<R> | Promise<Static<R>> : void | Promise<void>;
/** What a call resolves to. */
type Resolved<R> = [R] extends [TSchema] ? Static<R> : undefined;
/** A method's handler; `P` is the app's principal type (`ctx.principal`). */
export type MethodImplementation<M, P = unknown> = M extends MethodSpec<infer A, infer R> ? [A] extends [TSchema] ? (args: Static<A>, ctx: Ctx<P>) => Returned<R> : (ctx: Ctx<P>) => Returned<R> : never;
export type Call<M> = M extends MethodSpec<infer A, infer R> ? [A] extends [TSchema] ? (args: Static<A>, ctx?: Ctx) => Promise<Resolved<R>> : (ctx?: Ctx) => Promise<Resolved<R>> : never;
/** Whether `contract`'s method `name` takes no arguments (it is called as `ref.name(ctx)`). */
export declare function takesNoArgs(contract: AnyContract, name: string): boolean;
type VariantImplementation<K, V, P> = {
    readonly variant: K;
} & {
    readonly [S in keyof StateOf<V>]: StateSource<StaticOf<StateOf<V>[S]>>;
} & {
    readonly [M in keyof MethodsOf<V>]: MethodImplementation<MethodsOf<V>[M], P>;
};
/**
 * A reference in one variant: its state members are plain readables (a reference you hold has its state) and its
 * methods calls. `variant` discriminates the union `Ref` is for a multi-variant type.
 */
type VariantRef<C extends AnyContract, K, V> = RefBase<C> & {
    readonly variant: K;
} & {
    readonly [S in keyof StateOf<V>]: Readable<StaticOf<StateOf<V>[S]>>;
} & {
    readonly [M in keyof MethodsOf<V>]: Call<MethodsOf<V>[M]>;
};
type LocalImplementationMember<M, P> = M extends MethodSpec ? MethodImplementation<M, P> : M extends OpaqueSpec<infer T> ? T | Exposed<T> : M extends TSchema ? StateSource<Static<M>> : never;
type LocalRefMember<M> = M extends MethodSpec ? Call<M> : M extends OpaqueSpec<infer T> ? T | undefined : M extends TSchema ? Readable<Static<M>> : never;
type LocalMembers<D> = D extends {
    readonly members: infer M extends Readonly<Record<string, LocalMember>>;
} ? M : Empty;
export type InputOf<C> = C extends {
    readonly def: {
        readonly input: infer I extends TSchema;
    };
} ? Static<I> : never;
/** What a factory returns for contract C; its methods' `ctx.principal` is `P`. */
export type ImplementationOf<C, P = unknown> = C extends RemoteContract<infer D> ? {
    [K in keyof D["variants"]]: VariantImplementation<K, D["variants"][K], P>;
}[keyof D["variants"]] : C extends LocalContract<infer D> ? {
    readonly [K in keyof LocalMembers<D>]: LocalImplementationMember<LocalMembers<D>[K], P>;
} & Record<string, unknown> : never;
/**
 * What `get` returns for contract C. A remote type's reference is a union discriminated by `variant`: another variant's
 * members are reachable only after narrowing (`if (ref.variant === "editor") ref.add(…)`). A local type's reference has
 * its members.
 */
export type Ref<C extends AnyContract = AnyContract> = C extends RemoteContract<infer D> ? {
    [K in keyof D["variants"]]: VariantRef<C, K, D["variants"][K]>;
}[keyof D["variants"]] : C extends LocalContract<infer D> ? RefBase<C> & {
    readonly [K in keyof LocalMembers<D>]: LocalRefMember<LocalMembers<D>[K]>;
} : never;
export {};
//# sourceMappingURL=contract.d.ts.map