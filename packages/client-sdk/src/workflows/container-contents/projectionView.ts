import type { DocumentSummary } from "../../data/documents/documentSummary";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { listContainerContentsSqlIdBatches } from "./documentQueries/sql";
import type { ContainerDocumentQueriesRuntime } from "./documentQueries/types";

/**
 * Device-first projection reads for the local-projection store (Layer A).
 *
 * These load document summaries and their container links straight from
 * SQLite — no network — so the explorer can paint a container's contents on
 * first open. They reuse the same persistence functions the broader
 * `documentQueries` facade uses, kept in this small module so the local
 * projection store does not import raw persistence itself.
 */

interface ContainerProjectionDocuments {
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

async function listLinkedDocumentIdsForContainers(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
): Promise<string[]> {
  const documentIds = new Set<string>();
  for (const containerIdBatch of listContainerContentsSqlIdBatches(
    containerIds,
  )) {
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

async function listSummariesByContainerOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
  },
): Promise<DocumentSummary[]> {
  const summariesById = new Map<string, DocumentSummary>();
  const addSummaries = (summaries: ReadonlyArray<DocumentSummary>) => {
    for (const summary of summaries) {
      summariesById.set(summary.id, summary);
    }
  };

  for (const containerIdBatch of listContainerContentsSqlIdBatches(
    input.containerIds,
  )) {
    addSummaries(
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        { containerIds: containerIdBatch, documentIds: [] },
      ),
    );
  }
  for (const documentIdBatch of listContainerContentsSqlIdBatches(
    input.documentIds,
  )) {
    addSummaries(
      await sqlDocumentsPersistence.listDocumentsByContainerIdsOrDocumentIds(
        execSql,
        { containerIds: [], documentIds: documentIdBatch },
      ),
    );
  }
  return Array.from(summariesById.values());
}

/**
 * Load document summaries + container links for a flat set of container ids,
 * directly from SQLite. Returns empty results when no containers are given.
 */
async function loadLocalContainerProjectionDocuments(input: {
  containerIds: ReadonlyArray<string>;
  execSql: ExecSql;
}): Promise<ContainerProjectionDocuments> {
  const containerIds = Array.from(
    new Set(
      input.containerIds.filter(
        (containerId): containerId is string =>
          typeof containerId === "string" && containerId.length > 0,
      ),
    ),
  );
  if (containerIds.length === 0) {
    return {
      documentSummaries: [],
      linkedContainerIdsByDocumentId: new Map(),
    };
  }

  await sqlDocumentsPersistence.ensureSchema(input.execSql);
  const linkedDocumentIds = await listLinkedDocumentIdsForContainers(
    input.execSql,
    containerIds,
  );
  const documentSummaries = await listSummariesByContainerOrDocumentIds(
    input.execSql,
    { containerIds, documentIds: linkedDocumentIds },
  );
  const documentIds = Array.from(
    new Set(
      documentSummaries.flatMap((summary) =>
        summary.documentId ? [summary.documentId] : [],
      ),
    ),
  );
  const linkedContainerIdsByDocumentId =
    await sqlDocumentContainerProjectionPersistence.listLinkedContainerIdsByDocumentIds(
      input.execSql,
      documentIds,
    );

  return { documentSummaries, linkedContainerIdsByDocumentId };
}

/** Convenience wrapper that pulls `execSql` from a workflow runtime. */
export function loadLocalContainerProjectionDocumentsFromRuntime(input: {
  containerIds: ReadonlyArray<string>;
  runtime: ContainerDocumentQueriesRuntime;
}): Promise<ContainerProjectionDocuments> {
  return loadLocalContainerProjectionDocuments({
    containerIds: input.containerIds,
    execSql: input.runtime.infra.execSql,
  });
}
