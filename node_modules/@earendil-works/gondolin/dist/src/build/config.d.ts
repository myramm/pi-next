/**
 * Build configuration schema for custom Linux kernel and rootfs builds.
 *
 * Users can generate a default config with `gondolin build --init-config`,
 * edit it, and then build with `gondolin build --config <file> --output <dir>`.
 */
export type RootfsMode = "readonly" | "memory" | "cow";
export declare function isRootfsMode(value: unknown): value is RootfsMode;
export type Architecture = "aarch64" | "x86_64";
export type Distro = "alpine" | "nixos";
export type ContainerRuntime = "docker" | "podman";
export type OciPullPolicy = "if-not-present" | "always" | "never";
/** environment variables as `KEY=VALUE` or a mapping */
export type EnvInput = string[] | Record<string, string>;
/**
 * Alpine Linux specific configuration.
 */
export interface AlpineConfig {
    /** alpine version (e.g. "3.23.0") */
    version: string;
    /** alpine branch (e.g. "v3.23", default: derived from version) */
    branch?: string;
    /** mirror url (default: official cdn) */
    mirror?: string;
    /** kernel package name (default: "linux-virt") */
    kernelPackage?: string;
    /** kernel image filename in the package (e.g. "vmlinuz-virt") */
    kernelImage?: string;
    /** extra packages to install in the rootfs */
    rootfsPackages?: string[];
    /** extra packages to install in the initramfs */
    initramfsPackages?: string[];
    /** libkrunfw release version used for krun boot artifacts */
    krunfwVersion?: string;
}
/**
 * NixOS specific configuration (for future use).
 */
export interface NixOSConfig {
    /** nixos channel (e.g. "nixos-24.05") */
    channel: string;
    /** nix expression path for building the system */
    systemExpression?: string;
    /** extra system packages */
    packages?: string[];
}
/**
 * Container configuration for builds that require Linux tooling on macOS.
 */
export interface ContainerConfig {
    /** whether to force container usage even on linux (default: false) */
    force?: boolean;
    /** container image to use (default: "alpine:3.23") */
    image?: string;
    /** container runtime (default: auto-detect) */
    runtime?: ContainerRuntime;
}
/**
 * OCI rootfs source configuration.
 */
export interface OciRootfsConfig {
    /** OCI image reference (`repo/name[:tag]` or `repo/name@sha256:...`) */
    image: string;
    /** container runtime used for pull/create/export (auto-detect when undefined) */
    runtime?: ContainerRuntime;
    /** image platform override (default: derived from `arch`) */
    platform?: string;
    /** pull behavior before export (default: "if-not-present") */
    pullPolicy?: OciPullPolicy;
}
/**
 * Rootfs image configuration.
 */
export interface RootfsConfig {
    /** volume label (default: "gondolin-root") */
    label?: string;
    /** size in `mb` (auto when undefined) */
    sizeMb?: number;
}
/**
 * Custom init script configuration.
 */
export interface InitConfig {
    /** custom rootfs init script path (built-in when undefined) */
    rootfsInit?: string;
    /** custom initramfs init script path (built-in when undefined) */
    initramfsInit?: string;
    /** path to a shell script appended to the rootfs init before sandboxd starts */
    rootfsInitExtra?: string;
}
/**
 * A host path copied into the rootfs during image assembly.
 */
export interface PostBuildCopyEntry {
    /** host source path (resolved relative to the build config file) */
    src: string;
    /** absolute destination path inside the guest rootfs */
    dest: string;
}
/**
 * Post-build command configuration.
 */
export interface PostBuildConfig {
    /** host files or directories copied into rootfs before commands */
    copy?: PostBuildCopyEntry[];
    /** shell commands executed in rootfs after package installation */
    commands?: string[];
}
export interface RuntimeDefaultsConfig {
    /** default rootfs write mode for vm startup */
    rootfsMode?: RootfsMode;
}
/**
 * Build configuration for generating custom VM assets.
 */
export interface BuildConfig {
    /** target architecture */
    arch: Architecture;
    /** distribution to use */
    distro: Distro;
    /** default environment variables baked into the guest image */
    env?: EnvInput;
    /** alpine config (when distro is "alpine") */
    alpine?: AlpineConfig;
    /** nixos config (when distro is "nixos") */
    nixos?: NixOSConfig;
    /** container config for cross-platform builds */
    container?: ContainerConfig;
    /** OCI image used as the rootfs base instead of Alpine minirootfs */
    oci?: OciRootfsConfig;
    /** rootfs image config */
    rootfs?: RootfsConfig;
    /** custom init scripts */
    init?: InitConfig;
    /** commands executed in rootfs after package installation */
    postBuild?: PostBuildConfig;
    /** runtime defaults baked into the asset manifest */
    runtimeDefaults?: RuntimeDefaultsConfig;
    /** custom sandboxd binary path (built-in when undefined) */
    sandboxdPath?: string;
    /** custom sandboxfs binary path (built-in when undefined) */
    sandboxfsPath?: string;
    /** custom sandboxssh binary path (built-in when undefined) */
    sandboxsshPath?: string;
    /** custom sandboxingress binary path (built-in when undefined) */
    sandboxingressPath?: string;
}
/**
 * Get the default build configuration for the current system.
 */
export declare function getDefaultBuildConfig(): BuildConfig;
/**
 * Get the default architecture based on the current system.
 */
export declare function getDefaultArch(): Architecture;
export declare function validateBuildConfig(config: unknown): config is BuildConfig;
/**
 * Parse and validate a build configuration from JSON.
 */
export declare function parseBuildConfig(json: string): BuildConfig;
/**
 * Serialize a build configuration to JSON.
 */
export declare function serializeBuildConfig(config: BuildConfig): string;
//# sourceMappingURL=config.d.ts.map