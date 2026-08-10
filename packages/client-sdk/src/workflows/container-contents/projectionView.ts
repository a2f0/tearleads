import type {
  ContainerContentsSharedDocumentSummaries,
  ContainerDocumentQueriesRuntime,
} from "./documentQueries/types";
import { listContainerContentsDocumentsForContainers } from "./documentSubtreeQueries";

/**
 * Device-first projection reads for the local-projection store (Layer A).
 *
 * These load document summaries and their container links straight from
 * SQLite — no network — so the explorer can paint a container's contents on
 * first open. They reuse the shared `documentSubtreeQueries` pipeline, kept in
 * this small module so the local projection store does not import raw
 * persistence itself.
 */

/**
 * Load document summaries + container links for a flat set of container ids,
 * directly from SQLite. Returns empty results when no containers are given.
 */
export async function loadLocalContainerProjectionDocumentsFromRuntime(input: {
  containerIds: ReadonlyArray<string>;
  runtime: ContainerDocumentQueriesRuntime;
}): Promise<ContainerContentsSharedDocumentSummaries> {
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

  return listContainerContentsDocumentsForContainers(
    input.runtime.infra.execSql,
    containerIds,
    { sortDocumentSummaries: false },
  );
}
