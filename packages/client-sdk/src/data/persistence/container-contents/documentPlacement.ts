import { and, eq, inArray } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import {
  documents,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
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

const movePlacementSelection = {
  id: localIntents.id,
  intentType: localIntents.intentType,
  targetContainerId: localIntents.targetContainerId,
};

export interface DocumentMovePlacement {
  readonly id: string | null;
  readonly intentType: string;
  readonly targetContainerId: string;
}

export async function loadDocumentMovePlacement(
  tx: ClientSQLiteTransactionScope,
  documentId: string,
): Promise<DocumentMovePlacement | undefined> {
  const [intent] = await tx
    .select(movePlacementSelection)
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

/** `loadDocumentMovePlacement` for many documents, keyed by document id. */
export async function loadDocumentMovePlacements(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<Map<string, DocumentMovePlacement>> {
  const placements = new Map<string, DocumentMovePlacement>();
  const unique = Array.from(new Set(documentIds));
  // The lane predicate binds one value; the rest carry document ids.
  const chunkSize = sqliteRowsPerStatement(1, 1);
  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const rows = await tx
      .select({ subjectId: localIntents.subjectId, ...movePlacementSelection })
      .from(localIntents)
      .where(
        and(
          inLocalIntentLane(LOCAL_INTENT_LANES.documentPlacement),
          inArray(
            localIntents.subjectId,
            unique.slice(offset, offset + chunkSize),
          ),
        ),
      );
    for (const { subjectId, ...placement } of rows) {
      placements.set(subjectId, placement);
    }
  }
  return placements;
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
