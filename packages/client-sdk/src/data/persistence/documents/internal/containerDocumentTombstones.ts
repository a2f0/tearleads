import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  type ClientSQLiteTransaction,
  getClientDatabaseRuntime,
} from "../../../sqlite/clientDatabaseRuntime";
import {
  documentContainerProjection,
  documentProjection,
  documents,
} from "../../../sqlite/schema";
import type { ExecSql } from "../../../sqlite/sqlSchema";
import type { ContainerDocumentTombstoneInput } from "../types";
import { DOCUMENTS_APP_KIND } from "./constants";
import {
  documentSummaryJoin,
  documentSummarySelection,
  mapDocumentSummary,
} from "./documentProjectionRows";

function getLatestTimestamp(
  left: string | undefined,
  right: string | undefined,
): string {
  if (!left) {
    return right ?? new Date().toISOString();
  }

  if (!right) {
    return left;
  }

  return left.localeCompare(right) >= 0 ? left : right;
}

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

async function updateSelectedContainerForDocumentTombstones(input: {
  documentId: string;
  removedContainerIds: ReadonlySet<string>;
  tombstoneUpdatedAt: string | undefined;
  tx: ClientSQLiteTransaction;
}): Promise<string | null> {
  const { documentId, removedContainerIds, tombstoneUpdatedAt, tx } = input;
  const documentRows = await tx
    .select({ localId: documents.localId })
    .from(documents)
    .where(
      and(
        eq(documents.appKind, DOCUMENTS_APP_KIND),
        eq(documents.documentId, documentId),
      ),
    )
    .limit(1);
  const localId = documentRows[0]?.localId;
  if (!localId) {
    return null;
  }

  const projectionRows = await tx
    .select({
      containerId: documentProjection.containerId,
      updatedAt: documentProjection.updatedAt,
    })
    .from(documentProjection)
    .where(eq(documentProjection.localId, localId))
    .limit(1);
  const selectedContainerId = projectionRows[0]?.containerId;
  if (!selectedContainerId || !removedContainerIds.has(selectedContainerId)) {
    return null;
  }

  const remainingLinkRows = await tx
    .select({ containerId: documentContainerProjection.containerId })
    .from(documentContainerProjection)
    .where(eq(documentContainerProjection.documentId, documentId))
    .orderBy(asc(documentContainerProjection.containerId));
  const nextContainerId = remainingLinkRows[0]?.containerId ?? null;

  await tx
    .update(documentProjection)
    .set({
      containerId: nextContainerId,
      updatedAt: getLatestTimestamp(
        projectionRows[0]?.updatedAt,
        tombstoneUpdatedAt,
      ),
    })
    .where(eq(documentProjection.localId, localId))
    .run();

  return localId;
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
  const { db } = getClientDatabaseRuntime(execSql);

  return db.transaction(async (tx) => {
    await deleteContainerDocumentTombstoneRows(tx, uniqueTombstones);

    const changedLocalIds: string[] = [];
    for (const [
      documentId,
      removedContainerIds,
    ] of removedContainerIdsByDocumentId) {
      const changedLocalId = await updateSelectedContainerForDocumentTombstones(
        {
          documentId,
          removedContainerIds,
          tombstoneUpdatedAt: tombstoneUpdatedAtByDocumentId.get(documentId),
          tx,
        },
      );
      if (changedLocalId) {
        changedLocalIds.push(changedLocalId);
      }
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
