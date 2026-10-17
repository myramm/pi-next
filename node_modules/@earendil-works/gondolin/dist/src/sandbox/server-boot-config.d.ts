import type { BootCommandMessage } from "./control-protocol.js";
export type SandboxFsConfig = {
    fuseMount: string;
    fuseBinds: string[];
};
export declare function normalizeSandboxFsConfig(message: BootCommandMessage): SandboxFsConfig;
export declare function isSameSandboxFsConfig(left: SandboxFsConfig, right: SandboxFsConfig): boolean;
export declare function buildSandboxfsAppend(baseAppend: string, config: SandboxFsConfig): string;
//# sourceMappingURL=server-boot-config.d.ts.map