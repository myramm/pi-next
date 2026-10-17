/**
 * @earendil-works/gondolin
 *
 * Alpine Linux sandbox for running untrusted code with controlled
 * filesystem and network access.
 */
// Main VM interface
export { VM, } from "./vm/core.js";
export { VmCheckpoint } from "./checkpoint.js";
export {} from "./exec.js";
// Server for running the sandbox
export { SandboxServer } from "./sandbox/server.js";
// VFS (Virtual File System) providers
export { VirtualFileSystem, VirtualProvider, MemoryProvider, RealFSProvider, } from "./vfs/node/index.js";
export { SandboxVfsProvider, } from "./vfs/provider.js";
export { ReadonlyProvider } from "./vfs/readonly.js";
export { ReadonlyVirtualProvider } from "./vfs/readonly-virtual.js";
export { ShadowProvider, createShadowPathPredicate, } from "./vfs/shadow.js";
export { VirtualProviderClass, ERRNO, isWriteFlag, normalizeVfsPath, VirtualDirent, createVirtualDirStats, formatVirtualEntries, } from "./vfs/utils.js";
export { FsRpcService, MAX_RPC_DATA, } from "./vfs/rpc-service.js";
// HTTP hooks for network policy
export { createHttpHooks, makePlaceholderFunc, BASE32_ALPHABET, BASE32_HEX_ALPHABET, BASE62_ALPHABET, BASE64URL_ALPHABET, HEX_ALPHABET, LOWERCASE_ALPHABET, UPPERCASE_ALPHABET, } from "./http/hooks.js";
export { HttpRequestBlockedError } from "./http/utils.js";
// SSH helpers
export { getInfoFromSshExecRequest } from "./ssh/exec.js";
// Debug helpers
export {} from "./debug.js";
// Ingress gateway
export { IngressGateway, GondolinListeners, IngressRequestBlockedError, parseListenersFile, serializeListenersFile, } from "./ingress.js";
// Session registry
export { registerSession, unregisterSession, listSessions, findSession, gcSessions, SessionIpcServer, connectToSession, } from "./session-registry.js";
// Asset management
export { ensureGuestAssets, getAssetVersion, getAssetDirectory, hasGuestAssets, loadGuestAssets, loadAssetManifest, } from "./assets.js";
// Local image store
export { getImageStoreDirectory, getImageObjectDirectory, importImageFromDirectory, resolveImageSelector, ensureImageSelector, listImageRefs, setImageRef, tagImage, } from "./images.js";
// Build configuration and builder
export { getDefaultBuildConfig, getDefaultArch, validateBuildConfig, parseBuildConfig, serializeBuildConfig, } from "./build/config.js";
export { buildAssets, verifyAssets, } from "./build/index.js";
//# sourceMappingURL=index.js.map