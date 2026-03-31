import type { SqlRow } from "../../data/AppDataProvider";
import {
  type DocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
  parseDocumentRecord,
  parsePendingUpdateRecord,
} from "../../data/documentPersistence";
import {
  type ExecSql,
  ensureSqlTables,
  readSqlRowValue,
} from "../../data/sqlSchema";
import type { AddressBookEntry } from "./types";

export interface AddressBookPendingUpdateInsert extends PendingUpdateFields {
  addressBookId: string;
}

export interface AddressBookState {
  entries: ReadonlyArray<AddressBookEntry>;
  record: DocumentRecord | null;
}

export interface ContactsPersistence {
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  loadAddressBook: (
    execSql: ExecSql,
    addressBookId: string,
  ) => Promise<AddressBookState>;
  saveAddressBook: (
    execSql: ExecSql,
    record: DocumentRecord,
    entries: ReadonlyArray<AddressBookEntry>,
  ) => Promise<void>;
  listPendingUpdates: (
    execSql: ExecSql,
    addressBookId: string,
  ) => Promise<PendingUpdateRecord[]>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    pendingUpdate: AddressBookPendingUpdateInsert,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
}

const contactsTables = [
  {
    name: "address_book_entries",
    createSql: `
      CREATE TABLE IF NOT EXISTS address_book_entries (
        user_id TEXT PRIMARY KEY,
        address_book_id TEXT NOT NULL DEFAULT 'default',
        encapsulation_public_key TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
    requiredColumns: [
      {
        name: "address_book_id",
        addSql:
          "ALTER TABLE address_book_entries ADD COLUMN address_book_id TEXT NOT NULL DEFAULT 'default'",
      },
    ],
  },
  {
    name: "address_books",
    createSql: `
      CREATE TABLE IF NOT EXISTS address_books (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        loro_snapshot TEXT NOT NULL,
        access_epoch INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `,
  },
  {
    name: "address_book_pending_updates",
    createSql: `
      CREATE TABLE IF NOT EXISTS address_book_pending_updates (
        id TEXT PRIMARY KEY,
        address_book_id TEXT NOT NULL,
        update_data TEXT NOT NULL,
        partial_start_version_vector TEXT NOT NULL,
        partial_end_version_vector TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
  },
] as const;

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

async function loadEntries(
  execSql: ExecSql,
  addressBookId: string,
): Promise<ReadonlyArray<AddressBookEntry>> {
  const rows = await execSql(
    `
      SELECT user_id, encapsulation_public_key
      FROM address_book_entries
      WHERE address_book_id = :addressBookId
      ORDER BY user_id COLLATE NOCASE ASC
    `,
    {
      ":addressBookId": addressBookId,
    },
  );

  return rows.map((row) => parseAddressBookEntry(row));
}

async function replaceEntries(
  execSql: ExecSql,
  addressBookId: string,
  entries: ReadonlyArray<AddressBookEntry>,
) {
  await execSql(
    `
      DELETE FROM address_book_entries
      WHERE address_book_id = :addressBookId
    `,
    {
      ":addressBookId": addressBookId,
    },
  );

  for (const entry of entries) {
    await execSql(
      `
        INSERT INTO address_book_entries (
          user_id,
          address_book_id,
          encapsulation_public_key,
          updated_at
        )
        VALUES (
          :userId,
          :addressBookId,
          :encapsulationPublicKey,
          :updatedAt
        )
      `,
      {
        ":userId": entry.userId,
        ":addressBookId": addressBookId,
        ":encapsulationPublicKey": entry.encapsulationPublicKey,
        ":updatedAt": new Date().toISOString(),
      },
    );
  }
}

export const sqlContactsPersistence: ContactsPersistence = {
  async ensureSchema(execSql) {
    await ensureSqlTables(execSql, contactsTables);
  },
  async loadAddressBook(execSql, addressBookId) {
    const [recordRows, entries] = await Promise.all([
      execSql(
        `
          SELECT id, document_id, loro_snapshot, access_epoch
          FROM address_books
          WHERE id = :id
          LIMIT 1
        `,
        {
          ":id": addressBookId,
        },
      ),
      loadEntries(execSql, addressBookId),
    ]);

    return {
      entries,
      record: recordRows[0] ? parseDocumentRecord(recordRows[0]) : null,
    };
  },
  async saveAddressBook(execSql, record, entries) {
    await execSql(
      `
        INSERT INTO address_books (
          id,
          document_id,
          loro_snapshot,
          access_epoch,
          updated_at
        )
        VALUES (
          :id,
          :documentId,
          :loroSnapshot,
          :accessEpoch,
          :updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          document_id = excluded.document_id,
          loro_snapshot = excluded.loro_snapshot,
          access_epoch = excluded.access_epoch,
          updated_at = excluded.updated_at
      `,
      {
        ":id": record.id,
        ":documentId": record.documentId,
        ":loroSnapshot": record.loroSnapshot,
        ":accessEpoch": record.accessEpoch,
        ":updatedAt": new Date().toISOString(),
      },
    );

    await replaceEntries(execSql, record.id, entries);
  },
  async listPendingUpdates(execSql, addressBookId) {
    const rows = await execSql(
      `
        SELECT id, update_data
          , partial_start_version_vector
          , partial_end_version_vector
        FROM address_book_pending_updates
        WHERE address_book_id = :addressBookId
        ORDER BY created_at ASC
      `,
      {
        ":addressBookId": addressBookId,
      },
    );

    return rows.map((row) => parsePendingUpdateRecord(row));
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await execSql(
      `
        INSERT INTO address_book_pending_updates (
          id,
          address_book_id,
          update_data,
          partial_start_version_vector,
          partial_end_version_vector,
          created_at
        )
        VALUES (
          :id,
          :addressBookId,
          :updateData,
          :partialStartVersionVector,
          :partialEndVersionVector,
          :createdAt
        )
      `,
      {
        ":id": crypto.randomUUID(),
        ":addressBookId": pendingUpdate.addressBookId,
        ":updateData": pendingUpdate.updateData,
        ":partialStartVersionVector": pendingUpdate.partialStartVersionVector,
        ":partialEndVersionVector": pendingUpdate.partialEndVersionVector,
        ":createdAt": new Date().toISOString(),
      },
    );
  },
  async deletePendingUpdate(execSql, id) {
    await execSql(
      `
        DELETE FROM address_book_pending_updates
        WHERE id = :id
      `,
      {
        ":id": id,
      },
    );
  },
};
