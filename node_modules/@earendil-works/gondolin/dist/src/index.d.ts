/**
 * @earendil-works/gondolin
 *
 * Alpine Linux sandbox for running untrusted code with controlled
 * filesystem and network access.
 */
export { VM, type VMOptions, type VMState, type EnableSshOptions, type SshAccess, type VmFs, type VmRootfsOptions, type VmFsAccessOptions, type VmFsMkdirOptions, type VmFsListDirOptions, type VmFsStatOptions, type VmFsRenameOptions, type VmFsStat, type VmFsReadFileOptions, type VmFsReadFileBufferOptions, type VmFsReadFileTextOptions, type VmFsReadFileStreamOptions, type VmFsWriteFileInput, type VmFsWriteFileOptions, type VmFsDeleteOptions, } from "./vm/core.js";
export { VmCheckpoint, type VmCheckpointData } from "./checkpoint.js";
export { type ExecOptions, type ExecResult, type ExecProcess } from "./exec.js";
export { SandboxServer } from "./sandbox/server.js";
export { VirtualFileSystem, VirtualProvider, MemoryProvider, RealFSProvider, type VirtualFileHandle, type VfsStatfs, type VirtualFileSystemOptions, } from "./vfs/node/index.js";
export { SandboxVfsProvider, type VfsHooks, type VfsHookContext, } from "./vfs/provider.js";
export { ReadonlyProvider } from "./vfs/readonly.js";
export { ReadonlyVirtualProvider } from "./vfs/readonly-virtual.js";
export { ShadowProvider, createShadowPathPredicate, type ShadowProviderOptions, type ShadowWriteMode, type ShadowPredicate, type ShadowContext, } from "./vfs/shadow.js";
export { VirtualProviderClass, ERRNO, isWriteFlag, normalizeVfsPath, VirtualDirent, createVirtualDirStats, formatVirtualEntries, } from "./vfs/utils.js";
export { FsRpcService, type FsRpcMetrics, MAX_RPC_DATA, } from "./vfs/rpc-service.js";
export { createHttpHooks, makePlaceholderFunc, BASE32_ALPHABET, BASE32_HEX_ALPHABET, BASE62_ALPHABET, BASE64URL_ALPHABET, HEX_ALPHABET, LOWERCASE_ALPHABET, UPPERCASE_ALPHABET, type CreateHttpHooksOptions, type CreateHttpHooksResult, type MakePlaceholderFuncOptions, type SecretDefinition, type SecretManager, type SecretManagerEntry, type UpdateSecretOptions, } from "./http/hooks.js";
export type { DnsMode, DnsOptions, SyntheticDnsHostMappingMode, HttpIpAllowInfo, HttpHooks, HttpFetch, TcpOptions, } from "./qemu/net.js";
export type { SshOptions, SshCredential, SshExecRequest, SshExecDecision, SshExecPolicy, } from "./qemu/ssh.js";
export { HttpRequestBlockedError } from "./http/utils.js";
export { getInfoFromSshExecRequest, type GitSshExecInfo } from "./ssh/exec.js";
export { type DebugFlag, type DebugConfig, type DebugComponent, type DebugLogFn, } from "./debug.js";
export { IngressGateway, GondolinListeners, IngressRequestBlockedError, parseListenersFile, serializeListenersFile, type IngressRoute, type EnableIngressOptions, type IngressAccess, type IngressGatewayHooks, type IngressAllowInfo, type IngressHeaders, type IngressHeaderValue, type IngressHeaderPatch, type IngressHookRequest, type IngressHookRequestPatch, type IngressHookResponse, type IngressHookResponsePatch, } from "./ingress.js";
export { registerSession, unregisterSession, listSessions, findSession, gcSessions, SessionIpcServer, connectToSession, type SessionInfo, type SessionEntry, type IpcClientCallbacks, } from "./session-registry.js";
export { ensureGuestAssets, getAssetVersion, getAssetDirectory, hasGuestAssets, loadGuestAssets, loadAssetManifest, type GuestAssets, type AssetManifest, } from "./assets.js";
export { getImageStoreDirectory, getImageObjectDirectory, importImageFromDirectory, resolveImageSelector, ensureImageSelector, listImageRefs, setImageRef, tagImage, type ImageArch, type ImageRefTargets, type LocalImageRef, type ImportedImage, type ResolvedImage, } from "./images.js";
export { type Architecture, type Distro, type ContainerRuntime, type OciPullPolicy, type BuildConfig, type AlpineConfig, type NixOSConfig, type ContainerConfig, type OciRootfsConfig, type RootfsConfig, type InitConfig, type RuntimeDefaultsConfig, type RootfsMode, getDefaultBuildConfig, getDefaultArch, validateBuildConfig, parseBuildConfig, serializeBuildConfig, } from "./build/config.js";
export { buildAssets, verifyAssets, type BuildOptions, type BuildResult, } from "./build/index.js";
//# sourceMappingURL=index.d.ts.map