import { and, asc, desc, eq, inArray, notInArray } from "drizzle-orm";
import {
  documentContainerProjection,
  documentProjection,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { filterWritableDocumentPlacements } from "../../containers/documentPlacement";
import { getLatestTimestamp } from "../../latestTimestamp";
import type { ContainerDocumentTombstoneInput } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import { deleteContainerDocumentTombstoneHoldRows } from "./containerDocumentTombstoneHolds";
import {
  documentSummaryJoin,
  documentSummarySelection,
  mapDocumentSummary,
} from "./documentProjectionRows";

function dedupeContainerDocumentTombstones(
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): ContainerDocumentTombstoneInput[] {
  return Array.from(
    new Map(
      tombstones.map((tombstone) => [
        `${tombstone.documentId}\u0000${tombstone.containerId}`,
        tombstone,
      ]),
    ).values(),
  );
}

function buildContainerDocumentTombstoneState(
  uniqueTombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
): {
  removedContainerIdsByDocumentId: Map<string, Set<string>>;
  tombstoneUpdatedAtByDocumentId: Map<string, string>;
  verifiedLinkedContainerIdsByDocumentId: Map<string, ReadonlySet<string>>;
} {
  const removedContainerIdsByDocumentId = new Map<string, Set<string>>();
  const tombstoneUpdatedAtByDocumentId = new Map<string, string>();
  const verifiedLinkedContainerIdsByDocumentId = new Map<
    string,
    ReadonlySet<string>
  >();

  for (const tombstone of uniqueTombstones) {
    verifiedLinkedContainerIdsByDocumentId.set(
      tombstone.documentId,
      new Set(tombstone.linkedContainerIds),
    );
    const removedContainerIds =
      removedContainerIdsByDocumentId.get(tombstone.documentId) ?? new Set();
    removedContainerIds.add(tombstone.containerId);
    removedContainerIdsByDocumentId.set(
      tombstone.documentId,
      removedContainerIds,
    );
    tombstoneUpdatedAtByDocumentId.set(
      tombstone.documentId,
      getLatestTimestamp(
        tombstoneUpdatedAtByDocumentId.get(tombstone.documentId),
        tombstone.updatedAt,
      ),
    );
  }

  return {
    removedContainerIdsByDocumentId,
    tombstoneUpdatedAtByDocumentId,
    verifiedLinkedContainerIdsByDocumentId,
  };
}

/**
 * Remove the tombstoned placement and, with the head now verified, every
 * remaining local link row the head does not link: those are listing-seeded
 * rows, and leaving one would keep showing the document in a container the
 * signed link set never named. Rows the head links are kept as they are.
 */
async function deleteContainerDocumentTombstoneRows(
  tx: ClientSQLiteTransactionScope,
  uniqueTombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
  verifiedLinkedContainerIdsByDocumentId: ReadonlyMap<
    string,
    ReadonlySet<string>
  >,
): Promise<void> {
  for (const tombstone of uniqueTombstones) {
    await tx
      .delete(documentContainerProjection)
      .where(
        and(
          eq(documentContainerProjection.documentId, tombstone.documentId),
          eq(documentContainerProjection.containerId, tombstone.containerId),
        ),
      )
      .run();
  }
  for (const [documentId, linked] of verifiedLinkedContainerIdsByDocumentId) {
    await tx
      .delete(documentContainerProjection)
      .where(
        linked.size === 0
          ? eq(documentContainerProjection.documentId, documentId)
          : and(
              eq(documentContainerProjection.documentId, documentId),
              notInArray(documentContainerProjection.containerId, [...linked]),
            ),
      )
      .run();
  }
}

/**
 * The primary container after a removal: the first remaining local row the
 * verified head links. A remaining row the head does not link is a
 * listing-seeded row and never becomes the primary, so a listing cannot
 * re-home the document. With no such row the document is unplaced (`null`)
 * and reachable through orphan recovery, rather than pointed at a head
 * container this device may not be able to read.
 */
function selectNextContainerId(
  remainingContainerIds: ReadonlyArray<string>,
  verifiedLinkedContainerIds: ReadonlySet<string>,
): string | null {
  return (
    remainingContainerIds.find((containerId) =>
      verifiedLinkedContainerIds.has(containerId),
    ) ?? null
  );
}

async function updateSelectedContainersForDocumentTombstones(input: {
  documentId: string;
  removedContainerIds: ReadonlySet<string>;
  tombstoneUpdatedAt: string | undefined;
  tx: ClientSQLiteTransactionScope;
  verifiedLinkedContainerIds: ReadonlySet<string>;
}): Promise<string[]> {
  const { documentId, removedContainerIds, tombstoneUpdatedAt, tx } = input;
  // A server document can own more than one local projection row: identity
  // recovery legitimately rematerializes a second projection for the same
  // documentId before semantic convergence completes. The link delete above is
  // keyed by (documentId, containerId) and the container item view surfaces a
  // document by its primary container_id, so EVERY projection row still pointing
  // at a removed container must be repaired here — resolving a single localId
  // left a duplicate row stranded at the source, keeping a moved document
  // visible in the container it was unlinked from.
  const localIds = (
    await tx
      .select({ localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          eq(documents.documentId, documentId),
        ),
      )
  ).map((row) => row.localId);
  if (localIds.length === 0) {
    return [];
  }

  const projectionRows = await tx
    .select({
      localId: documentProjection.localId,
      containerId: documentProjection.containerId,
      updatedAt: documentProjection.updatedAt,
    })
    .from(documentProjection)
    .where(inArray(documentProjection.localId, localIds));
  const rowsAtRemovedContainer = projectionRows.flatMap((row) =>
    row.localId !== null &&
    row.containerId !== null &&
    removedContainerIds.has(row.containerId)
      ? [{ localId: row.localId, updatedAt: row.updatedAt ?? undefined }]
      : [],
  );
  if (rowsAtRemovedContainer.length === 0) {
    return [];
  }

  const remainingLinkRows = await tx
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.documentId, documentId))
    .orderBy(asc(documentContainerProjection.containerId));
  const nextContainerId = selectNextContainerId(
    remainingLinkRows.map((row) => row.containerId),
    input.verifiedLinkedContainerIds,
  );

  const changedLocalIds: string[] = [];
  for (const row of rowsAtRemovedContainer) {
    await tx
      .update(documentProjection)
      .set({
        containerId: nextContainerId,
        updatedAt: getLatestTimestamp(row.updatedAt, tombstoneUpdatedAt),
      })
      .where(eq(documentProjection.localId, row.localId))
      .run();
    changedLocalIds.push(row.localId);
  }

  return changedLocalIds;
}

