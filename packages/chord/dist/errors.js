/** Error codes callers see (guide table). A refused or aborted reload keeps the code of its cause. */
export const CHORD_ERROR_CODES = [
    "aborted",
    "contract_mismatch",
    "forbidden",
    "gone",
    "invalid",
    "not_in_variant",
    "not_ready",
    "released",
    "superseded",
    "unavailable",
    "upgrade_conflict",
    "upgrade_required",
];
const RETRYABLE = new Set(["superseded", "upgrade_conflict"]);
export class ChordError extends Error {
    code;
    reason;
    retryable;
    details;
    constructor(code, message, options) {
        super(`${code}${options?.reason ? `/${options.reason}` : ""}: ${message}`, {
            cause: options?.cause,
        });
        this.name = "ChordError";
        this.code = code;
        this.reason = options?.reason;
        this.retryable = RETRYABLE.has(code);
        this.details = options?.details;
    }
}
export const isChordError = (error, code) => error instanceof ChordError && (code === undefined || error.code === code);
/** For factories and methods refusing a principal: `throw forbidden()`. */
export const forbidden = (message = "forbidden") => new ChordError("forbidden", message);
export const invalid = (reason, message, details) => new ChordError("invalid", message, { reason, details });
/** Keeps a ChordError's code; anything else becomes `unavailable` with the original as cause. */
export const asChordError = (error, context) => error instanceof ChordError
    ? error
    : new ChordError("unavailable", `${context}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
    });
/** Runs every step, then throws one error, or an AggregateError when several failed. */
export async function runAll(steps, message) {
    const errors = [];
    for (const step of steps) {
        try {
            await step();
        }
        catch (error) {
            errors.push(error);
        }
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, message);
}
//# sourceMappingURL=errors.js.map