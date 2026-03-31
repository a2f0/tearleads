import type { SqlRow } from "../../data/AppDataProvider";
import { ensureSqlTables, readSqlRowValue } from "../../data/sqlSchema";
import type { AddressBookEntry, ContactsExecSql } from "./ContactsProvider";

export interface ContactsPersistence {
  ensureSchema: (execSql: ContactsExecSql) => Promise<void>;
  listEntries: (
    execSql: ContactsExecSql,
  ) => Promise<ReadonlyArray<AddressBookEntry>>;
  removeEntry: (execSql: ContactsExecSql, userId: string) => Promise<void>;
  saveEntry: (
    execSql: ContactsExecSql,
    entry: AddressBookEntry,
  ) => Promise<void>;
}

const contactsTables = [
  {
    name: "address_book_entries",
    createSql: `
      CREATE TABLE IF NOT EXISTS address_book_entries (
        user_id TEXT PRIMARY KEY,
        encapsulation_public_key TEXT NOT NULL,
        updated_at TEXT NOT NULL
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

export const sqlContactsPersistence: ContactsPersistence = {
  async ensureSchema(execSql) {
    await ensureSqlTables(execSql, contactsTables);
  },
  async listEntries(execSql) {
    const rows = await execSql(`
      SELECT user_id, encapsulation_public_key
      FROM address_book_entries
      ORDER BY user_id COLLATE NOCASE ASC
    `);

    return rows.map((row) => parseAddressBookEntry(row));
  },
  async removeEntry(execSql, userId) {
    await execSql(
      `
        DELETE FROM address_book_entries
        WHERE user_id = :userId
      `,
      {
        ":userId": userId,
      },
    );
  },
  async saveEntry(execSql, entry) {
    await execSql(
      `
        INSERT INTO address_book_entries (
          user_id,
          encapsulation_public_key,
          updated_at
        )
        VALUES (
          :userId,
          :encapsulationPublicKey,
          :updatedAt
        )
        ON CONFLICT(user_id) DO UPDATE SET
          encapsulation_public_key = excluded.encapsulation_public_key,
          updated_at = excluded.updated_at
      `,
      {
        ":encapsulationPublicKey": entry.encapsulationPublicKey,
        ":updatedAt": new Date().toISOString(),
        ":userId": entry.userId,
      },
    );
  },
};
