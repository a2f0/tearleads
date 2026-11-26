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
