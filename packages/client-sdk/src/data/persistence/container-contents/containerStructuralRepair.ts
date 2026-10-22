import { and, asc, eq, inArray } from "drizzle-orm";
import {
  containers,
  documentContainerProjection,
  documentProjection,
  inContainerIntentLanes,
  inLocalIntentLane,
  LOCAL_INTENT_LANES,
  localIntents,
} from "../../sqlite/schema";
import { sqliteRowsPerStatement } from "../../sqlite/sqliteBindBudget";
import type { ClientSQLiteTransactionScope } from "../../sqlite/sqlitePersistenceRuntime";
import { deleteContainerDocumentTombstoneHoldsForContainers } from "../documents/containerDocumentTombstoneHoldsPersistence";
import { setDocumentProjectionContainerInTransaction } from "../documents/documentProjectionContainers";
import { getLatestTimestamp } from "../latestTimestamp";
import type {
  ContainerRemoval,
  LocalRootDescendantReparentInput,
} from "./containerContentsPersistenceTypes";
import { saveContainerCreateIntent } from "./containerIntentPersistence";
import { deleteContainerWatermarksInTransaction } from "./containerSyncWatermarkPersistence";
import { deleteContainerMetadataDocumentRowsInTransaction } from "./dormantContainerMetadata";

// The containers being removed still exist when repair runs (deletion follows
// it). Capture their org attribution so a detached document's pending writes
// keep a resolvable organization id after the join source is gone — e.g. when
// access to a shared org is revoked mid-sync.
async function loadOrganizationIdsForContainers(
  tx: ClientSQLiteTransactionScope,
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

// One removed container can hold any number of documents, so their ids are
// read back in batches that fit SQLite's bind budget.
const DOCUMENT_ID_BATCH_SIZE = sqliteRowsPerStatement(1);

// A document unlinked from a removed container may keep other live links; its
// projection then re-homes to the first remaining link (deterministic order)
// instead of dropping to null.
async function loadFirstRemainingContainerIdByDocumentId(
  tx: ClientSQLiteTransactionScope,
  documentIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const firstRemainingContainerIdByDocumentId = new Map<string, string>();
  for (
    let index = 0;
    index < documentIds.length;
    index += DOCUMENT_ID_BATCH_SIZE
  ) {
    // A document's links all fall in its own batch, so the first per
    // document is still the lowest container id.
    const remainingLinks = await tx
      .select({
        containerId: documentContainerProjection.containerId,
        documentId: documentContainerProjection.documentId,
      })
      .from(documentContainerProjection)
      .where(
        inArray(
          documentContainerProjection.documentId,
          documentIds.slice(index, index + DOCUMENT_ID_BATCH_SIZE),
        ),
      )
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
  }
  return firstRemainingContainerIdByDocumentId;
}

export async function repairDocumentsForRemovedContainersInTransaction(input: {
  removals: ReadonlyArray<ContainerRemoval>;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { tx } = input;
  const updatedAtByContainerId = new Map(
    input.removals.map((removal) => [removal.containerId, removal.updatedAt]),
  );
  const containerIds = Array.from(updatedAtByContainerId.keys());
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
    await deleteContainerDocumentTombstoneHoldsForContainers(tx, containerIds);

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
      await setDocumentProjectionContainerInTransaction(tx, row.localId, {
        containerId: row.documentId
          ? (firstRemainingContainerIdByDocumentId.get(row.documentId) ?? null)
          : null,
        organizationId: removedOrganizationId,
        updatedAt: getLatestTimestamp(
          row.updatedAt,
          row.containerId
            ? (updatedAtByContainerId.get(row.containerId) ?? row.updatedAt)
            : row.updatedAt,
        ),
      });
    }
  }
}

export async function updateReparentedDescendantContainers(input: {
  descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
  remoteOrganizationId: string;
  tx: ClientSQLiteTransactionScope;
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
        .update(localIntents)
        .set({
          id: crypto.randomUUID(),
          targetContainerId: reparent.parentContainerId,
          syncStatus: "pending",
          updatedAt,
        })
        .where(
          and(
            inLocalIntentLane(LOCAL_INTENT_LANES.containerMove),
            eq(localIntents.subjectId, reparent.containerId),
          ),
        )
        .run();
    }
  }
}

export async function reparentLocalContainerChildren(input: {
  fromContainerId: string;
  remoteOrganizationId: string;
  toContainerId: string;
  tx: ClientSQLiteTransactionScope;
  updatedAt: string;
}): Promise<void> {
  const {
    fromContainerId,
    remoteOrganizationId,
    toContainerId,
    tx,
    updatedAt,
  } = input;
  await tx
    .update(containers)
    .set({
      organizationId: remoteOrganizationId,
      parentId: toContainerId,
      localUpdatedAt: updatedAt,
    })
    .where(eq(containers.parentId, fromContainerId))
    .run();
  const createLane = inLocalIntentLane(LOCAL_INTENT_LANES.containerCreate);
  const createIntentRows = await tx
    .select({ containerId: localIntents.subjectId })
    .from(localIntents)
    .where(and(createLane, eq(localIntents.targetContainerId, fromContainerId)))
    .all();
  for (const intent of createIntentRows) {
    await tx
      .update(localIntents)
      .set({
        id: crypto.randomUUID(),
        targetContainerId: toContainerId,
        updatedAt,
      })
      .where(and(createLane, eq(localIntents.subjectId, intent.containerId)))
      .run();
  }
  const moveLane = inLocalIntentLane(LOCAL_INTENT_LANES.containerMove);
  const moveIntentRows = await tx
    .select({ containerId: localIntents.subjectId })
    .from(localIntents)
    .where(and(moveLane, eq(localIntents.targetContainerId, fromContainerId)))
    .all();
  for (const intent of moveIntentRows) {
    await tx
      .update(localIntents)
      .set({
        id: crypto.randomUUID(),
        targetContainerId: toContainerId,
        syncStatus: "pending",
        updatedAt,
      })
      .where(and(moveLane, eq(localIntents.subjectId, intent.containerId)))
      .run();
  }
}

export async function deleteLocalContainerRows(input: {
  containerId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { containerId, tx } = input;
  await tx
    .delete(localIntents)
    .where(
      and(inContainerIntentLanes(), eq(localIntents.subjectId, containerId)),
    )
    .run();
  await tx.delete(containers).where(eq(containers.id, containerId)).run();
  await deleteContainerMetadataDocumentRowsInTransaction(tx, [containerId]);
  await deleteContainerWatermarksInTransaction(tx, [containerId]);
}
