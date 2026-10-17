import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
export function exportOciRootfs(opts) {
    const runtime = detectOciRuntime(opts.runtime);
    const platform = opts.platform ?? getOciPlatform(opts.arch);
    const pullPolicy = opts.pullPolicy ?? "if-not-present";
    if (pullPolicy === "always") {
        pullOciImage(runtime, opts.image, platform, opts.log);
    }
    else {
        const hasImage = hasLocalOciImage(runtime, opts.image, platform);
        if (!hasImage && pullPolicy === "never") {
            throw new Error(`OCI image '${opts.image}' is not available locally for platform '${platform}' and pullPolicy is 'never'`);
        }
        if (!hasImage) {
            pullOciImage(runtime, opts.image, platform, opts.log);
        }
    }
    const resolvedDigest = resolveLocalOciImageDigest(runtime, opts.image);
    opts.log(`Resolved OCI image ${opts.image} -> ${resolvedDigest.reference}`);
    const containerId = createOciExportContainer(runtime, opts.image, platform, pullPolicy, opts.log);
    const exportTar = path.join(opts.workDir, "oci-rootfs.tar");
    try {
        runContainerCommand(runtime, ["export", containerId, "-o", exportTar]);
        const ownershipEntries = readTarOwnershipEntries(exportTar);
        opts.ownershipSink?.(ownershipEntries);
        extractTarFile(exportTar, opts.targetDir);
    }
    finally {
        try {
            runContainerCommand(runtime, ["rm", "-f", containerId]);
        }
        catch {
            // Best effort cleanup.
        }
        fs.rmSync(exportTar, { force: true });
    }
    return {
        image: opts.image,
        runtime,
        platform,
        pullPolicy,
        digest: resolvedDigest.digest,
        reference: resolvedDigest.reference,
    };
}
function getOciPlatform(arch) {
    return arch === "x86_64" ? "linux/amd64" : "linux/arm64";
}
function detectOciRuntime(preferred) {
    if (preferred) {
        if (!hasContainerRuntime(preferred)) {
            throw new Error(`Container runtime '${preferred}' is required for OCI rootfs builds but was not found on PATH`);
        }
        return preferred;
    }
    for (const runtime of ["docker", "podman"]) {
        if (hasContainerRuntime(runtime)) {
            return runtime;
        }
    }
    throw new Error("OCI rootfs builds require Docker or Podman to pull and export the image");
}
function hasContainerRuntime(runtime) {
    try {
        execFileSync(runtime, ["--version"], { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
export function hasLocalOciImage(runtime, image, platform) {
    let output;
    try {
        output = runContainerCommand(runtime, buildOciCreateArgs(image, platform, "never"));
    }
    catch (err) {
        if (isMissingLocalOciImageError(err)) {
            return false;
        }
        throw err;
    }
    const containerId = parseContainerId(output);
    if (!containerId) {
        throw new Error(`Failed to parse container id from ${runtime} create output for '${image}'`);
    }
    try {
        runContainerCommand(runtime, ["rm", "-f", containerId]);
    }
    catch {
        // Best effort cleanup.
    }
    return true;
}
function pullOciImage(runtime, image, platform, log) {
    log(`Pulling OCI image ${image} (${platform}) with ${runtime}`);
    runContainerCommand(runtime, ["pull", "--platform", platform, image]);
}
function createOciExportContainer(runtime, image, platform, pullPolicy, log) {
    log(`Creating OCI export container from ${image}`);
    const output = runContainerCommand(runtime, buildOciCreateArgs(image, platform, pullPolicy));
    const id = parseContainerId(output);
    if (!id) {
        throw new Error(`Failed to create OCI export container for '${image}'`);
    }
    return id;
}
export function buildOciCreateArgs(image, platform, pullPolicy) {
    const args = ["create", "--platform", platform];
    if (pullPolicy === "never") {
        args.push("--pull=never");
    }
    args.push(image, "true");
    return args;
}
function parseContainerId(output) {
    const id = output.trim().split(/\s+/)[0];
    return id || null;
}
export function resolveLocalOciImageDigest(runtime, image) {
    const digestFromRef = extractDigestFromImageReference(image);
    if (digestFromRef) {
        return {
            reference: image,
            digest: digestFromRef,
        };
    }
    let output;
    try {
        output = runContainerCommand(runtime, [
            "image",
            "inspect",
            image,
            "--format",
            "{{json .RepoDigests}}",
        ]);
    }
    catch (err) {
        throw new Error(`Failed to resolve OCI digest metadata for '${image}': ${String(err)}`);
    }
    const digests = parseRepoDigestsOutput(output);
    if (digests.length > 0) {
        const preferredDigest = pickRepoDigestReference(image, digests) ?? digests[0];
        const digest = extractDigestFromImageReference(preferredDigest);
        if (!digest) {
            throw new Error(`Failed to resolve OCI digest metadata for '${image}': invalid RepoDigest '${preferredDigest}'`);
        }
        return {
            reference: preferredDigest,
            digest,
        };
    }
    // Some runtimes/local image states don't populate RepoDigests for tag references
    // (for instance imported/tagged images). Fall back to the local image id digest.
    const localDigest = resolveLocalOciImageIdDigest(runtime, image);
    if (localDigest) {
        return {
            reference: `${normalizeImageRepository(image)}@${localDigest}`,
            digest: localDigest,
        };
    }
    throw new Error(`Failed to resolve OCI digest metadata for '${image}': runtime did not report RepoDigests`);
}
function parseRepoDigestsOutput(output) {
    try {
        const parsed = JSON.parse(output.trim());
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((entry) => typeof entry === "string" && entry.includes("@sha256:"));
    }
    catch {
        return [];
    }
}
function resolveLocalOciImageIdDigest(runtime, image) {
    let output;
    try {
        output = runContainerCommand(runtime, [
            "image",
            "inspect",
            image,
            "--format",
            "{{.Id}}",
        ]);
    }
    catch {
        return null;
    }
    const match = output.match(/sha256:[a-fA-F0-9]{64}/);
    if (!match) {
        return null;
    }
    return match[0].toLowerCase();
}
function pickRepoDigestReference(requestedImage, digests) {
    const requestedRepo = normalizeImageRepository(requestedImage);
    for (const digestRef of digests) {
        const digestRepo = normalizeImageRepository(digestRef);
        if (digestRepo === requestedRepo) {
            return digestRef;
        }
        if (digestRepo.endsWith(`/${requestedRepo}`)) {
            return digestRef;
        }
    }
    return null;
}
function normalizeImageRepository(image) {
    let value = image;
    const at = value.indexOf("@");
    if (at !== -1) {
        value = value.slice(0, at);
    }
    const slash = value.lastIndexOf("/");
    const colon = value.lastIndexOf(":");
    if (colon > slash) {
        value = value.slice(0, colon);
    }
    return value;
}
function extractDigestFromImageReference(imageRef) {
    const match = imageRef.match(/@?(sha256:[a-fA-F0-9]{64})$/);
    if (!match) {
        return null;
    }
    return match[1].toLowerCase();
}
class ContainerCommandError extends Error {
    status;
    stdout;
    stderr;
    runtime;
    args;
    constructor(runtime, args, status, stdout, stderr) {
        super(`Container command failed: ${runtime} ${args.join(" ")}\n` +
            `exit: ${status}\n` +
            (stdout || stderr ? `${stdout}${stderr}` : ""));
        this.name = "ContainerCommandError";
        this.status = status;
        this.stdout = stdout;
        this.stderr = stderr;
        this.runtime = runtime;
        this.args = [...args];
    }
}
const CONTAINER_COMMAND_MAX_BUFFER = 64 * 1024 * 1024;
function runContainerCommand(runtime, args) {
    try {
        return execFileSync(runtime, args, {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            maxBuffer: CONTAINER_COMMAND_MAX_BUFFER,
        });
    }
    catch (err) {
        const e = err;
        const status = String(e.status ?? "?");
        const stdout = commandOutputToString(e.stdout);
        const stderr = commandOutputToString(e.stderr);
        throw new ContainerCommandError(runtime, args, status, stdout, stderr);
    }
}
function isMissingLocalOciImageError(err) {
    if (!(err instanceof ContainerCommandError)) {
        return false;
    }
    // docker/podman commonly return status 125 for create-time failures.
    if (err.status !== "125" && err.status !== "1") {
        return false;
    }
    const detail = `${err.stderr}\n${err.stdout}`.toLowerCase();
    // This is pretty brittle but there does not seem to be a better way
    return (detail.includes("image not known") ||
        detail.includes("no such image") ||
        detail.includes("manifest unknown") ||
        detail.includes("pull access denied") ||
        detail.includes("not available locally") ||
        detail.includes("does not match the specified platform") ||
        detail.includes("does not match the expected platform") ||
        detail.includes("requested platform not available locally"));
}
function commandOutputToString(value) {
    if (typeof value === "string") {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("utf8");
    }
    return "";
}
const TAR_BLOCK_SIZE = 512;
const TAR_TYPE_PAX_LOCAL = 0x78;
const TAR_TYPE_PAX_GLOBAL = 0x67;
const TAR_TYPE_GNU_LONGNAME = 0x4c;
const TAR_TYPE_GNU_LONGLINK = 0x4b;
function readTarOwnershipEntries(tarPath) {
    const entries = new Map();
    const stat = fs.statSync(tarPath);
    const fd = fs.openSync(tarPath, "r");
    let globalPaxHeaders = {};
    let nextPaxHeaders = null;
    let nextLongName = null;
    try {
        let offset = 0;
        while (offset + TAR_BLOCK_SIZE <= stat.size) {
            const header = readExact(fd, offset, TAR_BLOCK_SIZE);
            if (header.every((byte) => byte === 0)) {
                break;
            }
            const name = readTarString(header, 0, 100);
            const uid = parseTarNumber(header.subarray(108, 116));
            const gid = parseTarNumber(header.subarray(116, 124));
            const size = parseTarNumber(header.subarray(124, 136));
            const typeFlag = header[156] ?? 0;
            let fullName = name;
            const magic = readTarString(header, 257, 6);
            if (magic === "ustar" || magic === "ustar\0") {
                const prefix = readTarString(header, 345, 155);
                if (prefix) {
                    fullName = `${prefix}/${name}`;
                }
            }
            offset += TAR_BLOCK_SIZE;
            const dataSize = Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
            let content = null;
            if (size > 0) {
                if (typeFlag === TAR_TYPE_PAX_LOCAL ||
                    typeFlag === TAR_TYPE_PAX_GLOBAL ||
                    typeFlag === TAR_TYPE_GNU_LONGNAME ||
                    typeFlag === TAR_TYPE_GNU_LONGLINK) {
                    content = readExact(fd, offset, size);
                }
                offset += dataSize;
            }
            if (typeFlag === TAR_TYPE_PAX_LOCAL || typeFlag === TAR_TYPE_PAX_GLOBAL) {
                const paxHeaders = parsePaxHeaders(content);
                if (typeFlag === TAR_TYPE_PAX_GLOBAL) {
                    globalPaxHeaders = {
                        ...globalPaxHeaders,
                        ...paxHeaders,
                    };
                }
                else {
                    nextPaxHeaders = paxHeaders;
                }
                continue;
            }
            if (typeFlag === TAR_TYPE_GNU_LONGNAME) {
                nextLongName = readLongTarString(content);
                continue;
            }
            if (typeFlag === TAR_TYPE_GNU_LONGLINK) {
                continue;
            }
            const effectivePaxHeaders = nextPaxHeaders
                ? { ...globalPaxHeaders, ...nextPaxHeaders }
                : globalPaxHeaders;
            if (nextLongName) {
                fullName = nextLongName;
            }
            else if (effectivePaxHeaders.path) {
                fullName = effectivePaxHeaders.path;
            }
            let effectiveUid = uid;
            const paxUid = parsePaxNumericHeader(effectivePaxHeaders.uid);
            if (paxUid !== null) {
                effectiveUid = paxUid;
            }
            let effectiveGid = gid;
            const paxGid = parsePaxNumericHeader(effectivePaxHeaders.gid);
            if (paxGid !== null) {
                effectiveGid = paxGid;
            }
            const normalizedPath = normalizeTarPath(fullName);
            if (normalizedPath) {
                entries.set(normalizedPath, {
                    path: normalizedPath,
                    uid: effectiveUid,
                    gid: effectiveGid,
                });
            }
            nextPaxHeaders = null;
            nextLongName = null;
        }
    }
    finally {
        fs.closeSync(fd);
    }
    return Array.from(entries.values());
}
function readExact(fd, offset, size) {
    if (size === 0) {
        return Buffer.alloc(0);
    }
    const buf = Buffer.alloc(size);
    let done = 0;
    while (done < size) {
        const read = fs.readSync(fd, buf, done, size - done, offset + done);
        if (read <= 0) {
            throw new Error("Unexpected end of tar archive while reading header");
        }
        done += read;
    }
    return buf;
}
function readTarString(buf, start, length) {
    const slice = buf.subarray(start, start + length);
    const nul = slice.indexOf(0);
    const end = nul === -1 ? slice.length : nul;
    return slice.subarray(0, end).toString("utf8");
}
function readLongTarString(content) {
    if (!content || content.length === 0) {
        return "";
    }
    let end = content.length;
    while (end > 0 && (content[end - 1] === 0 || content[end - 1] === 0x0a)) {
        end -= 1;
    }
    return content.subarray(0, end).toString("utf8");
}
function parsePaxHeaders(content) {
    if (!content || content.length === 0) {
        return {};
    }
    const out = {};
    let offset = 0;
    while (offset < content.length) {
        const spaceIdx = content.indexOf(0x20, offset);
        if (spaceIdx === -1) {
            break;
        }
        const lenStr = content.subarray(offset, spaceIdx).toString("utf8").trim();
        const recordLen = Number.parseInt(lenStr, 10);
        if (!Number.isFinite(recordLen) || recordLen <= 0) {
            break;
        }
        const recordEnd = offset + recordLen;
        if (recordEnd > content.length) {
            break;
        }
        const record = content.subarray(spaceIdx + 1, recordEnd).toString("utf8");
        const normalized = record.endsWith("\n") ? record.slice(0, -1) : record;
        const eqIdx = normalized.indexOf("=");
        if (eqIdx !== -1) {
            const key = normalized.slice(0, eqIdx);
            const value = normalized.slice(eqIdx + 1);
            if (key) {
                out[key] = value;
            }
        }
        offset = recordEnd;
    }
    return out;
}
function parsePaxNumericHeader(value) {
    if (!value) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}
function parseTarNumber(field) {
    if (field.length === 0) {
        return 0;
    }
    // GNU base-256 encoding (high bit set on first byte)
    if ((field[0] & 0x80) !== 0) {
        let value = BigInt(field[0] & 0x7f);
        for (let idx = 1; idx < field.length; idx += 1) {
            value = (value << 8n) | BigInt(field[idx]);
        }
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error("tar numeric field exceeds JavaScript safe integer range");
        }
        return Number(value);
    }
    const text = field
        .toString("utf8")
        .replace(/\0.*$/, "")
        .trim();
    if (!text) {
        return 0;
    }
    const parsed = Number.parseInt(text, 8);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}
function normalizeTarPath(value) {
    if (containsControlCharacter(value)) {
        return null;
    }
    let pathValue = value.replace(/\\/g, "/");
    while (pathValue.startsWith("./")) {
        pathValue = pathValue.slice(2);
    }
    if (pathValue.startsWith("/")) {
        pathValue = pathValue.slice(1);
    }
    if (!pathValue || pathValue === ".") {
        return null;
    }
    pathValue = path.posix.normalize(pathValue);
    if (!pathValue || pathValue === "." || pathValue === "..") {
        return null;
    }
    if (pathValue.startsWith("../")) {
        return null;
    }
    if (pathValue.endsWith("/")) {
        pathValue = pathValue.slice(0, -1);
    }
    return pathValue || null;
}
function containsControlCharacter(value) {
    return /[\x00-\x1f\x7f]/.test(value);
}
function extractTarFile(tarPath, destDir) {
    try {
        execFileSync("tar", ["-xf", tarPath, "-C", destDir], {
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
        });
        return;
    }
    catch (err) {
        const e = err;
        if (e.code === "ENOENT") {
            throw new Error("OCI rootfs extraction requires the 'tar' binary, but it was not found on PATH");
        }
        const stdout = commandOutputToString(e.stdout);
        const stderr = commandOutputToString(e.stderr);
        throw new Error(`Failed to extract OCI rootfs tar with tar (exit ${String(e.status ?? "?")}): ` +
            `${tarPath}\n` +
            (stdout || stderr ? `${stdout}${stderr}` : ""));
    }
}
export const __test = {
    readTarOwnershipEntries,
};
//# sourceMappingURL=oci.js.map