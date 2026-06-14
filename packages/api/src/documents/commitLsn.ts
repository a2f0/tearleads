import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";

export async function readCurrentCommitLsn(
  executor: DatabaseSession,
): Promise<string> {
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
