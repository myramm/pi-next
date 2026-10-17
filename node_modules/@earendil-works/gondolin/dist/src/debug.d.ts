export type DebugFlag = "net" | "exec" | "vfs" | "protocol";
/**
 * Debug configuration value
 *
 * - `true`: enable all debug components
 * - `false`: disable all debug components
 * - `string[]`: enable selected components
 */
export type DebugConfig = boolean | ReadonlyArray<DebugFlag>;
/**
 * Component identifier passed to debug log callbacks
 */
export type DebugComponent = DebugFlag | "qemu" | "error";
/**
 * Debug log callback invoked with component + message
 */
export type DebugLogFn = (component: DebugComponent, message: string) => void;
export declare function defaultDebugLog(component: DebugComponent, message: string): void;
export declare function stripTrailingNewline(value: string): string;
export declare function parseDebugEnv(value?: string | undefined): Set<DebugFlag>;
export declare function resolveDebugFlags(config: DebugConfig | undefined, envFlags?: Set<DebugFlag>): Set<DebugFlag>;
export declare function debugFlagsToArray(flags: Set<DebugFlag>): DebugFlag[];
//# sourceMappingURL=debug.d.ts.map