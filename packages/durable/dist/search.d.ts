/**
 * BM25 tool search for code mode's `searchTools()` and the `tool_search` tool, a copy of the coding agent's tool search
 * ranking: durable keeps its own copy of what it needs from the coding agent.
 */
export type SearchDocument = {
    readonly name: string;
    readonly text: string;
};
/** Lowercase terms, split at camelCase boundaries and non-alphanumerics, without stop words. */
export declare function tokenize(text: string): string[];
/** Okapi BM25 (k1 1.2, b 0.75): the names of the best matches, best first; ties keep document order. */
export declare function rankDocuments(query: string, documents: readonly SearchDocument[], limit: number): string[];
//# sourceMappingURL=search.d.ts.map