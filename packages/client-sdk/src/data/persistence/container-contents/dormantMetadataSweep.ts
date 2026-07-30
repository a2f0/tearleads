import { and, eq, exists, gt, inArray, lte, notExists, sql } from "drizzle-orm";
import { ensureDocumentTables } from "../../sqlite/documentPersistence";
import {
  containers,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "../containers/containerPersistence";
import { deleteContainerMetadataDocumentRowsInTransaction } from "./dormantContainerMetadata";

const DORMANT_METADATA_SWEEP_BATCH_SIZE = 64;

export interface DormantMetadataSweepRequest {
  readonly attemptCount: number;
  readonly generation: number;
  readonly lastAttemptedAt: string | null;
  readonly organizationId: string;
  readonly requestedAt: string;
  readonly requesterUserId: string;
}

export interface DormantMetadataSweepPersistence {
  claimDormantMetadataSweepAttempt: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
    attemptedAt: string,
  ) => Promise<boolean>;
  completeDormantMetadataSweepRequest: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
  ) => Promise<void>;
  listDormantMetadataSweepRequests: (
    execSql: ExecSql,
    requesterUserId: string,
  ) => Promise<readonly DormantMetadataSweepRequest[]>;
  listDormantMetadataSweepCandidates: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
    afterContainerId?: string | undefined,
  ) => Promise<readonly string[]>;
  purgeDormantContainerMetadataCandidates: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
    containerIds: ReadonlyArray<string>,
  ) => Promise<number>;
}

export async function requestDormantMetadataRestorationSweeps(
  execSql: ExecSql,
  input: { requesterUserId: string },
): Promise<number> {
  await ensureContainerTables(execSql);
  const requestedAt = new Date().toISOString();
  return getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    const organizations = await db
      .selectDistinct({
        organizationId: dormantContainerMetadata.organizationId,
      })
      .from(dormantContainerMetadata)
      .orderBy(dormantContainerMetadata.organizationId);
    if (organizations.length === 0) {
      return 0;
    }

    await db
      .insert(dormantMetadataSweepRequests)
      .values(
        organizations.map(({ organizationId }) => ({
          attemptCount: 0,
          generation: 1,
          lastAttemptedAt: null,
          organizationId,
          requestedAt,
          requesterUserId: input.requesterUserId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          dormantMetadataSweepRequests.organizationId,
          dormantMetadataSweepRequests.requesterUserId,
        ],
        set: {
          attemptCount: 0,
          generation: sql`${dormantMetadataSweepRequests.generation} + 1`,
          lastAttemptedAt: null,
          requestedAt: sql`excluded.requested_at`,
        },
      })
      .run();
    return organizations.length;
  });
}

export async function listDormantMetadataSweepRequests(
  execSql: ExecSql,
  requesterUserId: string,
): Promise<readonly DormantMetadataSweepRequest[]> {
  await ensureContainerTables(execSql);
  return getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      attemptCount: dormantMetadataSweepRequests.attemptCount,
      generation: dormantMetadataSweepRequests.generation,
      lastAttemptedAt: dormantMetadataSweepRequests.lastAttemptedAt,
      organizationId: dormantMetadataSweepRequests.organizationId,
      requestedAt: dormantMetadataSweepRequests.requestedAt,
      requesterUserId: dormantMetadataSweepRequests.requesterUserId,
    })
    .from(dormantMetadataSweepRequests)
    .where(eq(dormantMetadataSweepRequests.requesterUserId, requesterUserId))
    .orderBy(dormantMetadataSweepRequests.organizationId);
}

export async function claimDormantMetadataSweepAttempt(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  attemptedAt: string,
): Promise<boolean> {
  await ensureContainerTables(execSql);
  return getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const [current] = await tx
      .select({ attemptCount: dormantMetadataSweepRequests.attemptCount })
      .from(dormantMetadataSweepRequests)
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
      .limit(1);
    if (!current || current.attemptCount !== sweep.attemptCount) {
      return false;
    }
    await tx
      .update(dormantMetadataSweepRequests)
      .set({
        attemptCount: current.attemptCount + 1,
        lastAttemptedAt: attemptedAt,
      })
      .where(
        and(
          eq(dormantMetadataSweepRequests.organizationId, sweep.organizationId),
          eq(
            dormantMetadataSweepRequests.requesterUserId,
            sweep.requesterUserId,
          ),
          eq(dormantMetadataSweepRequests.generation, sweep.generation),
          eq(dormantMetadataSweepRequests.attemptCount, current.attemptCount),
        ),
      )
      .run();
    return true;
  });
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

export async function listDormantMetadataSweepCandidates(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  afterContainerId?: string,
): Promise<readonly string[]> {
  await ensureContainerTables(execSql);
  const db = getClientSQLitePersistenceRuntime(execSql).db;
  const candidates = await db
    .select({ containerId: dormantContainerMetadata.containerId })
    .from(dormantContainerMetadata)
    .where(
      and(
        eq(dormantContainerMetadata.organizationId, sweep.organizationId),
        lte(dormantContainerMetadata.retainedAt, sweep.requestedAt),
        afterContainerId
          ? gt(dormantContainerMetadata.containerId, afterContainerId)
          : undefined,
        exists(
          db
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
                eq(dormantMetadataSweepRequests.generation, sweep.generation),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: containers.id })
            .from(containers)
            .where(eq(containers.id, dormantContainerMetadata.containerId)),
        ),
      ),
    )
    .orderBy(dormantContainerMetadata.containerId)
    .limit(DORMANT_METADATA_SWEEP_BATCH_SIZE);
  return candidates.map((candidate) => candidate.containerId);
}

/**
 * Reclaim only the exact candidates whose remote deletion the caller proved
 * after an authoritative restoration crawl. The request generation, retention
 * timestamp, and missing local container are rechecked in the transaction so a
 * concurrent re-grant or newer sweep cannot authorize a stale deletion.
 */
async function purgeDormantContainerMetadataCandidateBatch(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  containerIds: ReadonlyArray<string>,
): Promise<number> {
  return getClientSQLitePersistenceRuntime(execSql).transaction(async (tx) => {
    const candidates = await tx
      .select({ containerId: dormantContainerMetadata.containerId })
      .from(dormantContainerMetadata)
      .where(
        and(
          inArray(dormantContainerMetadata.containerId, [...containerIds]),
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
                  eq(dormantMetadataSweepRequests.generation, sweep.generation),
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
      );
    const confirmedContainerIds = candidates.map(
      (candidate) => candidate.containerId,
    );
    await deleteContainerMetadataDocumentRowsInTransaction(
      tx,
      confirmedContainerIds,
    );
    return confirmedContainerIds.length;
  });
}

export async function purgeDormantContainerMetadataCandidates(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  containerIds: ReadonlyArray<string>,
): Promise<number> {
  const uniqueContainerIds = Array.from(new Set(containerIds));
  if (uniqueContainerIds.length === 0) {
    return 0;
  }
  await ensureContainerTables(execSql);
  await ensureDocumentTables(execSql);
  let purgedCount = 0;
  for (
    let offset = 0;
    offset < uniqueContainerIds.length;
    offset += DORMANT_METADATA_SWEEP_BATCH_SIZE
  ) {
    purgedCount += await purgeDormantContainerMetadataCandidateBatch(
      execSql,
      sweep,
      uniqueContainerIds.slice(
        offset,
        offset + DORMANT_METADATA_SWEEP_BATCH_SIZE,
      ),
    );
  }
  return purgedCount;
}
