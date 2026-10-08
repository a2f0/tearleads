import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import {
  principalHistoryEvidenceTables,
  principalHistoryPrefixes,
} from "../sqlite/principalHistoryEvidenceSchema";
import { principalHistoryStageTables } from "../sqlite/principalHistoryStageSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";
import { reclaimPrincipalHistoryNodes } from "./principalHistoryNodeRetention";
import {
  releasePrincipalHistoryRoot,
  retainPrincipalHistoryRoot,
} from "./principalHistoryRootOwnership";
import { reclaimCompletedPrincipalHistoryStages } from "./principalHistoryStageRetention";
import { archivePrincipalHistoryKeyEnvelopes } from "./principalKeyEnvelopeArchivePersistence";

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

/** Keep the newest prefix unless replay replaces the exact rejected candidate. */
export async function savePrincipalHistoryPrefix(input: {
  readonly execSql: ExecSql;
  readonly prefix: PrincipalHistoryPrefix;
  readonly indexRootHash: string;
  readonly stillCurrent: () => boolean;
  readonly rejectedPrefix?: PrincipalHistoryPrefix | null;
}): Promise<void> {
  const prefix = { ...input.prefix };
  const indexRootHash = input.indexRootHash;
  const rejected = input.rejectedPrefix ? { ...input.rejectedPrefix } : null;
  await ensureSqlTables(input.execSql, [
    ...principalHistoryEvidenceTables,
    ...principalHistoryStageTables,
  ]);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      const [previous] = await tx
        .select()
        .from(principalHistoryPrefixes)
        .where(eq(principalHistoryPrefixes.scopeId, prefix.scopeId))
        .limit(1);
      if (
        previous &&
        previous.version > prefix.version &&
        !(
          rejected?.scopeId === previous.scopeId &&
          rejected.progress === previous.progress
        )
      )
        return;
      if (previous) await archivePrincipalHistoryKeyEnvelopes(tx, previous);
      await archivePrincipalHistoryKeyEnvelopes(tx, prefix);
      await tx
        .insert(principalHistoryPrefixes)
        .values(prefix)
        .onConflictDoUpdate({
          target: principalHistoryPrefixes.scopeId,
          set: prefix,
        })
        .run();
      await reclaimCompletedPrincipalHistoryStages(tx, prefix);
      await retainPrincipalHistoryRoot(tx, {
        id: `prefix:${prefix.scopeId}`,
        scopeId: prefix.scopeId,
        organizationId: prefix.organizationId,
        rootHash: indexRootHash,
      });
      await reclaimPrincipalHistoryNodes(tx, prefix);
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
  await ensureSqlTables(input.execSql, principalHistoryEvidenceTables);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      const [current] = await tx
        .select({ progress: principalHistoryPrefixes.progress })
        .from(principalHistoryPrefixes)
        .where(eq(principalHistoryPrefixes.scopeId, prefix.scopeId))
        .limit(1);
      if (current?.progress !== prefix.progress) return;
      await releasePrincipalHistoryRoot(tx, `prefix:${prefix.scopeId}`);
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
