import { Type } from "typebox";
import { Value } from "typebox/value";
import { ChordError, invalid } from "./errors.js";
import { canonicalJson, fits, hash64 } from "./schema.js";
const MEMBER = Symbol("chord.member");
export function method(args, result) {
    return { [MEMBER]: "method", args, result };
}
/** A native in-process object identified by `name@version` (local contracts only). */
export const opaque = (id) => {
    if (!/^[^@\s]+@\d+$/.test(id))
        throw new TypeError(`opaque id must be name@version: ${id}`);
    return { [MEMBER]: "opaque", id };
};
/** Objects of the type live on the host named `name` (`hostNamed("server")`). */
export function hostNamed(name) {
    if (typeof name !== "string" || name === "")
        throw new TypeError("hostNamed needs a host name");
    return { name };
}
/**
 * Objects of the type live on `prefix` + the value of the input's string field `key`: `hostFamily("session:",
 * "session")` puts `{ session: "S1", … }` on `session:S1`. The field is required and must be a non-empty string.
 */
export function hostFamily(prefix, key) {
    if (typeof prefix !== "string" || prefix === "")
        throw new TypeError("hostFamily needs a host-name prefix");
    if (typeof key !== "string" || key === "")
        throw new TypeError("hostFamily needs an input field name");
    return { prefix, key };
}
/** The host an object of `placement` with this (normalized) input lives on. Throws `invalid/placement`. */
export function resolveHost(typeName, placement, input) {
    if ("name" in placement)
        return placement.name;
    const value = input !== null && typeof input === "object" ? input[placement.key] : undefined;
    if (typeof value !== "string" || value === "")
        throw invalid("placement", `${typeName}: input field ${placement.key} names no host`);
    return placement.prefix + value;
}
/** Whether the host named `hostName` may serve a type of `placement`. */
export const placedOn = (placement, hostName) => "name" in placement
    ? placement.name === hostName
    : hostName.startsWith(placement.prefix) && hostName.length > placement.prefix.length;
