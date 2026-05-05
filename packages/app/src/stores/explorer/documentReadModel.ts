import { useMemo } from "react";
import type {
  DiscoveredDocumentInput,
  DocumentSummary,
} from "../../data/documents/shared/documentSummary";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  sqlDocumentsPersistence,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { AppDataContextValue } from "../../providers/data/AppDataProvider";

export interface ExplorerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export interface ExplorerDocumentReadModel {
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
  upsertDiscoveredDocuments(
    inputs: ReadonlyArray<DiscoveredDocumentInput>,
  ): Promise<ReadonlyArray<DocumentSummary>>;
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

function listExplorerLinkedContainerIdsByDocumentIds(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  return sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
    execSql,
    documentIds,
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
