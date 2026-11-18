import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readJournalMigrations } from "./adapters/migrationHistory";

test("existing discovery rows retain historical order and new commits follow every backfilled source", async () => {
  const client = new PGlite();
  const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const id = crypto.randomUUID();
  const runMigration = async (statements: readonly string[]) => {
    await client.transaction(async (tx) => {
      for (const statement of statements) await tx.exec(statement);
    });
  };
  try {
    const migrations = readJournalMigrations(folder);
    for (const migration of migrations.filter((m) => m.tag < "0004")) {
      await runMigration(migration.sql);
    }
    await client.query(
      "INSERT INTO documents (id, created_by_fingerprint, updated_at) VALUES ($1, 'fixture', '2099-05-01 11:22:33.000001')",
      [id],
    );
    await client.query(
      "INSERT INTO container_document_sync_tombstones (document_id, container_id, updated_at) VALUES ($1, $1, '2099-05-01 11:22:33.000001')",
      [id],
    );
    for (const migration of migrations.filter(
      (m) => m.tag >= "0004" && m.tag < "0006",
    )) {
      await runMigration(migration.sql);
    }
    const sources = () =>
      client.query<{ source: string }>(
        `SELECT source FROM (
        SELECT 'document' AS source, discovery_order FROM documents
        UNION ALL SELECT 'removal', discovery_order FROM container_document_sync_tombstones
        UNION ALL SELECT 'container', discovery_order FROM containers
      ) rows ORDER BY discovery_order`,
      );
    expect((await sources()).rows.map((row) => row.source)).toEqual([
      "document",
      "removal",
    ]);
    await client.query(
      "INSERT INTO containers (id, organization_id, updated_at) VALUES ($1, $1, '2020-01-01')",
      [id],
    );
    expect((await sources()).rows.map((row) => row.source)).toEqual([
      "document",
      "removal",
      "container",
    ]);
  } finally {
    await client.close();
  }
});
