import { FileError, type Result } from "@earendil-works/pi-durable/env";
export declare function abortResult<T>(signal: AbortSignal | undefined, path?: string): Result<T, FileError> | undefined;
/** `NodeExecutionEnv`'s mapping of Node error codes to `FileError` codes. */
export declare function toFileError(error: unknown, fallbackPath?: string): FileError;
//# sourceMappingURL=errors.d.ts.map