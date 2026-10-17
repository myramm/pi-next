import type { TSchema } from "typebox";
import { type ChordErrorReason } from "./errors.ts";
/** Canonical JSON: sorted object keys, `undefined` members dropped. */
export declare function canonicalJson(value: unknown): string;
/** Non-cryptographic 64-bit hash (two FNV-1a lanes). Contracts are trusted, so collisions are not an attack surface. */
export declare function hash64(text: string): string;
export declare function deepEqual(a: unknown, b: unknown): boolean;
/** Throws `invalid` (with `reason`) and the first schema errors when `value` does not match. */
export declare function assertValid(reason: ChordErrorReason, what: string, schema: TSchema, value: unknown): void;
/** Applies defaults, strips unknown fields, validates. Returns a fresh value. */
export declare function normalize(schema: TSchema, value: unknown, what: string): unknown;
/** Canonical identity of a normalized value: fields equal to their schema default are omitted. */
export declare function canonicalIdentity(schema: TSchema, value: unknown): string;
/**
 * Conservative structural subtyping: true only if every value valid under `sub` is valid under `sup`, where object
 * fields missing from `sub` but optional in `sup` count as fine (unknown fields are stripped at the provider, see
 * `RecordImpl.call`). A provider schema using a keyword this function does not model (`not`, `allOf`, `contains`,
 * `$ref`, ...) or an `additionalProperties` schema only fits an identical consumer schema.
 */
export declare function fits(subSchema: unknown, supSchema: unknown): boolean;
//# sourceMappingURL=schema.d.ts.map