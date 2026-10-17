#!/usr/bin/env node
type MountSpec = {
    hostPath: string;
    guestPath: string;
    readonly: boolean;
};
type SecretSpec = {
    name: string;
    value: string;
    hosts: string[];
};
type SshCredentialSpec = {
    host: string;
    username?: string;
    keyPath: string;
    /** private key passphrase (optional) */
    passphrase?: string;
};
type CommonOptions = {
    mounts: MountSpec[];
    memoryMounts: string[];
    allowedHosts: string[];
    secrets: SecretSpec[];
    /** image selector (asset dir, build id, or name:tag) */
    image?: string;
    /** vm backend selection */
    vmm?: "qemu" | "krun";
    /** minimum rootfs virtual disk size */
    rootfsSize?: string;
    /** disable WebSocket upgrades (both egress and ingress) */
    disableWebSockets?: boolean;
    /** dns mode (synthetic|trusted|open) */
    dnsMode?: "synthetic" | "trusted" | "open";
    /** trusted dns server ipv4 addresses */
    dnsTrustedServers: string[];
    /** synthetic dns hostname mapping mode */
    dnsSyntheticHostMapping?: "single" | "per-host";
    /** guest host[:port] -> upstream host:port tcp mappings */
    tcpHostMappings: Record<string, string>;
    /** allowed ssh host patterns for outbound ssh */
    sshAllowedHosts: string[];
    /** ssh-agent socket path (defaults to $SSH_AUTH_SOCK) */
    sshAgent?: string;
    /** OpenSSH known_hosts file paths for upstream host key verification */
    sshKnownHostsFiles: string[];
    /** ssh credentials for host-side proxy auth */
    sshCredentials: SshCredentialSpec[];
    /** enable ssh (bash command only) */
    ssh?: boolean;
    /** ssh user (bash command only) */
    sshUser?: string;
    /** local ssh listen port (bash command only) */
    sshPort?: number;
    /** local ssh listen host (bash command only) */
    sshListen?: string;
};
declare function parseHostSecret(spec: string): SecretSpec;
declare function buildVmOptions(common: CommonOptions): any;
export declare const __test: {
    buildVmOptions: typeof buildVmOptions;
    parseHostSecret: typeof parseHostSecret;
};
export {};
//# sourceMappingURL=gondolin.d.ts.map