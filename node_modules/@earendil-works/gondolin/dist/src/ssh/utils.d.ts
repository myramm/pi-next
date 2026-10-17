import type { SshCredential } from "./types.js";
import { matchHostname, normalizeHostnamePattern } from "../host/patterns.js";
export { matchHostname, normalizeHostnamePattern };
export type SshAllowedTarget = {
    /** normalized host pattern */
    pattern: string;
    /** destination port */
    port: number;
};
export type ResolvedSshCredential = {
    /** matched host pattern */
    pattern: string;
    /** destination port */
    port: number;
    /** upstream ssh username */
    username?: string;
    /** private key in OpenSSH/PEM format */
    privateKey: string | Buffer;
    /** private key passphrase */
    passphrase?: string | Buffer;
};
export declare function generateSshHostKey(): string;
export declare function normalizeSshAllowedTargets(targets?: string[]): SshAllowedTarget[];
export declare function normalizeSshCredentials(credentials?: Record<string, SshCredential>): ResolvedSshCredential[];
export declare function normalizeSshKnownHostsFiles(knownHostsFile?: string | string[]): string[];
export declare function createOpenSshKnownHostsHostVerifier(files: string[]): (hostname: string, key: Buffer, port: number) => boolean;
//# sourceMappingURL=utils.d.ts.map