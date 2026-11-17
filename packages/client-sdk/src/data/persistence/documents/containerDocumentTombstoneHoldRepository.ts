import { and, eq, max } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../documents/documentConstants";
import { containerDocumentTombstoneHolds } from "../../sqlite/schema";
import { documentContainerProjectionTables } from "../../sqlite/schema/documentProjectionSchema";
import {
  documents,
  documentTables,
} from "../../sqlite/schema/documentRecordSchema";
import { remoteResetBatches } from "../../sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import { heldTombstoneRetryDelayMs } from "./containerDocumentTombstoneHoldsPersistence";
import {
  type ContainerDocumentPlacementKey,
  type ContainerDocumentTombstoneHoldRow,
  deleteContainerDocumentTombstoneHoldRows,
  type HeldContainerDocumentTombstone,
  holdContainerDocumentTombstonesInTransaction,
  listContainerDocumentTombstoneHoldsForDocumentsInTransaction,
  listContainerDocumentTombstoneHoldsInTransaction,
  listKnownContainerDocumentPlacementsInTransaction,
  partitionContainerDocumentTombstoneHolds,
  placementPairsMatch,
} from "./internal/containerDocumentTombstoneHolds";

function isHoldDue(
  hold: ContainerDocumentTombstoneHoldRow,
  now: Date,
): boolean {
  return (
    Date.parse(hold.updatedAt) + heldTombstoneRetryDelayMs(hold.attempts) <=
    now.getTime()
  );
}

/**
 * Container document tombstone holds bound to one executor and clock. The
 * clock stamps new holds and decides which held tombstones are due for retry.
 */
export class ContainerDocumentTombstoneHoldRepository {
  private readonly execSql: ExecSql;
  private readonly now: () => Date;

  constructor(execSql: ExecSql, now: () => Date = () => new Date()) {
    this.execSql = execSql;
    this.now = now;
  }

  async holdContainerDocumentTombstones(
    tombstones: ReadonlyArray<HeldContainerDocumentTombstone>,
  ): Promise<void> {
    if (tombstones.length === 0) return;
    const now = this.now().toISOString();
    return runSerializedSqlMutation(this.execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
      await db.transaction((tx) =>
        holdContainerDocumentTombstonesInTransaction(tx, tombstones, now),
      );
    });
  }

  async refuteContainerDocumentTombstoneHolds(
    placements: ReadonlyArray<ContainerDocumentPlacementKey>,
  ): Promise<void> {
    if (placements.length === 0) return;
    return runSerializedSqlMutation(this.execSql, async (lockedExecSql) => {
      await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
      const { db } = getClientSQLitePersistenceRuntime(lockedExecSql);
      await db.transaction(async (tx) => {
        for (const batch of remoteResetBatches(placements)) {
          await tx
            .update(containerDocumentTombstoneHolds)
            .set({ hidden: false })
            .where(
              placementPairsMatch(
                batch,
                containerDocumentTombstoneHolds.documentId,
                containerDocumentTombstoneHolds.containerId,
              ),
            )
            .run();
        }
      });
    });
  }

  async listContainerDocumentTombstoneHolds(
    containerIds: ReadonlyArray<string>,
  ): Promise<ContainerDocumentTombstoneHoldRow[]> {
    if (containerIds.length === 0) return [];
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return listContainerDocumentTombstoneHoldsInTransaction(db, containerIds);
  }

  async listContainerDocumentTombstoneHoldsForDocuments(
    documentIds: ReadonlyArray<string>,
  ): Promise<ContainerDocumentPlacementKey[]> {
    if (documentIds.length === 0) return [];
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return listContainerDocumentTombstoneHoldsForDocumentsInTransaction(
      db,
      documentIds,
    );
  }

  async listKnownContainerDocumentPlacements(
    placements: ReadonlyArray<ContainerDocumentPlacementKey>,
  ): Promise<ContainerDocumentPlacementKey[]> {
    if (placements.length === 0) return [];
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    return listKnownContainerDocumentPlacementsInTransaction(db, placements);
  }

  /**
   * The held tombstones on the given containers that are due for another
   * verification attempt. Holds whose placement is gone are pruned first; that
   * is the only write, and it is taken under the mutation lock only when there
   * is something to prune.
   */
  async listRetryableHeldContainerDocumentTombstones(
    containerIds: ReadonlyArray<string>,
  ): Promise<HeldContainerDocumentTombstone[]> {
    if (containerIds.length === 0) return [];
    const now = this.now();
    await ensureSqlTables(this.execSql, documentContainerProjectionTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const { live, orphaned } = await partitionContainerDocumentTombstoneHolds(
      db,
      await listContainerDocumentTombstoneHoldsInTransaction(db, containerIds),
    );
    if (orphaned.length > 0) {
      // Re-check under the lock: a hold re-created between the unlocked read
      // and this write is hiding a placement again and must survive.
      await runSerializedSqlMutation(this.execSql, (lockedExecSql) =>
        getClientSQLitePersistenceRuntime(lockedExecSql).db.transaction(
          async (tx) =>
            deleteContainerDocumentTombstoneHoldRows(
              tx,
              (await partitionContainerDocumentTombstoneHolds(tx, orphaned))
                .orphaned,
            ),
        ),
      );
    }
    return live
      .filter((hold) => isHoldDue(hold, now))
      .map((hold) => ({
        containerId: hold.containerId,
        documentId: hold.documentId,
        updatedAt: hold.tombstonedAt,
      }));
  }

  /** Ordinary-document floors must exclude unsigned container-metadata epochs. */
  async loadLocalDocumentAccessEpoch(documentId: string): Promise<number> {
    await ensureSqlTables(this.execSql, documentTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const [row] = await db
      .select({ accessEpoch: max(documents.accessEpoch) })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          eq(documents.documentId, documentId),
        ),
      );
    return row?.accessEpoch ?? 0;
  }
}
