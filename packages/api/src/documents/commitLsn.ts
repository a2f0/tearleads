import {
  type DatabaseSession,
  databaseReadConsistency,
} from "@tearleads/api-shared/postgres";
import { parseWalLsn } from "@tearleads/validators/util";
import { sql } from "drizzle-orm";
import { z } from "zod";

const commitLsnRowSchema = z.object({ commitLsn: z.string().min(1) });

export async function readCommitCheckpoint(executor: DatabaseSession): Promise<{
  readonly commitLsn: string;
  readonly commitLsnMode: "tracked" | "untracked";
}> {
  return databaseReadConsistency(executor) === "primary-only"
    ? { commitLsn: "0/0", commitLsnMode: "untracked" }
    : {
        commitLsn: await readCurrentCommitLsn(executor),
        commitLsnMode: "tracked",
      };
}

export async function isMinLsnSatisfied(
  executor: DatabaseSession,
  minLsn: string | undefined,
): Promise<boolean> {
  if (!minLsn) return true;
  const checkpoint = await readCommitCheckpoint(executor);
  return (
    checkpoint.commitLsnMode === "untracked" ||
    parseWalLsn(checkpoint.commitLsn) >= parseWalLsn(minLsn)
  );
}

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
