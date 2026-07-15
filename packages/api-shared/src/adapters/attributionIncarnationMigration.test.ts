import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const postgresMigration = new URL(
  "../../drizzle/0011_chubby_quentin_quire.sql",
  import.meta.url,
);
const sqliteMigration = new URL(
  "../../drizzle-sqlite/0011_ambiguous_mad_thinker.sql",
  import.meta.url,
);

test("postgres migration backfills a distinct attribution incarnation per document", async () => {
  const postgres = new PGlite({ dataDir: "memory://", debug: 0 });
  try {
    await postgres.exec(`
      CREATE TABLE documents (
        id UUID PRIMARY KEY,
        created_by_fingerprint TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      );
      INSERT INTO documents VALUES
        ('00000000-0000-4000-8000-000000000001', 'fingerprint-1', now(), now()),
        ('00000000-0000-4000-8000-000000000002', 'fingerprint-2', now(), now());
    `);

    const migration = await Bun.file(postgresMigration).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        await postgres.exec(statement);
      }
    }

    const { rows } = await postgres.query<{
      attribution_incarnation: string;
      attribution_revision: number;
    }>(`
      SELECT attribution_incarnation, attribution_revision
      FROM documents
      ORDER BY id
    `);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attribution_revision)).toEqual([0, 0]);
    expect(new Set(rows.map((row) => row.attribution_incarnation)).size).toBe(
      2,
    );
    for (const row of rows) {
      expect(row.attribution_incarnation).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
  } finally {
    await postgres.close();
  }
});

test("sqlite migration backfills a distinct attribution incarnation per document", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY NOT NULL,
        created_by_fingerprint TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX documents_updated_at_id_idx
        ON documents (updated_at, id);
      INSERT INTO documents VALUES
        ('document-1', 'fingerprint-1', 1, 1),
        ('document-2', 'fingerprint-2', 1, 1);
    `);

    const migration = await Bun.file(sqliteMigration).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        sqlite.exec(statement);
      }
    }

    const rows = sqlite
      .query<
        { attributionIncarnation: string; attributionRevision: number },
        []
      >(`
        SELECT
          attribution_incarnation AS attributionIncarnation,
          attribution_revision AS attributionRevision
        FROM documents
        ORDER BY id
      `)
      .all();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.attributionRevision)).toEqual([0, 0]);
    expect(new Set(rows.map((row) => row.attributionIncarnation)).size).toBe(2);
    for (const row of rows) {
      expect(row.attributionIncarnation).toMatch(/^[0-9a-f]{32}$/u);
    }

    const column = sqlite
      .query<{ name: string; notnull: number }, []>(
        "SELECT name, `notnull` FROM pragma_table_info('documents') WHERE name = 'attribution_incarnation'",
      )
      .get();
    expect(column).toEqual({ name: "attribution_incarnation", notnull: 1 });
  } finally {
    sqlite.close();
  }
});
