import { satisfiesVersionVector } from "@tearleads/loro";
import { and, eq } from "drizzle-orm";
import { documentSyncProgress } from "../../../sqlite/schema/documentSyncVerdictSchema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import type { DocumentScope } from "./documentPersistenceTypes";

type VerdictReader = Pick<ClientSQLiteTransactionScope, "select">;

/**
 * The processed cursor a pull may send, or undefined to pull by version
 * alone. It needs a row for this server document, reached by the running
 * judge, whose recorded frontier the current one still covers. A row reached
 * by the running judge implies every void row was too: the judge changes
 * only between pulls, the next pull then goes without a cursor, and its
 * completion drops each void row it did not judge again.
 */
export async function readSendableProcessedCursor(
  db: VerdictReader,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly judge: string;
    readonly scope: DocumentScope;
  },
): Promise<string | undefined> {
  return (await readSendableProcessedProgress(db, input))?.updateId;
}

/**
 * The sendable processed cursor, under `readSendableProcessedCursor`'s
 * rules, with how many updates its pull counted through it (null when the
 * pull's count is unknown).
 */
export async function readSendableProcessedProgress(
  db: VerdictReader,
  input: {
    readonly documentId: string;
    readonly frontier: string;
    readonly judge: string;
    readonly scope: DocumentScope;
  },
): Promise<
  { readonly updateCount: number | null; readonly updateId: string } | undefined
> {
  const [progress] = await db
    .select()
    .from(documentSyncProgress)
    .where(
      and(
        eq(documentSyncProgress.appKind, input.scope.appKind),
        eq(documentSyncProgress.localId, input.scope.localId),
      ),
    )
    .limit(1);
  if (
    !progress?.throughUpdateId ||
    progress.throughVersion === null ||
    progress.documentId !== input.documentId ||
    progress.judge !== input.judge ||
    !satisfiesVersionVector(input.frontier, progress.throughVersion)
  ) {
    return undefined;
  }
  return {
    updateCount: progress.throughUpdateCount,
    updateId: progress.throughUpdateId,
  };
}
