import {
  type ContainerDocumentQueries,
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { act } from "@testing-library/react";
import type { MouseEvent } from "react";
import { ExplorerContainerDetail } from "../../../src/mini-apps/explorer/detail/container/ExplorerContainerDetail";
import type { ExplorerUploadManager } from "../../../src/mini-apps/explorer/hooks/useExplorerUploadManager";

export const containerA: ContainerNode = {
  id: "container-a",
  kind: "container",
  name: "Container A",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

export const containerB: ContainerNode = {
  id: "container-b",
  kind: "container",
  name: "Container B",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

// Typed as the document variant: importers lose the narrowing a local const
// initializer gives, and the tests spread it into orphaned and paged rows.
export const alphaNoteRow: Extract<ContainerItemRow, { itemKind: "document" }> =
  {
    containerId: containerA.id,
    createdAt: null,
    documentId: "alpha-doc",
    documentKind: "note",
    itemKind: "document",
    localId: "alpha-local",
    name: "Alpha Note",
    syncState: syncedContainerDocumentObjectSyncState,
    updatedAt: null,
  };

type ContainerItemWindow = Awaited<
  ReturnType<ContainerDocumentQueries["listContainerItemWindow"]>
>;

interface DeferredItemWindow {
  offset: number;
  reject: (error: Error) => void;
  resolve: (window: ContainerItemWindow) => void;
}

export function createDeferredDocumentQueries() {
  const pending: DeferredItemWindow[] = [];
  const documentQueries = {
    listContainerItemWindow: ({ offset }: { offset: number }) =>
      new Promise<ContainerItemWindow>((resolve, reject) => {
        pending.push({ offset, reject, resolve });
      }),
  } as unknown as ContainerDocumentQueries;
  return { documentQueries, pending };
}

export const idleUploadManager: ExplorerUploadManager = {
  cancel: () => undefined,
  cancelForContainer: () => undefined,
  isImporting: false,
  items: [],
  queuedFileCount: 0,
  queuedFileCounts: new Map(),
  run: null,
  startImport: () => undefined,
};

export function renderContainerDetail(params: {
  documentQueries: ContainerDocumentQueries;
  documentListRevision?: number;
  selectedNode?: ContainerNode;
}) {
  return {
    documentListRevision: params.documentListRevision ?? 0,
    documentQueries: params.documentQueries,
    selectedNode: params.selectedNode ?? containerA,
  };
}

export function containerDetailElement(props: {
  documentQueries: ContainerDocumentQueries;
  documentListRevision: number;
  onContainerContextMenu?:
    | ((event: MouseEvent<HTMLElement>, containerId: string) => void)
    | undefined;
  selectedNode: ContainerNode;
  showHeaderSyncIndicator?: boolean | undefined;
  uploadManager?: ExplorerUploadManager;
}) {
  return (
    <ExplorerContainerDetail
      containerNodes={[containerA, containerB]}
      contactAvatarUrlByLocalId={{}}
      contextTarget={null}
      currentOrganizationId="org-1"
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      onRecoveryChanged={() => {}}
      documentListRevision={props.documentListRevision}
      documentQueries={props.documentQueries}
      uploadManager={props.uploadManager ?? idleUploadManager}
      online
      onContainerContextMenu={props.onContainerContextMenu ?? (() => undefined)}
      onItemContextMenu={() => undefined}
      refreshError={null}
      selectDocumentProjection={() => undefined}
      selectedNode={props.selectedNode}
      setSelectedId={() => undefined}
      showHeaderSyncIndicator={props.showHeaderSyncIndicator ?? false}
      visibleSystemSlots={new Set()}
    />
  );
}

export async function settlePendingItemWindow(
  pending: DeferredItemWindow[],
  window: ContainerItemWindow,
) {
  const deferred = pending.shift();
  if (!deferred) {
    throw new Error("Expected a pending listContainerItemWindow call.");
  }

  await act(async () => {
    deferred.resolve(window);
  });
}
