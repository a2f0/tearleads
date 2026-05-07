import type { SyncWatermark } from "@tearleads/validators/response";
import { useMemo } from "react";
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
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";

export interface ExplorerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export type ExplorerContainerDocumentTombstone =
  ContainerDocumentTombstoneInput;

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

async function listVisibleExplorerDocumentSummaries(
  execSql: ExecSql,
  containers: ReadonlyArray<{ id: string }>,
): Promise<ReadonlyArray<DocumentSummary>> {
  await sqlDocumentContainerProjectionPersistence.ensureSchema(execSql);
  await sqlDocumentsPersistence.ensureSchema(execSql);

  const storedDocuments = await sqlDocumentsPersistence.listDocuments(execSql);
  const validContainerIds = new Set(
    containers.map((container) => container.id),
  );

  return storedDocuments.filter(
    (documentSummary) =>
      documentSummary.containerId &&
      validContainerIds.has(documentSummary.containerId),
  );
}

export async function listExplorerDocumentsForContainerSubtree(
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

export function useExplorerDocumentReadModel(
  appData: Pick<AppDataContextValue, "execSql">,
): ExplorerDocumentReadModel {
  const { execSql } = appData;

  return useMemo(() => createExplorerDocumentReadModel(execSql), [execSql]);
}
