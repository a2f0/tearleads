import { inArray } from "drizzle-orm";
import { ensureDocumentProjectionTables } from "../../sqlite/documentPersistence";
import {
  containerCreateIntents,
  containerMoveIntents,
  containers,
  documentContainerProjectionTables,
} from "../../sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import {
  ensureSqlTables,
  runSerializedSqlMutation,
} from "../../sqlite/sqlSchema";
import {
  deleteContainerRowsInTransaction,
  ensureContainerTables,
} from "../containers/containerPersistence";
import {
  deleteContainerWatermarksInTransaction,
  sqlContainerSyncWatermarkPersistence,
} from "../containers/containerSyncWatermarkPersistence";
import type {
  ContainerContentsPersistence,
  ContainerDeletionGuard,
  ContainerRemoval,
} from "./containerContentsPersistenceTypes";
import { recordContainerHydrationTombstones } from "./containerHydrationPersistence";
import { repairDocumentsForRemovedContainersInTransaction } from "./containerStructuralRepair";
import {
  deleteContainerMetadataDocumentRowsInTransaction,
  retainDormantContainerMetadataInTransaction,
} from "./dormantContainerMetadata";

type DeleteContainerOptions = NonNullable<
  Parameters<ContainerContentsPersistence["deleteContainers"]>[2]
>;

function normalizeContainerRemovals(
  removals: ReadonlyArray<ContainerRemoval>,
): ContainerRemoval[] {
  const removalByContainerId = new Map<string, ContainerRemoval>();
  for (const removal of removals) {
    const current = removalByContainerId.get(removal.containerId);
    if (
      !current ||
      (current.reason === "access_revoked" && removal.reason === "deleted") ||
      (current.reason === removal.reason &&
        current.updatedAt < removal.updatedAt)
    ) {
      removalByContainerId.set(removal.containerId, removal);
    }
  }
  return Array.from(removalByContainerId.values());
}

function loadGuardedContainerRows(
  tx: ClientSQLiteTransactionScope,
  containerIds: ReadonlyArray<string>,
) {
  return tx
    .select({
      effectiveAccessLevel: containers.effectiveAccessLevel,
      id: containers.id,
      metadataDocumentId: containers.metadataDocumentId,
      organizationId: containers.organizationId,
      parentId: containers.parentId,
      serverCreatedAt: containers.serverCreatedAt,
      serverUpdatedAt: containers.serverUpdatedAt,
      systemSlot: containers.systemSlot,
    })
    .from(containers)
    .where(inArray(containers.id, [...containerIds]));
}

type GuardedContainerRow = Awaited<
  ReturnType<typeof loadGuardedContainerRows>
>[number];

function sameGuardedContainerRow(
  row: GuardedContainerRow | undefined,
  guard: ContainerDeletionGuard,
): boolean {
  const expected = guard.expectedContainer;
  if (!row || !expected) return row === undefined && expected === null;
  return (
    row.id === expected.id &&
    row.organizationId === expected.organizationId &&
    row.parentId === expected.parentId &&
    row.metadataDocumentId === expected.metadataDocumentId &&
    row.systemSlot === (expected.systemSlot ?? null) &&
    row.effectiveAccessLevel === (expected.effectiveAccessLevel ?? "read") &&
    row.serverCreatedAt === (expected.serverCreatedAt ?? null) &&
    row.serverUpdatedAt === (expected.serverUpdatedAt ?? null)
  );
}

async function canApplyContainerRemovals(input: {
  expectedContainers: DeleteContainerOptions["expectedContainers"];
  removals: ReadonlyArray<ContainerRemoval>;
  tx: ClientSQLiteTransactionScope;
}): Promise<boolean> {
  const currentRows = await loadGuardedContainerRows(
    input.tx,
    input.removals.map((removal) => removal.containerId),
  );
  const currentRowById = new Map(
    currentRows.flatMap((row) => (row.id ? ([[row.id, row]] as const) : [])),
  );
  const guardById = new Map(
    input.expectedContainers?.map((guard) => [guard.containerId, guard]) ?? [],
  );
  return input.removals.every((removal) => {
    const currentRow = currentRowById.get(removal.containerId);
    const guard = guardById.get(removal.containerId);
    return (
      (!guard || sameGuardedContainerRow(currentRow, guard)) &&
      (currentRow?.serverUpdatedAt == null ||
        currentRow.serverUpdatedAt <= removal.updatedAt)
    );
  });
}

