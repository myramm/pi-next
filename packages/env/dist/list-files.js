import { err, FileError, ok, } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { abortResult, toFileError } from "./errors.js";
/** Kind bytes of `listFiles` records: `f`, `d`, `l`. */
const KINDS = { 102: "file", 100: "directory", 108: "symlink" };
/**
 * `listFiles` of an absolute path through the daemon: fails with `not_supported` if the daemon does not list files
 * (a release before `listFiles`), so callers fall back to their own walk.
 */
export async function listFilesOver(connection, path, options, context) {
    for (const key of ["maxEntries", "maxBytes", "timeoutMs"]) {
        const value = options?.[key];
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
            return err(new FileError("invalid", `${key} must be a non-negative safe integer`, path));
        }
    }
    const aborted = abortResult(context.abortSignal, path);
    if (aborted)
        return aborted;
    try {
        if (!(await connection.info()).features?.includes("listFiles")) {
            return err(new FileError("not_supported", "The pi-env daemon does not list files; update it", path));
        }
        const { json, payload } = await connection.request("listFiles", 
        // Fields left undefined are not sent; the daemon applies the defaults.
        {
            path,
            hidden: options?.hidden,
            gitignore: options?.gitignore,
            exclude: options?.exclude,
            maxEntries: options?.maxEntries,
            maxBytes: options?.maxBytes,
            timeoutMs: options?.timeoutMs,
        }, context.abortSignal ? { signal: context.abortSignal } : {});
        const afterAbort = abortResult(context.abortSignal, path);
        if (afterAbort)
            return afterAbort;
        // Records of a kind byte, the UTF-8 path, and a NUL.
        const entries = [];
        const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.length);
        for (let start = 0; start < bytes.length;) {
            const end = bytes.indexOf(0, start);
            if (end === -1)
                break;
            const kind = KINDS[bytes[start]];
            if (kind !== undefined)
                entries.push({ path: bytes.toString("utf8", start + 1, end), kind });
            start = end + 1;
        }
        return ok({ entries, truncated: json.truncated === true });
    }
    catch (error) {
        return err(toFileError(error, path));
    }
}
/**
 * `NodeExecutionEnv` with `listFiles` through a pi-env daemon on the same machine, so local and remote environments
 * list files with the same code. Everything else is `NodeExecutionEnv`'s. The connection belongs to the caller, who
 * closes it; several environments may share it.
 */
export class LocalExecutionEnv extends NodeExecutionEnv {
    #connection;
    constructor(options) {
        const { connection, ...node } = options;
        super(node);
        this.#connection = connection;
    }
    async listFiles(path, options, context) {
        const resolved = await this.absolutePath(path, context);
        if (!resolved.ok)
            return resolved;
        return listFilesOver(this.#connection, resolved.value, options, context);
    }
}
//# sourceMappingURL=list-files.js.map