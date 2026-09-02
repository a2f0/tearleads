import { and, eq, exists, gt, inArray, lte, notExists, sql } from "drizzle-orm";
import { ensureDocumentTables } from "../../sqlite/documentPersistence";
import {
  containers,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
} from "../../sqlite/schema";
import {
  type ClientSQLiteDatabase,
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
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
    stillCurrent?: (() => boolean) | undefined,
  ) => Promise<boolean>;
  completeDormantMetadataSweepRequest: (
    execSql: ExecSql,
    sweep: DormantMetadataSweepRequest,
    stillCurrent?: (() => boolean) | undefined,
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
    stillCurrent?: (() => boolean) | undefined,
  ) => Promise<number>;
}

type SweepQueryHandle = ClientSQLiteDatabase | ClientSQLiteTransactionScope;

// The sweep request row must still exist at this generation: a concurrent
// newer sweep (or a completed one) revokes the candidate set it authorized.
function sweepGenerationExists(
  handle: SweepQueryHandle,
  sweep: DormantMetadataSweepRequest,
) {
  return exists(
    handle
      .select({ generation: dormantMetadataSweepRequests.generation })
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
      ),
  );
}

// A dormant-metadata row is only reclaimable while its container stays gone;
// a re-granted container re-attaches the metadata instead.
function containerRowMissing(handle: SweepQueryHandle) {
  return notExists(
    handle
      .select({ id: containers.id })
      .from(containers)
      .where(eq(containers.id, dormantContainerMetadata.containerId)),
  );
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
  stillCurrent?: (() => boolean) | undefined,
): Promise<boolean> {
  await ensureContainerTables(execSql);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const claim = async (tx: ClientSQLiteTransactionScope) => {
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
  };
  if (!stillCurrent) {
    return runtime.transaction(claim);
  }
  const outcome = await runtime.guardedTransaction(claim, stillCurrent);
  return outcome.committed && outcome.result === true;
}

export async function completeDormantMetadataSweepRequest(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  stillCurrent?: (() => boolean) | undefined,
): Promise<void> {
  await ensureContainerTables(execSql);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const complete = async (tx: ClientSQLiteTransactionScope) => {
    await tx
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
  };
  if (stillCurrent) {
    await runtime.guardedTransaction(complete, stillCurrent);
    return;
  }
  await runtime.transaction(complete);
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
        sweepGenerationExists(db, sweep),
        containerRowMissing(db),
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
  stillCurrent?: (() => boolean) | undefined,
): Promise<number> {
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const purge = async (tx: ClientSQLiteTransactionScope) => {
    const candidates = await tx
      .select({ containerId: dormantContainerMetadata.containerId })
      .from(dormantContainerMetadata)
      .where(
        and(
          inArray(dormantContainerMetadata.containerId, [...containerIds]),
          eq(dormantContainerMetadata.organizationId, sweep.organizationId),
          lte(dormantContainerMetadata.retainedAt, sweep.requestedAt),
          sweepGenerationExists(tx, sweep),
          containerRowMissing(tx),
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
  };
  if (!stillCurrent) return runtime.transaction(purge);
  const outcome = await runtime.guardedTransaction(purge, stillCurrent);
  return outcome.committed ? (outcome.result ?? 0) : 0;
}

export async function purgeDormantContainerMetadataCandidates(
  execSql: ExecSql,
  sweep: DormantMetadataSweepRequest,
  containerIds: ReadonlyArray<string>,
  stillCurrent?: (() => boolean) | undefined,
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
    if (stillCurrent?.() === false) return purgedCount;
    purgedCount += await purgeDormantContainerMetadataCandidateBatch(
      execSql,
      sweep,
      uniqueContainerIds.slice(
        offset,
        offset + DORMANT_METADATA_SWEEP_BATCH_SIZE,
      ),
      stillCurrent,
    );
  }
  return purgedCount;
}
