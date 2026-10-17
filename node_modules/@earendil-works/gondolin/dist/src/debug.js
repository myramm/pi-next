const ALL_DEBUG_FLAGS = [
    "net",
    "exec",
    "vfs",
    "protocol",
];
export function defaultDebugLog(component, message) {
    // Intentionally console.log (not stderr) so callers can easily intercept/redirect.
    console.log(formatDebugLine(component, message));
}
function formatDebugLine(component, message) {
    const trimmed = stripTrailingNewline(message);
    return `[${component}] ${trimmed}`;
}
export function stripTrailingNewline(value) {
    if (value.endsWith("\r\n"))
        return value.slice(0, -2);
    if (value.endsWith("\n"))
        return value.slice(0, -1);
    return value;
}
export function parseDebugEnv(value = process.env.GONDOLIN_DEBUG) {
    const flags = new Set();
    if (!value)
        return flags;
    // Allow: "net,exec" as well as "all" / "*".
    for (const entry of value.split(",")) {
        const raw = entry.trim();
        if (!raw)
            continue;
        if (raw === "*" || raw === "all" || raw === "1" || raw === "true") {
            for (const f of ALL_DEBUG_FLAGS)
                flags.add(f);
            continue;
        }
        const flag = raw === "fs" ? "vfs" : raw;
        if (flag === "net" ||
            flag === "exec" ||
            flag === "vfs" ||
            flag === "protocol") {
            flags.add(flag);
        }
    }
    return flags;
}
export function resolveDebugFlags(config, envFlags = parseDebugEnv()) {
    if (config === undefined) {
        return envFlags;
    }
    if (config === true) {
        return new Set(ALL_DEBUG_FLAGS);
    }
    if (config === false) {
        return new Set();
    }
    const out = new Set();
    for (const flag of config) {
        if (flag === "net" ||
            flag === "exec" ||
            flag === "vfs" ||
            flag === "protocol") {
            out.add(flag);
        }
    }
    return out;
}
export function debugFlagsToArray(flags) {
    return Array.from(flags).sort();
}
//# sourceMappingURL=debug.js.map