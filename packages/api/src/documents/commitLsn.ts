import {
  type ApiDatabaseKind,
  type DatabaseSession,
  getDefaultApiDatabaseKind,
} from "@symcrypt/api-shared/postgres";
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
  options: {
    readonly clientSupportsUntracked?: boolean | undefined;
    readonly minimumLsn?: string | undefined;
  } = {},
): Promise<string> {
  // Remote-only Turso always serves reads from the primary, so there is no
  // replica watermark to wait for. New clients explicitly opt into resetting
  // an old tracked checkpoint to the zero sentinel. Legacy clients ignore the
  // additive response mode, so echo their requested minimum instead; it is not
  // a Turso watermark, but it prevents an existing client from rejecting the
  // response as stale during the capability rollout.
  if (databaseKind === "turso") {
    return options.clientSupportsUntracked
      ? "0/0"
      : (options.minimumLsn ?? "0/0");
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
  options: {
    readonly clientSupportsUntracked?: boolean | undefined;
    readonly minimumLsn?: string | undefined;
  } = {},
): "tracked" | "untracked" | undefined {
  if (databaseKind !== "turso") {
    return "tracked";
  }

  // A legacy Turso response echoes the request's compatibility token rather
  // than claiming it is a real watermark. Omitting the additive mode keeps
  // that nonzero token from being mislabeled as an untracked checkpoint. A
  // requested 0/0 already is the sentinel, so declaring it remains valid.
  return options.clientSupportsUntracked || options.minimumLsn === "0/0"
    ? "untracked"
    : undefined;
}
