import { and, asc, eq, inArray, lte } from "drizzle-orm";
import {
  containerDocumentTombstoneHolds,
  documentContainerProjection,
  documentProjection,
} from "../../../sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../../sqlite/sqlitePersistenceRuntime";
import { filterWritableDocumentPlacements } from "../../containers/documentPlacement";
import type { ContainerDocumentTombstoneInput } from "../types";

export interface ContainerDocumentPlacementKey {
  readonly containerId: string;
  readonly documentId: string;
}

export type HeldContainerDocumentTombstone = Omit<
  ContainerDocumentTombstoneInput,
  "linkedContainerIds"
>;

/** Keep `IN (...)` lists well under SQLite's bound-parameter limit. */
const HOLD_SQL_ID_BATCH_SIZE = 400;

function batches<T>(values: ReadonlyArray<T>): T[][] {
  const unique = Array.from(new Set(values));
  const result: T[][] = [];
  for (let index = 0; index < unique.length; index += HOLD_SQL_ID_BATCH_SIZE) {
    result.push(unique.slice(index, index + HOLD_SQL_ID_BATCH_SIZE));
  }
  return result;
}

function placementKey(placement: ContainerDocumentPlacementKey): string {
  return `${placement.documentId}\u0000${placement.containerId}`;
}

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
 * A local move or relink takes ownership of a document's placement: the
 * intent, not a server listing, now says where it lives, so any hold that was
 * hiding one of its placements is released with the link rewrite.
 */
export async function deleteContainerDocumentTombstoneHoldsForDocuments(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<void> {
  for (const batch of batches(documentIds)) {
    await tx
      .delete(containerDocumentTombstoneHolds)
      .where(inArray(containerDocumentTombstoneHolds.documentId, batch))
      .run();
  }
}

/**
 * The placements among `placements` that exist locally: a link row, or a
 * document projection row whose primary container is the named container.
 * A tombstone for any other placement has nothing to remove or hide, so it
 * is not worth fetching and verifying the document head for.
 */
export async function listKnownContainerDocumentPlacementsInTransaction(
  tx: ClientSQLiteTransactionScope,
  placements: ReadonlyArray<ContainerDocumentPlacementKey>,
): Promise<ContainerDocumentPlacementKey[]> {
  const known = new Set<string>();
  for (const batch of batches(placements.map((entry) => entry.documentId))) {
    const [linkRows, projectionRows] = await Promise.all([
      tx
        .select({
          containerId: documentContainerProjection.containerId,
          documentId: documentContainerProjection.documentId,
        })
        .from(documentContainerProjection)
        .where(inArray(documentContainerProjection.documentId, batch)),
      tx
        .select({
          containerId: documentProjection.containerId,
          documentId: documentProjection.documentId,
        })
        .from(documentProjection)
        .where(inArray(documentProjection.documentId, batch)),
    ]);
    for (const row of [...linkRows, ...projectionRows]) {
      if (row.documentId !== null && row.containerId !== null) {
        known.add(
          placementKey({
            containerId: row.containerId,
            documentId: row.documentId,
          }),
        );
      }
    }
  }
  return placements.filter((placement) => known.has(placementKey(placement)));
}

/**
 * Hold listing tombstones whose signed evidence is unavailable. A placement a
 * pending move intent owns is never held: the intent, not the listing, decides
 * where the document lives until it settles (`ProtectPendingTombstones`).
 */
export async function holdContainerDocumentTombstonesInTransaction(
  tx: ClientSQLiteTransactionScope,
  tombstones: ReadonlyArray<HeldContainerDocumentTombstone>,
  now: string,
): Promise<void> {
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
}

/** Every hold on the given containers, for hiding placements in views. */
export async function listContainerDocumentTombstoneHoldsInTransaction(
  handle: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<ContainerDocumentPlacementKey[]> {
  const holds: ContainerDocumentPlacementKey[] = [];
  for (const batch of batches(containerIds)) {
    holds.push(
      ...(await handle
        .select({
          containerId: containerDocumentTombstoneHolds.containerId,
          documentId: containerDocumentTombstoneHolds.documentId,
        })
        .from(containerDocumentTombstoneHolds)
        .where(inArray(containerDocumentTombstoneHolds.containerId, batch))
        .orderBy(
          asc(containerDocumentTombstoneHolds.containerId),
          asc(containerDocumentTombstoneHolds.documentId),
        )),
    );
  }
  return holds;
}

/**
 * Holds on the given containers due for another verification attempt: those
 * last attempted at or before `retryBefore`. A hold whose placement is gone
 * (the document was purged, reset, or relinked locally) has nothing left to
 * hide and is dropped first.
 */
export async function listRetryableContainerDocumentTombstoneHoldsInTransaction(
  tx: ClientSQLiteTransactionScope,
  input: { containerIds: ReadonlyArray<string>; retryBefore: string },
): Promise<HeldContainerDocumentTombstone[]> {
  const retryable: HeldContainerDocumentTombstone[] = [];
  for (const batch of batches(input.containerIds)) {
    const rows = await tx
      .select({
        containerId: containerDocumentTombstoneHolds.containerId,
        documentId: containerDocumentTombstoneHolds.documentId,
        tombstonedAt: containerDocumentTombstoneHolds.tombstonedAt,
      })
      .from(containerDocumentTombstoneHolds)
      .where(
        and(
          inArray(containerDocumentTombstoneHolds.containerId, batch),
          lte(containerDocumentTombstoneHolds.updatedAt, input.retryBefore),
        ),
      )
      .orderBy(
        asc(containerDocumentTombstoneHolds.containerId),
        asc(containerDocumentTombstoneHolds.documentId),
      );
    const known = new Set(
      (await listKnownContainerDocumentPlacementsInTransaction(tx, rows)).map(
        placementKey,
      ),
    );
    const orphaned = rows.filter((row) => !known.has(placementKey(row)));
    await deleteContainerDocumentTombstoneHoldRows(tx, orphaned);
    retryable.push(
      ...rows
        .filter((row) => known.has(placementKey(row)))
        .map((row) => ({
          containerId: row.containerId,
          documentId: row.documentId,
          updatedAt: row.tombstonedAt,
        })),
    );
  }
  return retryable;
}
