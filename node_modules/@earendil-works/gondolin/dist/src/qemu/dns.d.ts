/** DNS record type A */
export declare const DNS_TYPE_A = 1;
/** DNS record type AAAA */
export declare const DNS_TYPE_AAAA = 28;
/** DNS class IN */
export declare const DNS_CLASS_IN = 1;
export type ParsedDnsQuestion = {
    /** question name in presentation format */
    name: string;
    /** question type */
    type: number;
    /** question class */
    qclass: number;
};
export type ParsedDnsQuery = {
    /** transaction id */
    id: number;
    /** request flags */
    flags: number;
    /** raw wire bytes of the first question (for synthetic answers) */
    questionSection: Buffer;
    /** first question (used for synthetic answers) */
    firstQuestion: ParsedDnsQuestion;
};
export type SyntheticDnsResponseOptions = {
    /** synthetic ipv4 A response address */
    ipv4: string;
    /** synthetic ipv6 AAAA response address */
    ipv6: string;
    /** response ttl in `seconds` */
    ttlSeconds: number;
};
export declare function isProbablyDnsPacket(packet: Buffer): boolean;
export declare function parseDnsQuery(packet: Buffer): ParsedDnsQuery | null;
/** RFC 6761 localhost name match */
export declare function isLocalhostDnsName(name: string): boolean;
export declare function buildSyntheticDnsResponse(query: ParsedDnsQuery, options: SyntheticDnsResponseOptions): Buffer;
//# sourceMappingURL=dns.d.ts.map