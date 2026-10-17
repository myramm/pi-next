export function resolveEnvNumber(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return parsed;
}
export function buildShellEnv(baseEnv, extraEnv) {
    const envMap = mergeEnvMap(baseEnv, extraEnv);
    if (envMap.size === 0) {
        const term = resolveTermValue();
        return term ? [`TERM=${term}`] : undefined;
    }
    if (!envMap.has("TERM")) {
        const term = resolveTermValue();
        if (term)
            envMap.set("TERM", term);
    }
    return mapToEnvArray(envMap);
}
function resolveTermValue() {
    const term = process.env.TERM;
    if (!term || term === "xterm-ghostty") {
        return "xterm-256color";
    }
    return term;
}
export function mergeEnvInputs(baseEnv, extraEnv) {
    const envMap = mergeEnvMap(baseEnv, extraEnv);
    return envMap.size > 0 ? mapToEnvArray(envMap) : undefined;
}
function mergeEnvMap(baseEnv, extraEnv) {
    const envMap = new Map();
    for (const [key, value] of envInputToEntries(baseEnv)) {
        envMap.set(key, value);
    }
    for (const [key, value] of envInputToEntries(extraEnv)) {
        envMap.set(key, value);
    }
    return envMap;
}
export function envInputToEntries(env) {
    if (!env)
        return [];
    if (Array.isArray(env)) {
        return env.map(parseEnvEntry);
    }
    return Object.entries(env);
}
export function parseEnvEntry(entry) {
    const idx = entry.indexOf("=");
    if (idx === -1)
        return [entry, ""];
    return [entry.slice(0, idx), entry.slice(idx + 1)];
}
export function mapToEnvArray(envMap) {
    return Array.from(envMap.entries(), ([key, value]) => `${key}=${value}`);
}
//# sourceMappingURL=env.js.map