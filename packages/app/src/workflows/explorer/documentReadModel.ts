import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documentSummary";
import {
  containerDocumentsSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  type ContainerDocumentTombstoneInput,
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ExplorerWorkflowSqlRuntime,
  getExplorerWorkflowRuntimeExecSql,
} from "./runtime";

export interface ExplorerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ExplorerContainerDocumentTombstone =
  ContainerDocumentTombstoneInput;

interface ExplorerDocumentRuntimeTarget {
  documentId: string | null;
  localId: string;
  runtimeContainerId: string;
}

type ExplorerDocumentReadModelRuntime = ExplorerWorkflowSqlRuntime;

export interface ExplorerDocumentPrimeStore {
  requestSync: () => void;
}

export interface ExplorerDocumentPrimeHost<TRuntime> {
  createDocumentRuntime: (containerId: string) => TRuntime;
  primeDocumentStore: (input: {
    documentId: string | null;
    localId: string;
    runtime: TRuntime;
  }) => ExplorerDocumentPrimeStore;
}

export interface ExplorerDocumentReadModel {
  applyContainerDocumentTombstones(
    tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  loadContainerDocumentWatermark(
    containerId: string,
  ): Promise<SyncWatermark | null>;
  listVisibleDocumentSummaries(
    containers: ReadonlyArray<{ id: string }>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
  listLinkedContainerIdsByDocumentIds(
    documentIds: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ReadonlyArray<string>>>;
  replaceDocumentLinks(
    documentId: string,
    linkedContainerIds: ReadonlyArray<string>,
  ): Promise<void>;
  replaceDocumentLinksBatch(
    inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
  ): Promise<void>;
  saveContainerDocumentWatermark(
    containerId: string,
    watermark: SyncWatermark,
  ): Promise<void>;
  upsertDiscoveredDocuments(
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
}

interface ExplorerSharedDocumentSummaries {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

interface ExplorerContainerSubtreeState {
  container: {
    id: string;
    parentId: string | null;
  };
}

// Keep each IN clause below SQLite's historical 999 bind-parameter limit.
const EXPLORER_SQL_ID_BATCH_SIZE = 500;

function listExplorerSqlIdBatches(
  values: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> {
  const uniqueValues = Array.from(new Set(values));
  const batches: string[][] = [];

  for (
    let index = 0;
    index < uniqueValues.length;
    index += EXPLORER_SQL_ID_BATCH_SIZE
  ) {
    batches.push(uniqueValues.slice(index, index + EXPLORER_SQL_ID_BATCH_SIZE));
  }

  return batches;
}

function compareExplorerDocumentSummaries(
  left: DocumentSummary,
  right: DocumentSummary,
): number {
  const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtComparison !== 0) {
    return updatedAtComparison;
  }

  return right.id.localeCompare(left.id);
}

function addExplorerDocumentSummaries(
  documentSummariesById: Map<string, DocumentSummary>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): void {
  for (const documentSummary of documentSummaries) {
    documentSummariesById.set(documentSummary.id, documentSummary);
  }
}

async function listExplorerDocumentIdsByContainerIds(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<string[]> {
  const documentIds = new Set<string>();

  for (const containerIdBatch of listExplorerSqlIdBatches(containerIds)) {
    const batchDocumentIds =
      await sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
        execSql,
        containerIdBatch,
      );
    for (const documentId of batchDocumentIds) {
      documentIds.add(documentId);
    }
  }

  return Array.from(documentIds).sort();
}

async function listExplorerDocumentSummariesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const documentSummariesById = new Map<string, DocumentSummary>();

  for (const containerIdBatch of listExplorerSqlIdBatches(input.containerIds)) {
    addExplorerDocumentSummaries(
      documentSummariesById,
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: containerIdBatch,
          documentIds: [],
        },
      ),
    );
  }

  for (const documentIdBatch of listExplorerSqlIdBatches(input.documentIds)) {
    addExplorerDocumentSummaries(
      documentSummariesById,
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        {
          containerIds: [],
          documentIds: documentIdBatch,
        },
      ),
    );
  }

  return Array.from(documentSummariesById.values()).sort(
    compareExplorerDocumentSummaries,
  );
}

async function listVisibleExplorerDocumentSummaries(
  execSql: ExecSql,
  containers: ReadonlyArray<{ id: string }>,
): Promise<ReadonlyArray<DocumentSummary>> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  return listExplorerDocumentSummariesByContainerIdsOrDocumentIds(execSql, {
    containerIds: containers.map((container) => container.id),
    documentIds: [],
  });
}

