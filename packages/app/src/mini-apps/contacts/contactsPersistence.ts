import type { SqlRow } from "../../data/AppDataProvider";
import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdate,
  deleteDocumentPendingUpdates,
  deleteDocumentRecord,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  parseDocumentRecord,
  saveDocumentRecord,
} from "../../data/documentPersistence";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
  runSqlTransaction,
  type SqlTableSchema,
} from "../../data/sqlSchema";
import type { AddressBookEntry } from "./types";

export interface ContactPendingUpdateInsert extends PendingUpdateFields {
  userId: string;
}

export interface StoredContact {
  entry: AddressBookEntry;
  record: DocumentRecord | null;
}

export interface ContactsPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  loadContacts: (
    execSql: ExecSql,
    addressBookId: string,
  ) => Promise<ReadonlyArray<StoredContact>>;
  saveContact: (
    execSql: ExecSql,
    addressBookId: string,
    record: DocumentRecord,
    entry: AddressBookEntry,
  ) => Promise<void>;
  deleteContact: (
    execSql: ExecSql,
    addressBookId: string,
    userId: string,
  ) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    userId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: ContactPendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
}

const CONTACTS_APP_KIND = "contacts";

const addressBookProjectionTables: ReadonlyArray<SqlTableSchema> = [
  {
    name: "address_book_projection",
    createSql: `
      CREATE TABLE IF NOT EXISTS address_book_projection (
        address_book_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        encapsulation_public_key TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (address_book_id, user_id)
      )
    `,
  },
];

function getContactScope(userId: string): DocumentScope {
  return {
    appKind: CONTACTS_APP_KIND,
    localId: userId,
  };
}

function parseAddressBookEntry(row: SqlRow): AddressBookEntry {
  const userId = readSqlRowValue(row, "user_id");
  const encapsulationPublicKey = readSqlRowValue(
    row,
    "encapsulation_public_key",
  );

  return {
    userId: String(userId ?? ""),
    encapsulationPublicKey: String(encapsulationPublicKey ?? ""),
  };
}

function parseStoredContact(row: SqlRow): StoredContact {
  const id = readSqlRowValue(row, "id");

  return {
    entry: parseAddressBookEntry(row),
    record:
      id === null || typeof id === "undefined"
        ? null
        : parseDocumentRecord(row),
  };
}

export const sqlContactsPersistence: ContactsPersistence = {
  async ensureSchema(execSql) {
    await ensureDocumentTables(execSql);
    await ensureSqlTables(execSql, addressBookProjectionTables);
  },
  async loadContacts(execSql, addressBookId) {
    const rows = await execSql(
      `
        SELECT
          projection.user_id,
          projection.encapsulation_public_key,
          documents.local_id AS id,
          documents.document_id,
          documents.loro_snapshot,
          documents.access_epoch
        FROM address_book_projection AS projection
        LEFT JOIN documents
          ON documents.app_kind = :appKind
         AND documents.local_id = projection.user_id
        WHERE projection.address_book_id = :addressBookId
        ORDER BY projection.user_id COLLATE NOCASE ASC
      `,
      {
        ":appKind": CONTACTS_APP_KIND,
        ":addressBookId": addressBookId,
      },
    );

    return rows.map((row) => parseStoredContact(row));
  },
  async saveContact(execSql, addressBookId, record, entry) {
    const updatedAt = new Date().toISOString();

    await runSqlTransaction(execSql, async () => {
      await saveDocumentRecord(
        execSql,
        getContactScope(entry.userId),
        {
          ...record,
          id: entry.userId,
        },
        updatedAt,
      );
      await execSql(
        `
          INSERT INTO address_book_projection (
            address_book_id,
            user_id,
            encapsulation_public_key,
            updated_at
          )
          VALUES (
            :addressBookId,
            :userId,
            :encapsulationPublicKey,
            :updatedAt
          )
          ON CONFLICT(address_book_id, user_id) DO UPDATE SET
            encapsulation_public_key = excluded.encapsulation_public_key,
            updated_at = excluded.updated_at
        `,
        {
          ":addressBookId": addressBookId,
          ":userId": entry.userId,
          ":encapsulationPublicKey": entry.encapsulationPublicKey,
          ":updatedAt": updatedAt,
        },
      );
    });
  },
  async deleteContact(execSql, addressBookId, userId) {
    await runSqlTransaction(execSql, async () => {
      await execSql(
        `
          DELETE FROM address_book_projection
          WHERE address_book_id = :addressBookId
            AND user_id = :userId
        `,
        {
          ":addressBookId": addressBookId,
          ":userId": userId,
        },
      );
      await deleteDocumentRecord(execSql, getContactScope(userId));
      await deleteDocumentPendingUpdates(execSql, getContactScope(userId));
    });
  },
  async listPendingUpdates(execSql, userId) {
    return listDocumentPendingUpdates(execSql, getContactScope(userId));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await enqueueDocumentPendingUpdate(
      execSql,
      getContactScope(pendingUpdate.userId),
      pendingUpdate,
    );
  },
  async deletePendingUpdate(execSql, id) {
    await deleteDocumentPendingUpdate(execSql, id);
  },
};
