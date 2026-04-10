import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "../../adapters/postgres";

export async function readCurrentCommitLsn(
  executor: DatabaseExecutor,
): Promise<string> {
  const result = await executor.execute(
    sql`select pg_current_wal_lsn()::text as "commitLsn"`,
  );
  const rows = result.rows as Array<{ commitLsn?: unknown }>;
  const commitLsn = rows[0]?.commitLsn;

  if (typeof commitLsn !== "string" || commitLsn.length === 0) {
    throw new Error("Failed to read current commit LSN.");
  }

  return commitLsn;
}
