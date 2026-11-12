import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  assertMigrationHistory,
  type JournalMigration,
  migrateWithHistory,
  readAppliedMigrations,
} from "./migrationHistory";

const sourceFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

interface Journal {
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
}

async function copyMigrations(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), "tearleads-migration-history-"),
  );
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  const folder = join(directory, "drizzle");
  await cp(sourceFolder, folder, { recursive: true });
  return folder;
}

async function readJournal(folder: string): Promise<Journal> {
  return JSON.parse(
    await readFile(join(folder, "meta", "_journal.json"), "utf8"),
  );
}

// Appends a hand-written migration the way `drizzle-kit generate --custom`
// does: a SQL file plus a journal entry.
async function appendMigration(
  folder: string,
  tag: string,
  statements: readonly string[],
  when?: number,
): Promise<void> {
  const journal = await readJournal(folder);
  const last = journal.entries.at(-1);
  if (!last) throw new Error("empty journal");
  journal.entries.push({
    ...last,
    idx: last.idx + 1,
    tag,
    when: when ?? last.when + 1000,
  });
  await writeFile(
    join(folder, `${tag}.sql`),
    statements.join("\n--> statement-breakpoint\n"),
  );
  await writeFile(
    join(folder, "meta", "_journal.json"),
    JSON.stringify(journal),
  );
}

async function openDatabase() {
  const client = new PGlite();
  cleanups.push(() => client.close());
  const db = drizzle(client);
  return {
    client,
    db,
    migrate: (folder: string) =>
      migrateWithHistory(db, folder, (config) => migrate(db, config)),
  };
}

test("an appended migration applies once on top of the baseline, including its backfill", async () => {
  const folder = await copyMigrations();
  const { client, db, migrate: run } = await openDatabase();
  await run(folder);
  expect(await readAppliedMigrations(db)).toHaveLength(1);

  await appendMigration(folder, "0001_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL, "label" text)',
    `INSERT INTO "migration_probe" ("id") VALUES ('existing')`,
    `UPDATE "migration_probe" SET "label" = 'backfilled' WHERE "label" IS NULL`,
  ]);
  await run(folder);
  await run(folder);
  expect(await readAppliedMigrations(db)).toHaveLength(2);
  const { rows } = await client.query("SELECT id, label FROM migration_probe");
  expect(rows).toEqual([{ id: "existing", label: "backfilled" }]);
});

test("a migration edited after it was applied is refused before anything runs", async () => {
  const folder = await copyMigrations();
  const { migrate: run } = await openDatabase();
  await appendMigration(folder, "0001_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)',
  ]);
  await run(folder);
  await writeFile(
    join(folder, "0001_migration_probe.sql"),
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL, "label" text)',
  );
  await expect(run(folder)).rejects.toThrow(
    "API migration 0001_migration_probe changed after it was applied",
  );
});

test("a database migrated by a newer build is refused", async () => {
  const newer = await copyMigrations();
  const older = await copyMigrations();
  const { migrate: run } = await openDatabase();
  await appendMigration(newer, "0001_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)',
  ]);
  await run(newer);
  await expect(run(older)).rejects.toThrow(
    "The API database has applied 2 migrations but this build has 1",
  );
});

test("a migration that sorts before an applied one is refused instead of skipped", async () => {
  const folder = await copyMigrations();
  const { db, migrate: run } = await openDatabase();
  await run(folder);
  const [baseline] = (await readJournal(folder)).entries;
  if (!baseline) throw new Error("empty journal");
  await appendMigration(
    folder,
    "0001_migration_probe",
    ['CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)'],
    baseline.when - 1,
  );
  await expect(run(folder)).rejects.toThrow(
    "API migration 0001_migration_probe sorts before 0000_greenfield_baseline",
  );
  expect(await readAppliedMigrations(db)).toHaveLength(1);
});

function journalEntry(
  tag: string,
  folderMillis: number,
  hash: string,
): JournalMigration {
  return { bps: true, folderMillis, hash, sql: [], tag };
}

test("assertMigrationHistory accepts an applied prefix of the journal", () => {
  const journal = [
    journalEntry("0000_a", 1, "a"),
    journalEntry("0001_b", 2, "b"),
  ];
  expect(() => assertMigrationHistory([], journal)).not.toThrow();
  expect(() =>
    assertMigrationHistory([{ createdAt: 1, hash: "a" }], journal),
  ).not.toThrow();
  expect(() =>
    assertMigrationHistory([{ createdAt: 2, hash: "b" }], journal),
  ).toThrow(
    "API migration 0000_a is not the migration the database applied at position 1",
  );
});
