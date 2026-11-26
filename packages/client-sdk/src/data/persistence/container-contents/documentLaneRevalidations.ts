import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import {
  containers,
  containerTableSchemas,
} from "../../sqlite/schema/containerSchema";
import {
  containerSyncWatermarks,
  containerSyncWatermarkTables,
  documentLaneRevalidations,
} from "../../sqlite/schema/containerSyncWatermarkSchema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { CONTAINER_DOCUMENTS_LANE } from "./containerSyncWatermarkPersistence";

/** A container's document lane owed a listing, and the request's revision. */
export interface DocumentLaneRevalidation {
  readonly containerId: string;
  readonly revision: string;
}

/**
 * Listings owed to container document lanes, bound to one executor. See
 * `document_lane_revalidations` for what a row means.
 */
export class DocumentLaneRevalidationRepository {
  constructor(
    private readonly execSql: ExecSql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async db() {
    await ensureSqlTables(this.execSql, containerSyncWatermarkTables);
    return getClientSQLitePersistenceRuntime(this.execSql).db;
  }

  /** Record, or renew, a request that each container's lane be listed. */
  async request(containerIds: ReadonlyArray<string>): Promise<void> {
    const unique = [...new Set(containerIds)];
    if (unique.length === 0) return;
    await ensureSqlTables(this.execSql, containerSyncWatermarkTables);
    const requestedAt = this.now().toISOString();
    // Three binds per row.
    const chunkSize = sqliteRowsPerStatement(3, 0);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        for (let offset = 0; offset < unique.length; offset += chunkSize) {
          await db
            .insert(documentLaneRevalidations)
            .values(
              unique.slice(offset, offset + chunkSize).map((containerId) => ({
                containerId,
                requestedAt,
                revision: crypto.randomUUID(),
              })),
            )
            .onConflictDoUpdate({
              target: documentLaneRevalidations.containerId,
              set: {
                requestedAt: sql`excluded.requested_at`,
                revision: sql`excluded.revision`,
              },
            })
            .run();
        }
      },
    );
  }

  /** Every container whose lane is owed a listing. */
  async listOwedContainerIds(): Promise<ReadonlySet<string>> {
    const rows = await (await this.db())
      .select({ containerId: documentLaneRevalidations.containerId })
      .from(documentLaneRevalidations);
    return new Set(rows.map((row) => row.containerId));
  }

  /** The requests still owed to these containers' lanes. */
  async find(
    containerIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<DocumentLaneRevalidation>> {
    if (containerIds.length === 0) return [];
    const db = await this.db();
    const chunkSize = sqliteRowsPerStatement(1, 0);
    const found: DocumentLaneRevalidation[] = [];
    for (let offset = 0; offset < containerIds.length; offset += chunkSize) {
      found.push(
        ...(await db
          .select({
            containerId: documentLaneRevalidations.containerId,
            revision: documentLaneRevalidations.revision,
          })
          .from(documentLaneRevalidations)
          .where(
            inArray(
              documentLaneRevalidations.containerId,
              containerIds.slice(offset, offset + chunkSize),
            ),
          )),
      );
    }
    return found;
  }

  /**
   * Forgets the document-lane state of containers this device does not
   * store: their requests, and their lane rows. A tree listing owes a lane
   * before its row is applied, so a row that was then refused, or one that
   * never verified, leaves a request nothing lists. Dropping it loses
   * nothing as long as a container stored later has no settled lane, which
   * owes it a listing by itself. The delete cascade clears a deleted
   * container's lane row, but a listing that was in flight across the delete
   * writes one afterwards, so those rows go in the same mutation.
   */
  async forgetUnheld(): Promise<void> {
    await ensureSqlTables(this.execSql, [
      ...containerSyncWatermarkTables,
      ...containerTableSchemas,
    ]);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .delete(containerSyncWatermarks)
          .where(
            and(
              eq(containerSyncWatermarks.laneKind, CONTAINER_DOCUMENTS_LANE),
              notExists(
                db
                  .select({ id: containers.id })
                  .from(containers)
                  .where(eq(containers.id, containerSyncWatermarks.laneId)),
              ),
            ),
          )
          .run();
        await db
          .delete(documentLaneRevalidations)
          .where(
            notExists(
              db
                .select({ id: containers.id })
                .from(containers)
                .where(
                  eq(containers.id, documentLaneRevalidations.containerId),
                ),
            ),
          )
          .run();
      },
    );
  }

  /**
   * Settle the request a listing read before it began. A newer request, from
   * this tab or another sharing the database, carries another revision and
   * stays.
   */
  async settle(revalidation: DocumentLaneRevalidation): Promise<void> {
    await ensureSqlTables(this.execSql, containerSyncWatermarkTables);
    await getClientSQLitePersistenceRuntime(this.execSql).runMutation(
      async (db) => {
        await db
          .delete(documentLaneRevalidations)
          .where(
            and(
              eq(
                documentLaneRevalidations.containerId,
                revalidation.containerId,
              ),
              eq(documentLaneRevalidations.revision, revalidation.revision),
            ),
          )
          .run();
      },
    );
  }
}
