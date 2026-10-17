import type { BuildConfig, ContainerRuntime, OciPullPolicy, RootfsMode } from "./build/config.js";
export declare const MANIFEST_FILENAME = "manifest.json";
export type AssetBuildIdInput = {
    /** sha256 checksums (hex) */
    checksums: {
        kernel: string;
        initramfs: string;
        rootfs: string;
        krunKernel?: string;
        krunInitrd?: string;
    };
    /** guest architecture identifier (e.g. "aarch64") */
    arch?: string;
};
/**
 * Compute a deterministic guest asset build ID.
 *
 * This is intentionally derived from *content* (checksums), not host paths.
 */
export declare function computeAssetBuildId(input: AssetBuildIdInput): string;
/**
 * Manifest describing the built assets.
 */
export interface AssetManifest {
    /** manifest schema version */
    version: 1;
    /** deterministic content-derived build identifier (uuid) */
    buildId?: string;
    /** build configuration */
    config: BuildConfig;
    /** runtime defaults used by vm creation */
    runtimeDefaults?: {
        /** default rootfs write mode */
        rootfsMode?: RootfsMode;
    };
    /** resolved OCI source metadata captured during rootfs export */
    ociSource?: {
        /** requested OCI image reference from build config */
        image: string;
        /** OCI runtime used for export */
        runtime: ContainerRuntime;
        /** OCI platform used for export */
        platform: string;
        /** OCI pull policy used for export */
        pullPolicy: OciPullPolicy;
        /** resolved OCI digest (`sha256:...`) */
        digest?: string;
        /** resolved OCI image reference (`repo@sha256:...`) */
        reference?: string;
    };
    /** build timestamp (iso 8601) */
    buildTime: string;
    /** asset filenames */
    assets: {
        /** kernel image filename */
        kernel: string;
        /** initramfs filename */
        initramfs: string;
        /** rootfs filename */
        rootfs: string;
        /** krun-compatible kernel image filename */
        krunKernel?: string;
        /** krun initrd image filename */
        krunInitrd?: string;
    };
    /** sha256 checksums (hex) */
    checksums: {
        /** kernel checksum */
        kernel: string;
        /** initramfs checksum */
        initramfs: string;
        /** rootfs checksum */
        rootfs: string;
        /** krun-compatible kernel checksum */
        krunKernel?: string;
        /** krun initrd checksum */
        krunInitrd?: string;
    };
}
/**
 * Guest image asset paths.
 */
export interface GuestAssets {
    /** linux kernel path */
    kernelPath: string;
    /** compressed initramfs path */
    initrdPath: string;
    /** rootfs image path */
    rootfsPath: string;
}
/**
 * Load an asset manifest from a directory.
 */
export declare function loadAssetManifest(assetDir: string): AssetManifest | null;
/**
 * Load guest assets from a custom directory.
 *
 * This is useful when you've built custom assets using `gondolin build`.
 * The directory should contain manifest.json or the default filenames
 * (vmlinuz-virt, initramfs.cpio.lz4, and rootfs.ext4).
 *
 * @param assetDir Path to the directory containing the assets
 * @returns Paths to the guest assets
 * @throws If any required assets are missing
 */
export declare function loadGuestAssets(assetDir: string): GuestAssets;
/**
 * Ensure guest assets are available.
 *
 * Resolution priority:
 * 1. GONDOLIN_GUEST_DIR environment override
 * 2. Local dev checkout (`guest/image/out`)
 * 3. Default image selector (`GONDOLIN_DEFAULT_IMAGE`, default `alpine-base:latest`)
 */
export declare function ensureGuestAssets(): Promise<GuestAssets>;
/**
 * Get the current package-derived asset version string.
 */
export declare function getAssetVersion(): string;
/**
 * Get the preferred local asset location root.
 */
export declare function getAssetDirectory(): string;
/**
 * Check if guest assets are available without downloading.
 */
export declare function hasGuestAssets(): boolean;
/**
 * Resolve guest assets synchronously without downloading.
 */
export declare function resolveGuestAssetsSync(): GuestAssets | null;
//# sourceMappingURL=assets.d.ts.map