import type { SqliteDatabase } from "./database.ts";
import { type SqliteSchema } from "./schema.ts";
export type SqliteMigration = {
    readonly version: number;
    readonly statements: readonly string[];
};
/** Build immutable, ordered schema history for a set of SQLite identifiers. */
export declare function createSqliteMigrations(schema: SqliteSchema): readonly SqliteMigration[];
export declare const SQLITE_MIGRATIONS: readonly SqliteMigration[];
export declare const CURRENT_SQLITE_SCHEMA_VERSION: number;
/** Apply all pending schema migrations atomically. */
export declare function applySqliteMigrations(database: SqliteDatabase, migrations?: readonly SqliteMigration[]): Promise<void>;
/** Apply migrations rendered for a particular schema. */
export declare function applySqliteMigrationsForSchema(database: SqliteDatabase, schema: SqliteSchema, migrations?: readonly SqliteMigration[]): Promise<void>;
//# sourceMappingURL=migrations.d.ts.map