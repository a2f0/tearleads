import type { DocumentSummary } from "../../data/documents/documentSummary";
import { sqlDocumentContainerProjectionPersistence } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { compareContainerContentsDocumentSummaries } from "./documentQueries/rows";
import { listContainerContentsSqlIdBatches } from "./documentQueries/sql";
import type {
  ContainerContentsContainerSubtreeState,
  ContainerContentsDocumentRuntimeTarget,
  ContainerContentsSharedDocumentSummaries,
  ContainerDocumentQueriesRuntime,
} from "./documentQueries/types";

function addContainerContentsDocumentSummaries(
  documentSummariesById: Map<string, DocumentSummary>,
  documentSummaries: ReadonlyArray<DocumentSummary>,
): void {
  for (const documentSummary of documentSummaries) {
    documentSummariesById.set(documentSummary.id, documentSummary);
  }
}

async function listContainerContentsDocumentIdsByContainerIds(
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

async function listContainerContentsDocumentSummariesByContainerIdsOrDocumentIds(
  execSql: ExecSql,
  input: {
    containerIds: ReadonlyArray<string>;
    documentIds: ReadonlyArray<string>;
    sortDocumentSummaries: boolean;
  },
): Promise<DocumentSummary[]> {
  const documentSummariesById = new Map<string, DocumentSummary>();

  for (const containerIdBatch of listContainerContentsSqlIdBatches(
    input.containerIds,
  )) {
    addContainerContentsDocumentSummaries(
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

  for (const documentIdBatch of listContainerContentsSqlIdBatches(
    input.documentIds,
  )) {
    addContainerContentsDocumentSummaries(
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

  const documentSummaries = Array.from(documentSummariesById.values());
  return input.sortDocumentSummaries
    ? documentSummaries.sort(compareContainerContentsDocumentSummaries)
    : documentSummaries;
}

/**
 * Shared batched read pipeline for a flat set of container ids: linked
 * document ids → document summaries → linked container ids per document.
 * Sorting is optional so device-first projection reads can skip it.
 */
export async function listContainerContentsDocumentsForContainers(
  execSql: ExecSql,
  containerIds: ReadonlyArray<string>,
  options: { sortDocumentSummaries: boolean },
): Promise<ContainerContentsSharedDocumentSummaries> {
  await sqlDocumentsPersistence.ensureSchema(execSql);
  const linkedDocumentIds =
    await listContainerContentsDocumentIdsByContainerIds(execSql, containerIds);
  const documentSummaries =
    await listContainerContentsDocumentSummariesByContainerIdsOrDocumentIds(
      execSql,
      {
        containerIds,
        documentIds: linkedDocumentIds,
        sortDocumentSummaries: options.sortDocumentSummaries,
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

function listContainerContentsContainerSubtreeIds(
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>,
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

function resolveContainerContentsDocumentRuntimeContainerId(params: {
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

async function listDocumentRuntimeTargetsForContainerSubtree(input: {
  containersById: ReadonlyMap<string, ContainerContentsContainerSubtreeState>;
  execSql: ExecSql;
  rootContainerId: string;
}): Promise<ContainerContentsDocumentRuntimeTarget[]> {
  const { containersById, execSql, rootContainerId } = input;
  const sharedContainerIds = new Set(
    listContainerContentsContainerSubtreeIds(containersById, rootContainerId),
  );
  if (sharedContainerIds.size === 0) {
    return [];
  }

  const { documentSummaries, linkedContainerIdsByDocumentId } =
    await listContainerContentsDocumentsForContainers(
      execSql,
      Array.from(sharedContainerIds),
      { sortDocumentSummaries: true },
    );

  return documentSummaries.flatMap((documentSummary) => {
    const runtimeContainerId =
      resolveContainerContentsDocumentRuntimeContainerId({
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

export function listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
  runtime,
  ...input
}: Omit<
  Parameters<typeof listDocumentRuntimeTargetsForContainerSubtree>[0],
  "execSql"
> & {
  runtime: ContainerDocumentQueriesRuntime;
}): ReturnType<typeof listDocumentRuntimeTargetsForContainerSubtree> {
  return listDocumentRuntimeTargetsForContainerSubtree({
    ...input,
    execSql: runtime.infra.execSql,
  });
}
