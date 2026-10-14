import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as sqliteDrizzle } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
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
    expect(rows).toHaveLength(55);
    const nameColumns = await client.query(
      "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('groups', 'organizations') AND column_name = 'name'",
    );
    expect(nameColumns.rows).toEqual([]);
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

test("SQLite baseline initializes all tables without application data", () => {
  const client = new Database(":memory:");
  try {
    client.exec("PRAGMA foreign_keys = ON");
    const db = sqliteDrizzle(client);
    const options = {
      migrationsFolder: fileURLToPath(
        new URL("../drizzle-sqlite", import.meta.url),
      ),
    };
    migrateSqlite(db, options);
    migrateSqlite(db, options);
    const rows = client
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'",
      )
      .all();
    expect(rows).toHaveLength(55);
    for (const table of ["groups", "organizations"]) {
      const columns = client
        .query<{ name: string }, []>(`PRAGMA table_info('${table}')`)
        .all();
      expect(columns.some((column) => column.name === "name")).toBe(false);
    }
    for (const { name } of rows) {
      const result = client
        .query<{ count: number }, []>(
          `SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`,
        )
        .get();
      expect(result?.count).toBe(0);
    }
    expect(
      client.query("SELECT id FROM __drizzle_migrations").all(),
    ).toHaveLength(1);
    expect(client.query("PRAGMA foreign_key_check").all()).toEqual([]);
    const insertRoot = (id: string, slot: string | null) =>
      client
        .query(
          "INSERT INTO containers (id, organization_id, system_slot) VALUES (?, ?, ?)",
        )
        .run(id, ROOT_ORGANIZATION_ID, slot);
    insertRoot(PERSONAL_ROOT_ID, null);
    insertRoot(METADATA_ROOT_ID, METADATA_SLOT);
    expect(() => insertRoot(DUPLICATE_ROOT_ID, null)).toThrow(
      "UNIQUE constraint failed",
    );
    expect(() => insertRoot(DUPLICATE_ROOT_ID, METADATA_SLOT)).toThrow(
      "UNIQUE constraint failed",
    );
  } finally {
    client.close();
  }
});
