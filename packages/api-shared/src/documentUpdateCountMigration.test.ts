import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readJournalMigrations } from "./adapters/migrationHistory";

const COUNT_MIGRATION = "0011_document_update_count";

test("the update-count migration counts stored updates and every later insert", async () => {
  const client = new PGlite();
  const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const documents = {
    empty: crypto.randomUUID(),
    many: crypto.randomUUID(),
    one: crypto.randomUUID(),
  };
  const withoutRow = crypto.randomUUID();
  const runMigration = async (statements: readonly string[]) => {
    await client.transaction(async (tx) => {
      for (const statement of statements) await tx.exec(statement);
    });
  };
  /** One statement inserting an update row for each `[id, documentId]`. */
  const insertUpdates = (
    updates: ReadonlyArray<readonly [id: string, documentId: string]>,
    onConflict = "",
  ) =>
    client.query(
      `INSERT INTO document_updates (id, document_id, access_epoch, author_fingerprint, encrypted_data, byte_length, partial_start_version_vector, partial_end_version_vector, dependency_version_vector, plaintext_hash)
       VALUES ${updates
         .map(
           (_, index) =>
             `($${index * 2 + 1}, $${index * 2 + 2}, 1, 'author', 'data', 4, 'start', 'end', '', 'hash')`,
         )
         .join(", ")} ${onConflict}`,
      updates.flat(),
    );
  const countsById = async () => {
    const { rows } = await client.query<{ id: string; update_count: number }>(
      "SELECT id, update_count FROM documents",
    );
    return Object.fromEntries(rows.map((row) => [row.id, row.update_count]));
  };
  try {
    const migrations = readJournalMigrations(folder);
    for (const migration of migrations.filter((m) => m.tag < COUNT_MIGRATION)) {
      await runMigration(migration.sql);
    }
    for (const id of Object.values(documents)) {
      await client.query(
        "INSERT INTO documents (id, created_by_fingerprint) VALUES ($1, 'author')",
        [id],
      );
    }
    // Rows committed before the trigger existed, in one document and in
    // several, and an update whose document has no row.
    const first = crypto.randomUUID();
    await insertUpdates([[first, documents.one]]);
    await insertUpdates([
      [crypto.randomUUID(), documents.many],
      [crypto.randomUUID(), documents.many],
      [crypto.randomUUID(), documents.many],
      [crypto.randomUUID(), withoutRow],
    ]);

    for (const migration of migrations.filter(
      (m) => m.tag === COUNT_MIGRATION,
    )) {
      await runMigration(migration.sql);
    }

    expect(await countsById()).toEqual({
      [documents.empty]: 0,
      [documents.many]: 3,
      [documents.one]: 1,
    });

    // One statement inserting for two documents counts each document's rows.
    await insertUpdates([
      [crypto.randomUUID(), documents.empty],
      [crypto.randomUUID(), documents.many],
      [crypto.randomUUID(), documents.many],
      [crypto.randomUUID(), withoutRow],
    ]);
    // A retried insert of a stored update stores nothing and counts nothing.
    await insertUpdates(
      [[first, documents.one]],
      "ON CONFLICT (id) DO NOTHING",
    );

    expect(await countsById()).toEqual({
      [documents.empty]: 1,
      [documents.many]: 5,
      [documents.one]: 1,
    });
  } finally {
    await client.close();
  }
});
