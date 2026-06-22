import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { isSqliteApiDatabase } from "../utils/sqlDialect";

let sqliteCommitLsnValue = 0n;

function formatWalLsn(value: bigint): string {
  const high = value >> 32n;
  const low = value & 0xffff_ffffn;
  return `${high.toString(16).toUpperCase()}/${low.toString(16).toUpperCase()}`;
}

function readCurrentSqliteCommitLsn(): string {
  const now = BigInt(Date.now());
  sqliteCommitLsnValue =
    now > sqliteCommitLsnValue ? now : sqliteCommitLsnValue + 1n;
  return formatWalLsn(sqliteCommitLsnValue);
}

export async function readCurrentCommitLsn(
  executor: DatabaseSession,
): Promise<string> {
  if (isSqliteApiDatabase()) {
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
