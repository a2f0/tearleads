import { and, eq } from "drizzle-orm";
import { assertProjectionVerificationCurrent } from "../keyingProjectionVerification/types";
import {
  principalMutationJournal,
  principalMutationJournalTables,
} from "../sqlite/schema/principalMutationJournalSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

export type PrincipalMutationJournalRow = Omit<
  typeof principalMutationJournal.$inferSelect,
  "identityBundleFormat"
>;

export class PendingPrincipalMutationError extends Error {
  constructor() {
    super(
      "Resolve the pending principal mutation or explicitly abandon its retry before submitting another",
    );
    this.name = "PendingPrincipalMutationError";
  }
}

/**
 * The principal mutation journal, bound to one executor: at most one
 * unresolved signed mutation per organization lane. Each write runs its own
 * immediate guarded transaction and throws when `stillCurrent` refuses it.
 */
export class PrincipalMutationJournalRepository {
  private readonly execSql: ExecSql;

  constructor(execSql: ExecSql) {
    this.execSql = execSql;
  }

  async loadPrincipalMutationJournal(
    scopeId: string,
  ): Promise<PrincipalMutationJournalRow | null> {
    await ensureSqlTables(this.execSql, principalMutationJournalTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [row] = await db
      .select({
        scopeId: principalMutationJournal.scopeId,
        organizationId: principalMutationJournal.organizationId,
        serializedRequest: principalMutationJournal.serializedRequest,
        signature: principalMutationJournal.signature,
      })
      .from(principalMutationJournal)
      .where(eq(principalMutationJournal.scopeId, scopeId))
      .limit(1);
    return row ?? null;
  }

  /** Claim the organization lane before dispatch; never overwrite unresolved work. */
  async claimPrincipalMutationJournal(input: {
    readonly row: PrincipalMutationJournalRow;
    readonly stillCurrent: () => boolean;
  }): Promise<void> {
    const row = { ...input.row };
    await ensureSqlTables(this.execSql, principalMutationJournalTables);
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
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
  async clearPrincipalMutationJournal(input: {
    readonly row: PrincipalMutationJournalRow;
    readonly stillCurrent: () => boolean;
  }): Promise<boolean> {
    const row = { ...input.row };
    const runtime = getClientSQLitePersistenceRuntime(this.execSql);
    const result = await runtime.guardedTransaction(
      async (tx) => {
        const deleted = await tx
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
          .returning({ scopeId: principalMutationJournal.scopeId });
        return deleted.length > 0;
      },
      input.stillCurrent,
      { behavior: "immediate" },
    );
    assertProjectionVerificationCurrent(() => result.committed);
    return result.result === true;
  }
}
