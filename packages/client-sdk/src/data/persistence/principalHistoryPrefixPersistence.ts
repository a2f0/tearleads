import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export type PrincipalHistoryPrefix =
  typeof principalHistoryPrefixes.$inferSelect;

export async function loadPrincipalHistoryPrefix(
  execSql: ExecSql,
  scopeId: string,
) {
  await ensureSqlTables(execSql, principalHistoryEvidenceTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [prefix] = await db
    .select()
    .from(principalHistoryPrefixes)
    .where(eq(principalHistoryPrefixes.scopeId, scopeId))
    .limit(1);
  return prefix ?? null;
}

/** Keep one completed prefix per key/trust scope; older readers cannot replace it. */
export async function savePrincipalHistoryPrefix(input: {
  readonly execSql: ExecSql;
  readonly prefix: PrincipalHistoryPrefix;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const prefix = { ...input.prefix };
  await ensureSqlTables(input.execSql, principalHistoryEvidenceTables);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      const [previous] = await tx
        .select()
        .from(principalHistoryPrefixes)
        .where(eq(principalHistoryPrefixes.scopeId, prefix.scopeId))
        .limit(1);
      if (previous && previous.version > prefix.version) return;
      await tx
        .insert(principalHistoryPrefixes)
        .values(prefix)
        .onConflictDoUpdate({
          target: principalHistoryPrefixes.scopeId,
          set: prefix,
        })
        .run();
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => result.committed);
}

/** Invalid hints are disposable, but a losing reader must preserve a newer hint. */
export async function discardPrincipalHistoryPrefix(input: {
  readonly execSql: ExecSql;
  readonly prefix: PrincipalHistoryPrefix;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const prefix = { ...input.prefix };
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      await tx
        .delete(principalHistoryPrefixes)
        .where(
          and(
            eq(principalHistoryPrefixes.scopeId, prefix.scopeId),
            eq(principalHistoryPrefixes.progress, prefix.progress),
          ),
        )
        .run();
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => result.committed);
}
