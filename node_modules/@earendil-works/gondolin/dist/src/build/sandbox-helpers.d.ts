import type { Architecture } from "./config.js";
declare const SANDBOX_HELPER_REGISTRY_SCHEMA: 1;
declare const SANDBOX_HELPER_MANIFEST_SCHEMA: 1;
declare const SANDBOX_HELPER_KIND: "gondolin-sandbox-helpers";
export declare const SANDBOX_HELPER_BINARY_NAMES: readonly ["sandboxd", "sandboxfs", "sandboxssh", "sandboxingress"];
export type SandboxHelperBinaryName = (typeof SANDBOX_HELPER_BINARY_NAMES)[number];
export type SandboxHelperChecksums = Record<SandboxHelperBinaryName, string>;
export interface SandboxHelperManifest {
    /** manifest schema version */
    schema: typeof SANDBOX_HELPER_MANIFEST_SCHEMA;
    /** manifest kind marker */
    kind: typeof SANDBOX_HELPER_KIND;
    /** compatible gondolin package version */
    gondolinVersion: string;
    /** source git ref used for the build */
    sourceRef?: string;
    /** guest architecture */
    arch: Architecture;
    /** Zig target triple */
    target?: string;
    /** Zig compiler version */
    zigVersion?: string;
    /** binary checksums (`sha256` hex) */
    checksums: SandboxHelperChecksums;
}
export interface SandboxHelperBinaryPaths {
    /** path to `sandboxd` executable */
    sandboxdPath: string;
    /** path to `sandboxfs` executable */
    sandboxfsPath: string;
    /** path to `sandboxssh` executable */
    sandboxsshPath: string;
    /** path to `sandboxingress` executable */
    sandboxingressPath: string;
}
export interface ResolvedSandboxHelpers {
    /** helper source location */
    source: "directory" | "cache" | "download";
    /** helper object build id */
    buildId?: string;
    /** helper architecture */
    arch: Architecture;
    /** helper manifest when present */
    manifest?: SandboxHelperManifest;
    /** resolved executable paths */
    paths: SandboxHelperBinaryPaths;
}
export interface ResolveSandboxHelperOptions {
    /** target guest architecture */
    arch: Architecture;
    /** compatible gondolin package version */
    gondolinVersion?: string;
    /** helper registry ref (`name:tag`) */
    ref?: string;
    /** explicit helper directory */
    helpersDir?: string;
    /** helper registry URL */
    registryUrl?: string;
    /** helper cache/store directory */
    storeDir?: string;
    /** optional progress logger */
    log?: (msg: string) => void;
}
export interface SandboxHelperBuildIdInput {
    /** target guest architecture */
    arch: Architecture;
    /** binary checksums (`sha256` hex) */
    checksums: SandboxHelperChecksums;
}
type ParsedHelperRef = {
    /** helper ref name */
    name: string;
    /** helper ref tag */
    tag: string;
    /** canonical helper ref */
    canonical: string;
};
type RegistrySandboxHelperSource = {
    /** downloadable archive URL */
    url: string;
    /** expected archive checksum (`sha256` hex) */
    sha256?: string;
    /** expected helper architecture */
    arch?: Architecture;
    /** compatible gondolin package version */
    gondolinVersion?: string;
    /** Zig target triple */
    target?: string;
    /** Zig compiler version */
    zigVersion?: string;
};
type BuiltinSandboxHelperRegistry = {
    /** registry schema version */
    schema: typeof SANDBOX_HELPER_REGISTRY_SCHEMA;
    /** named refs mapped by architecture to build ids */
    refs: Record<string, Partial<Record<Architecture, string>>>;
    /** build-id keyed sources */
    builds: Record<string, RegistrySandboxHelperSource>;
};
export declare function getSandboxHelperStoreDirectory(): string;
declare function normalizeArchitecture(value: string | undefined | null): Architecture | null;
declare function normalizeHelperBuildId(value: string): string;
export declare function computeSandboxHelperBuildId(input: SandboxHelperBuildIdInput): string;
declare function parseSandboxHelperRef(reference: string): ParsedHelperRef;
export declare function sandboxHelperRefForVersion(version: string): string;
declare function parseBuiltinSandboxHelperRegistry(raw: unknown, sourceUrl: string): BuiltinSandboxHelperRegistry;
declare function parseSandboxHelperManifest(raw: unknown): SandboxHelperManifest;
export declare function loadSandboxHelperManifest(helperDir: string): SandboxHelperManifest | null;
export declare function ensureSandboxHelperBinaries(options: ResolveSandboxHelperOptions): Promise<ResolvedSandboxHelpers>;
export declare const __test: {
    parseBuiltinSandboxHelperRegistry: typeof parseBuiltinSandboxHelperRegistry;
    parseSandboxHelperManifest: typeof parseSandboxHelperManifest;
    parseSandboxHelperRef: typeof parseSandboxHelperRef;
    normalizeArchitecture: typeof normalizeArchitecture;
    normalizeHelperBuildId: typeof normalizeHelperBuildId;
};
export {};
//# sourceMappingURL=sandbox-helpers.d.ts.map