export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Strict-JSON representation of an application data type. Unknown payloads become JsonValue. */
export type JsonRepresentation<T> = IsAny<T> extends true ? JsonValue : unknown extends T ? JsonValue : T extends null | boolean | number | string ? T : T extends readonly (infer TItem)[] ? JsonRepresentation<TItem>[] : T extends object ? {
    [TKey in keyof T]: JsonRepresentation<T[TKey]>;
} : never;
export type CopyJsonOptions = {
    /** Omit undefined object properties while preserving strict array semantics. */
    readonly omitUndefinedProperties?: boolean;
};
/** Copy a value into an alias-free strict-JSON tree owned by the caller. */
export declare function copyJson(value: unknown, options?: CopyJsonOptions): JsonValue;
/** Return whether a value is finite strict JSON with plain objects and no cycles. */
export declare function isJsonValue(value: unknown): value is JsonValue;
export {};
//# sourceMappingURL=json.d.ts.map