import type { Context } from "@earendil-works/chord";
import { type ExecutionEnv, FileError, type FileListing, type ListFilesOptions, type Result } from "@earendil-works/pi-durable/env";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { Connection } from "./connection.ts";
/**
 * `listFiles` of an absolute path through the daemon: fails with `not_supported` if the daemon does not list files
 * (a release before `listFiles`), so callers fall back to their own walk.
 */
export declare function listFilesOver(connection: Connection, path: string, options: ListFilesOptions | undefined, context: Context): Promise<Result<FileListing, FileError>>;
export type LocalExecutionEnvOptions = ConstructorParameters<typeof NodeExecutionEnv>[0] & {
    /** A connection to this machine's daemon, `new Connection({ command: [localDaemon()] })`, for `listFiles`. */
    connection: Connection;
};
/**
 * `NodeExecutionEnv` with `listFiles` through a pi-env daemon on the same machine, so local and remote environments
 * list files with the same code. Everything else is `NodeExecutionEnv`'s. The connection belongs to the caller, who
 * closes it; several environments may share it.
 */
export declare class LocalExecutionEnv extends NodeExecutionEnv implements ExecutionEnv {
    #private;
    constructor(options: LocalExecutionEnvOptions);
    listFiles(path: string, options: ListFilesOptions | undefined, context: Context): Promise<Result<FileListing, FileError>>;
}
//# sourceMappingURL=list-files.d.ts.map