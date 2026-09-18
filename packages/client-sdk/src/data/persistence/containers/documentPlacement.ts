import { eq, inArray } from "drizzle-orm";
import { documentMoveIntents, documents } from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export interface DocumentPlacementInput {
  documentId: string;
  containerIds: ReadonlyArray<string>;
  accessEpoch?: number | undefined;
}

export interface DocumentPlacementWriteOptions {
  stillCurrent?: (() => boolean) | undefined;
  moveIntentId?: string | undefined;
}

export async function loadDocumentMovePlacement(
  tx: ClientSQLiteTransactionScope,
  documentId: string,
) {
  const [intent] = await tx
    .select({
      id: documentMoveIntents.id,
      targetContainerId: documentMoveIntents.targetContainerId,
    })
    .from(documentMoveIntents)
    .where(eq(documentMoveIntents.documentId, documentId))
    .limit(1);
  return intent;
}

/** Check at commit time: neither intermediate replay nor discovery owns a pending move. */
export async function filterWritableDocumentPlacements(
  tx: ClientSQLiteTransactionScope,
  inputs: readonly DocumentPlacementInput[],
  options?: DocumentPlacementWriteOptions,
): Promise<readonly DocumentPlacementInput[]> {
  const ids = inputs.map((input) => input.documentId);
  const intents = new Map(
    (
      await tx
        .select({
          documentId: documentMoveIntents.documentId,
          id: documentMoveIntents.id,
        })
        .from(documentMoveIntents)
        .where(inArray(documentMoveIntents.documentId, ids))
    ).map((row) => [row.documentId, row.id]),
  );
  const versionedIds = inputs
    .filter((input) => input.accessEpoch !== undefined)
    .map((input) => input.documentId);
  const epochs = new Map<string, number>();
  if (versionedIds.length > 0) {
    const rows = await tx
      .select({
        documentId: documents.documentId,
        accessEpoch: documents.accessEpoch,
      })
      .from(documents)
      .where(inArray(documents.documentId, versionedIds));
    for (const row of rows)
      if (row.documentId)
        epochs.set(
          row.documentId,
          Math.max(epochs.get(row.documentId) ?? 0, row.accessEpoch),
        );
  }
  return inputs.filter((input) => {
    if (options?.moveIntentId)
      return intents.get(input.documentId) === options.moveIntentId;
    if (intents.has(input.documentId)) return false;
    return (
      input.accessEpoch === undefined ||
      input.accessEpoch >= (epochs.get(input.documentId) ?? 0)
    );
  });
}
