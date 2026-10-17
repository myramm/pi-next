/**
 * The `tool_search` tool, a copy of the coding agent's: the model searches the deferred tools it is not offered yet,
 * and the matches are loaded with `control.addTools`, so the next request offers them. Loading writes the
 * conversation's `modelTools` (its `add`), so loaded tools stay offered on that branch, also after a compaction.
 */
import { Type } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "../harness/types.ts";
export declare const TOOL_SEARCH_TOOL_NAME = "tool_search";
export declare const DEFAULT_TOOL_SEARCH_LIMIT = 8;
/** `tool_search` result details: the tools it loaded. */
export type ToolSearchToolDetails = {
    loaded: string[];
};
export declare function createToolSearchTool(): ToolRegistration<Type.TObject<{
    query: Type.TString;
    limit: Type.TOptional<Type.TNumber>;
}>, import("@earendil-works/chord").JsonValue>;
/** The `tool_search` extension: install it and select it where the model should find deferred tools. */
export declare function createToolSearchExtension(): import("../harness/types.ts").Extension<ToolRegistration<Type.TObject<{
    query: Type.TString;
    limit: Type.TOptional<Type.TNumber>;
}>, import("@earendil-works/chord").JsonValue>>;
//# sourceMappingURL=tool-search.d.ts.map