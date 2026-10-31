import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { DOCUMENTS_APP_KIND } from "../../../documents/documentConstants";
import {
  documentContainerProjection,
  documentProjection,
  documents,
} from "../../../sqlite/schema";
import {
  REMOTE_RESET_SQL_BATCH_SIZE,
  remoteResetBatches,
  SQLITE_BOUND_VARIABLE_BUDGET,
  sqliteRowsPerStatement,
} from "../../../sqlite/sqliteBindBudget";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { unlinkedDocumentPlacementRows } from "../../container-contents/documentContainerProjectionPersistence";
import { filterWritableDocumentPlacements } from "../../container-contents/documentPlacement";
import { getLatestTimestamp } from "../../latestTimestamp";
import type { ContainerDocumentTombstoneInput } from "../types";
import {
  deleteContainerDocumentTombstoneHoldRows,
  placementPairsMatch,
} from "./containerDocumentTombstoneHolds";
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
  for (const batch of remoteResetBatches(uniqueTombstones)) {
    await tx
      .delete(documentContainerProjection)
      .where(
        placementPairsMatch(
          batch,
          documentContainerProjection.documentId,
          documentContainerProjection.containerId,
        ),
      )
      .run();
  }
  // Each document binds its id and its linked containers; batch the
  // documents so one statement stays inside SQLite's bind budget.
  let batch: SQL[] = [];
  let binds = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await tx
      .delete(documentContainerProjection)
      .where(or(...batch))
      .run();
    batch = [];
    binds = 0;
  };
  for (const [documentId, linked] of verifiedLinkedContainerIdsByDocumentId) {
    const documentBinds = 1 + linked.size;
    if (
      batch.length >= REMOTE_RESET_SQL_BATCH_SIZE ||
      binds + documentBinds > SQLITE_BOUND_VARIABLE_BUDGET
    ) {
      await flush();
    }
    batch.push(unlinkedDocumentPlacementRows(documentId, linked));
    binds += documentBinds;
  }
  await flush();
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

interface TombstoneRepairReads {
  /** Local ids per document id. */
  readonly localIdsByDocumentId: ReadonlyMap<string, string[]>;
  readonly projectionByLocalId: ReadonlyMap<
    string,
    { containerId: string | null; updatedAt: string | null }
  >;
  /** Remaining link containers per document, in container id order. */
  readonly remainingLinksByDocumentId: ReadonlyMap<string, string[]>;
}

function pushGrouped(
  map: Map<string, string[]>,
  key: string,
  value: string,
): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

/**
 * Every row the repair reads, for all tombstoned documents at once. The
 * deletes above have already run, and the repair below writes only
 * projection rows of the document it repairs, so reading before any repair
 * sees what each per-document read saw.
 */
async function loadTombstoneRepairReads(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<TombstoneRepairReads> {
  const localIdsByDocumentId = new Map<string, string[]>();
  const projectionByLocalId = new Map<
    string,
    { containerId: string | null; updatedAt: string | null }
  >();
  const remainingLinksByDocumentId = new Map<string, string[]>();
  // The app kind binds one value; the rest carry ids.
  const chunkSize = sqliteRowsPerStatement(1, 1);
  for (let offset = 0; offset < documentIds.length; offset += chunkSize) {
    const batch = documentIds.slice(offset, offset + chunkSize);
    const localRows = await tx
      .select({ documentId: documents.documentId, localId: documents.localId })
      .from(documents)
      .where(
        and(
          eq(documents.appKind, DOCUMENTS_APP_KIND),
          inArray(documents.documentId, batch),
        ),
      );
    for (const row of localRows) {
      if (row.documentId !== null) {
        pushGrouped(localIdsByDocumentId, row.documentId, row.localId);
      }
    }
    const linkRows = await tx
      .select({
        containerId: documentContainerProjection.containerId,
        documentId: documentContainerProjection.documentId,
      })
      .from(documentContainerProjection)
      .where(inArray(documentContainerProjection.documentId, batch))
      .orderBy(
        asc(documentContainerProjection.documentId),
        asc(documentContainerProjection.containerId),
      );
    for (const row of linkRows) {
      pushGrouped(remainingLinksByDocumentId, row.documentId, row.containerId);
    }
  }
  const localIds = [...localIdsByDocumentId.values()].flat();
  for (let offset = 0; offset < localIds.length; offset += chunkSize) {
    const projectionRows = await tx
      .select({
        localId: documentProjection.localId,
        containerId: documentProjection.containerId,
        updatedAt: documentProjection.updatedAt,
      })
      .from(documentProjection)
      .where(
        inArray(
          documentProjection.localId,
          localIds.slice(offset, offset + chunkSize),
        ),
      );
    for (const row of projectionRows) {
      if (row.localId !== null) {
        projectionByLocalId.set(row.localId, {
          containerId: row.containerId,
          updatedAt: row.updatedAt,
        });
      }
    }
  }
  return {
    localIdsByDocumentId,
    projectionByLocalId,
    remainingLinksByDocumentId,
  };
}

async function updateSelectedContainersForDocumentTombstones(input: {
  documentId: string;
  reads: TombstoneRepairReads;
  removedContainerIds: ReadonlySet<string>;
  tombstoneUpdatedAt: string | undefined;
  tx: ClientSQLiteTransactionScope;
  verifiedLinkedContainerIds: ReadonlySet<string>;
}): Promise<string[]> {
  const { documentId, reads, removedContainerIds, tombstoneUpdatedAt, tx } =
    input;
  // A server document can own more than one local projection row: identity
  // recovery legitimately rematerializes a second projection for the same
  // documentId before semantic convergence completes. The link delete above is
  // keyed by (documentId, containerId) and the container item view surfaces a
  // document by its primary container_id, so EVERY projection row still pointing
  // at a removed container must be repaired here — resolving a single localId
  // left a duplicate row stranded at the source, keeping a moved document
  // visible in the container it was unlinked from.
  const localIds = reads.localIdsByDocumentId.get(documentId) ?? [];
  // Every projection row whose primary container is tombstoned OR outside the
  // verified link set is repointed: a primary at a listing-seeded row would
  // otherwise keep showing the document in a container the head never named.
  const rowsAtRemovedContainer = localIds.flatMap((localId) => {
    const row = reads.projectionByLocalId.get(localId);
    return row !== undefined &&
      row.containerId !== null &&
      (removedContainerIds.has(row.containerId) ||
        !input.verifiedLinkedContainerIds.has(row.containerId))
      ? [{ localId, updatedAt: row.updatedAt ?? undefined }]
      : [];
  });
  if (rowsAtRemovedContainer.length === 0) {
    return [];
  }

  const nextContainerId = selectNextContainerId(
    reads.remainingLinksByDocumentId.get(documentId) ?? [],
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

    const reads = await loadTombstoneRepairReads(tx, [
      ...removedContainerIdsByDocumentId.keys(),
    ]);
    const changedLocalIds: string[] = [];
    for (const [
      documentId,
      removedContainerIds,
    ] of removedContainerIdsByDocumentId) {
      changedLocalIds.push(
        ...(await updateSelectedContainersForDocumentTombstones({
          documentId,
          reads,
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
