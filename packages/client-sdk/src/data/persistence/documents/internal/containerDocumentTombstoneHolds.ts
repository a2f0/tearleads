import { and, asc, eq, inArray, notExists } from "drizzle-orm";
import {
  containerDocumentTombstoneHolds,
  documentContainerProjection,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { filterWritableDocumentPlacements } from "../../containers/documentPlacement";
import type { ContainerDocumentTombstoneInput } from "../types";

export interface ContainerDocumentPlacementKey {
  readonly containerId: string;
  readonly documentId: string;
}

export type HeldContainerDocumentTombstone = ContainerDocumentTombstoneInput;

export async function deleteContainerDocumentTombstoneHoldRows(
  tx: ClientSQLiteTransactionScope,
  placements: ReadonlyArray<ContainerDocumentPlacementKey>,
): Promise<void> {
  for (const placement of placements) {
    await tx
      .delete(containerDocumentTombstoneHolds)
      .where(
        and(
          eq(containerDocumentTombstoneHolds.documentId, placement.documentId),
          eq(
            containerDocumentTombstoneHolds.containerId,
            placement.containerId,
          ),
        ),
      )
      .run();
  }
}

/**
 * Hold listing tombstones whose signed evidence is unavailable. A placement a
 * pending move intent owns is never held: the intent, not the listing, decides
 * where the document lives until it settles (`ProtectPendingTombstones`).
 */
export async function holdContainerDocumentTombstonesWithExec(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
  now: string,
): Promise<void> {
  if (tombstones.length === 0) return;
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  await db.transaction(async (tx) => {
    const writable = new Set(
      (
        await filterWritableDocumentPlacements(
          tx,
          tombstones.map((tombstone) => ({
            documentId: tombstone.documentId,
            containerIds: [],
          })),
        )
      ).map((input) => input.documentId),
    );
    for (const tombstone of tombstones) {
      if (!writable.has(tombstone.documentId)) continue;
      const row = {
        containerId: tombstone.containerId,
        documentId: tombstone.documentId,
        tombstonedAt: tombstone.updatedAt,
        updatedAt: now,
      };
      await tx
        .insert(containerDocumentTombstoneHolds)
        .values(row)
        .onConflictDoUpdate({
          target: [
            containerDocumentTombstoneHolds.documentId,
            containerDocumentTombstoneHolds.containerId,
          ],
          set: row,
        })
        .run();
    }
  });
}

export async function releaseContainerDocumentTombstoneHoldsWithExec(
  execSql: ExecSql,
  placements: ReadonlyArray<ContainerDocumentPlacementKey>,
): Promise<void> {
  if (placements.length === 0) return;
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  await db.transaction((tx) =>
    deleteContainerDocumentTombstoneHoldRows(tx, placements),
  );
}

/**
 * Holds for the given containers, retried on each discovery. A hold whose
 * link row is gone (the document was purged or reset locally) has nothing
 * left to hide and is dropped here.
 */
export async function listHeldContainerDocumentTombstonesWithExec(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<HeldContainerDocumentTombstone[]> {
  const uniqueContainerIds = Array.from(new Set(containerIds));
  if (uniqueContainerIds.length === 0) return [];
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  await db
    .delete(containerDocumentTombstoneHolds)
    .where(
      and(
        inArray(
          containerDocumentTombstoneHolds.containerId,
          uniqueContainerIds,
        ),
        notExists(
          db
            .select({ documentId: documentContainerProjection.documentId })
            .from(documentContainerProjection)
            .where(
              and(
                eq(
                  documentContainerProjection.documentId,
                  containerDocumentTombstoneHolds.documentId,
                ),
                eq(
                  documentContainerProjection.containerId,
                  containerDocumentTombstoneHolds.containerId,
                ),
              ),
            ),
        ),
      ),
    )
    .run();
  const rows = await db
    .select({
      containerId: containerDocumentTombstoneHolds.containerId,
      documentId: containerDocumentTombstoneHolds.documentId,
      tombstonedAt: containerDocumentTombstoneHolds.tombstonedAt,
    })
    .from(containerDocumentTombstoneHolds)
    .where(
      inArray(containerDocumentTombstoneHolds.containerId, uniqueContainerIds),
    )
    .orderBy(
      asc(containerDocumentTombstoneHolds.containerId),
      asc(containerDocumentTombstoneHolds.documentId),
    );
  return rows.map((row) => ({
    containerId: row.containerId,
    documentId: row.documentId,
    updatedAt: row.tombstonedAt,
  }));
}
