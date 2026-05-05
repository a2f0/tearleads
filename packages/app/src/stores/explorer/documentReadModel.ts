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

export interface ExplorerDocumentLinkInput {
  containerIds: ReadonlyArray<string>;
  documentId: string;
}

export async function listVisibleExplorerDocumentSummaries(
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

export function listExplorerLinkedContainerIdsByDocumentIds(
  execSql: ExecSql,
  documentIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, ReadonlyArray<string>>> {
  return sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
    execSql,
    documentIds,
  );
}

export function replaceExplorerDocumentLinks(
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

export function replaceExplorerDocumentLinksBatch(
  execSql: ExecSql,
  inputs: ReadonlyArray<ExplorerDocumentLinkInput>,
): Promise<void> {
  return sqlDocumentContainerProjectionPersistence.replaceDocumentLinksBatch(
    execSql,
    inputs,
  );
}

export function upsertDiscoveredExplorerDocuments(
  execSql: ExecSql,
  inputs: ReadonlyArray<DiscoveredDocumentInput>,
): Promise<ReadonlyArray<DocumentSummary>> {
  return upsertDiscoveredDocuments(execSql, inputs);
}
