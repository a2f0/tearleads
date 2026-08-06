import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  containerCreateIntents,
  containerMoveIntents,
  containerProjection,
  containerSyncWatermarks,
  containers,
  documentContainerProjection,
  documentProjection,
} from "../../sqlite/schema";
import type { ClientSQLiteTransaction } from "../../sqlite/sqlitePersistenceRuntime";
import {
  containerContentsSyncLane,
  containerParentSyncLane,
  containerSyncWatermarkLaneKey,
} from "../containers/containerSyncWatermarkPersistence";
import { getLatestTimestamp } from "../latestTimestamp";
import type { LocalRootDescendantReparentInput } from "./containerContentsPersistenceTypes";
import { saveContainerCreateIntent } from "./containerIntentPersistence";
import { deleteContainerMetadataDocumentRowsInTransaction } from "./dormantContainerMetadata";

// The containers being removed still exist when repair runs (deletion follows
// it). Capture their org attribution so a detached document's pending writes
// keep a resolvable organization id after the join source is gone — e.g. when
// access to a shared org is revoked mid-sync.
async function loadOrganizationIdsForContainers(
  tx: ClientSQLiteTransaction,
  containerIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({
      id: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(inArray(containers.id, containerIds));
  const organizationIdByContainerId = new Map<string, string>();
  for (const container of rows) {
    if (container.id && container.organizationId) {
      organizationIdByContainerId.set(container.id, container.organizationId);
    }
  }
  return organizationIdByContainerId;
}

// A document unlinked from a removed container may keep other live links; its
// projection then re-homes to the first remaining link (deterministic order)
// instead of dropping to null.
async function loadFirstRemainingContainerIdByDocumentId(
  tx: ClientSQLiteTransaction,
  documentIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const firstRemainingContainerIdByDocumentId = new Map<string, string>();
  if (documentIds.length === 0) {
    return firstRemainingContainerIdByDocumentId;
  }
  const remainingLinks = await tx
    .select({
      containerId: documentContainerProjection.containerId,
      documentId: documentContainerProjection.documentId,
    })
    .from(documentContainerProjection)
    .where(inArray(documentContainerProjection.documentId, documentIds))
    .orderBy(
      asc(documentContainerProjection.documentId),
      asc(documentContainerProjection.containerId),
    );
  for (const link of remainingLinks) {
    if (!firstRemainingContainerIdByDocumentId.has(link.documentId)) {
      firstRemainingContainerIdByDocumentId.set(
        link.documentId,
        link.containerId,
      );
    }
  }
  return firstRemainingContainerIdByDocumentId;
}

export async function repairDocumentsForRemovedContainersInTransaction(input: {
  containerIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { tx, updatedAt } = input;
  const containerIds = Array.from(new Set(input.containerIds));
  if (containerIds.length === 0) {
    return;
  }

  {
    const selectedRows = await tx
      .select({
        containerId: documentProjection.containerId,
        documentId: documentProjection.documentId,
        localId: documentProjection.localId,
        updatedAt: documentProjection.updatedAt,
      })
      .from(documentProjection)
      .where(inArray(documentProjection.containerId, containerIds));

    const organizationIdByContainerId = await loadOrganizationIdsForContainers(
      tx,
      containerIds,
    );

    await tx
      .delete(documentContainerProjection)
      .where(inArray(documentContainerProjection.containerId, containerIds))
      .run();

    const documentIds = Array.from(
      new Set(
        selectedRows.flatMap((row) => (row.documentId ? [row.documentId] : [])),
      ),
    );
    const firstRemainingContainerIdByDocumentId =
      await loadFirstRemainingContainerIdByDocumentId(tx, documentIds);

    for (const row of selectedRows) {
      if (!row.localId) {
        continue;
      }

      const removedOrganizationId = row.containerId
        ? organizationIdByContainerId.get(row.containerId)
        : undefined;
      await tx
        .update(documentProjection)
        .set({
          containerId: row.documentId
            ? (firstRemainingContainerIdByDocumentId.get(row.documentId) ??
              null)
            : null,
          ...(removedOrganizationId
            ? { organizationId: removedOrganizationId }
            : {}),
          updatedAt: getLatestTimestamp(row.updatedAt, updatedAt),
        })
        .where(eq(documentProjection.localId, row.localId))
        .run();
    }
  }
}

export async function updateReparentedDescendantContainers(input: {
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  remoteOrganizationId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const { descendantReparents, remoteOrganizationId, tx, updatedAt } = input;
  const descendantIds = Array.from(
    new Set(descendantReparents.map((reparent) => reparent.containerId)),
  );
  if (descendantIds.length === 0) {
    return;
  }

  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      localUpdatedAt: updatedAt,
    })
    .where(inArray(containers.id, descendantIds))
    .run();
  await tx
    .update(containerProjection)
    .set({ updatedAt })
    .where(inArray(containerProjection.containerId, descendantIds))
    .run();

  for (const reparent of descendantReparents) {
    await tx
      .update(containers)
      .set({ parentId: reparent.parentContainerId })
      .where(eq(containers.id, reparent.containerId))
      .run();

    if (reparent.updateCreateIntent && reparent.parentContainerId) {
      await saveContainerCreateIntent({
        containerId: reparent.containerId,
        createIntent: { parentContainerId: reparent.parentContainerId },
        tx,
        updatedAt,
      });
    }

    if (reparent.parentContainerId) {
      await tx
        .update(containerMoveIntents)
        .set({
          parentContainerId: reparent.parentContainerId,
          syncStatus: "pending",
          updatedAt,
        })
        .where(eq(containerMoveIntents.containerId, reparent.containerId))
        .run();
    }
  }
}

export async function reparentLocalContainerChildren(input: {
  fromContainerId: string;
  remoteOrganizationId: string;
  toContainerId: string;
  tx: ClientSQLiteTransaction;
  updatedAt: string;
}): Promise<void> {
  const {
    fromContainerId,
    remoteOrganizationId,
    toContainerId,
    tx,
    updatedAt,
  } = input;
  const childRows = await tx
    .select({ id: containers.id })
    .from(containers)
    .where(eq(containers.parentId, fromContainerId));
  const childContainerIds = childRows.flatMap((row) =>
    row.id ? [row.id] : [],
  );

  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      parentId: toContainerId,
      localUpdatedAt: updatedAt,
    })
    .where(eq(containers.parentId, fromContainerId))
    .run();
  if (childContainerIds.length > 0) {
    await tx
      .update(containerProjection)
      .set({ updatedAt })
      .where(inArray(containerProjection.containerId, childContainerIds))
      .run();
  }
  await tx
    .update(containerCreateIntents)
    .set({
      parentContainerId: toContainerId,
      updatedAt,
    })
    .where(eq(containerCreateIntents.parentContainerId, fromContainerId))
    .run();
  await tx
    .update(containerMoveIntents)
    .set({
      parentContainerId: toContainerId,
      syncStatus: "pending",
      updatedAt,
    })
    .where(eq(containerMoveIntents.parentContainerId, fromContainerId))
    .run();
}

