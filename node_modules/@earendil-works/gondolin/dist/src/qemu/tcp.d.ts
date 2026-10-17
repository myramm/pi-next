export type TcpOptions = {
    /** guest host[:port] -> upstream host:port mappings */
    hosts: Record<string, string>;
};
export type TcpMappedTarget = {
    /** guest hostname derived from synthetic dns */
    hostname: string;
    /** optional guest destination port match */
    port: number | null;
    /** upstream connect host */
    connectHost: string;
    /** upstream connect port */
    connectPort: number;
};
//# sourceMappingURL=tcp.d.ts.map