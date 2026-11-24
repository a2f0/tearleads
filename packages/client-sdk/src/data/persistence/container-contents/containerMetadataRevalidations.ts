import { and, eq, sql } from "drizzle-orm";
import { containerMetadataRevalidations } from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../sqlite/sqlSchema";
import { ensureContainerTables } from "./containerPersistence";

/** A metadata document owed a remote read, and the request's revision. */
export interface ContainerMetadataRevalidation {
  /** The most updates a listing counted; a read must cover at least these. */
  readonly advertisedUpdateCount: number;
  readonly documentId: string;
  readonly revision: string;
}

export interface ContainerMetadataRevalidationPersistence {
  /** Record, or renew, a request that a metadata document be read. */
  requestContainerMetadataRevalidation: (
    execSql: ExecSql,
    request: {
      readonly advertisedUpdateCount: number;
      readonly documentId: string;
    },
  ) => Promise<void>;
  /** Requests still owed, in document id order. */
  listContainerMetadataRevalidations: (
    execSql: ExecSql,
  ) => Promise<readonly ContainerMetadataRevalidation[]>;
  /**
   * Settle the request a read observed. A newer request, from this tab or
   * another sharing the database, carries another revision and stays.
   */
  settleContainerMetadataRevalidation: (
    execSql: ExecSql,
    revalidation: ContainerMetadataRevalidation,
  ) => Promise<void>;
}

async function requestContainerMetadataRevalidation(
  execSql: ExecSql,
  request: {
    readonly advertisedUpdateCount: number;
    readonly documentId: string;
  },
): Promise<void> {
  await ensureContainerTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .insert(containerMetadataRevalidations)
      .values({
        advertisedUpdateCount: request.advertisedUpdateCount,
        documentId: request.documentId,
        requestedAt: new Date().toISOString(),
        revision: crypto.randomUUID(),
      })
      .onConflictDoUpdate({
        target: containerMetadataRevalidations.documentId,
        set: {
          // A listing read from a lagging replica never lowers the debt.
          advertisedUpdateCount: sql`max(${containerMetadataRevalidations.advertisedUpdateCount}, excluded.advertised_update_count)`,
          requestedAt: sql`excluded.requested_at`,
          revision: sql`excluded.revision`,
        },
      })
      .run();
  });
}

async function listContainerMetadataRevalidations(
  execSql: ExecSql,
): Promise<readonly ContainerMetadataRevalidation[]> {
  await ensureContainerTables(execSql);
  return getClientSQLitePersistenceRuntime(execSql)
    .db.select({
      advertisedUpdateCount:
        containerMetadataRevalidations.advertisedUpdateCount,
      documentId: containerMetadataRevalidations.documentId,
      revision: containerMetadataRevalidations.revision,
    })
    .from(containerMetadataRevalidations)
    .orderBy(containerMetadataRevalidations.documentId);
}

async function settleContainerMetadataRevalidation(
  execSql: ExecSql,
  revalidation: ContainerMetadataRevalidation,
): Promise<void> {
  await ensureContainerTables(execSql);
  await getClientSQLitePersistenceRuntime(execSql).runMutation(async (db) => {
    await db
      .delete(containerMetadataRevalidations)
      .where(
        and(
          eq(
            containerMetadataRevalidations.documentId,
            revalidation.documentId,
          ),
          eq(containerMetadataRevalidations.revision, revalidation.revision),
        ),
      )
      .run();
  });
}

export const containerMetadataRevalidationPersistence: ContainerMetadataRevalidationPersistence =
  {
    listContainerMetadataRevalidations,
    requestContainerMetadataRevalidation,
    settleContainerMetadataRevalidation,
  };
