import type { SqlRow } from "../../data/AppDataProvider";
import {
  type DocumentRecord,
  type DocumentScope,
  deleteDocumentPendingUpdate,
  enqueueDocumentPendingUpdate,
  ensureDocumentTables,
  listDocumentPendingUpdates,
  loadDocumentRecord,
  type PendingUpdateFields,
  type PendingUpdateRecord,
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

function getAddressBookScope(addressBookId: string): DocumentScope {
  return {
    appKind: CONTACTS_APP_KIND,
    localId: addressBookId,
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

async function loadEntries(
  execSql: ExecSql,
  addressBookId: string,
): Promise<ReadonlyArray<AddressBookEntry>> {
  const rows = await execSql(
    `
      SELECT user_id, encapsulation_public_key
      FROM address_book_projection
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
  updatedAt: string,
) {
  await execSql(
    `
      DELETE FROM address_book_projection
      WHERE address_book_id = :addressBookId
    `,
    {
      ":addressBookId": addressBookId,
    },
  );

  for (const entry of entries) {
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
      `,
      {
        ":addressBookId": addressBookId,
        ":userId": entry.userId,
        ":encapsulationPublicKey": entry.encapsulationPublicKey,
        ":updatedAt": updatedAt,
      },
    );
  }
}

export const sqlContactsPersistence: ContactsPersistence = {
  async ensureSchema(execSql) {
    await ensureDocumentTables(execSql);
    await ensureSqlTables(execSql, addressBookProjectionTables);
  },
  async loadAddressBook(execSql, addressBookId) {
    const [record, entries] = await Promise.all([
      loadDocumentRecord(execSql, getAddressBookScope(addressBookId)),
      loadEntries(execSql, addressBookId),
    ]);

    return {
      entries,
      record,
    };
  },
  async saveAddressBook(execSql, record, entries) {
    const updatedAt = new Date().toISOString();

    await runSqlTransaction(execSql, async () => {
      await saveDocumentRecord(
        execSql,
        getAddressBookScope(record.id),
        record,
        updatedAt,
      );
      await replaceEntries(execSql, record.id, entries, updatedAt);
    });
  },
  async listPendingUpdates(execSql, addressBookId) {
    return listDocumentPendingUpdates(
      execSql,
      getAddressBookScope(addressBookId),
    );
  },
  async enqueuePendingUpdate(execSql, pendingUpdate) {
    await enqueueDocumentPendingUpdate(
      execSql,
      getAddressBookScope(pendingUpdate.addressBookId),
      pendingUpdate,
    );
  },
  async deletePendingUpdate(execSql, id) {
    await deleteDocumentPendingUpdate(execSql, id);
  },
};
