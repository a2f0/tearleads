import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readJournalMigrations } from "./adapters/migrationHistory";

const OWNERS_MIGRATION = "0009_document_peer_owners";

test("the peer-owner backfill gives each committed peer the user of its first update", async () => {
  const client = new PGlite();
  const folder = fileURLToPath(new URL("../drizzle", import.meta.url));
  const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
  const users = { alice: crypto.randomUUID(), bob: crypto.randomUUID() };
  const runMigration = async (statements: readonly string[]) => {
    await client.transaction(async (tx) => {
      for (const statement of statements) await tx.exec(statement);
    });
  };
  // The identity column numbers updates in insertion order.
  const insertUpdate = async (documentId: string, fingerprint: string) => {
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO document_updates (id, document_id, access_epoch, author_fingerprint, encrypted_data, byte_length, partial_start_version_vector, partial_end_version_vector, plaintext_hash)
       VALUES ($1, $2, 1, $3, 'data', 4, 'start', 'end', 'hash')`,
      [id, documentId, fingerprint],
    );
    return id;
  };
  const insertSpan = (
    documentId: string,
    updateId: string,
    peerId: string,
    [start, end]: readonly [number, number],
  ) =>
    client.query(
      "INSERT INTO document_update_spans (document_id, update_id, peer_id, start_counter, end_counter) VALUES ($1, $2, $3, $4, $5)",
      [documentId, updateId, peerId, start, end],
    );
  try {
    const migrations = readJournalMigrations(folder);
    for (const migration of migrations.filter(
      (m) => m.tag < OWNERS_MIGRATION,
    )) {
      await runMigration(migration.sql);
    }
    for (const [name, id] of Object.entries(users)) {
      await client.query(
        "INSERT INTO users (id, fingerprint, signing_public_key, encapsulation_public_key, encapsulation_key_fingerprint, default_organization_id) VALUES ($1, $2, 'signing', 'encapsulation', $2, $1)",
        [id, `${name}-fingerprint`],
      );
    }
    const bobFirst = await insertUpdate(first, "bob-fingerprint");
    const aliceLater = await insertUpdate(first, "alice-fingerprint");
    const bobLast = await insertUpdate(first, "bob-fingerprint");
    const unknownAuthor = await insertUpdate(first, "unknown-fingerprint");
    const aliceElsewhere = await insertUpdate(second, "alice-fingerprint");
    // Spans go in against sequence order, so only the sequence can pick.
    await insertSpan(first, bobLast, "2", [2, 4]);
    await insertSpan(first, aliceLater, "2", [0, 2]);
    await insertSpan(first, aliceLater, "1", [3, 5]);
    await insertSpan(first, bobFirst, "1", [0, 3]);
    await insertSpan(first, unknownAuthor, "3", [0, 1]);
    await insertSpan(second, aliceElsewhere, "1", [0, 2]);

    for (const migration of migrations.filter(
      (m) => m.tag >= OWNERS_MIGRATION,
    )) {
      await runMigration(migration.sql);
    }

    const { rows } = await client.query<{
      document_id: string;
      owner_user_id: string;
      peer_id: string;
    }>(
      "SELECT document_id, peer_id, owner_user_id FROM document_peer_owners ORDER BY document_id = $1 DESC, peer_id",
      [first],
    );
    // A peer whose only author has no user row stays unowned.
    expect(rows).toEqual([
      { document_id: first, owner_user_id: users.bob, peer_id: "1" },
      { document_id: first, owner_user_id: users.alice, peer_id: "2" },
      { document_id: second, owner_user_id: users.alice, peer_id: "1" },
    ]);
  } finally {
    await client.close();
  }
});
