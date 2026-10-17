/**
 * Async utilities
 */
export class AsyncSemaphore {
    active = 0;
    waiters = [];
    limit;
    constructor(limit) {
        if (!Number.isFinite(limit) || limit <= 0) {
            throw new Error(`max concurrent operations must be > 0 (got ${limit})`);
        }
        this.limit = limit;
    }
    async acquire() {
        if (this.active >= this.limit) {
            await new Promise((resolve) => {
                this.waiters.push(resolve);
            });
        }
        this.active += 1;
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            this.active = Math.max(0, this.active - 1);
            const next = this.waiters.shift();
            if (next)
                next();
        };
    }
}
/**
 * Deduplicate concurrent calls to an async operation.
 *
 * While a call is in-flight, subsequent `run()` invocations return the same
 * promise. Once it settles, the next `run()` triggers a new call.
 */
export class AsyncSingleflight {
    promise = null;
    run(fn) {
        if (this.promise)
            return this.promise;
        this.promise = fn().finally(() => {
            this.promise = null;
        });
        return this.promise;
    }
}
//# sourceMappingURL=async.js.map