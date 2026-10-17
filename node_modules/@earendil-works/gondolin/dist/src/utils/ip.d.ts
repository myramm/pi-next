/**
 * Parse an IPv4 address into bytes.
 *
 * Note: intentionally permissive (allows leading zeros) to match existing callers.
 */
export declare function parseIPv4Bytes(ip: string): Buffer | null;
/**
 * Parse an IPv6 address into 8 hextets.
 *
 * Supports :: compression and embedded IPv4.
 */
export declare function parseIPv6Hextets(ip: string): number[] | null;
export declare function parseIPv6Bytes(ip: string): Buffer | null;
/** Extract an IPv4 address from an IPv4-mapped IPv6 address (e.g. ::ffff:1.2.3.4) */
export declare function extractIPv4Mapped(hextets: number[]): string | null;
//# sourceMappingURL=ip.d.ts.map