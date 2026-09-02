import {
  type DocumentMoveIntentRecord,
  sqlDocumentMoveIntentPersistence,
} from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export async function settleDocumentMoveIntent(input: {
  execSql: ExecSql;
  intent: DocumentMoveIntentRecord;
  isCurrent: () => boolean;
}): Promise<void> {
  if (!input.isCurrent()) {
    throw new Error("Document move generation changed before local settlement");
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
}
