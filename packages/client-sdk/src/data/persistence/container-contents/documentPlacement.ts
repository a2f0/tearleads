import { and, eq, inArray } from "drizzle-orm";
import {
  documents,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { DOCUMENTS_APP_KIND } from "../documents/internal/constants";

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
      id: localIntents.id,
      intentType: localIntents.intentType,
      targetContainerId: localIntents.targetContainerId,
    })
    .from(localIntents)
    .where(
      and(
        inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
        eq(localIntents.subjectId, documentId),
      ),
    )
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
          documentId: localIntents.subjectId,
          id: localIntents.id,
        })
        .from(localIntents)
        .where(
          and(
            inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
            inArray(localIntents.subjectId, ids),
          ),
        )
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
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          inArray(documents.documentId, versionedIds),
        ),
      );
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
