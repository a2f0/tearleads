import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
  "accessEpoch" | "linkedContainerIds"
> & {
  /** Held without a verification attempt; the backoff does not advance. */
  readonly deferred?: boolean | undefined;
};

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

export function containerDocumentPlacementKey(
  placement: ContainerDocumentPlacementKey,
): string {
  return `${placement.documentId}\u0000${placement.containerId}`;
}
const placementKey = containerDocumentPlacementKey;

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
 * A local move takes ownership of a document's placement: the intent, not a
 * server listing, now says where it lives, so every hold that was hiding one
 * of its placements is released with the link rewrite.
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
      .values({ ...row, attempts: tombstone.deferred ? 0 : 1 })
      .onConflictDoUpdate({
        target: [
          containerDocumentTombstoneHolds.documentId,
          containerDocumentTombstoneHolds.containerId,
        ],
        set: {
          ...row,
          attempts: tombstone.deferred
            ? sql`${containerDocumentTombstoneHolds.attempts}`
            : sql`${containerDocumentTombstoneHolds.attempts} + 1`,
        },
      })
      .run();
  }
}

/** Release the holds on placements a listing has re-asserted as linked. */
export async function deleteContainerDocumentTombstoneHoldRowsForLinks(
  tx: ClientSQLiteTransactionScope,
  links: ReadonlyArray<{
    readonly containerIds: ReadonlyArray<string>;
    readonly documentId: string;
  }>,
): Promise<void> {
  for (const link of links) {
    for (const batch of batches(link.containerIds)) {
      await tx
        .delete(containerDocumentTombstoneHolds)
        .where(
          and(
            eq(containerDocumentTombstoneHolds.documentId, link.documentId),
            inArray(containerDocumentTombstoneHolds.containerId, batch),
          ),
        )
        .run();
    }
  }
}

export interface ContainerDocumentTombstoneHoldRow
  extends ContainerDocumentPlacementKey {
  readonly attempts: number;
  readonly tombstonedAt: string;
  readonly updatedAt: string;
}

const holdRowSelection = {
  attempts: containerDocumentTombstoneHolds.attempts,
  containerId: containerDocumentTombstoneHolds.containerId,
  documentId: containerDocumentTombstoneHolds.documentId,
  tombstonedAt: containerDocumentTombstoneHolds.tombstonedAt,
  updatedAt: containerDocumentTombstoneHolds.updatedAt,
};

/** Every hold on the given containers, for hiding placements in views. */
export async function listContainerDocumentTombstoneHoldsInTransaction(
  handle: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
): Promise<ContainerDocumentTombstoneHoldRow[]> {
  const holds: ContainerDocumentTombstoneHoldRow[] = [];
  for (const batch of batches(containerIds)) {
    holds.push(
      ...(await handle
        .select(holdRowSelection)
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

/** Every hold on the given documents, in any container. */
export async function listContainerDocumentTombstoneHoldsForDocumentsInTransaction(
  handle: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<ContainerDocumentTombstoneHoldRow[]> {
  const holds: ContainerDocumentTombstoneHoldRow[] = [];
  for (const batch of batches(documentIds)) {
    holds.push(
      ...(await handle
        .select(holdRowSelection)
        .from(containerDocumentTombstoneHolds)
        .where(inArray(containerDocumentTombstoneHolds.documentId, batch))
        .orderBy(
          asc(containerDocumentTombstoneHolds.documentId),
          asc(containerDocumentTombstoneHolds.containerId),
        )),
    );
  }
  return holds;
}

/**
 * Split the holds on the given containers into those whose placement is gone
 * (the document was purged, reset, or relinked locally: nothing left to hide,
 * so the hold is dropped) and those still hiding a placement.
 */
export async function partitionContainerDocumentTombstoneHolds(
  handle: ClientSQLiteTransactionScope,
  holds: ReadonlyArray<ContainerDocumentTombstoneHoldRow>,
): Promise<{
  live: ContainerDocumentTombstoneHoldRow[];
  orphaned: ContainerDocumentTombstoneHoldRow[];
}> {
  const known = new Set(
    (
      await listKnownContainerDocumentPlacementsInTransaction(handle, holds)
    ).map(placementKey),
  );
  return {
    live: holds.filter((hold) => known.has(placementKey(hold))),
    orphaned: holds.filter((hold) => !known.has(placementKey(hold))),
  };
}
