import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import {
  principalMutationJournal,
  principalMutationJournalTables,
} from "../sqlite/principalMutationJournalSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export type PrincipalMutationJournalRow =
  typeof principalMutationJournal.$inferSelect;

export class PendingPrincipalMutationError extends Error {
  constructor() {
    super("Resolve the pending principal mutation before submitting another");
    this.name = "PendingPrincipalMutationError";
  }
}

export async function loadPrincipalMutationJournal(
  execSql: ExecSql,
  scopeId: string,
): Promise<PrincipalMutationJournalRow | null> {
  await ensureSqlTables(execSql, principalMutationJournalTables);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const [row] = await db
    .select()
    .from(principalMutationJournal)
    .where(eq(principalMutationJournal.scopeId, scopeId))
    .limit(1);
  return row ?? null;
}

/** Claim the organization lane before dispatch; never overwrite unresolved work. */
export async function claimPrincipalMutationJournal(input: {
  readonly execSql: ExecSql;
  readonly row: PrincipalMutationJournalRow;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const row = { ...input.row };
  await ensureSqlTables(input.execSql, principalMutationJournalTables);
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      const [existing] = await tx
        .select({ scopeId: principalMutationJournal.scopeId })
        .from(principalMutationJournal)
        .where(eq(principalMutationJournal.scopeId, row.scopeId))
        .limit(1);
      if (existing) throw new PendingPrincipalMutationError();
      await tx.insert(principalMutationJournal).values(row).run();
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => result.committed);
}

/** A late acknowledgement cannot retire another operation's journal entry. */
export async function clearPrincipalMutationJournal(input: {
  readonly execSql: ExecSql;
  readonly row: PrincipalMutationJournalRow;
  readonly stillCurrent: () => boolean;
}): Promise<void> {
  const row = { ...input.row };
  const runtime = getClientSQLitePersistenceRuntime(input.execSql);
  const result = await runtime.guardedTransaction(
    async (tx) => {
      await tx
        .delete(principalMutationJournal)
        .where(
          and(
            eq(principalMutationJournal.scopeId, row.scopeId),
            eq(principalMutationJournal.organizationId, row.organizationId),
            eq(
              principalMutationJournal.serializedRequest,
              row.serializedRequest,
            ),
            eq(principalMutationJournal.signature, row.signature),
          ),
        )
        .run();
    },
    input.stillCurrent,
    { behavior: "immediate" },
  );
  assertProjectionVerificationCurrent(() => result.committed);
}
