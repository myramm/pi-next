"use strict";
import { createRequire } from "node:module";
// GONDOLIN_VENDORED_NODE_VFS_PATCH_BEGIN
const require = createRequire(import.meta.url);
const nodeVfs = require("./vendored-node-vfs/lib/vfs.js");
// GONDOLIN_VENDORED_NODE_VFS_PATCH_END
const { VirtualFileSystem, VirtualProvider, MemoryProvider, RealFSProvider } = nodeVfs;
function isVirtualProvider(value) {
    return (!!value &&
        typeof value === "object" &&
        typeof value.openSync === "function");
}
function create(providerOrOptions, options) {
    if (isVirtualProvider(providerOrOptions)) {
        return new VirtualFileSystem(providerOrOptions, options);
    }
    if (providerOrOptions === undefined) {
        return new VirtualFileSystem();
    }
    return new VirtualFileSystem(providerOrOptions);
}
export { create, VirtualFileSystem, VirtualProvider, MemoryProvider, RealFSProvider, };
//# sourceMappingURL=index.js.map