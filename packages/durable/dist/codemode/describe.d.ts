/**
 * What the model reads about code mode, copied from the coding agent's code mode: the tool's fixed description (the
 * script environment and its globals), and the `codemode` prompt section, which lists the tools scripts can call as
 * TypeScript declarations, grouped by namespace and limited to a token budget. Tools that do not fit are found with
 * `searchTools()`. The section renders from the conversation's callable tools, so it changes with them; the tool's
 * description never does.
 */
import type { CodemodeJsonSchema } from "@earendil-works/pi-codemode";
import type { ToolRegistration } from "../harness/types.ts";
/** A group of tools named by a common prefix, such as an MCP server's `mcp__github__`. */
export type CodemodeNamespace = {
    readonly name: string;
    readonly description?: string;
    readonly instructions?: string;
    /** Tool names starting with it belong to the namespace; the longest matching prefix wins. */
    readonly prefix: string;
};
/** Default token budget of the tool declarations in the `codemode` section, as in the coding agent. */
export declare const DEFAULT_CODEMODE_INLINE_BUDGET = 3000;
/** The code mode tool's description: the script environment and its globals, the same for every conversation. */
export declare function codemodeDescription(models: boolean): string;
/** What a script sees of a tool: its declaration. Tools without an output schema resolve to their text output. */
export declare function declarationOf(tool: ToolRegistration): {
    name: string;
    description: string;
    inputSchema: CodemodeJsonSchema;
    outputSchema: CodemodeJsonSchema;
};
/** `toolSample` of a tool: its description and TypeScript declaration. */
export declare function sampleOf(tool: ToolRegistration): string;
/** The namespace of a tool: the one with the longest prefix its name starts with. */
export declare function namespaceOf(name: string, namespaces: readonly CodemodeNamespace[]): CodemodeNamespace | undefined;
/**
 * The `codemode` section: the tools scripts can call, grouped by namespace, with their declarations as far as the
 * budget allows. `undefined` without callable tools.
 */
export declare function codemodeSection(tools: readonly ToolRegistration[], namespaces: readonly CodemodeNamespace[], budget: number): string | undefined;
//# sourceMappingURL=describe.d.ts.map