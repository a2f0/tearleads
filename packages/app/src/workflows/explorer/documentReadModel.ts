import type { SyncWatermark } from "@tearleads/validators/response";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/shared/documentSummary";
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

async function listVisibleExplorerDocumentSummaries(
  execSql: ExecSql,
  containers: ReadonlyArray<{ id: string }>,
): Promise<ReadonlyArray<DocumentSummary>> {
  await sqlDocumentsPersistence.ensureSchema(execSql);

  return sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
    execSql,
    {
      containerIds: containers.map((container) => container.id),
      documentIds: [],
    },
  );
}

async function listExplorerDocumentsForContainerSubtree(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<ExplorerSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds =
    await sqlDocumentContainerProjectionPersistence.listDocumentIdsByContainerIds(
      execSql,
      containerIds,
    );
  const documentSummaries =
    await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
      execSql,
      {
        containerIds,
        documentIds: linkedDocumentIds,
      },
    );
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

function isExplorerContainerInSubtree(
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>,
  containerId: string,
  rootContainerId: string,
): boolean {
  let currentId: string | null = containerId;

  while (currentId !== null) {
    if (currentId === rootContainerId) {
      return true;
    }

    currentId = containersById.get(currentId)?.container.parentId ?? null;
  }

  return false;
}

function listExplorerContainerSubtreeIds(
  containersById: ReadonlyMap<string, ExplorerContainerSubtreeState>,
  rootContainerId: string,
): string[] {
  return Array.from(containersById.values())
    .filter((containerState) =>
      isExplorerContainerInSubtree(
        containersById,
        containerState.container.id,
        rootContainerId,
      ),
    )
    .map((containerState) => containerState.container.id);
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

export async function listExplorerDocumentRuntimeTargetsForContainerSubtree(input: {
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

function listExplorerLinkedContainerIdsByDocumentIds(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  return sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
    execSql,
    documentIds,
  );
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

export function createExplorerDocumentReadModel(
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
