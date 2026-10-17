/**
 * Async utilities
 */
export declare class AsyncSemaphore {
    private active;
    private readonly waiters;
    private readonly limit;
    constructor(limit: number);
    acquire(): Promise<() => void>;
}
/**
 * Deduplicate concurrent calls to an async operation.
 *
 * While a call is in-flight, subsequent `run()` invocations return the same
 * promise. Once it settles, the next `run()` triggers a new call.
 */
export declare class AsyncSingleflight<T> {
    private promise;
    run(fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=async.d.ts.map