async function listExplorerDocumentsForContainerSubtree(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ExplorerSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds = await listExplorerDocumentIdsByContainerIds(
    execSql,
    containerIds,
  );
  const documentSummaries =
    await listExplorerDocumentSummariesByContainerIdsOrDocumentIds(execSql, {
      containerIds,
      documentIds: linkedDocumentIds,
    });
  const documentIds = Array.from(
    new Set(
      documentSummaries.flatMap((documentSummary) =>
        documentSummary.documentId ? [documentSummary.documentId] : [],
      ),
    ),
  );
  const linkedContainerIdsByDocumentId =
    await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
      execSql,
      documentIds,
    );

  return { documentSummaries, linkedContainerIdsByDocumentId };
}

function listExplorerContainerSubtreeIds(
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>,
  rootContainerId: string,
): string[] {
  const childrenByParentId = new Map<string, string[]>();
  for (const containerState of containersById.values()) {
    const parentId = containerState.container.parentId;
    if (parentId === null) {
      continue;
    }

    const children = childrenByParentId.get(parentId);
    if (children) {
      children.push(containerState.container.id);
    } else {
      childrenByParentId.set(parentId, [containerState.container.id]);
    }
  }

  const subtreeIds: string[] = [];
  const stack = [rootContainerId];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const containerId = stack.pop();
    if (containerId === undefined || visited.has(containerId)) {
      continue;
    }
    visited.add(containerId);

    if (containersById.has(containerId)) {
      subtreeIds.push(containerId);
    }

    const children = childrenByParentId.get(containerId);
    if (children) {
      stack.push(...children);
    }
  }

  return subtreeIds;
}

function resolveExplorerDocumentRuntimeContainerId(params: {
  documentSummary: Pick<DocumentSummary, "containerId" | "documentId">;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
  sharedContainerIds: ReadonlySet<string>;
}): string | null {
  const {
    documentSummary,
    linkedContainerIdsByDocumentId,
    sharedContainerIds,
  } = params;
  if (
    documentSummary.containerId &&
    sharedContainerIds.has(documentSummary.containerId)
  ) {
    return documentSummary.containerId;
  }

  if (!documentSummary.documentId) {
    return null;
  }

  return (
    linkedContainerIdsByDocumentId
      .get(documentSummary.documentId)
      ?.find((containerId) => sharedContainerIds.has(containerId)) ?? null
  );
}

async function listExplorerDocumentRuntimeTargetsForContainerSubtree(input: {
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>;
  execSql: ExecSql;
  rootContainerId: string;
}): Promise<ExplorerDocumentRuntimeTarget[]> {
  const { containersById, execSql, rootContainerId } = input;
  const sharedContainerIds = new Set(
    listExplorerContainerSubtreeIds(containersById, rootContainerId),
  );
  if (sharedContainerIds.size === 0) {
    return [];
  }

  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listExplorerDocumentsForContainerSubtree(
      execSql,
      Array.from(sharedContainerIds),
    );

  return documentSummaries.flatMap((documentSummary) => {
    const runtimeContainerId = resolveExplorerDocumentRuntimeContainerId({
      documentSummary,
      linkedContainerIdsByDocumentId,
      sharedContainerIds,
    });
    if (!runtimeContainerId) {
      return [];
    }

    return [
      {
        documentId: documentSummary.documentId,
        localId: documentSummary.id,
        runtimeContainerId,
      },
    ];
  });
}

export function listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof listExplorerDocumentRuntimeTargetsForContainerSubtree>[0],
  "execSql"
> & {
  runtime: ExplorerDocumentReadModelRuntime;
}): ReturnType<typeof listExplorerDocumentRuntimeTargetsForContainerSubtree> {
  const execSql = getExplorerWorkflowRuntimeExecSql(runtime);
  return listExplorerDocumentRuntimeTargetsForContainerSubtree({
    ...input,
    execSql,
  });
}

export async function primeExplorerDocumentsForContainerSubtree<
  TRuntime,
