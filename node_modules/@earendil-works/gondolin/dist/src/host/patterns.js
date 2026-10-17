/**
 * Hostname allowlist pattern matching helpers
 *
 * Pattern syntax:
 * - "*" matches any hostname
 * - "*" wildcards inside the pattern match any substring
 */
/** normalize hostname allowlist pattern */
export function normalizeHostnamePattern(pattern) {
    return pattern.trim().toLowerCase();
}
/** match a hostname against a normalized allowlist pattern */
export function matchHostname(hostname, pattern) {
    if (!pattern)
        return false;
    if (pattern === "*")
        return true;
    const escaped = pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    const regex = new RegExp(`^${escaped}$`, "i");
    return regex.test(hostname);
}
/** test a hostname against multiple allowlist patterns */
export function matchesAnyHost(hostname, patterns) {
    const normalized = hostname.toLowerCase();
    return patterns.some((pattern) => matchHostname(normalized, pattern));
}
//# sourceMappingURL=patterns.js.map