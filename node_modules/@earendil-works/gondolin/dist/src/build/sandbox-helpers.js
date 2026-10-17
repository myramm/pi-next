import { createHash, randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { extractTarGz } from "../alpine/tar.js";
const SANDBOX_HELPER_REGISTRY_SCHEMA = 1;
const SANDBOX_HELPER_MANIFEST_SCHEMA = 1;
const SANDBOX_HELPER_KIND = "gondolin-sandbox-helpers";
const DEFAULT_SANDBOX_HELPER_REGISTRY_URL = "https://raw.githubusercontent.com/earendil-works/gondolin/main/builtin-sandbox-helper-registry.json";
const HELPER_BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HELPER_REF_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const HELPER_REF_NAME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HELPER_REF_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
export const SANDBOX_HELPER_BINARY_NAMES = [
    "sandboxd",
    "sandboxfs",
    "sandboxssh",
    "sandboxingress",
];
function cacheBaseDir() {
    return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
}
export function getSandboxHelperStoreDirectory() {
    return (process.env.GONDOLIN_SANDBOX_HELPER_STORE ??
        path.join(cacheBaseDir(), "gondolin", "sandbox-helpers"));
}
function sandboxHelperRegistryUrl(value) {
    const envValue = process.env.GONDOLIN_SANDBOX_HELPER_REGISTRY_URL?.trim();
    const explicit = value?.trim();
    if (explicit && explicit.length > 0)
        return explicit;
    if (envValue && envValue.length > 0)
        return envValue;
    return DEFAULT_SANDBOX_HELPER_REGISTRY_URL;
}
function registryCachePath(storeDir) {
    return path.join(storeDir, "builtin-sandbox-helper-registry-cache.json");
}
function helperObjectRootDir(storeDir) {
    return path.join(storeDir, "objects");
}
function helperObjectDir(storeDir, buildId) {
    return path.join(helperObjectRootDir(storeDir), normalizeHelperBuildId(buildId));
}
function normalizeArchitecture(value) {
    if (!value)
        return null;
    const lower = value.toLowerCase();
    if (lower === "aarch64" || lower === "arm64")
        return "aarch64";
    if (lower === "x86_64" || lower === "amd64" || lower === "x64") {
        return "x86_64";
    }
    return null;
}
function normalizeSha256(value, label) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        throw new Error(`invalid ${label}: expected sha256 hex string`);
    }
    return value.toLowerCase();
}
function normalizeHelperBuildId(value) {
    const lower = value.toLowerCase();
    if (!HELPER_BUILD_ID_PATTERN.test(lower)) {
        throw new Error(`invalid sandbox helper build id: ${value}`);
    }
    return lower;
}
function bytesToUuid(bytes) {
    const hex = bytes.toString("hex");
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join("-");
}
export function computeSandboxHelperBuildId(input) {
    const parts = ["gondolin-sandbox-helper-build", `arch=${input.arch}`];
    for (const name of SANDBOX_HELPER_BINARY_NAMES) {
        parts.push(`${name}=${normalizeSha256(input.checksums[name], name)}`);
    }
    const digest = createHash("sha256").update(parts.join("\n")).digest();
    const bytes = Buffer.from(digest.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return bytesToUuid(bytes);
}
function computeFileHash(filePath) {
    const hash = createHash("sha256");
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let bytesRead = 0;
        while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            hash.update(buffer.subarray(0, bytesRead));
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return hash.digest("hex");
}
function hasValidRefNameSegments(name) {
    const segments = name.split("/");
    if (segments.length === 0)
        return false;
    for (const segment of segments) {
        if (segment.length === 0 || segment === "." || segment === "..") {
            return false;
        }
        if (!HELPER_REF_NAME_SEGMENT_PATTERN.test(segment)) {
            return false;
        }
    }
    return true;
}
function parseSandboxHelperRef(reference) {
    const trimmed = reference.trim();
    const colon = trimmed.lastIndexOf(":");
    if (colon <= 0 || colon >= trimmed.length - 1) {
        throw new Error(`invalid sandbox helper ref: ${reference}`);
    }
    const name = trimmed.slice(0, colon);
    const tag = trimmed.slice(colon + 1);
    if (!HELPER_REF_NAME_PATTERN.test(name) || !hasValidRefNameSegments(name)) {
        throw new Error(`invalid sandbox helper ref name: ${name}`);
    }
    if (!HELPER_REF_TAG_PATTERN.test(tag)) {
        throw new Error(`invalid sandbox helper ref tag: ${tag}`);
    }
    return { name, tag, canonical: `${name}:${tag}` };
}
export function sandboxHelperRefForVersion(version) {
    const normalized = version.trim().replace(/^v/, "");
    return parseSandboxHelperRef(`gondolin:${normalized}`).canonical;
}
function resolveHostPackageVersion() {
    let dir = import.meta.dirname;
    for (let i = 0; i < 8; i++) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
                if (parsed.name === "@earendil-works/gondolin" && parsed.version) {
                    return parsed.version;
                }
            }
            catch {
                // Ignore malformed package metadata while walking upward.
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return "0.0.0";
}
function parseRegistrySource(raw, where, baseUrl) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`invalid ${where}: expected object`);
    }
    const rec = raw;
    if (typeof rec.url !== "string" || rec.url.trim().length === 0) {
        throw new Error(`invalid ${where}.url: expected string`);
    }
    let url;
    try {
        url = new URL(rec.url, baseUrl).toString();
    }
    catch {
        throw new Error(`invalid ${where}.url: ${rec.url}`);
    }
    const source = { url };
    if (rec.sha256 !== undefined) {
        source.sha256 = normalizeSha256(rec.sha256, `${where}.sha256`);
    }
    if (rec.arch !== undefined) {
        if (typeof rec.arch !== "string") {
            throw new Error(`invalid ${where}.arch: expected string`);
        }
        const arch = normalizeArchitecture(rec.arch);
        if (!arch) {
            throw new Error(`invalid ${where}.arch: ${rec.arch}`);
        }
        source.arch = arch;
    }
    if (rec.gondolinVersion !== undefined) {
        if (typeof rec.gondolinVersion !== "string" || !rec.gondolinVersion) {
            throw new Error(`invalid ${where}.gondolinVersion: expected string`);
        }
        source.gondolinVersion = rec.gondolinVersion;
    }
    if (rec.target !== undefined) {
        if (typeof rec.target !== "string" || !rec.target) {
            throw new Error(`invalid ${where}.target: expected string`);
        }
        source.target = rec.target;
    }
    if (rec.zigVersion !== undefined) {
        if (typeof rec.zigVersion !== "string" || !rec.zigVersion) {
            throw new Error(`invalid ${where}.zigVersion: expected string`);
        }
        source.zigVersion = rec.zigVersion;
    }
    return source;
}
function parseBuiltinSandboxHelperRegistry(raw, sourceUrl) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("invalid builtin sandbox helper registry: expected object");
    }
    const rec = raw;
    if (rec.schema !== SANDBOX_HELPER_REGISTRY_SCHEMA) {
        throw new Error(`invalid builtin sandbox helper registry schema: expected ${SANDBOX_HELPER_REGISTRY_SCHEMA}`);
    }
    const baseUrl = new URL(sourceUrl);
    if (!rec.builds ||
        typeof rec.builds !== "object" ||
        Array.isArray(rec.builds)) {
        throw new Error("invalid builtin sandbox helper registry: builds must be an object");
    }
    const builds = {};
    for (const [buildId, value] of Object.entries(rec.builds)) {
        const canonical = normalizeHelperBuildId(buildId);
        builds[canonical] = parseRegistrySource(value, `builds['${buildId}']`, baseUrl);
    }
    if (!rec.refs || typeof rec.refs !== "object" || Array.isArray(rec.refs)) {
        throw new Error("invalid builtin sandbox helper registry: refs must be an object");
    }
    const refs = {};
    for (const [reference, archMap] of Object.entries(rec.refs)) {
        const parsedRef = parseSandboxHelperRef(reference);
        if (parsedRef.canonical !== reference) {
            throw new Error(`invalid builtin sandbox helper registry ref key: ${reference}`);
        }
        if (!archMap || typeof archMap !== "object" || Array.isArray(archMap)) {
            throw new Error(`invalid registry ref '${reference}': expected object`);
        }
        const mapped = {};
        for (const [archKey, value] of Object.entries(archMap)) {
            const arch = normalizeArchitecture(archKey);
            if (!arch) {
                throw new Error(`invalid registry ref '${reference}' arch key: ${archKey}`);
            }
            if (typeof value !== "string") {
                throw new Error(`invalid refs['${reference}']['${archKey}']: expected build id string`);
            }
            const buildId = normalizeHelperBuildId(value);
            const source = builds[buildId];
            if (!source) {
                throw new Error(`invalid refs['${reference}']['${archKey}']: unknown build id ${buildId}`);
            }
            if (source.arch && source.arch !== arch) {
                throw new Error(`invalid refs['${reference}']['${archKey}']: arch ${arch} does not match build arch ${source.arch}`);
            }
            mapped[arch] = buildId;
        }
        refs[parsedRef.canonical] = mapped;
    }
    return {
        schema: SANDBOX_HELPER_REGISTRY_SCHEMA,
        refs,
        builds,
    };
}
function loadRegistryCache(url, storeDir) {
    const cachePath = registryCachePath(storeDir);
    if (!fs.existsSync(cachePath))
        return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (!parsed || typeof parsed !== "object")
            return null;
        if (parsed.url !== url)
            return null;
        const registry = parseBuiltinSandboxHelperRegistry(parsed.registry, url);
        return {
            url,
            etag: typeof parsed.etag === "string" ? parsed.etag : undefined,
            registry,
        };
    }
    catch {
        return null;
    }
}
function saveRegistryCache(cache, storeDir) {
    fs.mkdirSync(storeDir, { recursive: true });
    const cachePath = registryCachePath(storeDir);
    const tmpPath = `${cachePath}.tmp-${randomUUID().slice(0, 8)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
    fs.renameSync(tmpPath, cachePath);
}
async function fetchBuiltinSandboxHelperRegistry(options) {
    const storeDir = options.storeDir ?? getSandboxHelperStoreDirectory();
    const url = sandboxHelperRegistryUrl(options.registryUrl);
    const cached = loadRegistryCache(url, storeDir);
    const headers = {
        "User-Agent": "gondolin-sandbox-helper-registry",
    };
    if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
    }
    let response;
    try {
        response = await fetch(url, { headers });
    }
    catch (error) {
        if (cached)
            return cached.registry;
        throw new Error(`failed to fetch builtin sandbox helper registry from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 304 && cached) {
        return cached.registry;
    }
    if (!response.ok) {
        if (cached)
            return cached.registry;
        throw new Error(`failed to fetch builtin sandbox helper registry: ${response.status} ${response.statusText} (${url})`);
    }
    const text = await response.text();
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`failed to parse builtin sandbox helper registry json from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const registry = parseBuiltinSandboxHelperRegistry(raw, url);
    saveRegistryCache({
        url,
        etag: response.headers.get("etag") ?? undefined,
        registry,
    }, storeDir);
    return registry;
}
function resolveRegistrySourceForRef(registry, reference, arch) {
    const parsedRef = parseSandboxHelperRef(reference);
    const entries = registry.refs[parsedRef.canonical];
    if (!entries) {
        throw new Error(`sandbox helper ref not found in builtin registry: ${parsedRef.canonical}`);
    }
    const buildId = entries[arch];
    if (!buildId) {
        const availableArchs = Object.keys(entries).join(", ") || "none";
        throw new Error(`sandbox helper ref '${parsedRef.canonical}' has no registry source for ${arch} (available: ${availableArchs})`);
    }
    const source = registry.builds[buildId];
    if (!source) {
        throw new Error(`sandbox helper ref '${parsedRef.canonical}' points to unknown registry build id: ${buildId}`);
    }
    return { buildId, source };
}
function parseSandboxHelperManifest(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("invalid sandbox helper manifest: expected object");
    }
    const rec = raw;
    if (rec.schema !== SANDBOX_HELPER_MANIFEST_SCHEMA) {
        throw new Error(`invalid sandbox helper manifest schema: expected ${SANDBOX_HELPER_MANIFEST_SCHEMA}`);
    }
    if (rec.kind !== SANDBOX_HELPER_KIND) {
        throw new Error(`invalid sandbox helper manifest kind: ${String(rec.kind)}`);
    }
    if (typeof rec.gondolinVersion !== "string" || !rec.gondolinVersion) {
        throw new Error("invalid sandbox helper manifest gondolinVersion");
    }
    if (typeof rec.arch !== "string") {
        throw new Error("invalid sandbox helper manifest arch");
    }
    const arch = normalizeArchitecture(rec.arch);
    if (!arch) {
        throw new Error(`invalid sandbox helper manifest arch: ${rec.arch}`);
    }
    if (!rec.checksums || typeof rec.checksums !== "object" || Array.isArray(rec.checksums)) {
        throw new Error("invalid sandbox helper manifest checksums");
    }
    const rawChecksums = rec.checksums;
    const checksums = {};
    for (const name of SANDBOX_HELPER_BINARY_NAMES) {
        checksums[name] = normalizeSha256(rawChecksums[name], `sandbox helper manifest checksums.${name}`);
    }
    const manifest = {
        schema: SANDBOX_HELPER_MANIFEST_SCHEMA,
        kind: SANDBOX_HELPER_KIND,
        gondolinVersion: rec.gondolinVersion,
        arch,
        checksums,
    };
    if (rec.sourceRef !== undefined) {
        if (typeof rec.sourceRef !== "string" || !rec.sourceRef) {
            throw new Error("invalid sandbox helper manifest sourceRef");
        }
        manifest.sourceRef = rec.sourceRef;
    }
    if (rec.target !== undefined) {
        if (typeof rec.target !== "string" || !rec.target) {
            throw new Error("invalid sandbox helper manifest target");
        }
        manifest.target = rec.target;
    }
    if (rec.zigVersion !== undefined) {
        if (typeof rec.zigVersion !== "string" || !rec.zigVersion) {
            throw new Error("invalid sandbox helper manifest zigVersion");
        }
        manifest.zigVersion = rec.zigVersion;
    }
    return manifest;
}
export function loadSandboxHelperManifest(helperDir) {
    const manifestPath = path.join(helperDir, "manifest.json");
    if (!fs.existsSync(manifestPath))
        return null;
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return parseSandboxHelperManifest(raw);
}
function helperBinDir(helperDir) {
    const nested = path.join(helperDir, "bin");
    if (fs.existsSync(path.join(nested, "sandboxd"))) {
        return nested;
    }
    return helperDir;
}
function buildHelperPaths(binDir) {
    return {
        sandboxdPath: path.join(binDir, "sandboxd"),
        sandboxfsPath: path.join(binDir, "sandboxfs"),
        sandboxsshPath: path.join(binDir, "sandboxssh"),
        sandboxingressPath: path.join(binDir, "sandboxingress"),
    };
}
function pathForHelperName(paths, name) {
    switch (name) {
        case "sandboxd":
            return paths.sandboxdPath;
        case "sandboxfs":
            return paths.sandboxfsPath;
        case "sandboxssh":
            return paths.sandboxsshPath;
        case "sandboxingress":
            return paths.sandboxingressPath;
    }
}
function assertExecutableFiles(paths) {
    for (const name of SANDBOX_HELPER_BINARY_NAMES) {
        const filePath = pathForHelperName(paths, name);
        let stat;
        try {
            stat = fs.lstatSync(filePath);
        }
        catch {
            throw new Error(`sandbox helper binary not found: ${filePath}`);
        }
        if (!stat.isFile()) {
            throw new Error(`sandbox helper binary is not a regular file: ${filePath}`);
        }
    }
}
function computeHelperChecksums(paths) {
    const checksums = {};
    for (const name of SANDBOX_HELPER_BINARY_NAMES) {
        checksums[name] = computeFileHash(pathForHelperName(paths, name));
    }
    return checksums;
}
function verifyManifestChecksums(manifest, paths) {
    const actual = computeHelperChecksums(paths);
    for (const name of SANDBOX_HELPER_BINARY_NAMES) {
        const expected = manifest.checksums[name];
        if (actual[name] !== expected) {
            throw new Error(`sandbox helper checksum mismatch for ${name}\n  expected: ${expected}\n  got:      ${actual[name]}`);
        }
    }
}
function resolveSandboxHelperDirectory(helperDir, options) {
    const resolvedDir = path.resolve(helperDir);
    const manifest = loadSandboxHelperManifest(resolvedDir);
    const paths = buildHelperPaths(helperBinDir(resolvedDir));
    assertExecutableFiles(paths);
    let arch = options.expectedArch;
    let buildId;
    if (manifest) {
        verifyManifestChecksums(manifest, paths);
        arch = manifest.arch;
        buildId = computeSandboxHelperBuildId({
            arch: manifest.arch,
            checksums: manifest.checksums,
        });
        if (options.expectedArch && manifest.arch !== options.expectedArch) {
            throw new Error(`sandbox helper arch mismatch\n  expected: ${options.expectedArch}\n  got:      ${manifest.arch}`);
        }
        if (options.expectedGondolinVersion &&
            manifest.gondolinVersion !== options.expectedGondolinVersion) {
            throw new Error(`sandbox helper gondolinVersion mismatch\n  expected: ${options.expectedGondolinVersion}\n  got:      ${manifest.gondolinVersion}`);
        }
    }
    else if (!arch) {
        throw new Error(`sandbox helper manifest not found: ${path.join(resolvedDir, "manifest.json")}`);
    }
    return {
        source: options.source,
        buildId,
        arch,
        manifest: manifest ?? undefined,
        paths,
    };
}
async function downloadHelperArchive(source, archivePath) {
    const response = await fetch(source.url, {
        headers: {
            "User-Agent": "gondolin-sandbox-helper-fetch",
        },
    });
    if (!response.ok) {
        throw new Error(`failed to download sandbox helper archive: ${response.status} ${response.statusText} (${source.url})`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    if (source.sha256) {
        const got = createHash("sha256").update(data).digest("hex");
        if (got !== source.sha256) {
            throw new Error(`downloaded sandbox helper checksum mismatch for ${source.url}\n  expected: ${source.sha256}\n  got:      ${got}`);
        }
    }
    fs.writeFileSync(archivePath, data);
}
async function importSandboxHelpersFromSource(source, expectedBuildId, storeDir) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-sandbox-helpers-"));
    const archivePath = path.join(tmpRoot, "helpers.tar.gz");
    const extractDir = path.join(tmpRoot, "extract");
    try {
        await downloadHelperArchive(source, archivePath);
        fs.mkdirSync(extractDir, { recursive: true });
        await extractTarGz(archivePath, extractDir);
        const extracted = resolveSandboxHelperDirectory(extractDir, {
            expectedArch: source.arch,
            expectedGondolinVersion: source.gondolinVersion,
            source: "cache",
        });
        if (!extracted.manifest) {
            throw new Error("downloaded sandbox helper archive is missing manifest.json");
        }
        if (extracted.buildId !== expectedBuildId) {
            throw new Error(`downloaded sandbox helper buildId mismatch\n  expected: ${expectedBuildId}\n  got:      ${extracted.buildId ?? "unknown"}\n  source:   ${source.url}`);
        }
        const objectDir = helperObjectDir(storeDir, expectedBuildId);
        const objectsRoot = path.dirname(objectDir);
        fs.mkdirSync(objectsRoot, { recursive: true });
        if (!fs.existsSync(objectDir)) {
            const tmpObjectDir = `${objectDir}.tmp-${randomUUID().slice(0, 8)}`;
            try {
                fs.cpSync(extractDir, tmpObjectDir, { recursive: true });
                for (const name of SANDBOX_HELPER_BINARY_NAMES) {
                    fs.chmodSync(path.join(tmpObjectDir, "bin", name), 0o755);
                }
                fs.renameSync(tmpObjectDir, objectDir);
            }
            catch (error) {
                fs.rmSync(tmpObjectDir, { recursive: true, force: true });
                if (fs.existsSync(objectDir)) {
                    return {
                        ...resolveSandboxHelperDirectory(objectDir, {
                            expectedArch: source.arch,
                            expectedGondolinVersion: source.gondolinVersion,
                            source: "cache",
                        }),
                        source: "download",
                    };
                }
                throw error;
            }
        }
        const resolved = resolveSandboxHelperDirectory(objectDir, {
            expectedArch: source.arch,
            expectedGondolinVersion: source.gondolinVersion,
            source: "cache",
        });
        return { ...resolved, source: "download" };
    }
    finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
}
export async function ensureSandboxHelperBinaries(options) {
    const gondolinVersion = options.gondolinVersion ?? resolveHostPackageVersion();
    const explicitHelpersDir = options.helpersDir ?? process.env.GONDOLIN_SANDBOX_HELPERS_DIR;
    if (explicitHelpersDir && explicitHelpersDir.trim().length > 0) {
        return resolveSandboxHelperDirectory(explicitHelpersDir, {
            expectedArch: options.arch,
            expectedGondolinVersion: gondolinVersion,
            source: "directory",
        });
    }
    const storeDir = options.storeDir ?? getSandboxHelperStoreDirectory();
    const registry = await fetchBuiltinSandboxHelperRegistry(options);
    const ref = options.ref ?? sandboxHelperRefForVersion(gondolinVersion);
    const { buildId, source } = resolveRegistrySourceForRef(registry, ref, options.arch);
    const objectDir = helperObjectDir(storeDir, buildId);
    if (fs.existsSync(objectDir)) {
        return resolveSandboxHelperDirectory(objectDir, {
            expectedArch: options.arch,
            expectedGondolinVersion: gondolinVersion,
            source: "cache",
        });
    }
    options.log?.(`Downloading sandbox helpers for ${options.arch} (${ref})`);
    return importSandboxHelpersFromSource(source, buildId, storeDir);
}
export const __test = {
    parseBuiltinSandboxHelperRegistry,
    parseSandboxHelperManifest,
    parseSandboxHelperRef,
    normalizeArchitecture,
    normalizeHelperBuildId,
};
//# sourceMappingURL=sandbox-helpers.js.map