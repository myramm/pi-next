import { type HttpHooks } from "../qemu/contracts.js";
export type SecretDefinition = {
    /** host patterns this secret may be sent to */
    hosts: string[];
    /** secret value */
    value: string;
    /** guest-visible placeholder value or generator */
    placeholder?: string | (() => string);
};
export type MakePlaceholderFuncOptions = {
    /** literal prefix before random characters */
    prefix?: string;
    /** literal suffix after random characters */
    suffix?: string;
    /** random character count */
    length: number;
    /** random character alphabet (default: `HEX_ALPHABET`) */
    alphabet?: string;
};
/** hexadecimal lowercase alphabet */
export declare const HEX_ALPHABET = "0123456789abcdef";
/** lowercase ASCII alphabet */
export declare const LOWERCASE_ALPHABET = "abcdefghijklmnopqrstuvwxyz";
/** uppercase ASCII alphabet */
export declare const UPPERCASE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** RFC 4648 base32 alphabet without padding */
export declare const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** RFC 4648 base32hex alphabet without padding */
export declare const BASE32_HEX_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUV";
/** uppercase, lowercase, and digit alphabet */
export declare const BASE62_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** base64url alphabet without padding */
export declare const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export type CreateHttpHooksOptions = {
    /** allowed host patterns (omitted = allow all, explicit empty = deny all) */
    allowedHosts?: string[];
    /** host patterns allowed to resolve to internal ip ranges */
    allowedInternalHosts?: string[];
    /** secret definitions keyed by env var name */
    secrets?: Record<string, SecretDefinition>;
    /** placeholder replacement in URL query string (default: false) */
    replaceSecretsInQuery?: boolean;
    /** whether to block internal ip ranges (default: true) */
    blockInternalRanges?: boolean;
    /** custom request policy callback */
    isRequestAllowed?: HttpHooks["isRequestAllowed"];
    /** custom ip policy callback */
    isIpAllowed?: HttpHooks["isIpAllowed"];
    /** request hook */
    onRequest?: HttpHooks["onRequest"];
    /** response hook */
    onResponse?: HttpHooks["onResponse"];
};
export type UpdateSecretOptions = {
    /** updated secret value */
    value?: string;
    /** updated host patterns this secret may be sent to */
    hosts?: string[];
};
export type SecretManagerEntry = {
    /** env var name */
    name: string;
    /** guest-visible placeholder value */
    placeholder: string;
    /** allowed host patterns */
    hosts: string[];
    /** whether placeholder substitution yields an empty string */
    deleted: boolean;
};
export type SecretManager = {
    /** list configured secrets */
    listSecrets(): SecretManagerEntry[];
    /** update an existing secret */
    updateSecret(name: string, options: UpdateSecretOptions): void;
    /** replace an existing secret with an empty string */
    deleteSecret(name: string): void;
};
export type CreateHttpHooksResult = {
    /** http hook implementation */
    httpHooks: HttpHooks;
    /** environment mapping for secret placeholders */
    env: Record<string, string>;
    /** resolved allowed hosts */
    allowedHosts: string[];
    /** runtime manager for configured secrets */
    secretManager: SecretManager;
};
export declare function makePlaceholderFunc(options: MakePlaceholderFuncOptions): () => string;
export declare function createHttpHooks(options?: CreateHttpHooksOptions): CreateHttpHooksResult;
//# sourceMappingURL=hooks.d.ts.map