import type {
  ContainerDocumentQueries,
  ContainerDocumentSidebarRow,
} from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";

export interface ExplorerSidebarWindowCall {
  containerId: string | null;
  limit: number;
  offset: number;
}

export function createExplorerSidebarRows(
  count: number,
  containerId = "root-container",
): ContainerDocumentSidebarRow[] {
  return Array.from({ length: count }, (_, index) => {
    const rowNumber = index + 1;
    return {
      containerId,
      documentId: `remote-${containerId}-document-${rowNumber}`,
      documentKind: "note",
      localId: `${containerId}-document-${rowNumber}`,
      syncState: syncedContainerDocumentObjectSyncState,
      title: `Document ${rowNumber}`,
      updatedAt: `2026-05-17T00:${String(index).padStart(2, "0")}:00.000Z`,
    };
  });
}

export function createExplorerDocumentQueries(
  rowsByContainerId: ReadonlyMap<
    string | null,
    ReadonlyArray<ContainerDocumentSidebarRow>
  >,
  calls: ExplorerSidebarWindowCall[],
): ContainerDocumentQueries {
  return {
    applyContainerDocumentTombstones: async () => [],
    hasOrphanedDocuments: async () => false,
    listContainerDocumentSidebarWindow: async ({
      containerId,
      limit,
      offset,
    }) => {
      calls.push({ containerId, limit, offset });
      const rows = rowsByContainerId.get(containerId) ?? [];
      return {
        rows: rows.slice(offset, offset + limit),
        totalCount: rows.length,
      };
    },
    listContainerItemWindow: async () => ({ rows: [], totalCount: 0 }),
    listPendingWrites: async () => [],
    retryPendingWriteItem: async () => undefined,
    loadContainerDocumentWatermark: async () => null,
    loadDocumentSyncState: async () => null,
    loadDocumentSummary: async () => null,
    loadOrphanedDocumentSummary: async () => null,
    listLinkedContainerIdsByDocumentIds: async () => new Map(),
    replaceDocumentLinksBatch: async () => undefined,
    saveContainerDocumentWatermark: async () => undefined,
    upsertDiscoveredDocuments: async () => [],
  };
}

export function createExplorerRowsByContainerId(
  rows: ReadonlyArray<ContainerDocumentSidebarRow>,
) {
  return new Map([["root-container", rows]]);
}
