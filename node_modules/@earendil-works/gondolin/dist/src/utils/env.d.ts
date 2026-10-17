type EnvInput = string[] | Record<string, string>;
export declare function resolveEnvNumber(name: string, fallback: number): number;
export declare function buildShellEnv(baseEnv?: EnvInput, extraEnv?: EnvInput): string[] | undefined;
export declare function mergeEnvInputs(baseEnv?: EnvInput, extraEnv?: EnvInput): string[] | undefined;
export declare function envInputToEntries(env?: EnvInput): Array<[string, string]>;
export declare function parseEnvEntry(entry: string): [string, string];
export declare function mapToEnvArray(envMap: Map<string, string>): string[];
export {};
//# sourceMappingURL=env.d.ts.map