async function retainRemovedContainerMetadata(input: {
  containerIds: ReadonlyArray<string>;
  retainedAt: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  if (input.containerIds.length === 0) return;
  const retainedContainers = await input.tx
    .select({
      containerId: containers.id,
      organizationId: containers.organizationId,
    })
    .from(containers)
    .where(inArray(containers.id, [...input.containerIds]));
  await retainDormantContainerMetadataInTransaction(
    input.tx,
    retainedContainers.flatMap((container) =>
      container.containerId
        ? [
            {
              containerId: container.containerId,
              organizationId: container.organizationId,
              retainedAt: input.retainedAt,
            },
          ]
        : [],
    ),
  );
}

async function applyContainerRemovals(input: {
  metadataDeleteIds: ReadonlyArray<string>;
  removals: ReadonlyArray<ContainerRemoval>;
  retainedMetadataIds: ReadonlyArray<string>;
  tx: ClientSQLiteTransactionScope;
}): Promise<ReadonlyArray<string>> {
  const containerIds = input.removals.map((removal) => removal.containerId);
  await recordContainerHydrationTombstones({
    removals: input.removals,
    tx: input.tx,
  });
  await retainRemovedContainerMetadata({
    containerIds: input.retainedMetadataIds,
    retainedAt: new Date().toISOString(),
    tx: input.tx,
  });
  await repairDocumentsForRemovedContainersInTransaction({
    removals: input.removals,
    tx: input.tx,
  });
  await input.tx
    .delete(containerCreateIntents)
    .where(inArray(containerCreateIntents.containerId, containerIds))
    .run();
  await input.tx
    .delete(containerMoveIntents)
    .where(inArray(containerMoveIntents.containerId, containerIds))
    .run();
  await deleteContainerRowsInTransaction(input.tx, containerIds);
  await deleteContainerMetadataDocumentRowsInTransaction(
    input.tx,
    input.metadataDeleteIds,
  );
  await deleteContainerWatermarksInTransaction(input.tx, containerIds);
  return containerIds;
}

export async function deleteStoredContainers(
  execSql: Parameters<ContainerContentsPersistence["deleteContainers"]>[0],
  removals: Parameters<ContainerContentsPersistence["deleteContainers"]>[1],
  options?: Parameters<ContainerContentsPersistence["deleteContainers"]>[2],
): Promise<ReadonlyArray<string>> {
  const uniqueRemovals = normalizeContainerRemovals(removals);
  if (uniqueRemovals.length === 0) return [];
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await ensureSqlTables(lockedExecSql, documentContainerProjectionTables);
    await ensureContainerTables(lockedExecSql);
    await ensureDocumentProjectionTables(lockedExecSql);
    await sqlContainerSyncWatermarkPersistence.ensureSchema(lockedExecSql);
    return getClientSQLitePersistenceRuntime(lockedExecSql).transaction(
      async (tx) => {
        if (
          !(await canApplyContainerRemovals({
            expectedContainers: options?.expectedContainers,
            removals: uniqueRemovals,
            tx,
          }))
        ) {
          return [];
        }
        const retainedMetadataIds = uniqueRemovals.flatMap((removal) =>
          options?.retainMetadataForContainerIds?.includes(removal.containerId)
            ? [removal.containerId]
            : [],
        );
        return applyContainerRemovals({
          metadataDeleteIds: uniqueRemovals.flatMap((removal) =>
            retainedMetadataIds.includes(removal.containerId)
              ? []
              : [removal.containerId],
          ),
          removals: uniqueRemovals,
          retainedMetadataIds,
          tx,
        });
      },
      { behavior: "immediate" },
    );
  });
}
