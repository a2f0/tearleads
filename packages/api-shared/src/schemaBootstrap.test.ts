import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/pglite";
import { migrate as migratePostgres } from "drizzle-orm/pglite/migrator";

const ROOT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PERSONAL_ROOT_ID = "00000000-0000-4000-8000-000000000002";
const METADATA_ROOT_ID = "00000000-0000-4000-8000-000000000003";
const DUPLICATE_ROOT_ID = "00000000-0000-4000-8000-000000000004";
const METADATA_SLOT = `sys_v1_${"a".repeat(43)}`;

test("Postgres baseline initializes all tables without application data", async () => {
  const client = new PGlite();
  try {
    const db = postgresDrizzle(client);
    const options = {
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    };
    await migratePostgres(db, options);
    await migratePostgres(db, options);
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(rows).toHaveLength(50);
    const nameColumns = await client.query(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('groups', 'organizations') AND column_name = 'name'",
    );
    expect(nameColumns.rows).toEqual([]);
    const identityColumns = await client.query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'principal_membership_projection' AND column_name = 'identity_bundle_fingerprint'",
    );
    expect(identityColumns.rows).toEqual([{ is_nullable: "NO" }]);
    for (const { tablename } of rows) {
      const result = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "${tablename.replaceAll('"', '""')}"`,
      );
      expect(result.rows[0]?.count).toBe(0);
    }
    const journal = await client.query(
      "SELECT id FROM drizzle.__drizzle_migrations",
    );
    expect(journal.rows).toHaveLength(1);
    const insertRoot = (id: string, slot: string | null) =>
      client.query(
        "INSERT INTO containers (id, organization_id, system_slot) VALUES ($1, $2, $3)",
        [id, ROOT_ORGANIZATION_ID, slot],
      );
    await insertRoot(PERSONAL_ROOT_ID, null);
    await insertRoot(METADATA_ROOT_ID, METADATA_SLOT);
    await expect(insertRoot(DUPLICATE_ROOT_ID, null)).rejects.toThrow(
      "containers_org_root_idx",
    );
    await expect(insertRoot(DUPLICATE_ROOT_ID, METADATA_SLOT)).rejects.toThrow(
      "containers_org_system_slot_idx",
    );
  } finally {
    await client.close();
  }
});
