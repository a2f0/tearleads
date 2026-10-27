import { and, eq } from "drizzle-orm";
import { normalizeEffectiveAccessLevel } from "../../keying/accessLevel";
import { containerSyncWatermarks } from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { clearDocumentDiscoveryEvidenceOnRemoteReset } from "../documents/documentDiscoveryEvidencePersistence";
import type { ContainerRecord } from "./containerPersistence";

/**
 * Held remote permissions change through the metadata CAS commit, which calls
 * this in its transaction. Insert and local-authoring saves have no prior
 * remote permission to invalidate. Documents' edit clocks do not track grants.
 */
export async function resetAccessDiscovery(
  tx: ClientSQLiteTransactionScope,
  current: ContainerRecord,
  next: ContainerRecord,
): Promise<void> {
  if (
    normalizeEffectiveAccessLevel(current.effectiveAccessLevel) ===
    normalizeEffectiveAccessLevel(next.effectiveAccessLevel)
  )
    return;
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
  // The discovery sequence is database-wide: this cancels all in-flight
  // listings and evicts all cached heads, costing a retry/re-verification even
  // in other organizations. Only this folder's pending candidates and cursor
  // are removed; unrelated queues and cursors survive.
  await clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
    containerIds: [containerId],
    documentIds: [],
  });
}
