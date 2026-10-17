import { apply } from "@earendil-works/chord/delta";
import { StorageRequestError } from "../../errors.js";
import { idFromNumber, seqFromNumber } from "../../ids.js";
import { nextCursor, scanStart } from "../scan.js";
import { applySqliteMigrationsForSchema } from "./migrations.js";
import { createSqliteSchema } from "./schema.js";
const parseJson = (value) => JSON.parse(value);
const encodeJson = (value) => JSON.stringify(value);
// Some SQLite bindings replace lone UTF-16 surrogates. JSON encoding keeps indexed identities lossless.
const encodeIndexedString = (value) => JSON.stringify(value);
const cursorId = (cursor) => {
    const after = cursor?.after;
    if (after === undefined)
        return undefined;
    if (typeof after !== "number" || !Number.isSafeInteger(after))
        throw new StorageRequestError("Invalid storage cursor");
    return idFromNumber(after);
};
const page = (values, limit, order = "ascending") => {
    const items = values.slice(0, limit);
    if (values.length <= limit)
        return { items };
    return { items, next: nextCursor(items.at(-1).id, order) };
};
/** The ID condition, its parameter, and the `ORDER BY` direction of a table scan. */
const scanSql = (start) => start.order === "ascending"
    ? { clause: "id > ?", param: start.after ?? -1, direction: "ASC" }
    : { clause: "id < ?", param: start.after ?? Number.MAX_SAFE_INTEGER, direction: "DESC" };