export async function applyContainerDocumentTombstonesWithExec(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
) {
  const uniqueTombstones = dedupeContainerDocumentTombstones(tombstones);
  if (uniqueTombstones.length === 0) {
    return [];
  }

  const { db } = getClientSQLitePersistenceRuntime(execSql);

  return db.transaction(async (tx) => {
    // Besides the pending-intent guard, the verified head must not be older
    // than local document state: a lagging or replayed head must never
    // delete rows a newer listing or settled move wrote (`CheckEpoch`).
    const writable = await filterWritableDocumentPlacements(
      tx,
      uniqueTombstones.map((tombstone) => ({
        accessEpoch: tombstone.accessEpoch,
        documentId: tombstone.documentId,
        containerIds: [],
      })),
    );
    const writableIds = new Set(writable.map((input) => input.documentId));
    const applicable = uniqueTombstones.filter((tombstone) =>
      writableIds.has(tombstone.documentId),
    );
    const {
      removedContainerIdsByDocumentId,
      tombstoneUpdatedAtByDocumentId,
      verifiedLinkedContainerIdsByDocumentId,
    } = buildContainerDocumentTombstoneState(applicable);
    await deleteContainerDocumentTombstoneRows(
      tx,
      applicable,
      verifiedLinkedContainerIdsByDocumentId,
    );
    await deleteContainerDocumentTombstoneHoldRows(tx, applicable);

    const changedLocalIds: string[] = [];
    for (const [
      documentId,
      removedContainerIds,
    ] of removedContainerIdsByDocumentId) {
      changedLocalIds.push(
        ...(await updateSelectedContainersForDocumentTombstones({
          documentId,
          removedContainerIds,
          tombstoneUpdatedAt: tombstoneUpdatedAtByDocumentId.get(documentId),
          tx,
          verifiedLinkedContainerIds:
            verifiedLinkedContainerIdsByDocumentId.get(documentId) ?? new Set(),
        })),
      );
    }

    if (changedLocalIds.length === 0) {
      return [];
    }

    const rows = await tx
      .select(documentSummarySelection)
      .from(documentProjection)
      .leftJoin(documents, documentSummaryJoin)
      .where(inArray(documentProjection.localId, changedLocalIds))
      .orderBy(
        desc(documentProjection.updatedAt),
        desc(documentProjection.localId),
      );

    return rows.map(mapDocumentSummary);
  });
}
