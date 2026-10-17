/**
 * Canonical Linux errno values sent to the guest over filesystem RPC
 *
 * Host-side Node.js errors expose platform-neutral `error.code` strings, but
 * `error.errno` numbers are host-OS specific (for example macOS ENOTEMPTY is
 * `66` while Linux ENOTEMPTY is `39`). The guest interprets errno numbers as
 * Linux values, so translate by code first.
 */
export declare const LINUX_ERRNO: Readonly<Record<string, number>>;
export declare function toLinuxErrno(error: Pick<NodeJS.ErrnoException, "code" | "errno">, fallback?: number): number;
//# sourceMappingURL=linux-errno.d.ts.map