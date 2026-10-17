/**
 * Hostname allowlist pattern matching helpers
 *
 * Pattern syntax:
 * - "*" matches any hostname
 * - "*" wildcards inside the pattern match any substring
 */
/** normalize hostname allowlist pattern */
export declare function normalizeHostnamePattern(pattern: string): string;
/** match a hostname against a normalized allowlist pattern */
export declare function matchHostname(hostname: string, pattern: string): boolean;
/** test a hostname against multiple allowlist patterns */
export declare function matchesAnyHost(hostname: string, patterns: string[]): boolean;
//# sourceMappingURL=patterns.d.ts.map