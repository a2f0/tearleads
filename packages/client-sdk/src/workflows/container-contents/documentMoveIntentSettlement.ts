import {
  type DocumentMoveIntentRecord,
  sqlDocumentMoveIntentPersistence,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { loadDocumentMovePlacement } from "../../data/persistence/containers/documentPlacement";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function settleDocumentMoveIntent(input: {
  execSql: ExecSql;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
  linkedContainerIds: readonly string[];
  partial: boolean;
}): Promise<void> {
  if (!input.isCurrent()) {
    throw new Error("Document move generation changed before local settlement");
  }
  if (input.partial) {
    const intent = await loadDocumentMovePlacement(
      getClientSQLitePersistenceRuntime(input.execSql).db,
      input.intent.documentId,
    );
    if (intent?.id !== input.intent.id)
      throw new Error(
        "Document move intent was superseded before local settlement",
      );
    return;
  }
  const settled = await sqlDocumentMoveIntentPersistence.markMoveIntentSynced(
    input.execSql,
    {
      documentId: input.intent.documentId,
      expectedIntentId: input.intent.id,
      expectedUpdatedAt: input.intent.updatedAt,
    },
  );
  if (!settled || !input.isCurrent()) {
    throw new Error(
      "Document move intent was superseded before local settlement",
    );
  }
  await sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    input.execSql,
    input.intent.documentId,
    input.linkedContainerIds,
  );
}
