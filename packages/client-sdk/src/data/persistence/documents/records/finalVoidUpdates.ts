import { and, eq, gte, ne, or } from "drizzle-orm";
import { MAX_LORO_RUNTIME_ATTEMPTS } from "../../../documents/shared/sync/loroRuntimeFailureLedger";
import { documentVoidUpdates } from "../../../sqlite/schema/documentSyncVerdictSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";

/**
 * The updates of a server document this device holds void for good under
 * `judge`, in any local record of it: what it judged is the server's
 * history, not the record's. An update still unsettled after a Loro runtime
 * failure is left out, since a later lifetime may yet import it.
 */
export async function readFinalVoidUpdateIds(
  db: Pick<ClientSQLiteTransactionScope, "select">,
  input: { readonly documentId: string; readonly judge: string },
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ updateId: documentVoidUpdates.updateId })
    .from(documentVoidUpdates)
    .where(
      and(
        eq(documentVoidUpdates.documentId, input.documentId),
        eq(documentVoidUpdates.judge, input.judge),
        or(
          ne(documentVoidUpdates.stage, "loro_runtime"),
          gte(documentVoidUpdates.attempts, MAX_LORO_RUNTIME_ATTEMPTS),
        ),
      ),
    );
  return new Set(rows.map((row) => row.updateId));
}
