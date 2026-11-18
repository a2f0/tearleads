import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { migrateWithHistory } from "./migrationHistory";
import { createDefaultManagedApiDatabase } from "./postgres";

// Two migrators need two real sessions, which only the Postgres concurrency
// lane has; this test creates and drops its own database there.
const { DATABASE_URL: serverUrl } = process.env;
const sourceFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function migrationFolder(probe: boolean): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tearleads-migration-lock-"));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const folder = join(directory, "drizzle");
  await cp(sourceFolder, folder, { recursive: true });
  if (!probe) return folder;
  const journalPath = join(folder, "meta", "_journal.json");
  const journal: { entries: { idx: number; when: number; tag: string }[] } =
    JSON.parse(await readFile(journalPath, "utf8"));
  const last = journal.entries.at(-1);
  if (!last) throw new Error("empty journal");
  journal.entries.push({
    ...last,
    idx: last.idx + 1,
    tag: "9999_migration_probe",
    when: last.when + 1000,
  });
  await writeFile(
    join(folder, "9999_migration_probe.sql"),
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)',
  );
  await writeFile(journalPath, JSON.stringify(journal));
  return folder;
}

async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  cleanups.push(() => client.end());
  return client;
}

function migrator(client: pg.Client) {
  const db = drizzle({ client });
  return (folder: string) =>
    migrateWithHistory(db, folder, (config) => migrate(db, config));
}

test.skipIf(!serverUrl)(
  "a migrate waits for a concurrent one and then checks the history it left",
  async () => {
    if (!serverUrl) throw new Error("DATABASE_URL is required");
    const databaseName = `tearleads_migration_lock_${randomUUID().replaceAll("-", "")}`;
    const admin = await connect(serverUrl);
    await admin.query(`CREATE DATABASE ${databaseName}`);
    cleanups.push(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    });
    const url = new URL(serverUrl);
    url.pathname = `/${databaseName}`;
    const newer = await connect(url.href);
    const older = await connect(url.href);

    // The newer build holds the migration lock, as if mid-migrate.
    await newer.query("SELECT pg_advisory_lock(7315420190)");
    let olderSettled = false;
    const olderRun = migrator(older)(await migrationFolder(false)).finally(
      () => {
        olderSettled = true;
      },
    );
    await Bun.sleep(300);
    expect(olderSettled).toBe(false);

    await migrator(newer)(await migrationFolder(true));
    await newer.query("SELECT pg_advisory_unlock(7315420190)");
    await expect(olderRun).rejects.toThrow("The API database has applied");
  },
);

test.skipIf(!serverUrl)(
  "an online discovery upgrade publishes new writes while filling history and repairs an interrupted index",
  async () => {
    if (!serverUrl) throw new Error("DATABASE_URL is required");
    const name = `tearleads_discovery_${randomUUID().replaceAll("-", "")}`;
    const admin = await connect(serverUrl);
    await admin.query(`CREATE DATABASE ${name}`);
    cleanups.push(async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    const reader = await connect(url.href);
    const earlier = await migrationFolder(false);
    const path = join(earlier, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(path, "utf8"));
    journal.entries = journal.entries.slice(0, 4);
    await writeFile(path, JSON.stringify(journal));
    const db = createDefaultManagedApiDatabase({
      API_DATABASE: "postgres",
      DATABASE_URL: url.href,
    });
    cleanups.push(() => db.close());
    await db.migrate({ migrationsFolder: earlier });
    await reader.query(
      "insert into documents (id,created_by_fingerprint) select gen_random_uuid(),'fixture' from generate_series(1,1025)",
    );
    // Mimic cancellation after a concurrent index build reserved its name.
    await expect(
      reader.query(
        "create unique index concurrently documents_discovery_idx on documents(created_by_fingerprint)",
      ),
    ).rejects.toThrow();
    const target = (
      await reader.query<{ id: string }>(
        "select id from documents order by id offset 700 limit 1",
      )
    ).rows[0]?.id;
    if (!target) throw new Error("No test document");
    await reader.query(`create function pause_discovery_fixture() returns trigger language plpgsql as $$
  begin if new.id = '${target}'::uuid then perform pg_advisory_xact_lock(710112); end if; return new; end $$`);
    await reader.query(
      "create trigger pause_discovery_fixture before update on documents for each row execute function pause_discovery_fixture()",
    );
    await reader.query("select pg_advisory_lock(710112)");
    await reader.query("begin");
    await reader.query("lock table documents in row exclusive mode");
    const migrating = db.migrate({ migrationsFolder: sourceFolder });
    try {
      const deadline = Date.now() + 15000;
      while (true) {
        const attempted = await reader.query(
          "select 1 from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and (wait_event_type='Lock' or lower(query)='rollback')",
        );
        if (attempted.rowCount) break;
        if (Date.now() > deadline)
          throw new Error("Migration did not attempt cutover");
        // PostgreSQL otherwise reuses the statistics snapshot in this writer transaction.
        await reader.query("select pg_stat_clear_snapshot()");
        await Bun.sleep(15);
      }
      // A document mutation touches its container after locking the document.
      await reader.query("set local lock_timeout = '300ms'");
      await reader.query("lock table containers in row exclusive mode");
      await reader.query("commit");
      while (true) {
        const waiters = await reader.query(
          "select 1 from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))",
        );
        if (waiters.rowCount) break;
        if (Date.now() > deadline)
          throw new Error("Discovery backfill did not reach the held row");
        await Bun.sleep(15);
      }
      await reader.query("set statement_timeout = '2s'");
      expect(
        (
          await reader.query(
            "select count(*)::int as count from documents where discovery_order<0",
          )
        ).rows[0]?.count,
      ).toBe(512);
      const inserted = await reader.query(
        "insert into documents (id,created_by_fingerprint) values (gen_random_uuid(),'while-preparing') returning id",
      );
      expect(
        (
          await reader.query(
            "select discovery_order>0 as published from documents where id=$1",
            [inserted.rows[0].id],
          )
        ).rows[0].published,
      ).toBe(true);
    } finally {
      await reader.query("rollback");
      await reader.query("select pg_advisory_unlock(710112)");
      await migrating;
    }
    expect(
      (
        await reader.query(
          "select count(*)::int as count from documents where discovery_order<0",
        )
      ).rows[0].count,
    ).toBe(1025);
    expect(
      (
        await reader.query(
          "select indisvalid from pg_index where indexrelid='documents_discovery_idx'::regclass",
        )
      ).rows[0].indisvalid,
    ).toBe(true);
    await db.migrate({ migrationsFolder: sourceFolder });
  },
  30000,
);
