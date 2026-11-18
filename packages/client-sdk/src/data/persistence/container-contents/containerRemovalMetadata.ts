import { and, eq, inArray } from "drizzle-orm";
import {
  documentHistoryCheckpoints,
  documents,
} from "../../sqlite/schema/documentRecordSchema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import type { ContainerDeletionGuard } from "./containerContentsPersistenceTypes";
import { containerRemovalBatches } from "./containerRemovalBatches";
import { CONTAINER_METADATA_APP_KIND } from "./dormantContainerMetadata";

/** A permission read may bypass an older entity clock. Its request-time
 * metadata must still match after the deletion has acquired the write lock. */
export async function confirmedRemovalMetadataMatches(
  tx: ClientSQLiteTransactionScope,
  guards: readonly ContainerDeletionGuard[],
): Promise<boolean> {
  const confirmed = guards.filter(
    (guard) => guard.confirmedAccessLoss && guard.expectedContainer,
  );
  for (const batch of containerRemovalBatches(confirmed)) {
    const ids = batch.map((guard) => guard.containerId);
    const rows = await tx
      .select({
        id: documents.localId,
        documentId: documents.documentId,
        accessEpoch: documents.accessEpoch,
        accessStateHash: documents.accessStateHash,
        metadataUpdates: documentHistoryCheckpoints.snapshot,
      })
      .from(documents)
      .leftJoin(
        documentHistoryCheckpoints,
        and(
          eq(documents.appKind, documentHistoryCheckpoints.appKind),
          eq(documents.localId, documentHistoryCheckpoints.localId),
        ),
      )
      .where(
        and(
          eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
          inArray(documents.localId, ids),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const guard of batch) {
      const previous = guard.confirmedAccessLoss?.expectedMetadata;
      const current = byId.get(guard.containerId);
      // A purged metadata document can have an in-memory initial record with
      // no signed head; it has no durable metadata to preserve.
      if (!current && !previous?.accessStateHash) continue;
      if (
        !previous ||
        !current ||
        previous.documentId !== current.documentId ||
        previous.accessEpoch !== current.accessEpoch ||
        (previous.accessStateHash ?? null) !== current.accessStateHash ||
        previous.metadataUpdates !== (current.metadataUpdates ?? "")
      )
        return false;
    }
  }
  return true;
}
