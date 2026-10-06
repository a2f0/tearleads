import { and, eq } from "drizzle-orm";
import { ProjectionVerificationCancelledError } from "../keyingProjectionVerification/types";
import {
  principalHistoryStages,
  principalHistoryStageTables,
} from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export type PrincipalHistoryStage = typeof principalHistoryStages.$inferSelect;

class PrincipalHistoryStageChangedError extends Error {
  readonly code = "principal_history_stage_changed";
  constructor() {
    super(
      "Another operation changed the saved principal history; resume from its current state",
    );
    this.name = "PrincipalHistoryStageChangedError";
  }
}

export async function loadPrincipalHistoryStage(execSql: ExecSql, id: string) {
  await ensureSqlTables(execSql, principalHistoryStageTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select()
    .from(principalHistoryStages)
    .where(eq(principalHistoryStages.id, id))
    .limit(1);
  return row ?? null;
}

/** The checked evidence lives inside authenticated progress, in the same row. */
export async function savePrincipalHistoryStage(input: {
  readonly execSql: ExecSql;
  readonly stage: PrincipalHistoryStage;
  readonly previousProgress: string | null;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const stage = { ...input.stage };
  await ensureSqlTables(input.execSql, principalHistoryStageTables);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const saved = await runtime.guardedTransaction(
    async (tx) => {
      const [previous] = await tx
        .select({ progress: principalHistoryStages.progress })
        .from(principalHistoryStages)
        .where(eq(principalHistoryStages.id, stage.id))
        .limit(1);
      if ((previous?.progress ?? null) !== input.previousProgress)
        throw new PrincipalHistoryStageChangedError();
      await tx
        .insert(principalHistoryStages)
        .values(stage)
        .onConflictDoUpdate({ target: principalHistoryStages.id, set: stage })
        .run();
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  if (!saved.committed) throw new ProjectionVerificationCancelledError();
}

export async function discardPrincipalHistoryStage(
  execSql: ExecSql,
  stage: PrincipalHistoryStage,
  stillCurrent: () => boolean,
) {
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const discarded = await runtime.guardedTransaction(
    async (db) => {
      await db
        .delete(principalHistoryStages)
        .where(
          and(
            eq(principalHistoryStages.id, stage.id),
            eq(principalHistoryStages.progress, stage.progress),
          ),
        )
        .run();
    },
    stillCurrent,
    { behavior: "immediate" },
  );
  if (!discarded.committed) throw new ProjectionVerificationCancelledError();
}
