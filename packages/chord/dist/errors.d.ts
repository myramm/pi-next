/** Error codes callers see (guide table). A refused or aborted reload keeps the code of its cause. */
export declare const CHORD_ERROR_CODES: readonly ["aborted", "contract_mismatch", "forbidden", "gone", "invalid", "not_in_variant", "not_ready", "released", "superseded", "unavailable", "upgrade_conflict", "upgrade_required"];
export type ChordErrorCode = (typeof CHORD_ERROR_CODES)[number];
/**
 * Finer cause inside a code, for logs and tests: e.g. `invalid` + `args`, `result`, `state`, `input`, `implementation`,
 * `duplicate`, `cycle`, `read_only`, `not_host_lifetime`, `registry_conflict`; `unavailable` + `unknown_type`.
 */
export type ChordErrorReason = string;
export declare class ChordError extends Error {
    readonly code: ChordErrorCode;
    readonly reason: ChordErrorReason | undefined;
    readonly retryable: boolean;
    readonly details: unknown;
    constructor(code: ChordErrorCode, message: string, options?: {
        cause?: unknown;
        details?: unknown;
        reason?: ChordErrorReason;
    });
}
export declare const isChordError: (error: unknown, code?: ChordErrorCode) => error is ChordError;
/** For factories and methods refusing a principal: `throw forbidden()`. */
export declare const forbidden: (message?: string) => ChordError;
export declare const invalid: (reason: ChordErrorReason, message: string, details?: unknown) => ChordError;
/** Keeps a ChordError's code; anything else becomes `unavailable` with the original as cause. */
export declare const asChordError: (error: unknown, context: string) => ChordError;
/** Runs every step, then throws one error, or an AggregateError when several failed. */
export declare function runAll(steps: readonly (() => unknown)[], message: string): Promise<void>;
//# sourceMappingURL=errors.d.ts.map