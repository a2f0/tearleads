import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type SQL, sql } from "drizzle-orm";
import { type MigrationMeta, readMigrationFiles } from "drizzle-orm/migrator";

export interface AppliedMigration {
  readonly createdAt: number;
  readonly hash: string;
}

export interface JournalMigration extends MigrationMeta {
  readonly tag: string;
}

interface QueryableDatabase {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/** The journal's migrations in order, with the tag each one was generated under. */
export function readJournalMigrations(
  migrationsFolder: string,
): JournalMigration[] {
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  );
  return readMigrationFiles({ migrationsFolder }).map((migration, index) => ({
    ...migration,
    tag: journal.entries[index]?.tag ?? String(migration.folderMillis),
  }));
}

function field(row: unknown, key: string): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  return Object.entries(row).find(([name]) => name === key)?.[1];
}

function readRow(row: unknown): AppliedMigration {
  const hash = field(row, "hash");
  if (typeof hash !== "string") {
    throw new Error("Unreadable API migration journal row");
  }
  return { createdAt: Number(field(row, "created_at")), hash };
}

/** The migrations the database has recorded, oldest first; none before the first migrate. */
export async function readAppliedMigrations(
  db: QueryableDatabase,
): Promise<AppliedMigration[]> {
  const present = await db.execute(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  if (field(present.rows[0], "present") !== true) return [];
  const applied = await db.execute(
    sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id`,
  );
  return applied.rows.map(readRow);
}

/**
 * Refuses a migrate whose journal does not extend what the database has
 * applied. Drizzle itself only compares the newest applied timestamp, so
 * without this check an edited migration, a database migrated by a newer
 * build, or a migration that sorts before the newest applied one would pass
 * silently and leave the schema different from the code.
 */
export function assertMigrationHistory(
  applied: ReadonlyArray<AppliedMigration>,
  journal: ReadonlyArray<JournalMigration>,
): void {
  for (const [index, migration] of journal.entries()) {
    const previous = journal[index - 1];
    if (previous && migration.folderMillis <= previous.folderMillis) {
      throw new Error(
        `API migration ${migration.tag} sorts before ${previous.tag}, so Drizzle would skip it; regenerate it so its journal timestamp is the newest`,
      );
    }
  }
  for (const [index, migration] of applied.entries()) {
    const expected = journal[index];
    if (!expected) {
      throw new Error(
        `The API database has applied ${applied.length} migrations but this build has ${journal.length}; deploy a build that includes migration ${migration.createdAt}`,
      );
    }
    if (expected.folderMillis !== migration.createdAt) {
      throw new Error(
        `API migration ${expected.tag} is not the migration the database applied at position ${index + 1} (${migration.createdAt}); new migrations must sort after every applied one`,
      );
    }
    if (expected.hash !== migration.hash) {
      throw new Error(
        `API migration ${expected.tag} changed after it was applied; restore its SQL and add a new migration instead`,
      );
    }
  }
}

/**
 * Applies the folder's pending migrations after checking that its journal
 * extends the database's applied history.
 */
export async function migrateWithHistory(
  db: QueryableDatabase,
  migrationsFolder: string,
  migrate: (config: { readonly migrationsFolder: string }) => Promise<void>,
): Promise<void> {
  assertMigrationHistory(
    await readAppliedMigrations(db),
    readJournalMigrations(migrationsFolder),
  );
  await migrate({ migrationsFolder });
}
