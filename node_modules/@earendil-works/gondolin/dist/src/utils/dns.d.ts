export declare function normalizeIpv4Servers(servers?: string[]): string[];
export declare class SyntheticDnsHostMap {
    private readonly hostToIp;
    private readonly ipToHost;
    private nextHostId;
    /**
     * Allocate (or retrieve) a stable synthetic IPv4 for a hostname
     *
     * Returns null for invalid/unsupported hostnames or if the mapping space is exhausted
     * This method must be safe to call on untrusted guest input
     */
    allocate(hostname: string): string | null;
    lookupHostByIp(ip: string): string | null;
}
//# sourceMappingURL=dns.d.ts.map