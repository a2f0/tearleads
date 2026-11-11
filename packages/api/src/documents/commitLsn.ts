import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { sql } from "drizzle-orm";
import { z } from "zod";

const commitLsnRowSchema = z.object({ commitLsn: z.string().min(1) });

export async function readCurrentCommitLsn(
  executor: DatabaseSession,
): Promise<string> {
  const result = await executor.execute(
    sql`select pg_current_wal_lsn()::text as "commitLsn"`,
  );
  const row = commitLsnRowSchema.safeParse(result.rows[0]);
  if (!row.success) {
    throw new Error("Failed to read current commit LSN.");
  }

  return row.data.commitLsn;
}
