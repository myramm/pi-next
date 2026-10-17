import type { Context } from "@earendil-works/chord";
import { type FileWatcher, type WatchChange, type WatchTarget } from "@earendil-works/pi-durable/env";
import { type Connection } from "./connection.ts";
/** How the daemon watches, like `NodeExecutionEnv`'s `NodeWatchOptions`. */
export interface RemoteWatchOptions {
    /** Force a mode; by default Windows and file systems that do not report remote changes poll. */
    mode?: "native" | "polling";
    /** Interval between snapshots in `polling` mode; default 2000 ms. */
    pollIntervalMs?: number;
    /** Most directories one watcher covers; default 10,000. */
    maxDirectories?: number;
}
/**
 * A watcher running in the daemon (Durable's `NodeFileWatcher` next to the files). When the connection is lost, it is
 * opened again once the connection can be started again, and reports `overflow`: changes in between were not seen.
 */
export declare class RemoteWatcher implements FileWatcher {
    #private;
    private constructor();
    /** Watch `targets` (resolved paths); fails like `NodeFileWatcher.open` if coverage cannot be established. */
    static open(connection: Connection, targets: readonly WatchTarget[], onChange: (change: WatchChange) => void, options?: RemoteWatchOptions): Promise<RemoteWatcher>;
    get mode(): "native" | "polling";
    close(_context: Context): Promise<void>;
}
//# sourceMappingURL=watch.d.ts.map