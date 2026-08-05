import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  documentContainerProjection,
  documentProjection,
  documents,
} from "../../../sqlite/schema";
import {
  type ClientSQLiteTransaction,
  getClientSQLitePersistenceRuntime,
} from "../../../sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import { getLatestTimestamp } from "../../latestTimestamp";
import type { ContainerDocumentTombstoneInput } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
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
} {
  const removedContainerIdsByDocumentId = new Map<string, Set<string>>();
  const tombstoneUpdatedAtByDocumentId = new Map<string, string>();

  for (const tombstone of uniqueTombstones) {
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

  return { removedContainerIdsByDocumentId, tombstoneUpdatedAtByDocumentId };
}

async function deleteContainerDocumentTombstoneRows(
  tx: ClientSQLiteTransaction,
  uniqueTombstones: ReadonlyArray<ContainerDocumentTombstoneInput>,
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
}

async function updateSelectedContainersForDocumentTombstones(input: {
  documentId: string;
  removedContainerIds: ReadonlySet<string>;
  tombstoneUpdatedAt: string | undefined;
  tx: ClientSQLiteTransaction;
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
  const nextContainerId = remainingLinkRows[0]?.containerId ?? null;

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

  const { removedContainerIdsByDocumentId, tombstoneUpdatedAtByDocumentId } =
    buildContainerDocumentTombstoneState(uniqueTombstones);
  const { db } = getClientSQLitePersistenceRuntime(execSql);

  return db.transaction(async (tx) => {
    await deleteContainerDocumentTombstoneRows(tx, uniqueTombstones);

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
