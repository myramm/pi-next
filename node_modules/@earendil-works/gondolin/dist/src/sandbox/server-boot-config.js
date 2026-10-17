import path from "path";
export function normalizeSandboxFsConfig(message) {
    const fuseMount = normalizeMountPath(message.fuseMount ?? "/data", "fuseMount");
    const fuseBinds = normalizeBindList(message.fuseBinds ?? []);
    return {
        fuseMount,
        fuseBinds,
    };
}
function normalizeMountPath(value, field) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
    let normalized = path.posix.normalize(value);
    if (!normalized.startsWith("/")) {
        throw new Error(`${field} must be an absolute path`);
    }
    if (normalized.length > 1 && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
    }
    if (normalized.includes("\0")) {
        throw new Error(`${field} contains null bytes`);
    }
    return normalized;
}
function normalizeBindList(value) {
    if (!Array.isArray(value)) {
        throw new Error("fuseBinds must be an array of absolute paths");
    }
    const seen = new Set();
    const binds = [];
    for (const entry of value) {
        const normalized = normalizeMountPath(entry, "fuseBinds");
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        binds.push(normalized);
    }
    binds.sort();
    return binds;
}
export function isSameSandboxFsConfig(left, right) {
    if (left.fuseMount !== right.fuseMount)
        return false;
    if (left.fuseBinds.length !== right.fuseBinds.length)
        return false;
    for (let i = 0; i < left.fuseBinds.length; i += 1) {
        if (left.fuseBinds[i] !== right.fuseBinds[i])
            return false;
    }
    return true;
}
export function buildSandboxfsAppend(baseAppend, config) {
    const pieces = [baseAppend.trim(), `sandboxfs.mount=${config.fuseMount}`];
    if (config.fuseBinds.length > 0) {
        pieces.push(`sandboxfs.bind=${config.fuseBinds.join(",")}`);
    }
    return pieces
        .filter((piece) => piece.length > 0)
        .join(" ")
        .trim();
}
//# sourceMappingURL=server-boot-config.js.map