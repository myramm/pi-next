import path from "path";
export function isRootfsMode(value) {
    return value === "readonly" || value === "memory" || value === "cow";
}
/**
 * Get the default build configuration for the current system.
 */
export function getDefaultBuildConfig() {
    const arch = getDefaultArch();
    return {
        arch,
        distro: "alpine",
        alpine: {
            version: "3.23.0",
            kernelPackage: "linux-virt",
            kernelImage: "vmlinuz-virt",
            rootfsPackages: [
                "linux-virt",
                "rng-tools",
                "bash",
                "ca-certificates",
                "curl",
                "e2fsprogs",
                "nodejs",
                "npm",
                "uv",
                "python3",
                "openssh",
            ],
            initramfsPackages: [],
            krunfwVersion: "v5.2.1",
        },
        rootfs: {
            label: "gondolin-root",
        },
    };
}
/**
 * Get the default architecture based on the current system.
 */
export function getDefaultArch() {
    const arch = process.arch;
    if (arch === "arm64") {
        return "aarch64";
    }
    return "x86_64";
}
/**
 * Validate a build configuration.
 */
const isRecord = (value) => typeof value === "object" && value !== null;
const isStringArray = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isOptionalString = (value) => value === undefined || typeof value === "string";
const isOptionalBoolean = (value) => value === undefined || typeof value === "boolean";
const isOptionalNumber = (value) => value === undefined || (typeof value === "number" && Number.isFinite(value));
const isOptionalStringArray = (value) => value === undefined || isStringArray(value);
const isPostBuildCopyEntry = (value) => isRecord(value) &&
    typeof value.src === "string" &&
    value.src.trim() !== "" &&
    typeof value.dest === "string" &&
    path.posix.isAbsolute(value.dest);
const isOptionalPostBuildCopyEntryArray = (value) => value === undefined ||
    (Array.isArray(value) && value.every(isPostBuildCopyEntry));
const isEnvRecord = (value) => isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
const isEnvInput = (value) => isStringArray(value) || isEnvRecord(value);
const isOptionalEnvInput = (value) => value === undefined || isEnvInput(value);
const isContainerRuntime = (value) => value === "docker" || value === "podman";
const isOptionalContainerRuntime = (value) => value === undefined || isContainerRuntime(value);
const isOciPullPolicy = (value) => value === "if-not-present" || value === "always" || value === "never";
const isOptionalOciPullPolicy = (value) => value === undefined || isOciPullPolicy(value);
export function validateBuildConfig(config) {
    if (!isRecord(config)) {
        return false;
    }
    const cfg = config;
    // Required fields
    if (cfg.arch !== "aarch64" && cfg.arch !== "x86_64") {
        return false;
    }
    if (cfg.distro !== "alpine" && cfg.distro !== "nixos") {
        return false;
    }
    // Optional top-level fields
    if (!isOptionalEnvInput(cfg.env)) {
        return false;
    }
    if (cfg.container !== undefined) {
        if (!isRecord(cfg.container)) {
            return false;
        }
        const container = cfg.container;
        if (!isOptionalBoolean(container.force)) {
            return false;
        }
        if (!isOptionalString(container.image)) {
            return false;
        }
        if (!isOptionalContainerRuntime(container.runtime)) {
            return false;
        }
    }
    if (cfg.oci !== undefined) {
        if (!isRecord(cfg.oci)) {
            return false;
        }
        const oci = cfg.oci;
        if (typeof oci.image !== "string" || oci.image.trim() === "") {
            return false;
        }
        if (!isOptionalContainerRuntime(oci.runtime)) {
            return false;
        }
        if (!isOptionalString(oci.platform)) {
            return false;
        }
        if (!isOptionalOciPullPolicy(oci.pullPolicy)) {
            return false;
        }
    }
    if (cfg.rootfs !== undefined) {
        if (!isRecord(cfg.rootfs)) {
            return false;
        }
        const rootfs = cfg.rootfs;
        if (!isOptionalString(rootfs.label)) {
            return false;
        }
        if (!isOptionalNumber(rootfs.sizeMb)) {
            return false;
        }
    }
    if (cfg.init !== undefined) {
        if (!isRecord(cfg.init)) {
            return false;
        }
        const init = cfg.init;
        if (!isOptionalString(init.rootfsInit)) {
            return false;
        }
        if (!isOptionalString(init.initramfsInit)) {
            return false;
        }
        if (!isOptionalString(init.rootfsInitExtra)) {
            return false;
        }
    }
    if (cfg.postBuild !== undefined) {
        if (!isRecord(cfg.postBuild)) {
            return false;
        }
        const postBuild = cfg.postBuild;
        if (!isOptionalPostBuildCopyEntryArray(postBuild.copy)) {
            return false;
        }
        if (!isOptionalStringArray(postBuild.commands)) {
            return false;
        }
    }
    if (cfg.runtimeDefaults !== undefined) {
        if (!isRecord(cfg.runtimeDefaults)) {
            return false;
        }
        const runtimeDefaults = cfg.runtimeDefaults;
        if (runtimeDefaults.rootfsMode !== undefined &&
            !isRootfsMode(runtimeDefaults.rootfsMode)) {
            return false;
        }
    }
    if (!isOptionalString(cfg.sandboxdPath)) {
        return false;
    }
    if (!isOptionalString(cfg.sandboxfsPath)) {
        return false;
    }
    if (!isOptionalString(cfg.sandboxsshPath)) {
        return false;
    }
    if (!isOptionalString(cfg.sandboxingressPath)) {
        return false;
    }
    // Distro-specific validation
    if (cfg.distro === "alpine") {
        if (cfg.alpine !== undefined) {
            if (!isRecord(cfg.alpine)) {
                return false;
            }
            const alpine = cfg.alpine;
            if (typeof alpine.version !== "string") {
                return false;
            }
            if (!isOptionalString(alpine.branch)) {
                return false;
            }
            if (!isOptionalString(alpine.mirror)) {
                return false;
            }
            if (!isOptionalString(alpine.kernelPackage)) {
                return false;
            }
            if (!isOptionalString(alpine.kernelImage)) {
                return false;
            }
            if (!isOptionalStringArray(alpine.rootfsPackages)) {
                return false;
            }
            if (!isOptionalStringArray(alpine.initramfsPackages)) {
                return false;
            }
            if (!isOptionalString(alpine.krunfwVersion)) {
                return false;
            }
        }
    }
    if (cfg.distro === "nixos") {
        if (cfg.nixos === undefined) {
            return false;
        }
        if (!isRecord(cfg.nixos)) {
            return false;
        }
        const nixos = cfg.nixos;
        if (typeof nixos.channel !== "string") {
            return false;
        }
        if (!isOptionalString(nixos.systemExpression)) {
            return false;
        }
        if (!isOptionalStringArray(nixos.packages)) {
            return false;
        }
    }
    return true;
}
/**
 * Parse and validate a build configuration from JSON.
 */
export function parseBuildConfig(json) {
    const parsed = JSON.parse(json);
    if (!validateBuildConfig(parsed)) {
        throw new Error("Invalid build configuration");
    }
    return parsed;
}
/**
 * Serialize a build configuration to JSON.
 */
export function serializeBuildConfig(config) {
    return JSON.stringify(config, null, 2);
}
//# sourceMappingURL=config.js.map