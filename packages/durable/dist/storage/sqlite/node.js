import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateSqliteSchemaPrefix } from "./schema.js";
import { SqliteStorage } from "./storage.js";
const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;
const ignore = () => { };
/**
 * Runs operations in call order. An operation starts immediately when nothing is running or waiting;
 * otherwise it waits for everything before it. An asynchronous operation holds the queue until it settles.
 */
class SerialOperationQueue {
    tail = Promise.resolve();
    pending = 0;
    run(operation) {
        if (this.pending > 0)
            return this.enqueue(operation);
        try {
            return Promise.resolve(operation());
        }
        catch (error) {
            return Promise.reject(error);
        }
    }
    runAsync(operation) {
        if (this.pending > 0)
            return this.enqueue(operation);
        this.pending++;
        // Publish the barrier before the operation starts, so calls it makes synchronously wait behind it.
        const { promise: barrier, resolve: releaseBarrier } = Promise.withResolvers();
        this.tail = barrier;
        let started;
        try {
            started = operation();
        }
        catch (error) {
            started = Promise.reject(error);
        }
        return started.finally(() => {
            this.pending--;
            releaseBarrier();
        });
    }
    enqueue(operation) {
        this.pending++;
        return this.release(this.tail.then(operation));
    }
    release(operation) {
        const settled = operation.finally(() => {
            this.pending--;
        });
        this.tail = settled.then(ignore, ignore);
        return settled;
    }
}
/**
 * Executes SQL on one connection. Prepared statements are cached per connection by SQL text, so the
 * database and its transaction handles share them across transactions.
 */
class NodeSqliteExecutor {
    database;
    statements;
    constructor(database, statements) {
        this.database = database;
        this.statements = statements;
    }
    exec(sql) {
        return this.runOperation(() => {
            this.database.exec(sql);
        });
    }
    run(sql, ...params) {
        return this.runOperation(() => {
            this.statement(sql).run(...params);
        });
    }
    get(sql, ...params) {
        return this.runOperation(() => this.statement(sql).get(...params));
    }
    all(sql, ...params) {
        return this.runOperation(() => this.statement(sql).all(...params));
    }
    statement(sql) {
        let statement = this.statements.get(sql);
        if (statement === undefined) {
            statement = this.database.prepare(sql);
            this.statements.set(sql, statement);
        }
        return statement;
    }
}
class NodeSqliteTransaction extends NodeSqliteExecutor {
    scope;
    constructor(database, statements, scope) {
        super(database, statements);
        this.scope = scope;
    }
    async runOperation(operation) {
        if (!this.scope.active)
            throw new Error("SQLite transaction handle is no longer active");
        return operation();
    }
}
/** `SqliteDatabase` adapter backed by Node's built-in `node:sqlite`. */
export class NodeSqliteDatabase extends NodeSqliteExecutor {
    access = new SerialOperationQueue();
    closed = false;
    constructor(database) {
        super(database, new Map());
    }
    transaction(callback) {
        return this.access.runAsync(async () => {
            this.database.exec("BEGIN IMMEDIATE");
            const scope = { active: true };
            try {
                const result = await callback(new NodeSqliteTransaction(this.database, this.statements, scope));
                scope.active = false;
                this.database.exec("COMMIT");
                return result;
            }
            catch (error) {
                scope.active = false;
                try {
                    this.database.exec("ROLLBACK");
                }
                catch (rollbackError) {
                    throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed");
                }
                throw error;
            }
        });
    }
    close() {
        return this.access.run(() => {
            if (this.closed)
                return;
            this.closed = true;
            this.statements.clear();
            try {
                this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
            }
            finally {
                this.database.close();
            }
        });
    }
    runOperation(operation) {
        return this.access.run(operation);
    }
}
/** Open and configure a Node-backed SQLite database facade. */
export async function openNodeSqliteDatabase(path, options = {}) {
    const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;
    const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
    if (path !== ":memory:")
        await mkdir(dirname(path), { recursive: true });
    const database = new DatabaseSync(path, { timeout });
    const adapter = new NodeSqliteDatabase(database);
    try {
        await adapter.exec("PRAGMA journal_mode = WAL");
        await adapter.exec("PRAGMA synchronous = NORMAL");
        await adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`);
        return adapter;
    }
    catch (error) {
        try {
            await adapter.close();
        }
        catch {
            // Preserve the configuration failure.
        }
        throw error;
    }
}
/** Open or create file-backed durable storage using Node's built-in SQLite, optionally under a table prefix. */
export async function openNodeSqliteStorage(path, options = {}) {
    const { prefix, ...databaseOptions } = options;
    if (prefix !== undefined)
        validateSqliteSchemaPrefix(prefix);
    return SqliteStorage.open(await openNodeSqliteDatabase(path, databaseOptions), { prefix });
}
//# sourceMappingURL=node.js.map