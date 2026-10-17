import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { getHostNodeArchCached } from "../host/arch.js";
import { debugFlagsToArray, parseDebugEnv, resolveDebugFlags, } from "../debug.js";
import { ensureGuestAssets, loadAssetManifest, loadGuestAssets, resolveGuestAssetsSync, } from "../assets.js";
import { ensureImageSelector, resolveImageSelector } from "../images.js";
import { DEFAULT_MAX_HTTP_BODY_BYTES, DEFAULT_MAX_HTTP_RESPONSE_BODY_BYTES, } from "../qemu/net.js";
const require = createRequire(import.meta.url);
const DEFAULT_MAX_STDIN_BYTES = 64 * 1024;
const DEFAULT_MAX_QUEUED_STDIN_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_QUEUED_STDIN_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_QUEUED_EXECS = 64;
const DEFAULT_DARWIN_HVF_IDLE_PAUSE_MS = 30_000;
/**
 * Resolve imagePath selector to guest assets and optional image directory.
 */
function resolveImagePath(imagePath) {
    if (typeof imagePath === "string") {
        const resolved = resolveImageSelector(imagePath);
        return {
            assets: loadGuestAssets(resolved.assetDir),
            imageDir: resolved.assetDir,
            explicitAssetObject: false,
        };
    }
    return {
        assets: imagePath,
        imageDir: null,
        explicitAssetObject: true,
    };
}
function normalizeVmm(value) {
    if (!value)
        return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === "qemu" || normalized === "krun") {
        return normalized;
    }
    return null;
}
function normalizeArch(value) {
    if (!value)
        return null;
    const lower = value.toLowerCase();
    if (lower === "arm64" || lower === "aarch64")
        return "arm64";
    if (lower === "x64" || lower === "x86_64" || lower === "amd64")
        return "x64";
    return null;
}
function detectQemuArch(qemuPath) {
    const lower = qemuPath.toLowerCase();
    if (lower.includes("aarch64") || lower.includes("arm64"))
        return "arm64";
    if (lower.includes("x86_64") ||
        lower.includes("x64") ||
        lower.includes("amd64"))
        return "x64";
    return null;
}
function normalizeQemuIdlePauseMs(value) {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`invalid qemu idle pause timeout: ${value}`);
    }
    const ms = Math.trunc(value);
    return ms > 0 ? ms : undefined;
}
function resolveQemuIdlePauseMs(options, vmm) {
    if (options.qemuIdlePauseMs !== undefined) {
        return normalizeQemuIdlePauseMs(options.qemuIdlePauseMs);
    }
    if (vmm !== "qemu" || process.platform !== "darwin") {
        return undefined;
    }
    const accelName = (options.accel ?? "")
        .split(",", 1)[0]
        .trim()
        .toLowerCase();
    if (accelName && accelName !== "hvf") {
        return undefined;
    }
    return DEFAULT_DARWIN_HVF_IDLE_PAUSE_MS;
}
function resolveLocalKrunRunnerPath() {
    const directCandidates = [
        path.resolve(process.cwd(), "host", "krun-runner", "zig-out", "bin", "gondolin-krun-runner"),
        path.resolve(process.cwd(), "krun-runner", "zig-out", "bin", "gondolin-krun-runner"),
    ];
    for (const candidate of directCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    const starts = [process.cwd(), import.meta.dirname];
    const visited = new Set();
    for (const start of starts) {
        let dir = path.resolve(start);
        for (let i = 0; i < 10; i += 1) {
            const candidate = path.join(dir, "krun-runner", "zig-out", "bin", "gondolin-krun-runner");
            if (!visited.has(candidate)) {
                visited.add(candidate);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
            const hostCandidate = path.join(dir, "host", "krun-runner", "zig-out", "bin", "gondolin-krun-runner");
            if (!visited.has(hostCandidate)) {
                visited.add(hostCandidate);
                if (fs.existsSync(hostCandidate)) {
                    return hostCandidate;
                }
            }
            const parent = path.dirname(dir);
            if (parent === dir)
                break;
            dir = parent;
        }
    }
    return null;
}
function probeKrunRunnerCandidate(candidatePath) {
    try {
        execFileSync(candidatePath, ["--version"], { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
function resolvePackagedKrunRunnerPath(deps = {}) {
    const platform = deps.platform ?? process.platform;
    const arch = deps.arch ?? process.arch;
    if ((platform !== "darwin" && platform !== "linux") ||
        (arch !== "arm64" && arch !== "x64")) {
        return null;
    }
    const packageName = `@earendil-works/gondolin-krun-runner-${platform}-${arch}`;
    const resolvePackageJson = deps.resolvePackageJson ??
        ((specifier) => require.resolve(specifier));
    const readFileSync = deps.readFileSync ?? fs.readFileSync;
    const existsSync = deps.existsSync ?? fs.existsSync;
    const probeRunner = deps.probeRunner ?? probeKrunRunnerCandidate;
    try {
        const packageJsonPath = resolvePackageJson(`${packageName}/package.json`);
        const packageDir = path.dirname(packageJsonPath);
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
        const binCandidates = [];
        if (typeof packageJson.bin === "string") {
            binCandidates.push(packageJson.bin);
        }
        else if (packageJson.bin && typeof packageJson.bin === "object") {
            const preferred = packageJson.bin["gondolin-krun-runner"];
            if (typeof preferred === "string") {
                binCandidates.push(preferred);
            }
            for (const value of Object.values(packageJson.bin)) {
                if (typeof value === "string") {
                    binCandidates.push(value);
                }
            }
        }
        binCandidates.push("bin/gondolin-krun-runner", "gondolin-krun-runner");
        const seen = new Set();
        for (const rel of binCandidates) {
            const candidate = path.resolve(packageDir, rel);
            if (seen.has(candidate) || !existsSync(candidate)) {
                continue;
            }
            seen.add(candidate);
            if (probeRunner(candidate)) {
                return candidate;
            }
        }
    }
    catch {
        return null;
    }
    return null;
}
function resolveDefaultKrunRunnerPath(deps = {}) {
    const envValue = Object.prototype.hasOwnProperty.call(deps, "envPath")
        ? deps.envPath
        : process.env.GONDOLIN_KRUN_RUNNER;
    const envPath = envValue?.trim();
    if (envPath) {
        return envPath;
    }
    const resolveLocalPath = deps.resolveLocalPath ?? resolveLocalKrunRunnerPath;
    const local = resolveLocalPath();
    if (local) {
        return local;
    }
    const resolvePackagedPath = deps.resolvePackagedPath ?? resolvePackagedKrunRunnerPath;
    const packaged = resolvePackagedPath();
    if (packaged) {
        return packaged;
    }
    return "gondolin-krun-runner";
}
function getDefaultKrunInitrdPath() {
    return path.join(os.tmpdir(), "gondolin-krun-empty-initrd");
}
function ensureEmptyInitrdFile(initrdPath) {
    try {
        if (fs.existsSync(initrdPath))
            return true;
        fs.mkdirSync(path.dirname(initrdPath), { recursive: true });
        fs.writeFileSync(initrdPath, "");
        return true;
    }
    catch {
        return false;
    }
}
function resolveManifestAssetPath(imageDir, relPath, fieldName) {
    if (path.isAbsolute(relPath)) {
        throw new Error(`${fieldName} must be relative to image dir, got ${relPath}`);
    }
    const resolved = path.resolve(imageDir, relPath);
    const relative = path.relative(imageDir, resolved);
    if (relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)) {
        throw new Error(`${fieldName} must stay within image dir, got ${relPath}`);
    }
    return resolved;
}
function resolveKrunInitrdPath(imageManifest, imageDir) {
    if (imageManifest?.assets?.krunInitrd) {
        const initrdPath = resolveManifestAssetPath(imageDir, imageManifest.assets.krunInitrd, "manifest.assets.krunInitrd");
        if (!fs.existsSync(initrdPath)) {
            throw new Error(`manifest.assets.krunInitrd points to missing file: ${imageManifest.assets.krunInitrd}`);
        }
        return initrdPath;
    }
    const initrdPath = getDefaultKrunInitrdPath();
    if (!ensureEmptyInitrdFile(initrdPath) && !fs.existsSync(initrdPath)) {
        throw new Error(`failed to create default krun initrd at ${initrdPath}`);
    }
    return initrdPath;
}
function resolveKrunKernelOverride(imageManifest, imageDir) {
    if (!imageDir || !imageManifest?.assets?.krunKernel) {
        return null;
    }
    const kernelPath = resolveManifestAssetPath(imageDir, imageManifest.assets.krunKernel, "manifest.assets.krunKernel");
    if (!fs.existsSync(kernelPath)) {
        throw new Error(`manifest.assets.krunKernel points to missing file: ${imageManifest.assets.krunKernel}`);
    }
    return {
        kernelPath,
        initrdPath: resolveKrunInitrdPath(imageManifest, imageDir),
    };
}
function findCommonAssetDir(assets) {
    const kernelDir = assets.kernelPath ? path.dirname(assets.kernelPath) : null;
    const initrdDir = assets.initrdPath ? path.dirname(assets.initrdPath) : null;
    const rootfsDir = assets.rootfsPath ? path.dirname(assets.rootfsPath) : null;
    if (!kernelDir || !initrdDir || !rootfsDir)
        return null;
    if (kernelDir !== initrdDir || kernelDir !== rootfsDir)
        return null;
    return kernelDir;
}
function isPathWithinOrEqual(base, candidate) {
    const relative = path.relative(path.resolve(base), path.resolve(candidate));
    return (relative === "" ||
        (!relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative)));
}
function findSharedAssetAncestor(assets) {
    const assetPaths = [assets.kernelPath, assets.initrdPath, assets.rootfsPath];
    if (assetPaths.some((value) => !value)) {
        return null;
    }
    let candidate = path.dirname(path.resolve(assetPaths[0]));
    for (const rawPath of assetPaths.slice(1)) {
        const current = path.dirname(path.resolve(rawPath));
        while (!isPathWithinOrEqual(candidate, current)) {
            const parent = path.dirname(candidate);
            if (parent === candidate) {
                break;
            }
            candidate = parent;
        }
    }
    return candidate;
}
function manifestMatchesAssets(manifestDir, assets) {
    if (!assets.kernelPath || !assets.initrdPath || !assets.rootfsPath) {
        return false;
    }
    const manifest = loadAssetManifest(manifestDir);
    if (!manifest) {
        return false;
    }
    const assetFiles = manifest.assets ?? {
        kernel: "vmlinuz-virt",
        initramfs: "initramfs.cpio.lz4",
        rootfs: "rootfs.ext4",
    };
    try {
        const kernelPath = resolveManifestAssetPath(manifestDir, assetFiles.kernel, "manifest.assets.kernel");
        const initrdPath = resolveManifestAssetPath(manifestDir, assetFiles.initramfs, "manifest.assets.initramfs");
        const rootfsPath = resolveManifestAssetPath(manifestDir, assetFiles.rootfs, "manifest.assets.rootfs");
        return (path.resolve(kernelPath) === path.resolve(assets.kernelPath) &&
            path.resolve(initrdPath) === path.resolve(assets.initrdPath) &&
            path.resolve(rootfsPath) === path.resolve(assets.rootfsPath));
    }
    catch {
        return false;
    }
}
function resolveImageDirFromAssets(assets) {
    const sharedAncestor = findSharedAssetAncestor(assets);
    if (sharedAncestor) {
        let dir = sharedAncestor;
        for (;;) {
            if (manifestMatchesAssets(dir, assets)) {
                return dir;
            }
            const parent = path.dirname(dir);
            if (parent === dir) {
                break;
            }
            dir = parent;
        }
    }
    const commonDir = findCommonAssetDir(assets);
    if (commonDir && manifestMatchesAssets(commonDir, assets)) {
        return commonDir;
    }
    return null;
}
function detectGuestArchFromManifest(assets) {
    const dir = resolveImageDirFromAssets(assets);
    if (!dir)
        return null;
    const manifest = loadAssetManifest(dir);
    const arch = normalizeArch(manifest?.config?.arch);
    if (!manifest || !arch)
        return null;
    return { arch, manifestPath: path.join(dir, "manifest.json") };
}
export function resolveSandboxServerOptions(options = {}, assets, deps = {}) {
    if (Object.hasOwn(options, "rootDiskSnapshot")) {
        throw new Error("sandbox.rootDiskSnapshot has been removed; use VM rootfs.mode='memory' for backend-native ephemeral writes on qemu or rootfs.mode='cow' for a throwaway qcow2 overlay on disk");
    }
    // Resolve image paths: explicit imagePath > assets parameter > local dev paths
    let resolvedAssets;
    let explicitImageObject = false;
    let imageDir = null;
    if (options.imagePath !== undefined) {
        const resolvedImagePath = resolveImagePath(options.imagePath);
        resolvedAssets = resolvedImagePath.assets;
        explicitImageObject = resolvedImagePath.explicitAssetObject;
        imageDir = resolvedImagePath.imageDir;
    }
    else if (assets) {
        resolvedAssets = assets;
    }
    else {
        resolvedAssets = resolveGuestAssetsSync() ?? {};
    }
    if (!imageDir) {
        imageDir = resolveImageDirFromAssets(resolvedAssets);
    }
    const baseKernelPath = resolvedAssets.kernelPath;
    const baseInitrdPath = resolvedAssets.initrdPath;
    const rootfsPath = resolvedAssets.rootfsPath;
    // we are running into length limits on macos on the default temp dir
    const tmpDir = process.platform === "darwin" ? "/tmp" : os.tmpdir();
    const defaultVirtio = path.resolve(tmpDir, `gondolin-virtio-${randomUUID().slice(0, 8)}.sock`);
    const defaultVirtioFs = path.resolve(tmpDir, `gondolin-virtio-fs-${randomUUID().slice(0, 8)}.sock`);
    const defaultVirtioSsh = path.resolve(tmpDir, `gondolin-virtio-ssh-${randomUUID().slice(0, 8)}.sock`);
    const defaultVirtioIngress = path.resolve(tmpDir, `gondolin-virtio-ingress-${randomUUID().slice(0, 8)}.sock`);
    const defaultNetSock = path.resolve(tmpDir, `gondolin-net-${randomUUID().slice(0, 8)}.sock`);
    const defaultNetMac = "02:00:00:00:00:01";
    const hostArch = getHostNodeArchCached();
    const hostArchNormalized = normalizeArch(hostArch);
    const defaultQemuForHostArch = hostArchNormalized === "arm64"
        ? "qemu-system-aarch64"
        : "qemu-system-x86_64";
    const defaultMemory = "1G";
    const envDebugFlags = parseDebugEnv();
    const resolvedDebugFlags = resolveDebugFlags(options.debug, envDebugFlags);
    const debug = debugFlagsToArray(resolvedDebugFlags);
    const explicitVmm = normalizeVmm(options.vmm ?? null);
    if (options.vmm !== undefined && !explicitVmm) {
        throw new Error(`invalid sandbox vmm backend: ${String(options.vmm)} (expected "qemu" or "krun")`);
    }
    const envVmm = normalizeVmm(process.env.GONDOLIN_VMM);
    const vmm = explicitVmm ?? envVmm ?? "qemu";
    const envCpu = process.env.GONDOLIN_CPU?.trim() || undefined;
    const cpu = vmm === "qemu" ? (options.cpu ?? envCpu) : options.cpu;
    let qemuPath = options.qemuPath ?? defaultQemuForHostArch;
    const resolveDefaultKrunRunnerPathFn = deps.resolveDefaultKrunRunnerPath ?? resolveDefaultKrunRunnerPath;
    const krunRunnerPath = options.krunRunnerPath ??
        (vmm === "krun"
            ? resolveDefaultKrunRunnerPathFn()
            : "gondolin-krun-runner");
    if (vmm === "krun") {
        const unsupported = [];
        if (options.qemuPath !== undefined)
            unsupported.push("sandbox.qemuPath");
        if (options.machineType !== undefined)
            unsupported.push("sandbox.machineType");
        if (options.accel !== undefined)
            unsupported.push("sandbox.accel");
        if (options.cpu !== undefined)
            unsupported.push("sandbox.cpu");
        if (options.qemuIdlePauseMs !== undefined)
            unsupported.push("sandbox.qemuIdlePauseMs");
        if (unsupported.length > 0) {
            throw new Error(`Unsupported sandbox option${unsupported.length === 1 ? "" : "s"} for vmm=krun: ${unsupported.join(", ")}. ` +
                "These options are only supported with vmm=qemu.");
        }
    }
    const imageManifest = imageDir ? loadAssetManifest(imageDir) : null;
    let kernelPath = baseKernelPath;
    let initrdPath = baseInitrdPath;
    let krunKernelOverride = null;
    if (vmm === "krun" && !explicitImageObject) {
        krunKernelOverride = resolveKrunKernelOverride(imageManifest, imageDir);
        if (krunKernelOverride) {
            kernelPath = krunKernelOverride.kernelPath;
            initrdPath = krunKernelOverride.initrdPath;
        }
    }
    if (!kernelPath || !initrdPath || !rootfsPath) {
        throw new Error("Guest assets not found. Either:\n" +
            "  1. Run from the gondolin repository with built guest images\n" +
            "  2. Use SandboxServer.create() to auto-download assets\n" +
            "  3. Provide imagePath option (asset directory, image selector, or explicit paths)\n" +
            "  4. Set GONDOLIN_GUEST_DIR to a directory containing the assets");
    }
    // Fail fast if we can detect that the guest image doesn't match the selected backend target.
    // Without this, the VM often just "hangs" until some higher-level timeout.
    const guestFromManifest = detectGuestArchFromManifest({
        kernelPath: baseKernelPath,
        initrdPath: baseInitrdPath,
        rootfsPath,
    });
    if (vmm === "qemu" &&
        options.qemuPath === undefined &&
        guestFromManifest !== null) {
        qemuPath =
            guestFromManifest.arch === "arm64"
                ? "qemu-system-aarch64"
                : "qemu-system-x86_64";
    }
    if (vmm === "qemu") {
        const qemuArch = detectQemuArch(qemuPath);
        if (guestFromManifest && qemuArch && guestFromManifest.arch !== qemuArch) {
            const host = hostArchNormalized ?? hostArch;
            throw new Error("Guest image architecture mismatch.\n" +
                `  guest assets: ${guestFromManifest.arch} (from ${guestFromManifest.manifestPath})\n` +
                `  qemu binary:  ${qemuArch} (${qemuPath})\n` +
                `  host arch:    ${host}\n\n` +
                "Fix: use a matching qemuPath (e.g. qemu-system-aarch64 vs qemu-system-x86_64) " +
                "or rebuild/download guest assets for the correct architecture.");
        }
    }
    else if (guestFromManifest) {
        const host = normalizeArch(hostArch);
        if (host && guestFromManifest.arch !== host) {
            throw new Error("Guest image architecture mismatch for libkrun backend.\n" +
                `  guest assets: ${guestFromManifest.arch} (from ${guestFromManifest.manifestPath})\n` +
                `  host arch:    ${host}\n\n` +
                "Fix: select a guest image that matches the host architecture when using vmm=krun.");
        }
    }
    if (vmm === "krun" && !explicitImageObject && !krunKernelOverride) {
        throw new Error("Selected image does not provide krun boot assets.\n" +
            "Expected manifest assets `krunKernel` (and optional `krunInitrd`).\n" +
            "Fix: use an image built with `gondolin build` or choose a published image that includes krun assets.");
    }
    const rootDiskPath = options.rootDiskPath ?? rootfsPath;
    const rootDiskFormat = options.rootDiskFormat ?? (options.rootDiskPath ? "qcow2" : "raw");
    const rootDiskReadOnly = options.rootDiskReadOnly ?? false;
    const maxStdinBytes = options.maxStdinBytes ?? DEFAULT_MAX_STDIN_BYTES;
    const maxQueuedStdinBytes = Math.max(options.maxQueuedStdinBytes ?? DEFAULT_MAX_QUEUED_STDIN_BYTES, maxStdinBytes);
    const maxTotalQueuedStdinBytes = Math.max(options.maxTotalQueuedStdinBytes ?? DEFAULT_MAX_TOTAL_QUEUED_STDIN_BYTES, maxQueuedStdinBytes);
    return {
        vmm,
        qemuPath,
        krunRunnerPath,
        kernelPath,
        initrdPath,
        rootfsPath,
        rootDiskPath,
        rootDiskFormat,
        rootDiskReadOnly,
        memory: options.memory ?? defaultMemory,
        cpus: options.cpus ?? 2,
        virtioSocketPath: options.virtioSocketPath ?? defaultVirtio,
        virtioFsSocketPath: options.virtioFsSocketPath ?? defaultVirtioFs,
        virtioSshSocketPath: options.virtioSshSocketPath ?? defaultVirtioSsh,
        virtioIngressSocketPath: options.virtioIngressSocketPath ?? defaultVirtioIngress,
        netSocketPath: options.netSocketPath ?? defaultNetSock,
        netMac: options.netMac ?? defaultNetMac,
        netEnabled: options.netEnabled ?? true,
        allowWebSockets: options.allowWebSockets ?? true,
        debug,
        machineType: options.machineType,
        accel: options.accel,
        cpu,
        console: options.console,
        autoRestart: options.autoRestart ?? false,
        qemuIdlePauseMs: resolveQemuIdlePauseMs(options, vmm),
        append: options.append,
        maxStdinBytes,
        maxQueuedStdinBytes,
        maxTotalQueuedStdinBytes,
        maxQueuedExecs: options.maxQueuedExecs ?? DEFAULT_MAX_QUEUED_EXECS,
        maxHttpBodyBytes: options.maxHttpBodyBytes ?? DEFAULT_MAX_HTTP_BODY_BYTES,
        maxHttpResponseBodyBytes: options.maxHttpResponseBodyBytes ?? DEFAULT_MAX_HTTP_RESPONSE_BODY_BYTES,
        fetch: options.fetch,
        httpHooks: options.httpHooks,
        dns: options.dns,
        ssh: options.ssh,
        tcp: options.tcp,
        mitmCertDir: options.mitmCertDir,
        vfsProvider: options.vfsProvider ?? null,
    };
}
/**
 * Resolve server options asynchronously, downloading guest assets if needed.
 *
 * This is the recommended way to get resolved options for production use.
 */
export async function resolveSandboxServerOptionsAsync(options = {}) {
    // Explicit object imagePath is already fully resolved.
    if (options.imagePath && typeof options.imagePath === "object") {
        return resolveSandboxServerOptions(options);
    }
    // String image selectors may require pulling from the builtin registry.
    if (typeof options.imagePath === "string") {
        const resolvedImage = await ensureImageSelector(options.imagePath);
        return resolveSandboxServerOptions({
            ...options,
            imagePath: resolvedImage.assetDir,
        });
    }
    const assets = await ensureGuestAssets();
    return resolveSandboxServerOptions(options, assets);
}
export const __test = {
    probeKrunRunnerCandidate,
    resolvePackagedKrunRunnerPath,
    resolveDefaultKrunRunnerPath,
};
//# sourceMappingURL=server-options.js.map