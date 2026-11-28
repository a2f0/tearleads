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

test("an appended migration applies once on top of the shipped ones, including its backfill", async () => {
  const folder = await copyMigrations();
  const shipped = (await readJournal(folder)).entries.length;
  const { client, db, migrate: run } = await openDatabase();
  await run(folder);
  expect(await readAppliedMigrations(db)).toHaveLength(shipped);

  await appendMigration(folder, "9999_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL, "label" text)',
    `INSERT INTO "migration_probe" ("id") VALUES ('existing')`,
    `UPDATE "migration_probe" SET "label" = 'backfilled' WHERE "label" IS NULL`,
  ]);
  await run(folder);
  await run(folder);
  expect(await readAppliedMigrations(db)).toHaveLength(shipped + 1);
  const { rows } = await client.query("SELECT id, label FROM migration_probe");
  expect(rows).toEqual([{ id: "existing", label: "backfilled" }]);
});

test("a migration edited after it was applied is refused before anything runs", async () => {
  const folder = await copyMigrations();
  const { migrate: run } = await openDatabase();
  await appendMigration(folder, "9999_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)',
  ]);
  await run(folder);
  await writeFile(
    join(folder, "9999_migration_probe.sql"),
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL, "label" text)',
  );
  await expect(run(folder)).rejects.toThrow(
    "API migration 9999_migration_probe changed after it was applied",
  );
});

test("a database migrated by a newer build is refused", async () => {
  const newer = await copyMigrations();
  const older = await copyMigrations();
  const shipped = (await readJournal(older)).entries.length;
  const { migrate: run } = await openDatabase();
  await appendMigration(newer, "9999_migration_probe", [
    'CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)',
  ]);
  await run(newer);
  await expect(run(older)).rejects.toThrow(
    `The API database has applied ${shipped + 1} migrations but this build has ${shipped}`,
  );
});

test("a migration that sorts before an applied one is refused instead of skipped", async () => {
  const folder = await copyMigrations();
  const { db, migrate: run } = await openDatabase();
  await run(folder);
  const { entries } = await readJournal(folder);
  const newest = entries.at(-1);
  if (!newest) throw new Error("empty journal");
  await appendMigration(
    folder,
    "9999_migration_probe",
    ['CREATE TABLE "migration_probe" ("id" text PRIMARY KEY NOT NULL)'],
    newest.when - 1,
  );
  await expect(run(folder)).rejects.toThrow(
    `API migration 9999_migration_probe sorts before ${newest.tag}`,
  );
  expect(await readAppliedMigrations(db)).toHaveLength(entries.length);
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

test("a migration that drops or disables count_document_updates is refused", async () => {
  const droppedFolder = await copyMigrations();
  await appendMigration(droppedFolder, "9999_drop_update_count_trigger", [
    "DROP TRIGGER count_document_updates ON public.document_updates",
  ]);
  const dropped = await openDatabase();
  await expect(dropped.migrate(droppedFolder)).rejects.toThrow(
    "API migration left public.document_updates without the count_document_updates trigger",
  );

  const disabledFolder = await copyMigrations();
  await appendMigration(disabledFolder, "9999_disable_update_count_trigger", [
    "ALTER TABLE public.document_updates DISABLE TRIGGER count_document_updates",
  ]);
  const disabled = await openDatabase();
  await expect(disabled.migrate(disabledFolder)).rejects.toThrow(
    "API migration left the count_document_updates trigger disabled on public.document_updates",
  );
});

test("count_document_updates increments counts, advances attribution revision, and publishes discovery order", async () => {
  const folder = await copyMigrations();
  const { client, migrate: run } = await openDatabase();
  await run(folder);

  const documentId = crypto.randomUUID();
  const initialUpdatedAt = "2020-01-01 00:00:00";
  await client.query(
    `INSERT INTO public.documents (id, created_by_fingerprint, updated_at)
     VALUES ($1, 'trigger-check', $2::timestamp)`,
    [documentId, initialUpdatedAt],
  );
  const before = await client.query<{
    attribution_revision: number;
    discovery_order: string;
    update_count: number;
    updated_at: Date;
  }>(
    `SELECT attribution_revision, discovery_order::text, update_count, updated_at
     FROM public.documents WHERE id = $1`,
    [documentId],
  );
  const beforeRow = before.rows[0];
  if (!beforeRow) throw new Error("Expected inserted document row");
  expect(beforeRow.update_count).toBe(0);
  expect(beforeRow.attribution_revision).toBe(0);

  await client.query(
    `INSERT INTO public.document_updates (
       id, document_id, access_epoch, author_fingerprint, encrypted_data,
       byte_length, partial_start_version_vector, partial_end_version_vector,
       dependency_version_vector, plaintext_hash
     ) VALUES (
       $1, $2, 1, 'trigger-check', 'data', 4, 'start', 'end', '', 'hash-1'
     )`,
    [crypto.randomUUID(), documentId],
  );
  const after = await client.query<{
    attribution_revision: number;
    discovery_order: string;
    update_count: number;
    updated_at: Date;
  }>(
    `SELECT attribution_revision, discovery_order::text, update_count, updated_at
     FROM public.documents WHERE id = $1`,
    [documentId],
  );
  const afterRow = after.rows[0];
  if (!afterRow) throw new Error("Expected updated document row");
  expect(afterRow.update_count).toBe(1);
  expect(afterRow.attribution_revision).toBe(1);
  expect(afterRow.updated_at.getTime()).toBeGreaterThan(
    beforeRow.updated_at.getTime(),
  );
  expect(BigInt(afterRow.discovery_order)).toBeGreaterThan(
    BigInt(beforeRow.discovery_order),
  );
});
