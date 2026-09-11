import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as sqliteDrizzle } from "drizzle-orm/bun-sqlite";
import { migrate as migrateSqlite } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle as postgresDrizzle } from "drizzle-orm/pglite";
import { migrate as migratePostgres } from "drizzle-orm/pglite/migrator";

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
  } finally {
    client.close();
  }
});
