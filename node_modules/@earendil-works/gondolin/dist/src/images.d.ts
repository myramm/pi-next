import type { Architecture } from "./build/config.js";
declare const BUILTIN_IMAGE_REGISTRY_SCHEMA: 1;
export type ImageArch = Architecture;
export interface ImageRefTargets {
    /** build id for `aarch64` */
    aarch64?: string;
    /** build id for `x86_64` */
    x86_64?: string;
}
export interface LocalImageRef {
    /** canonical image reference (`name:tag`) */
    reference: string;
    /** build ids mapped by architecture */
    targets: ImageRefTargets;
    /** last update timestamp (`iso 8601`) */
    updatedAt: string;
}
export interface ImportedImage {
    /** imported content-derived build id */
    buildId: string;
    /** image architecture from manifest */
    arch: ImageArch;
    /** object directory containing guest assets */
    assetDir: string;
    /** whether a new object was created */
    created: boolean;
}
export interface ResolvedImage {
    /** source selector (`path`, `build-id`, or `ref`) */
    source: "path" | "build-id" | "ref";
    /** selector value used for resolution */
    selector: string;
    /** resolved guest asset directory */
    assetDir: string;
    /** resolved content-derived build id if known */
    buildId?: string;
    /** resolved architecture when available */
    arch?: ImageArch;
}
type ParsedImageRef = {
    /** image name component */
    name: string;
    /** image tag component */
    tag: string;
    /** canonical `name:tag` */
    canonical: string;
};
type RegistryImageSource = {
    /** downloadable archive url */
    url: string;
    /** expected archive checksum (`sha256` hex) */
    sha256?: string;
    /** expected imported architecture */
    arch?: ImageArch;
};
type BuiltinImageRegistry = {
    /** registry schema version */
    schema: typeof BUILTIN_IMAGE_REGISTRY_SCHEMA;
    /** named refs mapped by architecture to build ids */
    refs: Record<string, Partial<Record<ImageArch, string>>>;
    /** build-id keyed sources */
    builds: Record<string, RegistryImageSource>;
};
export declare function getImageStoreDirectory(): string;
declare function normalizeImageArch(value: string | undefined | null): ImageArch | null;
declare function parseImageRef(reference: string): ParsedImageRef;
declare function isBuildId(value: string): boolean;
export declare function normalizeImageBuildId(buildId: string): string;
export declare function getImageObjectDirectory(buildId: string): string;
export declare function importImageFromDirectory(assetDir: string): ImportedImage;
export declare function setImageRef(reference: string, buildId: string, arch: ImageArch): LocalImageRef;
export declare function listImageRefs(): LocalImageRef[];
export declare function resolveImageSelector(selector: string, arch?: ImageArch): ResolvedImage;
declare function parseBuiltinRegistry(raw: unknown, sourceUrl: string): BuiltinImageRegistry;
export declare function ensureImageSelector(selector: string, arch?: ImageArch): Promise<ResolvedImage>;
export declare function tagImage(source: string, targetReference: string, arch?: ImageArch): LocalImageRef;
export declare const __test: {
    parseImageRef: typeof parseImageRef;
    normalizeImageArch: typeof normalizeImageArch;
    isBuildId: typeof isBuildId;
    normalizeImageBuildId: typeof normalizeImageBuildId;
    parseBuiltinRegistry: typeof parseBuiltinRegistry;
};
export {};
//# sourceMappingURL=images.d.ts.map