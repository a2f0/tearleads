import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const postgresMigrationDirectory = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);
const sqliteMigrationDirectory = fileURLToPath(
  new URL("../drizzle-sqlite/", import.meta.url),
);

async function migrationSql(
  directory: string,
  dialect: "PostgreSQL" | "SQLite",
  index: number,
): Promise<string> {
  const prefix = `${String(index).padStart(4, "0")}_`;
  const names = (await readdir(directory)).filter(
    (name) => name.startsWith(prefix) && name.endsWith(".sql"),
  );
  expect(names).toHaveLength(1);
  const name = names[0];
  if (!name) {
    throw new Error(`Missing ${dialect} migration ${prefix}`);
  }
  return readFile(`${directory}${name}`, "utf8");
}

test("SQLite backfills required blob audit ownership on upgrade", async () => {
  const sqlite = new Database(":memory:");
  try {
    for (let index = 0; index <= 5; index += 1) {
      sqlite.exec(
        await migrationSql(sqliteMigrationDirectory, "SQLite", index),
      );
    }

    const ownedBlobId = crypto.randomUUID();
    const historicalBlobId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO blob_content_write_headers (
          record_id, blob_id, organization_id, content_key_epoch,
          access_manifest_hash, target_hash, encryption_suite,
          content_record_id, nonce_domain_hash, header_hash, header
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        ownedBlobId,
        organizationId,
        `manifest:${ownedBlobId}`,
        `target:${ownedBlobId}`,
        "xchacha20-poly1305-ietf",
        ownedBlobId,
        `nonce:${ownedBlobId}`,
        `header:${ownedBlobId}`,
        "{}",
      );
    const insertAudit = sqlite.prepare(
      `INSERT INTO blob_audit_objects (
        blob_id, sha256, byte_length, live_storage_key, retention_mode,
        historical_bytes_retained, pruned_at
      ) VALUES (?, ?, 1, ?, 'live_only', 0, ?)`,
    );
    insertAudit.run(
      ownedBlobId,
      `sha256:${ownedBlobId}`,
      `blob-object:${ownedBlobId}`,
      null,
    );
    insertAudit.run(
      historicalBlobId,
      `sha256:${historicalBlobId}`,
      `blob-object:${historicalBlobId}`,
      Date.now(),
    );

    sqlite.exec(await migrationSql(sqliteMigrationDirectory, "SQLite", 6));

    const rows = sqlite
      .query<{ blob_id: string; organization_id: string }, []>(
        "SELECT blob_id, organization_id FROM blob_audit_objects ORDER BY blob_id",
      )
      .all();
    expect(rows).toEqual(
      [
        { blob_id: ownedBlobId, organization_id: organizationId },
        {
          blob_id: historicalBlobId,
          organization_id: "00000000-0000-0000-0000-000000000000",
        },
      ].sort((left, right) => left.blob_id.localeCompare(right.blob_id)),
    );
    const organizationColumn = sqlite
      .query<{ name: string; notnull: number }, []>(
        "PRAGMA table_info(blob_audit_objects)",
      )
      .all()
      .find((column) => column.name === "organization_id");
    expect(organizationColumn?.notnull).toBe(1);
  } finally {
    sqlite.close();
  }
});

test("PostgreSQL backfills required blob audit ownership on upgrade", async () => {
  const postgres = new PGlite({ dataDir: "memory://", debug: 0 });
  try {
    for (let index = 0; index <= 5; index += 1) {
      await postgres.exec(
        await migrationSql(postgresMigrationDirectory, "PostgreSQL", index),
      );
    }

    const ownedBlobId = crypto.randomUUID();
    const historicalBlobId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    await postgres.query(
      `INSERT INTO blob_content_write_headers (
        record_id, blob_id, organization_id, content_key_epoch,
        access_manifest_hash, target_hash, encryption_suite,
        content_record_id, nonce_domain_hash, header_hash, header
      ) VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, '{}'::jsonb)`,
      [
        crypto.randomUUID(),
        ownedBlobId,
        organizationId,
        `manifest:${ownedBlobId}`,
        `target:${ownedBlobId}`,
        "xchacha20-poly1305-ietf",
        ownedBlobId,
        `nonce:${ownedBlobId}`,
        `header:${ownedBlobId}`,
      ],
    );
    await postgres.query(
      `INSERT INTO blob_audit_objects (
        blob_id, sha256, byte_length, live_storage_key, retention_mode,
        historical_bytes_retained, pruned_at
      ) VALUES
        ($1, $2, 1, $3, 'live_only', false, NULL),
        ($4, $5, 1, $6, 'live_only', false, now())`,
      [
        ownedBlobId,
        `sha256:${ownedBlobId}`,
        `blob-object:${ownedBlobId}`,
        historicalBlobId,
        `sha256:${historicalBlobId}`,
        `blob-object:${historicalBlobId}`,
      ],
    );

    await postgres.exec(
      await migrationSql(postgresMigrationDirectory, "PostgreSQL", 6),
    );

    const rows = await postgres.query<{
      blob_id: string;
      organization_id: string;
    }>(
      "SELECT blob_id, organization_id FROM blob_audit_objects ORDER BY blob_id",
    );
    expect(rows.rows).toEqual(
      [
        { blob_id: ownedBlobId, organization_id: organizationId },
        {
          blob_id: historicalBlobId,
          organization_id: "00000000-0000-0000-0000-000000000000",
        },
      ].sort((left, right) => left.blob_id.localeCompare(right.blob_id)),
    );
    const column = await postgres.query<{ is_nullable: "NO" | "YES" }>(
      `SELECT is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'blob_audit_objects'
         AND column_name = 'organization_id'`,
    );
    expect(column.rows).toEqual([{ is_nullable: "NO" }]);
    await expect(
      postgres.query(
        "UPDATE blob_audit_objects SET organization_id = NULL WHERE blob_id = $1",
        [ownedBlobId],
      ),
    ).rejects.toThrow();
  } finally {
    await postgres.close();
  }
});
