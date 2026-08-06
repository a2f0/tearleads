import { and, eq, inArray, sql } from "drizzle-orm";
import {
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentPendingUpdates,
  documentSyncFailures,
  documents,
  dormantContainerMetadata,
} from "../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";

export const CONTAINER_METADATA_APP_KIND = "container-metadata";

interface DormantContainerMetadataRetention {
  readonly containerId: string;
  readonly organizationId: string;
  readonly retainedAt: string;
}

export async function retainDormantContainerMetadataInTransaction(
  tx: ClientSQLiteTransactionScope,
  retained: ReadonlyArray<DormantContainerMetadataRetention>,
): Promise<void> {
  if (retained.length === 0) {
    return;
  }

  await tx
    .insert(dormantContainerMetadata)
    .values([...retained])
    .onConflictDoUpdate({
      target: dormantContainerMetadata.containerId,
      set: {
        organizationId: sql`excluded.organization_id`,
        retainedAt: sql`excluded.retained_at`,
      },
    })
    .run();
}

export async function clearDormantContainerMetadataInTransaction(
  tx: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  if (containerIds.length === 0) {
    return;
  }
  await tx
    .delete(dormantContainerMetadata)
    .where(inArray(dormantContainerMetadata.containerId, [...containerIds]))
    .run();
}

/** Delete every durable row owned by a container-metadata document scope. */
export async function deleteContainerMetadataDocumentRowsInTransaction(
  tx: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  const ids = [...containerIds];
  if (ids.length === 0) {
    return;
  }
  await tx
    .delete(documents)
    .where(
      and(
        eq(documents.appKind, CONTAINER_METADATA_APP_KIND),
        inArray(documents.localId, ids),
      ),
    )
    .run();
  await tx
    .delete(documentHistoryCheckpoints)
    .where(
      and(
        eq(documentHistoryCheckpoints.appKind, CONTAINER_METADATA_APP_KIND),
        inArray(documentHistoryCheckpoints.localId, ids),
      ),
    )
    .run();
  await tx
    .delete(documentHistoryUpdates)
    .where(
      and(
        eq(documentHistoryUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        inArray(documentHistoryUpdates.localId, ids),
      ),
    )
    .run();
  await tx
    .delete(documentPendingUpdates)
    .where(
      and(
        eq(documentPendingUpdates.appKind, CONTAINER_METADATA_APP_KIND),
        inArray(documentPendingUpdates.localId, ids),
      ),
    )
    .run();
  await tx
    .delete(documentSyncFailures)
    .where(
      and(
        eq(documentSyncFailures.appKind, CONTAINER_METADATA_APP_KIND),
        inArray(documentSyncFailures.localId, ids),
      ),
    )
    .run();
  await clearDormantContainerMetadataInTransaction(tx, ids);
}
