import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type {
  DocumentsPersistence,
  QueuedPendingUpdateRecord,
} from "../../data/persistence/documents/documentsPersistence";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../data/sqlite/sqlSchema";

export async function listPendingDocumentUpdates(input: {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
}): Promise<QueuedPendingUpdateRecord[]> {
  return input.persistence.listPendingUpdates(input.execSql, input.localId);
}

type EnqueuePendingDocumentUpdateInput = {
  execSql: ExecSql;
  localId: string;
  persistence: DocumentsPersistence;
  /**
   * Queue nothing when a queued local row already holds these exact bytes,
   * checked under the mutation lock that inserts. Equal bytes are equal
   * operations, so this drops none; a row holding only some of them is no
   * reason to skip.
   */
  unlessQueued?: boolean;
  update: Uint8Array;
} & (
  | {
      expectedDocumentId: string | null;
      expectedRecoveryGeneration: number;
    }
  | {
      expectedDocumentId?: undefined;
      expectedRecoveryGeneration?: never;
    }
);

/** Whether the store still holds the document identity the caller expects. */
function expectedIdentityHolds(
  input: EnqueuePendingDocumentUpdateInput,
  execSql: ExecSql,
): Promise<boolean> | boolean {
  return input.expectedDocumentId === undefined
    ? true
    : input.persistence.documentIdentityMatches(
        execSql,
        input.localId,
        input.expectedDocumentId,
        input.expectedRecoveryGeneration,
      );
}

export async function enqueuePendingDocumentUpdate(
  input: EnqueuePendingDocumentUpdateInput,
): Promise<boolean> {
  const pendingUpdateFields = createPendingUpdateFields(input.update);
  if (!pendingUpdateFields) {
    return expectedIdentityHolds(input, input.execSql);
  }

  const insert = (execSql: ExecSql) =>
    input.persistence.enqueuePendingUpdate(
      execSql,
      {
        localId: input.localId,
        ...pendingUpdateFields,
      },
      input.expectedDocumentId === undefined
        ? undefined
        : {
            expectedDocumentId: input.expectedDocumentId,
            expectedRecoveryGeneration: input.expectedRecoveryGeneration,
          },
    );
  if (!input.unlessQueued) return insert(input.execSql);
  return runSerializedSqlMutation(input.execSql, async (execSql) => {
    const queued = await input.persistence.listPendingUpdates(
      execSql,
      input.localId,
    );
    const held = queued.some(
      (row) =>
        row.origin === "local" &&
        row.updateData === pendingUpdateFields.updateData,
    );
    return held ? expectedIdentityHolds(input, execSql) : insert(execSql);
  });
}
