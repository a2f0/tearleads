import { type SQL, sql } from "drizzle-orm";
import {
  readAppliedMigrations,
  readJournalMigrations,
} from "./migrationHistory";
import type { ApiDatabase } from "./types";

const sources = [
  ["containers", false],
  ["documents", false],
  ["container_sync_tombstones", true],
  ["container_document_sync_tombstones", true],
] as const;

type BackfillProgress = { cursor: string | null; remaining: boolean };

async function fillHistoricalRows(
  db: ApiDatabase,
  table: SQL,
  removed: boolean,
) {
  let cursor: string | null = null;
  while (true) {
    // Each statement commits one batch, releasing all row locks. A concurrent
    // application write publishes a positive position and cannot be overwritten.
    const result: { rows: BackfillProgress[] } =
      await db.execute<BackfillProgress>(sql`
      with batch as materialized (
        select id from ${table} where discovery_order = 0
          ${cursor ? sql`and id > ${cursor}::uuid` : sql``}
        order by id limit 512 for update skip locked
      ), filled as (
        update ${table} target
        set discovery_order = public.historical_discovery_order(target.updated_at, ${removed})
        from batch where target.id = batch.id and target.discovery_order = 0
      )
      select (select id::text from batch order by id desc limit 1) as cursor,
        case when not exists (select 1 from batch) then
          exists (select 1 from ${table} where discovery_order = 0)
        else false end as remaining
    `);
    const row: BackfillProgress | undefined = result.rows[0];
    if (!row) throw new Error("Discovery backfill returned no progress");
    cursor = row.cursor;
    if (!cursor) {
      if (!row.remaining) return;
      // Some zero rows were locked when their id range was scanned. Rewind
      // after releasing the batch locks; a busy writer can continue normally.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function buildDiscoveryIndex(db: ApiDatabase, statement: string) {
  const match = statement
    .trim()
    .match(/^CREATE INDEX IF NOT EXISTS "([a-z_]+)" ON /u);
  if (!match?.[1]) throw new Error("Invalid discovery index statement");
  const name = match[1];
  // An interrupted concurrent build leaves its name behind but cannot serve
  // scans. Only this migration's indexes are eligible for this recovery.
  const previous = await db.execute<{ invalid: boolean }>(sql`
    select not indisvalid as invalid from pg_index
    where indexrelid = to_regclass(${`public.${name}`})
  `);
  if (previous.rows.at(0)?.invalid === true) {
    await db.execute(
      sql`drop index concurrently public.${sql.identifier(name)}`,
    );
  }
  await db.execute(
    sql.raw(
      statement.replace(
        "CREATE INDEX IF NOT EXISTS",
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS",
      ),
    ),
  );
}

function unavailableLock(error: unknown): boolean {
  for (let cause = error; cause instanceof Error; cause = cause.cause)
    if ("code" in cause && cause.code === "55P03") return true;
  return false;
}

async function retryDiscoveryCutover(run: () => Promise<void>) {
  const deadline = Date.now() + 60_000;
  while (true) {
    try {
      return await run();
    } catch (error) {
      if (!unavailableLock(error) || Date.now() >= deadline) throw error;
      // The failed transaction has released every lock it acquired. Let
      // the application's transaction finish before taking the complete set.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Called only for a PostgreSQL migrate, on the session that holds the
 * migration advisory lock and has already validated its journal. */
export async function prepareDiscoveryMigration(
  db: ApiDatabase,
  folder: string,
  migrate: () => Promise<void>,
) {
  const journal = readJournalMigrations(folder);
  const setup = journal.find(
    (migration) => migration.tag === "0004_discovery_order",
  );
  const finish = journal.find(
    (migration) => migration.tag === "0005_publish_discovery_order",
  );
  if (!setup || !finish) return migrate();
  const applied = await readAppliedMigrations(db);
  if (
    !applied.length ||
    applied.some((row) => row.createdAt === finish.folderMillis)
  )
    return migrate();
  // Existing writers switch to deferred publication together. The old API can
  // continue reading immediately after these metadata-only locks are released.
  await retryDiscoveryCutover(() =>
    db.transaction(async (tx) => {
      for (const statement of setup.sql) await tx.execute(sql.raw(statement));
    }),
  );
  for (const [table, removed] of sources) {
    await fillHistoricalRows(db, sql`public.${sql.identifier(table)}`, removed);
  }
  for (const statement of finish.sql.slice(1))
    await buildDiscoveryIndex(db, statement);
  await db.execute(
    sql`update drizzle.discovery_cursor_key set backfill_complete = true where singleton`,
  );
  await retryDiscoveryCutover(migrate);
}
