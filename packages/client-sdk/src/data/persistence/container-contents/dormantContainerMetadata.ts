import { and, eq, exists, inArray, lte, notExists, sql } from "drizzle-orm";
import { ensureDocumentTables } from "../../sqlite/documentPersistence";
import {
  containers,
  documentHistoryCheckpoints,
  documentHistoryUpdates,
  documentPendingUpdates,
  documentSyncFailures,
  documents,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, runSerializedSqlMutation } from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "../containers/containerPersistence";

export const CONTAINER_METADATA_APP_KIND = "container-metadata";
const DORMANT_METADATA_SWEEP_BATCH_SIZE = 64;

interface DormantContainerMetadataRetention {
  readonly containerId: string;
  readonly organizationId: string;
  readonly retainedAt: string;
}

export interface DormantMetadataSweepRequest {
  readonly generation: number;
  readonly organizationId: string;
  readonly requestedAt: string;
  readonly requesterUserId: string;
}

export interface DormantContainerMetadataPersistence {
  completeDormantMetadataSweepRequest: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
  ) => Promise<void>;
  listDormantMetadataSweepRequests: (
    execSql: ExecSql,
    requesterUserId: string,
  ) => Promise<readonly DormantMetadataSweepRequest[]>;
  purgeUnmatchedDormantContainerMetadata: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
  ) => Promise<number>;
}

export async function requestDormantMetadataRestorationSweep(
  execSql: ExecSql,
  input: { organizationId: string; requesterUserId: string },
): Promise<void> {
  await ensureContainerTables(execSql);
  const requestedAt = new Date().toISOString();
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(dormantMetadataSweepRequests)
      .values({ generation: 1, ...input, requestedAt })
      .onConflictDoUpdate({
        target: [
          dormantMetadataSweepRequests.organizationId,
          dormantMetadataSweepRequests.requesterUserId,
        ],
        set: {
          generation: sql`${dormantMetadataSweepRequests.generation} + 1`,
          requestedAt: sql`excluded.requested_at`,
        },
      })
      .run();
  });
}

export async function listDormantMetadataSweepRequests(
  execSql: ExecSql,
  requesterUserId: string,
): Promise<readonly DormantMetadataSweepRequest[]> {
  await ensureContainerTables(execSql);
  return getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      generation: dormantMetadataSweepRequests.generation,
      organizationId: dormantMetadataSweepRequests.organizationId,
      requestedAt: dormantMetadataSweepRequests.requestedAt,
      requesterUserId: dormantMetadataSweepRequests.requesterUserId,
    })
    .from(dormantMetadataSweepRequests)
    .where(eq(dormantMetadataSweepRequests.requesterUserId, requesterUserId))
    .orderBy(dormantMetadataSweepRequests.organizationId);
}

export async function completeDormantMetadataSweepRequest(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
): Promise<void> {
  await ensureContainerTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(dormantMetadataSweepRequests)
      .where(
        and(
          eq(dormantMetadataSweepRequests.organizationId, sweep.organizationId),
          eq(
            dormantMetadataSweepRequests.requesterUserId,
            sweep.requesterUserId,
          ),
          eq(dormantMetadataSweepRequests.generation, sweep.generation),
        ),
      )
      .run();
  });
}

export async function retainDormantContainerMetadataInTransaction(
  tx: ClientSQLiteTransaction,
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
  tx: ClientSQLiteTransaction,
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
  tx: ClientSQLiteTransaction,
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

async function purgeDormantContainerMetadataBatch(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
): Promise<number> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) =>
    getClientSQLitePersistenceRuntime(lockedExecSql).transaction(async (tx) => {
      const candidates = await tx
        .select({ containerId: dormantContainerMetadata.containerId })
        .from(dormantContainerMetadata)
        .where(
          and(
            eq(dormantContainerMetadata.organizationId, sweep.organizationId),
            lte(dormantContainerMetadata.retainedAt, sweep.requestedAt),
            exists(
              tx
                .select({ generation: dormantMetadataSweepRequests.generation })
                .from(dormantMetadataSweepRequests)
                .where(
                  and(
                    eq(
                      dormantMetadataSweepRequests.organizationId,
                      sweep.organizationId,
                    ),
                    eq(
                      dormantMetadataSweepRequests.requesterUserId,
                      sweep.requesterUserId,
                    ),
                    eq(
                      dormantMetadataSweepRequests.generation,
                      sweep.generation,
                    ),
                  ),
                ),
            ),
            notExists(
              tx
                .select({ id: containers.id })
                .from(containers)
                .where(eq(containers.id, dormantContainerMetadata.containerId)),
            ),
          ),
        )
        .orderBy(dormantContainerMetadata.containerId)
        .limit(DORMANT_METADATA_SWEEP_BATCH_SIZE);
      const containerIds = candidates.map((candidate) => candidate.containerId);
      await deleteContainerMetadataDocumentRowsInTransaction(tx, containerIds);
      return containerIds.length;
    }),
  );
}

/**
 * Reclaim retained metadata only after the caller completed an authoritative
 * restoration crawl. SQL work is capped per transaction so a large stale set
 * never expands an `IN` clause or write lock without bound.
 */
export async function purgeUnmatchedDormantContainerMetadata(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
): Promise<number> {
  await ensureContainerTables(execSql);
  await ensureDocumentTables(execSql);
  let purgedCount = 0;
  while (true) {
    const batchCount = await purgeDormantContainerMetadataBatch(execSql, sweep);
    purgedCount += batchCount;
    if (batchCount < DORMANT_METADATA_SWEEP_BATCH_SIZE) {
      return purgedCount;
    }
  }
}