const scopeColumns = (scope) => {
    switch (scope.kind) {
        case "session":
            return { scopeKind: "session", ownerId: 0 };
        case "conversation":
            return { scopeKind: "conversation", ownerId: scope.conversationId };
        case "task":
            return { scopeKind: "task", ownerId: scope.taskId };
    }
};
const addressParts = (address) => {
    const scope = scopeColumns(address.scope);
    return {
        kind: encodeIndexedString(address.kind),
        ...scope,
        family: address.key === undefined ? 0 : 1,
        keyValue: encodeIndexedString(address.key ?? ""),
    };
};
const addressKey = (address) => {
    const parts = addressParts(address);
    return JSON.stringify([parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue]);
};
const isAliveAt = (record, at) => {
    if (at === "current")
        return record.retiredAt === undefined;
    return record.createdAt <= at && (record.retiredAt === undefined || at < record.retiredAt);
};
const isCurrentOnly = (record) => record.scope.kind !== "conversation" || record.history === "latest";
const writeId = (write) => {
    switch (write.type) {
        case "conversation":
        case "entry":
        case "task":
        case "submission":
            return write.value.id;
        case "document.create":
        case "document.copy":
            return write.record.id;
        case "document.change":
        case "document.retire":
            return undefined;
    }
};
/** Portable SQLite implementation of the Pico storage contract. */
export class SqliteStorage {
    db;
    schema;
    nextId;
    closed = false;
    closing;
    admittedReads = 0;
    readsDrained;
    constructor(db, schema, nextId) {
        this.db = db;
        this.schema = schema;
        this.nextId = nextId;
    }
    /** Initialize storage over an owned SQLite database facade. */
    static async open(db, options = {}) {
        try {
            const schema = createSqliteSchema(options.prefix);
            await applySqliteMigrationsForSchema(db, schema);
            const metadata = await db.get(`SELECT next_id, next_seq FROM ${schema.tables.durableMetadata} WHERE singleton = 1`);
            if (metadata === undefined)
                throw new Error("Durable SQLite metadata is missing");
            return new SqliteStorage(db, schema, Number(metadata.next_id));
        }
        catch (error) {
            try {
                await db.close();
            }
            catch {
                // Preserve the initialization failure.
            }
            throw error;
        }
    }
    async commit(writes, _context) {
        this.assertOpen();
        const documentActions = this.prepareDocumentActions(writes);
        const candidateNextId = this.candidateNextId(writes);
        const seq = await this.db.transaction(async (transaction) => {
            const metadata = await transaction.get(`SELECT next_id, next_seq FROM ${this.schema.tables.durableMetadata} WHERE singleton = 1`);
            if (metadata === undefined)
                throw new Error("Durable SQLite metadata is missing");
            const committedSeq = seqFromNumber(metadata.next_seq);
            await this.checkGlobalIds(transaction, writes);
            await this.checkDocumentActions(transaction, documentActions);
            for (const write of writes)
                await this.applyTableWrite(transaction, write, committedSeq);
            await this.applyDocumentActions(transaction, documentActions, committedSeq);
            await transaction.run(`UPDATE ${this.schema.tables.durableMetadata} SET next_id = ?, next_seq = ? WHERE singleton = 1`, String(Math.max(Number(metadata.next_id), candidateNextId)), committedSeq + 1);
            return committedSeq;
        });
        this.nextId = Math.max(this.nextId, candidateNextId);
        return seq;
    }
    async mintId() {
        this.assertOpen();
        if (!Number.isSafeInteger(this.nextId))
            throw new Error("ID space is exhausted");
        return idFromNumber(this.nextId++);
    }
    async conversation(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.conversations} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanConversations(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.ownerConversationId !== undefined) {
            clauses.push("owner_conversation_id = ?");
            params.push(query.ownerConversationId);
        }
        if (query.ownerTaskId !== undefined) {
            clauses.push("owner_task_id = ?");
            params.push(query.ownerTaskId);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.conversations} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    entry(idOrConversationId, idOrContext, context) {
        return this.admitRead(() => this.readEntry(idOrConversationId, idOrContext, context));
    }
    findLatestHeadMarker(conversationId, atOrBeforeEntryId, _context) {
        return this.admitRead(() => this.readLatestHeadMarker(conversationId, atOrBeforeEntryId));
    }
    scanEntries(query, limit, cursor, _context) {
        return this.admitRead(() => this.readEntries(query, limit, cursor));
    }
    async readEntry(idOrConversationId, idOrContext, context) {
        const id = context === undefined
            ? idFromNumber(idOrConversationId)
            : typeof idOrContext === "number"
                ? idFromNumber(idOrContext)
                : undefined;
        if (id === undefined)
            throw new StorageRequestError("Storage.entry() requires an entry ID");
        let conversation;
        if (context !== undefined) {
            const conversationId = idFromNumber(idOrConversationId);
            conversation = await this.readConversation(conversationId);
            if (conversation === undefined)
                throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        }
        const row = await this.db.get(`SELECT record, commit_seq FROM ${this.schema.tables.entries} WHERE id = ?`, id);
        if (row === undefined)
            return undefined;
        const entry = parseJson(row.record);
        if (conversation !== undefined) {
            let upperEntryId = Number.POSITIVE_INFINITY;
            while (conversation.id !== entry.conversationId) {
                if (conversation.parent === undefined)
                    return undefined;
                upperEntryId = Math.min(upperEntryId, conversation.parent.at);
                conversation = (await this.readConversation(conversation.parent.conversationId));
            }
            if (entry.id > upperEntryId)
                return undefined;
        }
        return { entry, commitSeq: seqFromNumber(row.commit_seq) };
    }
    async readLatestHeadMarker(conversationId, atOrBeforeEntryId) {
        let conversation = await this.readConversation(conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${conversationId}`);
        let upper = atOrBeforeEntryId;
        while (true) {
            const row = upper === undefined
                ? await this.db.get(`SELECT record FROM ${this.schema.tables.entries} WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1`, conversation.id)
                : await this.db.get(`SELECT record FROM ${this.schema.tables.entries} WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1`, conversation.id, upper);
            if (row !== undefined)
                return parseJson(row.record);
            if (conversation.parent === undefined)
                return undefined;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
    }
    async readEntries(query, limit, cursor) {
        const { order, after } = scanStart(query.order, cursor, "descending");
        if (order === "ascending")
            return this.readEntriesAscending(query, limit, after);
        let conversation = await this.readConversation(query.conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`);
        let upper = query.maxEntryId;
        if (after !== undefined)
            upper = Math.min(upper ?? Number.MAX_SAFE_INTEGER, after - 1);
        const values = [];
        while (true) {
            const clauses = ["conversation_id = ?"];
            const params = [conversation.id];
            if (query.minEntryId !== undefined) {
                clauses.push("id >= ?");
                params.push(query.minEntryId);
            }
            if (upper !== undefined) {
                clauses.push("id <= ?");
                params.push(upper);
            }
            params.push(limit + 1 - values.length);
            const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.entries} WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...params);
            values.push(...rows.map((row) => parseJson(row.record)));
            if (values.length > limit || conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
        return page(values, limit, "descending");
    }
    /** Oldest first: the fork chain's segments from the root conversation forward, each up to its fork point. */
    async readEntriesAscending(query, limit, after) {
        const segments = [];
        let conversation = await this.readConversation(query.conversationId);
        if (conversation === undefined)
            throw new StorageRequestError(`Unknown conversation: ${query.conversationId}`);
        let upper = query.maxEntryId;
        while (true) {
            segments.push({ conversationId: conversation.id, upper });
            if (conversation.parent === undefined)
                break;
            upper = upper === undefined ? conversation.parent.at : Math.min(upper, conversation.parent.at);
            if (query.minEntryId !== undefined && upper < query.minEntryId)
                break;
            conversation = (await this.readConversation(conversation.parent.conversationId));
        }
        let lower = query.minEntryId;
        if (after !== undefined)
            lower = Math.max(lower ?? after + 1, after + 1);
        const values = [];
        for (const segment of segments.reverse()) {
            const clauses = ["conversation_id = ?"];
            const params = [segment.conversationId];
            if (lower !== undefined) {
                clauses.push("id >= ?");
                params.push(lower);
            }
            if (segment.upper !== undefined) {
                clauses.push("id <= ?");
                params.push(segment.upper);
            }
            params.push(limit + 1 - values.length);
            const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.entries} WHERE ${clauses.join(" AND ")} ORDER BY id ASC LIMIT ?`, ...params);
            values.push(...rows.map((row) => parseJson(row.record)));
            if (values.length > limit)
                break;
        }
        return page(values, limit, "ascending");
    }
    async task(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.tasks} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanTasks(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.conversationId !== undefined) {
            clauses.push("conversation_id = ?");
            params.push(query.conversationId);
        }
        if (query.kind !== undefined) {
            clauses.push("kind = ?");
            params.push(encodeIndexedString(query.kind));
        }
        if (query.status !== undefined) {
            clauses.push("status = ?");
            params.push(query.status);
        }
        if (query.abortRequested !== undefined) {
            clauses.push("abort_requested = ?");
            params.push(query.abortRequested ? 1 : 0);
        }
        if (query.background !== undefined) {
            clauses.push("background = ?");
            params.push(query.background ? 1 : 0);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.tasks} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    async submission(id, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.submissions} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async scanSubmissions(query, limit, cursor, _context) {
        this.assertOpen();
        const start = scanStart(query.order, cursor, "ascending");
        const scan = scanSql(start);
        const clauses = [scan.clause];
        const params = [scan.param];
        if (query.conversationId !== undefined) {
            clauses.push("conversation_id = ?");
            params.push(query.conversationId);
        }
        if (query.status !== undefined) {
            clauses.push("status = ?");
            params.push(query.status);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.submissions} WHERE ${clauses.join(" AND ")} ORDER BY id ${scan.direction} LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit, start.order);
    }
    async submissionByRequest(conversationId, requestId, _context) {
        this.assertOpen();
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.submissions} WHERE conversation_id = ? AND request_id = ?`, conversationId, encodeIndexedString(requestId));
        return row === undefined ? undefined : parseJson(row.record);
    }
    async findDocument(address, at, _context) {
        this.assertOpen();
        const parts = addressParts(address);
        const sql = at === "current"
            ? `SELECT record FROM ${this.schema.tables.documents}
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`
            : `SELECT record FROM ${this.schema.tables.documents}
					WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
					AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
					ORDER BY created_at DESC LIMIT 1`;
        const params = [parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue];
        if (at !== "current")
            params.push(at, at);
        const row = await this.db.get(sql, ...params);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async document(id, at, _context) {
        this.assertOpen();
        // The record and revision queries must observe one committed state; a commit between them can replace the base.
        return this.db.transaction((transaction) => this.materializeDocument(transaction, id, at));
    }
    async scanDocuments(query, limit, cursor, _context) {
        this.assertOpen();
        const scope = scopeColumns(query.scope);
        const clauses = ["scope_kind = ?", "owner_id = ?", "id > ?"];
        const params = [scope.scopeKind, scope.ownerId, cursorId(cursor) ?? -1];
        if (query.kind !== undefined) {
            clauses.push("kind = ?");
            params.push(encodeIndexedString(query.kind));
        }
        if (query.at === "current") {
            clauses.push("retired_at IS NULL");
        }
        else {
            clauses.push("created_at <= ?", "(retired_at IS NULL OR retired_at > ?)");
            params.push(query.at, query.at);
        }
        params.push(limit + 1);
        const rows = await this.db.all(`SELECT record FROM ${this.schema.tables.documents} WHERE ${clauses.join(" AND ")} ORDER BY id LIMIT ?`, ...params);
        return page(rows.map((row) => parseJson(row.record)), limit);
    }
    close(_context) {
        if (this.closing === undefined) {
            this.closed = true;
            this.closing = this.closeDatabase();
        }
        return this.closing;
    }
    async closeDatabase() {
        if (this.admittedReads > 0) {
            await new Promise((resolve) => {
                this.readsDrained = resolve;
            });
        }
        await this.db.close();
    }
    /**
     * Run a read that issues several queries. Close waits for admitted reads, so their later queries never reach a
     * closed database. Single-query reads and transactions are already ordered before close by the database.
     */
    async admitRead(read) {
        this.assertOpen();
        this.admittedReads++;
        try {
            return await read();
        }
        finally {
            if (--this.admittedReads === 0)
                this.readsDrained?.();
        }
    }
    async readConversation(id) {
        const row = await this.db.get(`SELECT record FROM ${this.schema.tables.conversations} WHERE id = ?`, id);
        return row === undefined ? undefined : parseJson(row.record);
    }
    async materializeDocument(executor, id, at) {
        const row = await executor.get(`SELECT record FROM ${this.schema.tables.documents} WHERE id = ?`, id);
        if (row === undefined)
            return undefined;
        const record = parseJson(row.record);
        if (at !== "current" && isCurrentOnly(record)) {
            throw new StorageRequestError(`Document ${id} does not retain historical content`);
        }
        if (!isAliveAt(record, at))
            return undefined;
        const upper = at === "current" ? Number.MAX_SAFE_INTEGER : at;
        const base = await executor.get(`SELECT seq, kind, version, content FROM ${this.schema.tables.documentRevisions}
				WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`, id, upper);
        if (base === undefined)
            throw new Error(`Document ${id} is missing a required base`);
        let value = parseJson(base.content);
        const tail = await executor.all(`SELECT seq, kind, version, content FROM ${this.schema.tables.documentRevisions}
				WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`, id, base.seq, upper);
        for (const revision of tail) {
            if (revision.kind !== "delta" || revision.version !== base.version) {
                throw new Error(`Document ${id} crosses a stored version boundary without a base`);
            }
            value = apply(value, parseJson(revision.content));
        }
        return { record, version: base.version, value, deltasSinceBase: tail.length };
    }
    candidateNextId(writes) {
        let nextId = this.nextId;
        for (const write of writes) {
            const id = writeId(write);
            if (id !== undefined)
                nextId = Math.max(nextId, id + 1);
        }
        return nextId;
    }
    async checkGlobalIds(executor, writes) {
        const claimed = new Map();
        for (const write of writes) {
            if (write.type === "document.change" || write.type === "document.retire")
                continue;
            const document = write.type === "document.create" || write.type === "document.copy";
            const table = document ? "document" : write.type;
            const id = document ? write.record.id : write.value.id;
            const existing = (await executor.get(`SELECT record_type FROM ${this.schema.tables.recordIds} WHERE id = ?`, id))?.record_type;
            const earlier = claimed.get(id);
            if (table === "conversation" || table === "entry" || table === "document") {
                if (existing !== undefined)
                    throw new Error(`ID ${id} already belongs to ${existing}`);
                if (earlier !== undefined)
                    throw new Error(`ID ${id} is written more than once`);
            }
            else {
                if (existing !== undefined && existing !== table)
                    throw new Error(`ID ${id} already belongs to ${existing}`);
                if (earlier !== undefined && earlier !== table)
                    throw new Error(`ID ${id} is written as two record types`);
            }
            claimed.set(id, table);
        }
    }
    prepareDocumentActions(writes) {
        const actions = new Map();
        for (const write of writes) {
            if (write.type !== "document.create" &&
                write.type !== "document.copy" &&
                write.type !== "document.change" &&
                write.type !== "document.retire") {
                continue;
            }
            const id = write.type === "document.create" || write.type === "document.copy" ? write.record.id : write.id;
            let action = actions.get(id);
            if (action === undefined) {
                action = { retire: false };
                actions.set(id, action);
            }
            switch (write.type) {
                case "document.create":
                    if (action.create !== undefined || action.content !== undefined || action.copy !== undefined) {
                        throw new Error(`Document ${id} has more than one content command`);
                    }
                    action.create = write.record;
                    action.content = write.content;
                    break;
                case "document.copy":
                    if (action.create !== undefined || action.content !== undefined || action.copy !== undefined) {
                        throw new Error(`Document ${id} has more than one content command`);
                    }
                    action.create = write.record;
                    action.copy = write.source;
                    break;
                case "document.change":
                    if (action.content !== undefined || action.copy !== undefined) {
                        throw new Error(`Document ${id} has more than one content command`);
                    }
                    action.content = write.content;
                    break;
                case "document.retire":
                    if (action.retire)
                        throw new Error(`Document ${id} is retired more than once`);
                    action.retire = true;
                    break;
            }
        }
        return actions;
    }
    async checkDocumentActions(executor, actions) {
        const liveCounts = new Map();
        for (const [id, action] of actions) {
            if (action.copy !== undefined && actions.has(action.copy.id)) {
                throw new Error(`Document copy ${id} source is changed in the copy batch`);
            }
            const row = await executor.get(`SELECT record FROM ${this.schema.tables.documents} WHERE id = ?`, id);
            const existing = row === undefined ? undefined : parseJson(row.record);
            if (action.create === undefined && existing === undefined)
                throw new Error(`Unknown document: ${id}`);
            if (action.create !== undefined && existing !== undefined)
                throw new Error(`Document ${id} already exists`);
            if (existing?.retiredAt !== undefined)
                throw new Error(`Document ${id} is retired`);
            if (action.content?.kind === "delta") {
                const previous = await executor.get(`SELECT version FROM ${this.schema.tables.documentRevisions} WHERE document_id = ? ORDER BY seq DESC LIMIT 1`, id);
                if (previous === undefined)
                    throw new Error(`Document ${id} delta has no base`);
                if (previous.version !== action.content.version) {
                    throw new Error(`Document ${id} version transition requires a base`);
                }
            }
            const record = action.create ?? existing;
            const key = addressKey(record);
            let live = liveCounts.get(key);
            if (live === undefined)
                live = (await this.currentDocumentId(executor, record)) === undefined ? 0 : 1;
            if (action.retire && existing !== undefined)
                live--;
            if (action.create !== undefined && !action.retire)
                live++;
            liveCounts.set(key, live);
        }
        for (const live of liveCounts.values()) {
            if (live > 1)
                throw new Error("Document address already has a current incarnation");
        }
    }
    async currentDocumentId(executor, address) {
        const parts = addressParts(address);
        const id = (await executor.get(`SELECT id FROM ${this.schema.tables.documents}
				WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ? AND retired_at IS NULL
				LIMIT 1`, parts.kind, parts.scopeKind, parts.ownerId, parts.family, parts.keyValue))?.id;
        return id === undefined ? undefined : idFromNumber(id);
    }
    async applyTableWrite(executor, write, seq) {
        switch (write.type) {
            case "conversation":
                await this.claimId(executor, write.value.id, "conversation");
                await executor.run(`INSERT INTO ${this.schema.tables.conversations} (id, owner_conversation_id, owner_task_id, record) VALUES (?, ?, ?, ?)`, write.value.id, write.value.owner?.conversationId ?? null, write.value.owner?.taskId ?? null, encodeJson(write.value));
                break;
            case "entry":
                await this.claimId(executor, write.value.id, "entry");
                await executor.run(`INSERT INTO ${this.schema.tables.entries} (id, conversation_id, head, commit_seq, record) VALUES (?, ?, ?, ?, ?)`, write.value.id, write.value.conversationId, write.value.head ?? null, seq, encodeJson(write.value));
                break;
            case "task":
                await this.claimId(executor, write.value.id, "task");
                await executor.run(`INSERT INTO ${this.schema.tables.tasks} (id, conversation_id, kind, status, abort_requested, background, record)
						VALUES (?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id, kind = excluded.kind,
						status = excluded.status, abort_requested = excluded.abort_requested,
						background = excluded.background, record = excluded.record`, write.value.id, write.value.conversationId, encodeIndexedString(write.value.kind), write.value.state.status, write.value.abortRequested ? 1 : 0, write.value.background ? 1 : 0, encodeJson(write.value));
                break;
            case "submission":
                await this.claimId(executor, write.value.id, "submission");
                await executor.run(`INSERT INTO ${this.schema.tables.submissions} (id, conversation_id, request_id, status, record) VALUES (?, ?, ?, ?, ?)
						ON CONFLICT(id) DO UPDATE SET conversation_id = excluded.conversation_id,
						request_id = excluded.request_id, status = excluded.status, record = excluded.record`, write.value.id, write.value.conversationId, write.value.requestId === undefined ? null : encodeIndexedString(write.value.requestId), write.value.status, encodeJson(write.value));
                break;
            case "document.create":
            case "document.copy":
            case "document.change":
            case "document.retire":
                break;
        }
    }
    async claimId(executor, id, table) {
        await executor.run(`INSERT OR IGNORE INTO ${this.schema.tables.recordIds} (id, record_type) VALUES (?, ?)`, id, table);
    }
    async applyDocumentActions(executor, actions, seq) {
        for (const [id, action] of actions) {
            let content = action.content;
            if (action.copy !== undefined) {
                try {
                    const stored = await this.materializeDocument(executor, action.copy.id, action.copy.at);
                    if (stored === undefined)
                        throw new Error(`Fork source document ${action.copy.id} cannot be read`);
                    const create = action.create;
                    if (stored.record.scope.kind !== "conversation" ||
                        create.scope.kind !== "conversation" ||
                        stored.record.kind !== create.kind ||
                        stored.record.key !== create.key ||
                        stored.record.history !== create.history ||
                        stored.record.fork !== create.fork) {
                        throw new Error(`Fork source document ${action.copy.id} does not match the copied record`);
                    }
                    content = { kind: "base", version: stored.version, value: stored.value };
                }
                catch (error) {
                    throw new Error(`Document copy ${id} was rejected`, { cause: error });
                }
            }
            let record;
            if (action.create !== undefined) {
                record = {
                    ...action.create,
                    createdAt: seq,
                    ...(action.retire ? { retiredAt: seq } : {}),
                };
                const parts = addressParts(record);
                await this.claimId(executor, id, "document");
                await executor.run(`INSERT INTO ${this.schema.tables.documents}
						(id, kind, family, key_value, scope_kind, owner_id, created_at, retired_at, record)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, parts.kind, parts.family, parts.keyValue, parts.scopeKind, parts.ownerId, seq, action.retire ? seq : null, encodeJson(record));
            }
            else {
                const row = (await executor.get(`SELECT record FROM ${this.schema.tables.documents} WHERE id = ?`, id));
                record = parseJson(row.record);
            }
            if (content !== undefined) {
                if (content.kind === "base" && isCurrentOnly(record)) {
                    await executor.run(`DELETE FROM ${this.schema.tables.documentRevisions} WHERE document_id = ?`, id);
                }
                const encodedContent = content.kind === "base" ? encodeJson(content.value) : encodeJson(content.ops);
                await executor.run(`INSERT INTO ${this.schema.tables.documentRevisions} (document_id, seq, kind, version, content) VALUES (?, ?, ?, ?, ?)`, id, seq, content.kind, content.version, encodedContent);
            }
            if (action.retire) {
                if (action.create === undefined) {
                    record = { ...record, retiredAt: seq };
                    await executor.run(`UPDATE ${this.schema.tables.documents} SET retired_at = ?, record = ? WHERE id = ?`, seq, encodeJson(record), id);
                }
                if (isCurrentOnly(record)) {
                    await executor.run(`DELETE FROM ${this.schema.tables.documentRevisions} WHERE document_id = ?`, id);
                }
            }
        }
    }
    assertOpen() {
        if (this.closed)
            throw new Error("SqliteStorage is closed");
    }
}
//# sourceMappingURL=storage.js.map