export async function deleteLocalContainerRows(input: {
  containerId: string;
  tx: ClientSQLiteTransaction;
}): Promise<void> {
  const { containerId, tx } = input;
  const parentLane = containerSyncWatermarkLaneKey(
    containerParentSyncLane(containerId),
  );
  const documentsLane = containerSyncWatermarkLaneKey(
    containerContentsSyncLane(containerId),
  );

  await tx
    .delete(containerCreateIntents)
    .where(eq(containerCreateIntents.containerId, containerId))
    .run();
  await tx
    .delete(containerMoveIntents)
    .where(eq(containerMoveIntents.containerId, containerId))
    .run();
  await tx
    .delete(containerProjection)
    .where(eq(containerProjection.containerId, containerId))
    .run();
  await tx.delete(containers).where(eq(containers.id, containerId)).run();
  await deleteContainerMetadataDocumentRowsInTransaction(tx, [containerId]);
  await tx
    .delete(containerSyncWatermarks)
    .where(
      or(
        and(
          eq(containerSyncWatermarks.laneKind, parentLane.laneKind),
          eq(containerSyncWatermarks.laneId, parentLane.laneId),
        ),
        and(
          eq(containerSyncWatermarks.laneKind, documentsLane.laneKind),
          eq(containerSyncWatermarks.laneId, documentsLane.laneId),
        ),
      ),
    )
    .run();
}
