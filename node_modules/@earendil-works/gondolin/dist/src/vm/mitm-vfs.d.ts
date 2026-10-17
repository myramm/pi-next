import type { VmVfsOptions } from "./types.js";
import { type VirtualProvider } from "../vfs/node/index.js";
export declare function resolveMitmMounts(options?: VmVfsOptions | null, mitmCertDir?: string, netEnabled?: boolean): Record<string, VirtualProvider>;
export declare function createMitmCaProvider(mitmCertDir?: string): VirtualProvider;
//# sourceMappingURL=mitm-vfs.d.ts.map