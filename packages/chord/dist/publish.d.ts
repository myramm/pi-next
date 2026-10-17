/** Runs `task` after everything enqueued before it. Tasks must not throw (report instead). */
export declare function enqueue(task: () => void): void;
/** Delivers nothing until `fn` returns, then everything it enqueued, in order. */
export declare function holdPublications<T>(fn: () => T): T;
//# sourceMappingURL=publish.d.ts.map