import { Connection, type ConnectionOptions } from "./connection.ts";
/** A remote system the package ships a daemon for. */
export type RemotePlatform = {
    platform: "linux" | "android" | "darwin" | "windows";
    arch: "x64" | "arm64";
    /** The remote home directory, in the remote system's own spelling. */
    home: string;
    /** Windows: the shell `sshd` runs commands with (`DefaultShell`). */
    shell?: "cmd" | "powershell";
    /** Problems worth telling the owner about, such as Termux without `termux-exec`. */
    warnings: string[];
};
/** How to reach a machine with the system `ssh`. */
export interface SshTarget {
    /** Host name or `~/.ssh/config` alias. */
    host: string;
    user?: string;
    port?: number;
    identityFile?: string;
    /** Host keys this application trusts; `acceptHostKey` adds to it. */
    knownHostsFile: string;
    /** The name keys are stored under, independent of aliases, ports and jump hosts, e.g. `pi-env-<env name>`. */
    hostKeyAlias: string;
    /** The `ssh` program; default `ssh`. */
    ssh?: string;
    /** An `ssh` configuration file instead of `~/.ssh/config` (`-F`). */
    configFile?: string;
}
/** The remote host's key is not in `knownHostsFile`; `scanHostKey` shows it so the owner can accept it. */
export declare class HostKeyUnknownError extends Error {
}
/** The remote host's key differs from the one in `knownHostsFile`; it is never accepted automatically. */
export declare class HostKeyChangedError extends Error {
}
/** An `ssh` invocation that failed for another reason, with its exit code and diagnostics. */
export declare class SshError extends Error {
    readonly exitCode: number | null;
    readonly stderr: string;
    constructor(message: string, exitCode: number | null, stderr: string);
}
/**
 * Arguments for `ssh` up to the host: no prompts, no forwarding of any kind, no shared connections, no commands from
 * the configuration, no locale forwarding (the remote uses its own), and host keys checked strictly against the
 * application's own file under a fixed alias.
 */
export declare function sshArguments(target: SshTarget, strictHostKeys?: boolean, knownHostsFile?: string): string[];
/**
 * Connect once with `accept-new` against a temporary known-hosts file to capture the key the host presents, through
 * the same route (`~/.ssh/config`, jump hosts) as real connections. Returns its known-hosts lines and fingerprints.
 * Showing a fingerprint is not authentication: compare it with one obtained out of band before accepting it.
 */
export declare function scanHostKey(target: SshTarget): Promise<{
    lines: string[];
    fingerprints: string[];
}>;
/**
 * Trust host-key lines from `scanHostKey` by adding them to the target's known-hosts file. Only plain lines for the
 * target's alias are accepted. A key that differs from a trusted key of the same type is refused with
 * `HostKeyChangedError`; `forgetHostKey` must remove the old keys first.
 */
export declare function acceptHostKey(target: SshTarget, lines: readonly string[]): Promise<void>;
/** Stop trusting every key stored for the target's alias, e.g. after the owner confirmed a changed host key. */
export declare function forgetHostKey(target: SshTarget): Promise<void>;
/** Which system the target runs: `uname` through the login shell, or PowerShell on Windows. */
export declare function detectPlatform(target: SshTarget): Promise<RemotePlatform>;
/** The daemon binary this package ships for a remote system. */
export declare function packagedDaemon(remote: Pick<RemotePlatform, "platform" | "arch">): string;
/** The daemon this package ships for the machine it runs on, e.g. for terminals of local sessions. */
export declare function localDaemon(): string;
/**
 * Make sure the daemon is on the remote machine, verified by its SHA-256 before it ever runs, and remove daemons of
 * other contents. The upload goes to a new temporary file and is renamed into place only once its hash matches.
 * Returns the remote path of the binary.
 */
export declare function deployDaemon(target: SshTarget, remote: RemotePlatform, binary?: string): Promise<string>;
/** Options for `sshConnection` and `connectSsh`: the target, plus the binary to deploy (default: the one this package ships). */
export interface SshConnectOptions extends SshTarget {
    binary?: string;
    /**
     * POSIX: start the daemon through the user's login shell (`$SHELL -l`), so commands see the environment of
     * `~/.profile` and similar files. Off by default: `ssh` runs commands without a login shell.
     */
    loginShell?: boolean;
    onLog?: ConnectionOptions["onLog"];
}
/**
 * A `Connection` to the target that does nothing until its first request. Each start detects the remote system (the
 * first time), verifies the daemon and deploys it if it is missing or changed, then starts it over `ssh`. A failure
 * (no network, an untrusted or changed host key) fails the requests waiting for that start with code `spawn_error`
 * and the `ssh` diagnostics as message; the next request tries again. `remote()` is the detected system, once known.
 */
export declare function sshConnection(options: SshConnectOptions): {
    connection: Connection;
    remote(): RemotePlatform | undefined;
};
/**
 * Detect the remote system and deploy the daemon now, then return a `Connection` that starts it over `ssh`, like
 * `sshConnection`. Failures reject here: host keys must already be trusted (`scanHostKey`, `acceptHostKey`), otherwise
 * this rejects with `HostKeyUnknownError`.
 */
export declare function connectSsh(options: SshConnectOptions): Promise<{
    connection: Connection;
    remote: RemotePlatform;
}>;
//# sourceMappingURL=ssh.d.ts.map