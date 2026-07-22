import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

const postgresMigration = new URL(
  "../../drizzle/0018_broken_kat_farrell.sql",
  import.meta.url,
);
const sqliteMigration = new URL(
  "../../drizzle-sqlite/0018_smiling_ultimo.sql",
  import.meta.url,
);

const expectedPeriodKeys = [
  {
    organizationId: "00000000-0000-4000-8000-000000000001",
    seatPeriodKey: "trial:2026-07-31T12:34:56.789Z",
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000002",
    seatPeriodKey: "paid:2026-07-01T00:00:00.000Z:2026-08-01T00:00:00.000Z",
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000003",
    seatPeriodKey: "paid:2026-06-01T00:00:00.000Z:2026-07-01T00:00:00.000Z",
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000004",
    seatPeriodKey: "trial:2026-06-30T00:00:00.000Z",
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000005",
    seatPeriodKey: null,
  },
  {
    organizationId: "00000000-0000-4000-8000-000000000006",
    seatPeriodKey: "paid:open:open",
  },
] as const;

async function runPostgresMigration(postgres: PGlite): Promise<void> {
  const migration = await Bun.file(postgresMigration).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) {
      await postgres.exec(statement);
    }
  }
}

test("postgres seat-period migration backfills the represented billing period", async () => {
  const postgres = new PGlite({ dataDir: "memory://", debug: 0 });
  try {
    await postgres.exec(`
      CREATE TABLE organization_billing (
        organization_id UUID PRIMARY KEY,
        status TEXT NOT NULL,
        trial_ends_at TIMESTAMP,
        provider TEXT,
        current_period_starts_at TIMESTAMP,
        current_period_ends_at TIMESTAMP
      );
      INSERT INTO organization_billing VALUES
        ('00000000-0000-4000-8000-000000000001', 'trialing', '2026-07-31 12:34:56.789', NULL, NULL, NULL),
        ('00000000-0000-4000-8000-000000000002', 'active', NULL, 'revenuecat', '2026-07-01', '2026-08-01'),
        ('00000000-0000-4000-8000-000000000003', 'disabled', NULL, 'revenuecat', '2026-06-01', '2026-07-01'),
        ('00000000-0000-4000-8000-000000000004', 'disabled', '2026-06-30', NULL, NULL, NULL),
        ('00000000-0000-4000-8000-000000000005', 'local', NULL, NULL, NULL, NULL),
        ('00000000-0000-4000-8000-000000000006', 'active', NULL, 'revenuecat', NULL, NULL);
    `);
    await runPostgresMigration(postgres);

    const { rows } = await postgres.query<{
      organizationId: string;
      seatPeriodKey: string | null;
    }>(`
      SELECT
        organization_id AS "organizationId",
        seat_period_key AS "seatPeriodKey"
      FROM organization_billing
      ORDER BY organization_id
    `);
    expect(rows).toEqual([...expectedPeriodKeys]);
  } finally {
    await postgres.close();
  }
});

test("sqlite seat-period migration backfills the represented billing period", async () => {
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec(`
      CREATE TABLE organization_billing (
        organization_id TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        trial_ends_at INTEGER,
        provider TEXT,
        current_period_starts_at INTEGER,
        current_period_ends_at INTEGER
      );
    `);
    const insert = sqlite.query(`
      INSERT INTO organization_billing VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      expectedPeriodKeys[0].organizationId,
      "trialing",
      Date.parse("2026-07-31T12:34:56.789Z"),
      null,
      null,
      null,
    );
    insert.run(
      expectedPeriodKeys[1].organizationId,
      "active",
      null,
      "revenuecat",
      Date.parse("2026-07-01T00:00:00.000Z"),
      Date.parse("2026-08-01T00:00:00.000Z"),
    );
    insert.run(
      expectedPeriodKeys[2].organizationId,
      "disabled",
      null,
      "revenuecat",
      Date.parse("2026-06-01T00:00:00.000Z"),
      Date.parse("2026-07-01T00:00:00.000Z"),
    );
    insert.run(
      expectedPeriodKeys[3].organizationId,
      "disabled",
      Date.parse("2026-06-30T00:00:00.000Z"),
      null,
      null,
      null,
    );
    insert.run(
      expectedPeriodKeys[4].organizationId,
      "local",
      null,
      null,
      null,
      null,
    );
    insert.run(
      expectedPeriodKeys[5].organizationId,
      "active",
      null,
      "revenuecat",
      null,
      null,
    );

    const migration = await Bun.file(sqliteMigration).text();
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) {
        sqlite.exec(statement);
      }
    }

    const rows = sqlite
      .query<{ organizationId: string; seatPeriodKey: string | null }, []>(`
        SELECT
          organization_id AS organizationId,
          seat_period_key AS seatPeriodKey
        FROM organization_billing
        ORDER BY organization_id
      `)
      .all();
    expect(rows).toEqual([...expectedPeriodKeys]);
  } finally {
    sqlite.close();
  }
});
