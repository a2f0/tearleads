import { and, eq } from "drizzle-orm";
import { containerSyncWatermarks } from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { invalidateDocumentDiscoveryInTransaction } from "../documents/documentDiscoveryEvidencePersistence";
import type { ContainerRecord } from "./containerPersistence";

/** Permission changes do not advance the contained documents' edit clocks. */
export async function resetAccessDiscovery(
  tx: ClientSQLiteTransactionScope,
  current: ContainerRecord,
  next: ContainerRecord,
): Promise<void> {
  if (current.effectiveAccessLevel === next.effectiveAccessLevel) return;
  const containerId = next.id;
  await tx
    .delete(containerSyncWatermarks)
    .where(
      and(
        eq(containerSyncWatermarks.laneKind, "container_documents"),
        eq(containerSyncWatermarks.laneId, containerId),
      ),
    )
    .run();
  // Also fence listings started under the old permission and discard pending
  // candidates carrying it. The next discovery must relist unchanged documents.
  await invalidateDocumentDiscoveryInTransaction(tx, {
    containerIds: [containerId],
    documentIds: [],
  });
}
