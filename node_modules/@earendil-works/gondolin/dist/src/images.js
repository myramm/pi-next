import child_process from "child_process";
import { randomUUID, createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { loadAssetManifest, loadGuestAssets } from "./assets.js";
import { getHostNodeArchCached } from "./host/arch.js";
const BUILD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const IMAGE_NAME_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMAGE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BUILTIN_IMAGE_REGISTRY_SCHEMA = 1;
const DEFAULT_IMAGE_REGISTRY_URL = "https://raw.githubusercontent.com/earendil-works/gondolin/main/builtin-image-registry.json";
const DOWNLOAD_SPINNER_FRAMES = [
    "⠋",
    "⠙",
    "⠹",
    "⠸",
    "⠼",
    "⠴",
    "⠦",
    "⠧",
    "⠇",
    "⠏",
];
class ImageResolutionError extends Error {
    /** stable resolution error code */
    code;
    constructor(code, message) {
        super(message);
        this.name = "ImageResolutionError";
        this.code = code;
    }
}
function cacheBaseDir() {
    return process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
}
export function getImageStoreDirectory() {
    return (process.env.GONDOLIN_IMAGE_STORE ??
        path.join(cacheBaseDir(), "gondolin", "images"));
}
function imageObjectRootDir() {
    return path.join(getImageStoreDirectory(), "objects");
}
function imageRefRootDir() {
    return path.join(getImageStoreDirectory(), "refs");
}
function registryCachePath() {
    return path.join(getImageStoreDirectory(), "builtin-image-registry-cache.json");
}
function builtinRegistryUrl() {
    const value = process.env.GONDOLIN_IMAGE_REGISTRY_URL?.trim();
    return value && value.length > 0 ? value : DEFAULT_IMAGE_REGISTRY_URL;
}
function normalizeImageArch(value) {
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
function defaultImageArch() {
    return normalizeImageArch(getHostNodeArchCached()) ?? "x86_64";
}
function ensurePathWithinRoot(root, candidate, label) {
    const resolvedRoot = path.resolve(root);
    const resolvedCandidate = path.resolve(candidate);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(`invalid ${label}: path escapes ${resolvedRoot}`);
    }
    return resolvedCandidate;
}
function validateImageNameSegments(name) {
    const segments = name.split("/");
    if (segments.length === 0) {
        throw new Error(`invalid image name '${name}'`);
    }
    for (const segment of segments) {
        if (segment === "." || segment === ".." || segment.length === 0) {
            throw new Error(`invalid image name '${name}' (must not contain path traversal segments)`);
        }
        if (!IMAGE_NAME_SEGMENT_PATTERN.test(segment)) {
            throw new Error(`invalid image name '${name}' (invalid segment '${segment}')`);
        }
    }
}
function parseImageRef(reference) {
    const trimmed = reference.trim();
    if (!trimmed) {
        throw new Error("image reference must not be empty");
    }
    const colon = trimmed.lastIndexOf(":");
    const hasExplicitTag = colon > 0 && colon < trimmed.length - 1;
    const name = hasExplicitTag ? trimmed.slice(0, colon) : trimmed;
    const tag = hasExplicitTag ? trimmed.slice(colon + 1) : "latest";
    if (!IMAGE_NAME_PATTERN.test(name)) {
        throw new Error(`invalid image name '${name}' (allowed: letters, numbers, '.', '_', '-', '/')`);
    }
    validateImageNameSegments(name);
    if (!IMAGE_TAG_PATTERN.test(tag)) {
        throw new Error(`invalid image tag '${tag}' (allowed: letters, numbers, '.', '_', '-')`);
    }
    return {
        name,
        tag,
        canonical: `${name}:${tag}`,
    };
}
function isBuildId(value) {
    return BUILD_ID_PATTERN.test(value);
}
export function normalizeImageBuildId(buildId) {
    if (!isBuildId(buildId)) {
        throw new Error(`invalid image build id: ${buildId}`);
    }
    return buildId;
}
function detectImageArchFromAssetDir(assetDir) {
    const manifest = loadAssetManifest(assetDir);
    const arch = normalizeImageArch(manifest?.config?.arch);
    if (!arch) {
        throw new Error(`guest assets at ${assetDir} are missing a normalized arch in manifest.config.arch`);
    }
    return arch;
}
export function getImageObjectDirectory(buildId) {
    const canonicalBuildId = normalizeImageBuildId(buildId);
    return path.join(imageObjectRootDir(), canonicalBuildId);
}
function ensureImageObjectExists(buildId) {
    const canonicalBuildId = normalizeImageBuildId(buildId);
    const objectDir = getImageObjectDirectory(canonicalBuildId);
    if (!fs.existsSync(objectDir)) {
        throw new ImageResolutionError("object_not_found", `image object not found for buildId ${canonicalBuildId} (expected ${objectDir})`);
    }
    loadGuestAssets(objectDir);
    return objectDir;
}
function resolveContainedAssetPath(baseDir, assetPath, fieldName) {
    if (typeof assetPath !== "string" || assetPath.trim().length === 0) {
        throw new Error(`invalid ${fieldName}: expected non-empty string`);
    }
    if (path.isAbsolute(assetPath)) {
        throw new Error(`invalid ${fieldName}: absolute paths are not allowed`);
    }
    const resolvedPath = path.resolve(baseDir, assetPath);
    const relative = path.relative(baseDir, resolvedPath);
    if (relative.length === 0 ||
        relative === "." ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(`invalid ${fieldName}: path must stay within ${baseDir} (got '${assetPath}')`);
    }
    return resolvedPath;
}
function ensureSafeImportSourcePath(rootDir, sourcePath, fieldName) {
    const realSourcePath = fs.realpathSync(sourcePath);
    const resolvedRootDir = fs.realpathSync(rootDir);
    const relative = path.relative(resolvedRootDir, realSourcePath);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(`invalid ${fieldName}: resolved path escapes ${resolvedRootDir} (${realSourcePath})`);
    }
    const stat = fs.statSync(realSourcePath);
    if (!stat.isFile()) {
        throw new Error(`invalid ${fieldName}: expected regular file at ${realSourcePath}`);
    }
    return realSourcePath;
}
export function importImageFromDirectory(assetDir) {
    const resolvedDir = path.resolve(assetDir);
    const manifest = loadAssetManifest(resolvedDir);
    if (!manifest?.buildId) {
        throw new Error(`guest assets at ${resolvedDir} are missing manifest buildId (cannot import image)`);
    }
    const buildId = normalizeImageBuildId(manifest.buildId);
    const arch = normalizeImageArch(manifest.config?.arch);
    if (!arch) {
        throw new Error(`guest assets at ${resolvedDir} are missing a normalized arch in manifest.config.arch`);
    }
    const objectDir = getImageObjectDirectory(buildId);
    let created = false;
    if (!fs.existsSync(objectDir)) {
        created = true;
        const tmpDir = path.join(imageObjectRootDir(), `.tmp-${buildId}-${randomUUID().slice(0, 8)}`);
        let finalized = false;
        try {
            fs.mkdirSync(tmpDir, { recursive: true });
            const manifestPath = path.join(resolvedDir, "manifest.json");
            fs.copyFileSync(manifestPath, path.join(tmpDir, "manifest.json"));
            const sourceKernelPath = resolveContainedAssetPath(resolvedDir, manifest.assets?.kernel, "manifest.assets.kernel");
            const sourceInitramfsPath = resolveContainedAssetPath(resolvedDir, manifest.assets?.initramfs, "manifest.assets.initramfs");
            const sourceRootfsPath = resolveContainedAssetPath(resolvedDir, manifest.assets?.rootfs, "manifest.assets.rootfs");
            const sourceKrunKernelPath = manifest.assets?.krunKernel === undefined
                ? undefined
                : resolveContainedAssetPath(resolvedDir, manifest.assets.krunKernel, "manifest.assets.krunKernel");
            const sourceKrunInitrdPath = manifest.assets?.krunInitrd === undefined
                ? undefined
                : resolveContainedAssetPath(resolvedDir, manifest.assets.krunInitrd, "manifest.assets.krunInitrd");
            if (!fs.existsSync(sourceKernelPath)) {
                throw new Error(`missing manifest.assets.kernel file at ${sourceKernelPath}`);
            }
            if (!fs.existsSync(sourceInitramfsPath)) {
                throw new Error(`missing manifest.assets.initramfs file at ${sourceInitramfsPath}`);
            }
            if (!fs.existsSync(sourceRootfsPath)) {
                throw new Error(`missing manifest.assets.rootfs file at ${sourceRootfsPath}`);
            }
            if (sourceKrunKernelPath && !fs.existsSync(sourceKrunKernelPath)) {
                throw new Error(`missing manifest.assets.krunKernel file at ${sourceKrunKernelPath}`);
            }
            if (sourceKrunInitrdPath && !fs.existsSync(sourceKrunInitrdPath)) {
                throw new Error(`missing manifest.assets.krunInitrd file at ${sourceKrunInitrdPath}`);
            }
            const safeKernelPath = ensureSafeImportSourcePath(resolvedDir, sourceKernelPath, "manifest.assets.kernel");
            const safeInitramfsPath = ensureSafeImportSourcePath(resolvedDir, sourceInitramfsPath, "manifest.assets.initramfs");
            const safeRootfsPath = ensureSafeImportSourcePath(resolvedDir, sourceRootfsPath, "manifest.assets.rootfs");
            const targetKernelPath = resolveContainedAssetPath(tmpDir, manifest.assets?.kernel, "manifest.assets.kernel");
            const targetInitramfsPath = resolveContainedAssetPath(tmpDir, manifest.assets?.initramfs, "manifest.assets.initramfs");
            const targetRootfsPath = resolveContainedAssetPath(tmpDir, manifest.assets?.rootfs, "manifest.assets.rootfs");
            const targetKrunKernelPath = sourceKrunKernelPath === undefined
                ? undefined
                : resolveContainedAssetPath(tmpDir, manifest.assets.krunKernel, "manifest.assets.krunKernel");
            const targetKrunInitrdPath = sourceKrunInitrdPath === undefined
                ? undefined
                : resolveContainedAssetPath(tmpDir, manifest.assets.krunInitrd, "manifest.assets.krunInitrd");
            fs.mkdirSync(path.dirname(targetKernelPath), {
                recursive: true,
            });
            fs.mkdirSync(path.dirname(targetInitramfsPath), {
                recursive: true,
            });
            fs.mkdirSync(path.dirname(targetRootfsPath), {
                recursive: true,
            });
            if (targetKrunKernelPath) {
                fs.mkdirSync(path.dirname(targetKrunKernelPath), { recursive: true });
            }
            if (targetKrunInitrdPath) {
                fs.mkdirSync(path.dirname(targetKrunInitrdPath), { recursive: true });
            }
            fs.copyFileSync(safeKernelPath, targetKernelPath);
            fs.copyFileSync(safeInitramfsPath, targetInitramfsPath);
            fs.copyFileSync(safeRootfsPath, targetRootfsPath);
            if (targetKrunKernelPath && sourceKrunKernelPath) {
                const safeKrunKernelPath = ensureSafeImportSourcePath(resolvedDir, sourceKrunKernelPath, "manifest.assets.krunKernel");
                fs.copyFileSync(safeKrunKernelPath, targetKrunKernelPath);
            }
            if (targetKrunInitrdPath && sourceKrunInitrdPath) {
                const safeKrunInitrdPath = ensureSafeImportSourcePath(resolvedDir, sourceKrunInitrdPath, "manifest.assets.krunInitrd");
                fs.copyFileSync(safeKrunInitrdPath, targetKrunInitrdPath);
            }
            fs.mkdirSync(imageObjectRootDir(), { recursive: true });
            try {
                fs.renameSync(tmpDir, objectDir);
                finalized = true;
            }
            catch (err) {
                const code = err.code;
                if (code !== "EEXIST" && code !== "ENOTEMPTY") {
                    throw err;
                }
                // Handle races where another process imported the same build concurrently.
                created = false;
            }
        }
        finally {
            if (!finalized) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        }
    }
    loadGuestAssets(objectDir);
    return {
        buildId,
        arch,
        assetDir: objectDir,
        created,
    };
}
function symlinkTargetForRef(reference, arch) {
    const parsed = parseImageRef(reference);
    const refsRoot = imageRefRootDir();
    const linkPath = path.resolve(refsRoot, parsed.name, parsed.tag, arch);
    return ensurePathWithinRoot(refsRoot, linkPath, `image ref '${reference}'`);
}
function writeRefSymlink(reference, arch, objectDir) {
    const linkPath = symlinkTargetForRef(reference, arch);
    const linkDir = path.dirname(linkPath);
    fs.mkdirSync(linkDir, { recursive: true });
    const relativeTarget = path.relative(linkDir, objectDir) || ".";
    const tmpPath = `${linkPath}.tmp-${randomUUID().slice(0, 8)}`;
    fs.symlinkSync(relativeTarget, tmpPath, "dir");
    try {
        fs.renameSync(tmpPath, linkPath);
    }
    catch (error) {
        fs.rmSync(tmpPath, { force: true });
        throw error;
    }
}
function readBuildIdFromRefSymlink(linkPath) {
    const stat = fs.lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
        throw new Error(`invalid image ref link: ${linkPath} is not a symlink`);
    }
    const target = fs.readlinkSync(linkPath);
    const objectDir = path.resolve(path.dirname(linkPath), target);
    const manifest = loadAssetManifest(objectDir);
    if (!manifest?.buildId) {
        throw new Error(`image ref points to object without manifest buildId: ${linkPath} -> ${objectDir}`);
    }
    normalizeImageBuildId(manifest.buildId);
    loadGuestAssets(objectDir);
    return manifest.buildId;
}
function readLocalRefTargets(reference) {
    const parsed = parseImageRef(reference);
    const targets = {};
    let newestMtime = 0;
    for (const arch of ["aarch64", "x86_64"]) {
        const linkPath = symlinkTargetForRef(parsed.canonical, arch);
        if (!fs.existsSync(linkPath))
            continue;
        const stat = fs.lstatSync(linkPath);
        newestMtime = Math.max(newestMtime, stat.mtimeMs);
        targets[arch] = readBuildIdFromRefSymlink(linkPath);
    }
    const updatedAt = newestMtime > 0
        ? new Date(newestMtime).toISOString()
        : new Date(0).toISOString();
    return { targets, updatedAt };
}
export function setImageRef(reference, buildId, arch) {
    const normalizedArch = normalizeImageArch(arch);
    if (!normalizedArch) {
        throw new Error(`invalid image arch: ${arch}`);
    }
    const objectDir = ensureImageObjectExists(buildId);
    const detectedArch = detectImageArchFromAssetDir(objectDir);
    if (detectedArch !== normalizedArch) {
        throw new Error(`image object arch mismatch for ${buildId}: requested ${normalizedArch}, object is ${detectedArch}`);
    }
    const parsedRef = parseImageRef(reference);
    writeRefSymlink(parsedRef.canonical, normalizedArch, objectDir);
    const { targets, updatedAt } = readLocalRefTargets(parsedRef.canonical);
    return {
        reference: parsedRef.canonical,
        targets,
        updatedAt,
    };
}
function collectRefSymlinkEntries(root) {
    if (!fs.existsSync(root))
        return [];
    const entries = [];
    const queue = [root];
    while (queue.length > 0) {
        const dir = queue.pop();
        const dirEntries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of dirEntries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                queue.push(full);
                continue;
            }
            const normalizedArch = normalizeImageArch(entry.name);
            if (!normalizedArch)
                continue;
            const stat = fs.lstatSync(full);
            if (!stat.isSymbolicLink())
                continue;
            const rel = path.relative(root, full);
            const parts = rel.split(path.sep);
            if (parts.length < 3)
                continue;
            const tag = parts[parts.length - 2];
            const name = parts.slice(0, parts.length - 2).join("/");
            if (!name || !tag)
                continue;
            try {
                const parsed = parseImageRef(`${name}:${tag}`);
                entries.push({
                    reference: parsed.canonical,
                    arch: normalizedArch,
                    updatedAtMs: stat.mtimeMs,
                });
            }
            catch {
                // ignore invalid ref path entries
            }
        }
    }
    return entries;
}
export function listImageRefs() {
    const root = imageRefRootDir();
    const symlinkEntries = collectRefSymlinkEntries(root);
    const refs = new Map();
    for (const entry of symlinkEntries) {
        let current = refs.get(entry.reference);
        if (!current) {
            current = { targets: {}, updatedAtMs: 0 };
            refs.set(entry.reference, current);
        }
        try {
            const linkPath = symlinkTargetForRef(entry.reference, entry.arch);
            current.targets[entry.arch] = readBuildIdFromRefSymlink(linkPath);
            current.updatedAtMs = Math.max(current.updatedAtMs, entry.updatedAtMs);
        }
        catch {
            // Ignore broken ref links in listing output.
        }
    }
    return Array.from(refs.entries())
        .map(([reference, entry]) => ({
        reference,
        targets: entry.targets,
        updatedAt: new Date(entry.updatedAtMs || 0).toISOString(),
    }))
        .sort((a, b) => a.reference.localeCompare(b.reference));
}
function resolveBuildIdFromRef(reference, arch) {
    const parsedRef = parseImageRef(reference);
    const local = readLocalRefTargets(parsedRef.canonical);
    const requestedArch = normalizeImageArch(arch) ?? defaultImageArch();
    const exact = local.targets[requestedArch];
    if (exact) {
        return { buildId: exact, arch: requestedArch };
    }
    const available = Object.entries(local.targets).filter((pair) => {
        const [name, value] = pair;
        return normalizeImageArch(name) !== null && typeof value === "string";
    });
    if (available.length === 1) {
        const [fallbackArch, fallbackBuildId] = available[0];
        return {
            buildId: fallbackBuildId,
            arch: fallbackArch,
        };
    }
    if (available.length === 0) {
        throw new ImageResolutionError("ref_not_found", `image ref not found: ${parsedRef.canonical}`);
    }
    const availableArchs = available.map(([name]) => name).join(", ") || "none";
    throw new ImageResolutionError("ref_arch_not_found", `image ref '${parsedRef.canonical}' has no target for ${requestedArch} (available: ${availableArchs})`);
}
function resolvePathSelector(selector) {
    const resolved = path.resolve(selector);
    if (!fs.existsSync(resolved)) {
        return null;
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
        throw new Error(`image selector path is not a directory: ${resolved}`);
    }
    return resolved;
}
export function resolveImageSelector(selector, arch) {
    const trimmed = selector.trim();
    if (!trimmed) {
        throw new Error("image selector must not be empty");
    }
    const pathSelector = resolvePathSelector(trimmed);
    if (pathSelector) {
        loadGuestAssets(pathSelector);
        const manifest = loadAssetManifest(pathSelector);
        const resolvedArch = normalizeImageArch(manifest?.config?.arch) ?? undefined;
        return {
            source: "path",
            selector: pathSelector,
            assetDir: pathSelector,
            buildId: manifest?.buildId,
            arch: resolvedArch,
        };
    }
    if (isBuildId(trimmed)) {
        const buildId = normalizeImageBuildId(trimmed);
        const assetDir = ensureImageObjectExists(buildId);
        return {
            source: "build-id",
            selector: buildId,
            assetDir,
            buildId,
            arch: detectImageArchFromAssetDir(assetDir),
        };
    }
    const resolved = resolveBuildIdFromRef(trimmed, arch);
    const assetDir = ensureImageObjectExists(resolved.buildId);
    return {
        source: "ref",
        selector: parseImageRef(trimmed).canonical,
        assetDir,
        buildId: resolved.buildId,
        arch: resolved.arch,
    };
}
function parseRegistrySource(value, where, baseUrl) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`invalid ${where}: expected object`);
    }
    const rec = value;
    if (typeof rec.url !== "string" || rec.url.length === 0) {
        throw new Error(`invalid ${where}.url: expected non-empty string`);
    }
    const out = {
        url: new URL(rec.url, baseUrl).toString(),
    };
    if (rec.sha256 !== undefined) {
        if (typeof rec.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(rec.sha256)) {
            throw new Error(`invalid ${where}.sha256: expected 64-char lowercase hex`);
        }
        out.sha256 = rec.sha256;
    }
    if (rec.arch !== undefined) {
        if (typeof rec.arch !== "string") {
            throw new Error(`invalid ${where}.arch: expected string`);
        }
        const arch = normalizeImageArch(rec.arch);
        if (!arch) {
            throw new Error(`invalid ${where}.arch: ${String(rec.arch)}`);
        }
        out.arch = arch;
    }
    return out;
}
function parseBuiltinRegistry(raw, sourceUrl) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("invalid builtin image registry: expected object");
    }
    const rec = raw;
    if (rec.schema !== BUILTIN_IMAGE_REGISTRY_SCHEMA) {
        throw new Error(`invalid builtin image registry schema: expected ${BUILTIN_IMAGE_REGISTRY_SCHEMA}`);
    }
    const baseUrl = new URL(sourceUrl);
    if (!rec.builds ||
        typeof rec.builds !== "object" ||
        Array.isArray(rec.builds)) {
        throw new Error("invalid builtin image registry: builds must be an object");
    }
    const builds = {};
    for (const [buildId, value] of Object.entries(rec.builds)) {
        const canonical = normalizeImageBuildId(buildId);
        const source = parseRegistrySource(value, `builds['${buildId}']`, baseUrl);
        builds[canonical] = source;
    }
    if (!rec.refs || typeof rec.refs !== "object" || Array.isArray(rec.refs)) {
        throw new Error("invalid builtin image registry: refs must be an object");
    }
    const refs = {};
    for (const [reference, archMap] of Object.entries(rec.refs)) {
        const parsedRef = parseImageRef(reference);
        if (parsedRef.canonical !== reference) {
            throw new Error(`invalid builtin image registry ref key: ${reference}`);
        }
        if (!archMap || typeof archMap !== "object" || Array.isArray(archMap)) {
            throw new Error(`invalid registry ref '${reference}': expected object`);
        }
        const mapped = {};
        for (const [archKey, value] of Object.entries(archMap)) {
            const arch = normalizeImageArch(archKey);
            if (!arch) {
                throw new Error(`invalid registry ref '${reference}' arch key: ${archKey}`);
            }
            if (typeof value !== "string") {
                throw new Error(`invalid refs['${reference}']['${archKey}']: expected build id string`);
            }
            const buildId = normalizeImageBuildId(value);
            const buildSource = builds[buildId];
            if (!buildSource) {
                throw new Error(`invalid refs['${reference}']['${archKey}']: unknown build id ${buildId}`);
            }
            if (buildSource.arch && buildSource.arch !== arch) {
                throw new Error(`invalid refs['${reference}']['${archKey}']: arch ${arch} does not match build arch ${buildSource.arch}`);
            }
            mapped[arch] = buildId;
        }
        refs[parsedRef.canonical] = mapped;
    }
    return {
        schema: BUILTIN_IMAGE_REGISTRY_SCHEMA,
        refs,
        builds,
    };
}
function loadRegistryCache(url) {
    const cachePath = registryCachePath();
    if (!fs.existsSync(cachePath)) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (!parsed || typeof parsed !== "object")
            return null;
        if (parsed.url !== url)
            return null;
        const registry = parseBuiltinRegistry(parsed.registry, url);
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
function saveRegistryCache(cache) {
    const storeDir = getImageStoreDirectory();
    fs.mkdirSync(storeDir, { recursive: true });
    const cachePath = registryCachePath();
    const tmpPath = `${cachePath}.tmp-${randomUUID().slice(0, 8)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(cache, null, 2));
    fs.renameSync(tmpPath, cachePath);
}
function formatProgressBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    if (unit === 0) {
        return `${Math.round(value)}${units[unit]}`;
    }
    if (value >= 100) {
        return `${value.toFixed(0)}${units[unit]}`;
    }
    if (value >= 10) {
        return `${value.toFixed(1)}${units[unit]}`;
    }
    return `${value.toFixed(2)}${units[unit]}`;
}
function formatProgressDuration(totalMs) {
    if (totalMs < 1000) {
        return `${Math.max(1, Math.round(totalMs))}ms`;
    }
    const totalSeconds = Math.max(1, Math.round(totalMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
        return `${minutes}m${seconds}s`;
    }
    return `${seconds}s`;
}
function truncateProgressLine(line) {
    const columns = process.stderr.columns;
    if (!columns || columns < 8) {
        return line;
    }
    if (line.length <= columns - 1) {
        return line;
    }
    return `${line.slice(0, Math.max(1, columns - 2))}…`;
}
function createDownloadProgress(label, totalBytes) {
    const isTty = Boolean(process.stderr.isTTY) && process.env.CI !== "true";
    if (!isTty) {
        return {
            addChunk() { },
            finish() { },
            fail() { },
        };
    }
    const startedAt = Date.now();
    let downloadedBytes = 0;
    let frame = 0;
    let interval = null;
    let finished = false;
    const details = (elapsedMs) => {
        if (!totalBytes || totalBytes <= 0) {
            return {
                progress: formatProgressBytes(downloadedBytes),
            };
        }
        const progress = `${formatProgressBytes(downloadedBytes)}/${formatProgressBytes(totalBytes)}`;
        const elapsedSeconds = Math.max(elapsedMs / 1000, 0.001);
        const speedBytesPerSecond = downloadedBytes / elapsedSeconds;
        if (downloadedBytes <= 0 || speedBytesPerSecond <= 0) {
            return { progress };
        }
        const remainingBytes = Math.max(0, totalBytes - downloadedBytes);
        const etaSeconds = remainingBytes / speedBytesPerSecond;
        return {
            progress,
            eta: formatProgressDuration(etaSeconds * 1000),
        };
    };
    const render = (line, final = false) => {
        process.stderr.write(`\r\x1b[2K${truncateProgressLine(line)}`);
        if (final) {
            process.stderr.write("\n");
        }
    };
    interval = setInterval(() => {
        const spinner = DOWNLOAD_SPINNER_FRAMES[frame % DOWNLOAD_SPINNER_FRAMES.length];
        frame += 1;
        const elapsedMs = Date.now() - startedAt;
        const info = details(elapsedMs);
        const etaSuffix = info.eta ? `, eta ${info.eta}` : "";
        render(`${spinner} downloading ${label} ${info.progress}${etaSuffix}`);
    }, 250);
    interval.unref();
    return {
        addChunk(chunkBytes) {
            downloadedBytes += chunkBytes;
        },
        finish() {
            if (finished)
                return;
            finished = true;
            if (interval) {
                clearInterval(interval);
            }
            const elapsed = formatProgressDuration(Date.now() - startedAt);
            const progress = totalBytes
                ? `${formatProgressBytes(totalBytes)}/${formatProgressBytes(totalBytes)}`
                : formatProgressBytes(downloadedBytes);
            render(`✓ downloaded ${label} ${progress} in ${elapsed}`, true);
        },
        fail() {
            if (finished)
                return;
            finished = true;
            if (interval) {
                clearInterval(interval);
            }
            const elapsed = formatProgressDuration(Date.now() - startedAt);
            render(`✗ failed downloading ${label} after ${elapsed}`, true);
        },
    };
}
async function fetchBuiltinImageRegistry() {
    const url = builtinRegistryUrl();
    const cached = loadRegistryCache(url);
    const headers = {
        "User-Agent": "gondolin-image-registry",
    };
    if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
    }
    let response;
    try {
        response = await fetch(url, { headers });
    }
    catch (error) {
        if (cached) {
            return cached.registry;
        }
        throw new Error(`failed to fetch builtin image registry from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 304 && cached) {
        return cached.registry;
    }
    if (!response.ok) {
        if (cached) {
            return cached.registry;
        }
        throw new Error(`failed to fetch builtin image registry: ${response.status} ${response.statusText} (${url})`);
    }
    const text = await response.text();
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        throw new Error(`failed to parse builtin image registry json from ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const registry = parseBuiltinRegistry(raw, url);
    saveRegistryCache({
        url,
        etag: response.headers.get("etag") ?? undefined,
        registry,
    });
    return registry;
}
async function downloadArchive(source, archivePath, progressLabel) {
    const response = await fetch(source.url, {
        headers: {
            "User-Agent": "gondolin-image-fetch",
        },
    });
    if (!response.ok || !response.body) {
        throw new Error(`failed to download image archive: ${response.status} ${response.statusText} (${source.url})`);
    }
    const rawContentLength = response.headers.get("content-length");
    const totalBytes = rawContentLength && /^\d+$/.test(rawContentLength)
        ? Number.parseInt(rawContentLength, 10)
        : null;
    const progress = createDownloadProgress(progressLabel, totalBytes);
    const hash = createHash("sha256");
    const stream = fs.createWriteStream(archivePath, { flags: "w" });
    try {
        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            hash.update(value);
            const chunk = Buffer.from(value);
            progress.addChunk(chunk.length);
            await new Promise((resolve, reject) => {
                stream.write(chunk, (error) => {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        }
        await new Promise((resolve, reject) => {
            stream.end((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
        if (source.sha256) {
            const got = hash.digest("hex");
            if (got !== source.sha256) {
                throw new Error(`downloaded image checksum mismatch for ${source.url}\n  expected: ${source.sha256}\n  got:      ${got}`);
            }
        }
        progress.finish();
    }
    catch (error) {
        progress.fail();
        throw error;
    }
    finally {
        stream.destroy();
    }
}
async function importImageFromSource(source, expectedBuildId, progressLabel = "image") {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gondolin-image-pull-"));
    const archivePath = path.join(tmpRoot, "image.tar.gz");
    const extractDir = path.join(tmpRoot, "extract");
    try {
        await downloadArchive(source, archivePath, progressLabel);
        fs.mkdirSync(extractDir, { recursive: true });
        child_process.execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], {
            stdio: "pipe",
        });
        const imported = importImageFromDirectory(extractDir);
        if (source.arch && imported.arch !== source.arch) {
            throw new Error(`downloaded image arch mismatch\n  expected: ${source.arch}\n  got:      ${imported.arch}\n  source:   ${source.url}`);
        }
        if (expectedBuildId && imported.buildId !== expectedBuildId) {
            throw new Error(`downloaded image buildId mismatch\n  expected: ${expectedBuildId}\n  got:      ${imported.buildId}\n  source:   ${source.url}`);
        }
        return imported;
    }
    finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
}
function resolveRegistrySourceForRef(registry, reference, arch) {
    const parsedRef = parseImageRef(reference);
    const entries = registry.refs[parsedRef.canonical];
    if (!entries) {
        throw new Error(`image ref not found in builtin registry: ${parsedRef.canonical}`);
    }
    const requestedArch = normalizeImageArch(arch) ?? defaultImageArch();
    const exactBuildId = entries[requestedArch];
    if (exactBuildId) {
        return {
            buildId: exactBuildId,
            resolvedArch: requestedArch,
        };
    }
    const available = Object.entries(entries).filter((pair) => {
        const [name, value] = pair;
        return normalizeImageArch(name) !== null && typeof value === "string";
    });
    if (available.length === 1) {
        const [resolvedArch, buildId] = available[0];
        return {
            buildId,
            resolvedArch,
        };
    }
    const availableArchs = available.map(([name]) => name).join(", ") || "none";
    throw new Error(`image ref '${parsedRef.canonical}' has no registry source for ${requestedArch} (available: ${availableArchs})`);
}
function isExpectedLocalImageMiss(error) {
    if (!(error instanceof ImageResolutionError)) {
        return false;
    }
    return (error.code === "object_not_found" ||
        error.code === "ref_not_found" ||
        error.code === "ref_arch_not_found");
}
export async function ensureImageSelector(selector, arch) {
    const trimmed = selector.trim();
    if (!trimmed) {
        throw new Error("image selector must not be empty");
    }
    const absoluteSelectorPath = path.resolve(trimmed);
    if (fs.existsSync(absoluteSelectorPath)) {
        const stat = fs.statSync(absoluteSelectorPath);
        if (!stat.isDirectory()) {
            throw new Error(`image selector path is not a directory: ${absoluteSelectorPath}`);
        }
    }
    try {
        return resolveImageSelector(selector, arch);
    }
    catch (error) {
        if (!isExpectedLocalImageMiss(error)) {
            throw error;
        }
    }
    const registry = await fetchBuiltinImageRegistry();
    if (isBuildId(trimmed)) {
        const buildId = normalizeImageBuildId(trimmed);
        const source = registry.builds[buildId];
        if (!source) {
            throw new Error(`image build id not found in builtin registry builds metadata: ${buildId}`);
        }
        await importImageFromSource(source, buildId, buildId);
        return resolveImageSelector(buildId, arch);
    }
    const parsedRef = parseImageRef(trimmed);
    const { buildId, resolvedArch } = resolveRegistrySourceForRef(registry, parsedRef.canonical, arch);
    const source = registry.builds[buildId];
    if (!source) {
        throw new Error(`image ref '${parsedRef.canonical}' points to unknown registry build id: ${buildId}`);
    }
    const imported = await importImageFromSource(source, buildId, parsedRef.canonical);
    if (imported.arch !== resolvedArch) {
        throw new Error(`registry ref '${parsedRef.canonical}' (${resolvedArch}) resolved to ${imported.arch}`);
    }
    setImageRef(parsedRef.canonical, imported.buildId, imported.arch);
    return resolveImageSelector(parsedRef.canonical, arch);
}
export function tagImage(source, targetReference, arch) {
    const resolved = resolveImageSelector(source, arch);
    if (!resolved.buildId) {
        throw new Error(`image selector '${source}' does not have a buildId (expected manifest buildId)`);
    }
    const resolvedArch = normalizeImageArch(arch) ??
        resolved.arch ??
        detectImageArchFromAssetDir(resolved.assetDir);
    return setImageRef(targetReference, resolved.buildId, resolvedArch);
}
export const __test = {
    parseImageRef,
    normalizeImageArch,
    isBuildId,
    normalizeImageBuildId,
    parseBuiltinRegistry,
};
//# sourceMappingURL=images.js.map