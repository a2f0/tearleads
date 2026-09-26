import { and, eq, sql } from "drizzle-orm";
import {
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "../containers/containerPersistence";

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
