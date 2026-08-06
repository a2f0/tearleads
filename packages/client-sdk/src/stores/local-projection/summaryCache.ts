import type { DocumentSummary } from "../../data/documents/documentSummary";

/**
 * In-memory cache of document summaries + container links for the local
 * projection store (Layer A). Holds the device-first view of each container's
 * contents, loaded from SQLite and patched by the background reconciler.
 */
export interface SummaryCache {
  summariesByContainerId: Map<string, ReadonlyArray<DocumentSummary>>;
  linkedContainerIdsByDocumentId: Map<string, ReadonlyArray<string>>;
  /** Containers whose summaries have been loaded from SQLite at least once. */
  hydratedContainerIds: Set<string>;
}

export function createSummaryCache(): SummaryCache {
  return {
    summariesByContainerId: new Map(),
    linkedContainerIdsByDocumentId: new Map(),
    hydratedContainerIds: new Set(),
  };
}

export function resetSummaryCache(cache: SummaryCache): void {
  cache.summariesByContainerId.clear();
  cache.linkedContainerIdsByDocumentId.clear();
  cache.hydratedContainerIds.clear();
}

function setSummariesForContainer(
  cache: SummaryCache,
  containerId: string,
  summaries: ReadonlyArray<DocumentSummary>,
): void {
  cache.summariesByContainerId.set(containerId, summaries);
  cache.hydratedContainerIds.add(containerId);
}

function mergeLinks(
  cache: SummaryCache,
  links: ReadonlyMap<string, ReadonlyArray<string>>,
): void {
  for (const [documentId, containerIds] of links) {
    cache.linkedContainerIdsByDocumentId.set(documentId, containerIds);
  }
}

/**
 * Replace a container's summaries (and merge its document links) from a freshly
 * loaded or reconciled set. Returns true when the stored value changed, so the
 * store can decide whether to emit.
 */
export function applyContainerSummaries(
  cache: SummaryCache,
  input: {
    containerId: string;
    documentSummaries: ReadonlyArray<DocumentSummary>;
    linkedContainerIdsByDocumentId?:
      | ReadonlyMap<string, ReadonlyArray<string>>
      | undefined;
  },
): boolean {
  const previous = cache.summariesByContainerId.get(input.containerId);
  const changed =
    !previous || !areSummaryListsEqual(previous, input.documentSummaries);

  setSummariesForContainer(cache, input.containerId, input.documentSummaries);
  if (input.linkedContainerIdsByDocumentId) {
    mergeLinks(cache, input.linkedContainerIdsByDocumentId);
  }

  return changed;
}

/** Remove a locally deleted document from every hydrated container view. */
export function removeDocumentSummary(
  cache: SummaryCache,
  localId: string,
): boolean {
  const removedDocumentIds = new Set<string>();
  let changed = false;

  for (const [containerId, summaries] of cache.summariesByContainerId) {
    const remaining = summaries.filter((summary) => {
      if (summary.id !== localId) {
        return true;
      }
      if (summary.documentId) {
        removedDocumentIds.add(summary.documentId);
      }
      return false;
    });
    if (remaining.length !== summaries.length) {
      cache.summariesByContainerId.set(containerId, remaining);
      changed = true;
    }
  }

  for (const documentId of removedDocumentIds) {
    changed =
      cache.linkedContainerIdsByDocumentId.delete(documentId) || changed;
  }
  return changed;
}

function areSummaryListsEqual(
  left: ReadonlyArray<DocumentSummary>,
  right: ReadonlyArray<DocumentSummary>,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftSummary, index) => {
    const rightSummary = right[index];
    return (
      rightSummary !== undefined &&
      leftSummary.id === rightSummary.id &&
      leftSummary.documentId === rightSummary.documentId &&
      leftSummary.containerId === rightSummary.containerId &&
      leftSummary.title === rightSummary.title &&
      leftSummary.updatedAt === rightSummary.updatedAt &&
      leftSummary.accessStateHash === rightSummary.accessStateHash
    );
  });
}

export function snapshotSummariesByContainerId(
  cache: SummaryCache,
): ReadonlyMap<string, ReadonlyArray<DocumentSummary>> {
  return new Map(cache.summariesByContainerId);
}

export function snapshotLinkedContainerIdsByDocumentId(
  cache: SummaryCache,
): ReadonlyMap<string, ReadonlyArray<string>> {
  return new Map(cache.linkedContainerIdsByDocumentId);
}