>(input: {
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>;
  host: ExplorerDocumentPrimeHost<TRuntime>;
  rootContainerId: string;
  runtime: ExplorerDocumentReadModelRuntime;
}): Promise<number> {
  const targets =
    await listExplorerDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
      containersById: input.containersById,
      rootContainerId: input.rootContainerId,
      runtime: input.runtime,
    });

  const runtimesByContainerId = new Map<string, TRuntime>();
  for (const target of targets) {
    let runtime = runtimesByContainerId.get(target.runtimeContainerId);
    if (runtime === undefined) {
      runtime = input.host.createDocumentRuntime(target.runtimeContainerId);
      runtimesByContainerId.set(target.runtimeContainerId, runtime);
    }

    input.host
      .primeDocumentStore({
        documentId: target.documentId,
        localId: target.localId,
        runtime,
      })
      .requestSync();
  }

  return targets.length;
}

async function listExplorerLinkedContainerIdsByDocumentIds(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  const uniqueDocumentIds = Array.from(new Set(documentIds));
  if (uniqueDocumentIds.length === 0) {
    return new Map();
  }

  const linkedContainerIdsByDocumentId = new Map<string, string[]>();
  for (const documentId of uniqueDocumentIds) {
    linkedContainerIdsByDocumentId.set(documentId, []);
  }

  for (const documentIdBatch of listExplorerSqlIdBatches(uniqueDocumentIds)) {
    const batchLinkedContainerIdsByDocumentId =
      await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
        execSql,
        documentIdBatch,
      );
    for (const [
      documentId,
      linkedContainerIds,
    ] of batchLinkedContainerIdsByDocumentId.entries()) {
      linkedContainerIdsByDocumentId.set(
        documentId,
        Array.from(linkedContainerIds),
      );
    }
  }

  return linkedContainerIdsByDocumentId;
}

function applyExplorerContainerDocumentTombstones(
  execSql: ExecSql,
  tombstones: ReadonlyArray<ExplorerContainerDocumentTombstone>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return applyContainerDocumentTombstones(execSql, tombstones);
}

function loadExplorerContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(
    execSql,
    containerDocumentsSyncLane(containerId),
  );
}

function replaceExplorerDocumentLinks(
  execSql: ExecSql,
  documentId: string,
  linkedContainerIds: ReadonlyArray<string>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinks(
    execSql,
    documentId,
    linkedContainerIds,
  );
}

function replaceExplorerDocumentLinksBatch(
  execSql: ExecSql,
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    execSql,
    inputs,
  );
}

function saveExplorerContainerDocumentWatermark(
  execSql: ExecSql,
  containerId: string,
  watermark: SyncWatermark,
): Promise<void> {
  return sqlContainerSyncWatermarkPersistence.saveWatermark(
    execSql,
    containerDocumentsSyncLane(containerId),
    watermark,
  );
}

function upsertDiscoveredExplorerDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return upsertDiscoveredDocuments(execSql, inputs);
}

function createExplorerDocumentReadModel(
  execSql: ExecSql,
): ExplorerDocumentReadModel {
  return {
    applyContainerDocumentTombstones(tombstones) {
      return applyExplorerContainerDocumentTombstones(execSql, tombstones);
    },
    loadContainerDocumentWatermark(containerId) {
      return loadExplorerContainerDocumentWatermark(execSql, containerId);
    },
    listVisibleDocumentSummaries(containers) {
      return listVisibleExplorerDocumentSummaries(execSql, containers);
    },
    listLinkedContainerIdsByDocumentIds(documentIds) {
      return listExplorerLinkedContainerIdsByDocumentIds(execSql, documentIds);
    },
    replaceDocumentLinks(documentId, linkedContainerIds) {
      return replaceExplorerDocumentLinks(
        execSql,
        documentId,
        linkedContainerIds,
      );
    },
    replaceDocumentLinksBatch(inputs) {
      return replaceExplorerDocumentLinksBatch(execSql, inputs);
    },
    saveContainerDocumentWatermark(containerId, watermark) {
      return saveExplorerContainerDocumentWatermark(
        execSql,
        containerId,
        watermark,
      );
    },
    upsertDiscoveredDocuments(inputs) {
      return upsertDiscoveredExplorerDocuments(execSql, inputs);
    },
  };
}

export function createExplorerDocumentReadModelFromRuntime(
  runtime: ExplorerDocumentReadModelRuntime,
): ExplorerDocumentReadModel {
  return createExplorerDocumentReadModel(
    getExplorerWorkflowRuntimeExecSql(runtime),
  );
}
