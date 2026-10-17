import type { Connection } from "./connection.ts";
import type { HostImpl, PluginRef } from "./host.ts";
import { type ReloadOptions, type ReloadReport } from "./reload.ts";
import { type Frame } from "./wire.ts";
export declare function runClusterReload(host: HostImpl, plugins: readonly PluginRef[], options: ReloadOptions): Promise<ReloadReport>;
/**
 * Brings a child that connected behind this host's code version up to it: a reload of the child's modules (the ones
 * cluster reloads gave its name) to this host's current code version, prepared, voted and committed like a cluster
 * reload. Until then the child is fenced: nothing is routed to it. The child's old code is never relabeled as a newer
 * code version.
 */
export declare function reconcileChild(host: HostImpl, connection: Connection): Promise<void>;
/**
 * The child side: prepare and vote, then wait for the server's commit or abort. An abort or a lost parent link can
 * arrive at any point: while loading modules, while preparing (pending opens close themselves when they complete),
 * or after the vote. The operation is unwound once its pending work settles, and the reload slot is freed.
 */
export declare class ChildReloads {
    #private;
    constructor(host: HostImpl);
    handle(connection: Connection, frame: Extract<Frame, {
        t: "prepare" | "commit" | "abort";
    }>): void;
    /** The parent link died: nobody will commit, so roll back (now, or once pending work settles). */
    parentLost(): void;
}
//# sourceMappingURL=cluster.d.ts.map