export const placementText = (placement) => "name" in placement ? placement.name : `${placement.prefix}<${placement.key}>`;
// A description travels as a reference's contract token (wire.ts), so it is declared once, as the schema that validates it.
// `TSchema` is an empty interface: any object is one, which is all a peer's schema is checked for here.
const SchemaObject = Type.Unsafe(Type.Object({}));
const MemberDescriptionSchema = Type.Union([
    // Absent `args`: the method takes none. Absent `result`: it returns nothing.
    Type.Object({
        kind: Type.Literal("method"),
        args: Type.Optional(SchemaObject),
        result: Type.Optional(SchemaObject),
    }),
    Type.Object({ kind: Type.Literal("state"), schema: SchemaObject }),
    Type.Object({ kind: Type.Literal("opaque"), id: Type.String() }),
]);
/** Local contracts have one unnamed variant. */
export const LOCAL_VARIANT = "";
const PlacementSchema = Type.Union([
    Type.Object({ name: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    Type.Object({ prefix: Type.String({ minLength: 1 }), key: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
]);
export const DescriptionSchema = Type.Object({
    name: Type.String({ minLength: 1 }),
    scope: Type.Union([Type.Literal("remote"), Type.Literal("local")]),
    version: Type.Integer(),
    input: SchemaObject,
    /** Remote types only (required there): where their objects live. */
    host: Type.Optional(PlacementSchema),
    variants: Type.Record(Type.String(), Type.Record(Type.String(), MemberDescriptionSchema)),
});
/** Names a reference uses itself; members may not use them. */
export const RESERVED_MEMBERS = new Set([
    "variant",
    "status",
    "ready",
    "shape",
    "error",
    "onShape",
    "onStatus",
    "release",
    "then",
    "contract",
]);
function describeMember(name, member, scope) {
    if (RESERVED_MEMBERS.has(name))
        throw new TypeError(`member name is reserved: ${name}`);
    const brand = member[MEMBER];
    if (brand === "method") {
        const spec = member;
        return {
            kind: "method",
            ...(spec.args === undefined ? {} : { args: spec.args }),
            ...(spec.result === undefined ? {} : { result: spec.result }),
        };
    }
    if (brand === "opaque") {
        if (scope === "remote")
            throw new TypeError(`remote contracts cannot expose opaque members: ${name}`);
        return { kind: "opaque", id: member.id };
    }
    return { kind: "state", schema: member };
}
function finish(contract) {
    return { ...contract, fingerprint: hash64(canonicalJson(contract.description)) };
}
function checkHeader(name, version) {
    if (!name)
        throw new TypeError("contract name is empty");
    if (!Number.isInteger(version) || version < 1)
        throw new TypeError(`contract version must be a positive integer`);
}
export function remote(name, def) {
    checkHeader(name, def.version);
    const placement = def.host;
    if (placement === undefined || !Value.Check(PlacementSchema, placement))
        throw new TypeError(`remote contract ${name} needs \`host\`: hostNamed(…) or hostFamily(…)`);
    // A JSON copy: the description travels, and a placement object may carry nothing else.
    const host = "name" in placement ? { name: placement.name } : { prefix: placement.prefix, key: placement.key };
    const variants = {};
    if (Object.keys(def.variants).length === 0)
        throw new TypeError(`remote contract ${name} has no variants`);
    for (const [kind, variant] of Object.entries(def.variants)) {
        const members = {};
        for (const [key, schema] of Object.entries(variant.state ?? {}))
            members[key] = describeMember(key, schema, "remote");
        for (const [key, spec] of Object.entries(variant.methods ?? {})) {
            if (key in members)
                throw new TypeError(`member ${key} is both state and method in ${name}.${kind}`);
            members[key] = describeMember(key, spec, "remote");
            if (members[key].kind !== "method")
                throw new TypeError(`methods.${key} is not a method()`);
        }
        variants[kind] = members;
    }
    const description = { name, scope: "remote", version: def.version, input: def.input, host, variants };
    return finish({
        scope: "remote",
        name,
        version: def.version,
        input: def.input,
        def,
        description,
    });
}
export function local(name, def) {
    checkHeader(name, def.version);
    const members = {};
    for (const [key, member] of Object.entries(def.members ?? {}))
        members[key] = describeMember(key, member, "local");
    const description = {
        name,
        scope: "local",
        version: def.version,
        input: def.input,
        variants: { [LOCAL_VARIANT]: members },
    };
    return finish({ scope: "local", name, version: def.version, input: def.input, def, description });
}
/**
 * A consumer token received over a link (only its description travels). Has no `def`, so it is only good for binding
 * and validation, never for TypeScript types.
 */
export function contractFromDescription(description) {
    const { name, scope, version, input, host } = description;
    if (typeof name !== "string" ||
        (scope !== "remote" && scope !== "local") ||
        !Number.isInteger(version) ||
        (scope === "remote") !== (host !== undefined)) {
        throw new ChordError("invalid", "malformed contract token", { reason: "token" });
    }
    const base = { name, version, input, description, fingerprint: hash64(canonicalJson(description)) };
    return scope === "remote"
        ? { ...base, scope, def: { version, input, host: host, variants: {} } }
        : { ...base, scope, def: { version, input } };
}
/** Returns why `provider` does not cover `consumer`, or undefined when it does. */
export function coverage(provider, consumer) {
    if (provider.name !== consumer.name || provider.scope !== consumer.scope)
        return "different type";
    if (!samePlacement(provider, consumer))
        return "host";
    if (!fits(consumer.input, provider.input))
        return "input";
    for (const [kind, consumerMembers] of Object.entries(consumer.variants)) {
        const providerMembers = provider.variants[kind];
        if (providerMembers === undefined)
            return `variant ${kind} missing`;
        for (const [name, wanted] of Object.entries(consumerMembers)) {
            const offered = providerMembers[name];
            if (offered === undefined || offered.kind !== wanted.kind)
                return `${kind}.${name} missing or of another kind`;
            if (offered.kind === "method" && wanted.kind === "method") {
                // Both take arguments or neither does; a consumer that expects no result accepts any.
                if ((wanted.args === undefined) !== (offered.args === undefined))
                    return `${kind}.${name} arguments`;
                if (wanted.args !== undefined && offered.args !== undefined && !fits(wanted.args, offered.args))
                    return `${kind}.${name} arguments`;
                if (wanted.result !== undefined && (offered.result === undefined || !fits(offered.result, wanted.result)))
                    return `${kind}.${name} result`;
            }
            else if (offered.kind === "state" && wanted.kind === "state") {
                if (!fits(offered.schema, wanted.schema))
                    return `${kind}.${name} state`;
            }
            else if (offered.kind === "opaque" && wanted.kind === "opaque" && offered.id !== wanted.id) {
                return `${kind}.${name} opaque ${offered.id} != ${wanted.id}`;
            }
        }
    }
    return undefined;
}
const samePlacement = (a, b) => canonicalJson(a.host ?? null) === canonicalJson(b.host ?? null);
const placementOf = (description) => description.host === undefined ? "(local)" : placementText(description.host);
/** How a consumer token binds to a provider: directly or through an `accepts` adapter. Throws contract_mismatch. */
export function bind(provider, accepts, consumer) {
    if (provider.fingerprint === consumer.fingerprint)
        return undefined;
    // A moved type is another type for its consumers: no adapter reaches across hosts.
    if (!samePlacement(provider.description, consumer.description)) {
        throw new ChordError("contract_mismatch", `${provider.name} lives on ${placementOf(provider.description)}, the consumer expects ${placementOf(consumer.description)}`);
    }
    if (provider.version === consumer.version) {
        const reason = coverage(provider.description, consumer.description);
        if (reason === undefined)
            return undefined;
        throw new ChordError("contract_mismatch", `${provider.name}@${provider.version} does not cover the consumer's description (${reason}); forgotten version bump?`);
    }
    const adapter = accepts?.[consumer.version];
    if (adapter === undefined) {
        throw new ChordError("contract_mismatch", `${provider.name}: provider version ${provider.version}, consumer version ${consumer.version}, no accepts adapter`);
    }
    return adapter;
}
/** Whether `contract`'s method `name` takes no arguments (it is called as `ref.name(ctx)`). */
export function takesNoArgs(contract, name) {
    for (const members of Object.values(contract.description.variants)) {
        const member = members[name];
        if (member?.kind === "method")
            return member.args === undefined;
    }
    return false;
}
//# sourceMappingURL=contract.js.map