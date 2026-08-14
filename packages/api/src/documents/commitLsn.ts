import {
  type ApiDatabaseKind,
  type DatabaseSession,
  getDefaultApiDatabaseKind,
} from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";

let sqliteCommitLsnValue = 0n;
// Memoized so concurrent first calls all await the same seed query rather than a
// boolean flag, which a second caller could pass before the async query
// completed — emitting an unseeded (too-low) LSN during the startup window.
let sqliteCommitLsnSeedPromise: Promise<void> | null = null;

function formatWalLsn(value: bigint): string {
  const high = value >> 32n;
  const low = value & 0xffff_ffffn;
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase()}`;
}

// Seed the in-process counter once from the latest persisted write so an on-disk
// sqlite DB that outlives the process cannot reset the watermark below a
// commitLsn a client already persisted — which, combined with a backward
// wall-clock step, would make that client's minLsn permanently unsatisfiable.
// document_updates.created_at is stored as epoch-ms (timestamp_ms), the same
// scale as BigInt(Date.now()), and is contemporaneous with the writes whose
// commitLsn clients retain, so MAX(created_at) is a safe lower-bound floor.
// Best-effort: any failure falls back to the wall-clock counter. (Postgres uses
// a real durable WAL LSN and is unaffected; this path is test/dev only.)
function ensureSqliteCommitLsnSeeded(executor: DatabaseSession): Promise<void> {
  sqliteCommitLsnSeedPromise ??= (async () => {
    try {
      const result = await executor.execute(
        sql`select max(created_at) as "maxCreatedAt" from document_updates`,
      );
      const row = result.rows[0];
      const maxCreatedAt =
        row && typeof row === "object"
          ? Reflect.get(row, "maxCreatedAt")
          : null;
      if (typeof maxCreatedAt === "number" && Number.isFinite(maxCreatedAt)) {
        const seed = BigInt(Math.trunc(maxCreatedAt));
        if (seed > sqliteCommitLsnValue) {
          sqliteCommitLsnValue = seed;
        }
      }
    } catch {
      // Best-effort seed; the wall-clock counter remains the fallback.
    }
  })();
  return sqliteCommitLsnSeedPromise;
}

function readCurrentSqliteCommitLsn(): string {
  const now = BigInt(Date.now());
  sqliteCommitLsnValue =
    now > sqliteCommitLsnValue ? now : sqliteCommitLsnValue + 1n;
  return formatWalLsn(sqliteCommitLsnValue);
}

export async function readCurrentCommitLsn(
  executor: DatabaseSession,
  databaseKind: ApiDatabaseKind = getDefaultApiDatabaseKind(),
): Promise<string> {
  // Remote-only Turso always serves reads from the primary, so there is no
  // replica watermark to wait for. A zero sentinel remains compatible with the
  // existing WAL-LSN wire format and is satisfiable after a later Postgres move.
  if (databaseKind === "turso") {
    return "0/0";
  }
  if (databaseKind === "sqlite") {
    await ensureSqliteCommitLsnSeeded(executor);
    return readCurrentSqliteCommitLsn();
  }

  const result = await executor.execute(
    sql`select pg_current_wal_lsn()::text as "commitLsn"`,
  );
  const row = result.rows[0];
  const commitLsn =
    typeof row === "object" && row !== null
      ? Reflect.get(row, "commitLsn")
      : undefined;

  if (typeof commitLsn !== "string" || commitLsn.length === 0) {
    throw new Error("Failed to read current commit LSN.");
  }

  return commitLsn;
}

export function readCommitLsnMode(
  databaseKind: ApiDatabaseKind = getDefaultApiDatabaseKind(),
): "tracked" | "untracked" {
  return databaseKind === "turso" ? "untracked" : "tracked";
}
