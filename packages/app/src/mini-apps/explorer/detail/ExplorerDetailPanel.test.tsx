import { afterEach, expect, test } from "bun:test";
import type {
  BlobStore,
  ContainerDocumentQueries,
  ContainerNode,
  DocumentInfo,
  DocumentSummary,
  DomainScope,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentProps, createElement } from "react";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { ExplorerDetailPanel } from "./ExplorerDetailPanel";

afterEach(() => cleanup());

const nodes = [
  {
    id: "root-container",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "contacts-container",
    kind: "container",
    name: "Contacts",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedContainerDocumentObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

const contactDocument = {
  containerId: "contacts-container",
  documentId: "contact-document",
  documentKind: "contact",
  id: "you-contact",
  title: "You",
  updatedAt: "2026-06-20T10:00:00.000Z",
} satisfies DocumentSummary;

type ExplorerDetailPanelProps = ComponentProps<typeof ExplorerDetailPanel>;

function createBaseExplorerDetailPanelProps(
  overrides: Partial<ExplorerDetailPanelProps> = {},
): ExplorerDetailPanelProps {
  return {
    blobPickTarget: null,
    blobStore: {} as BlobStore,
    canLinkSelectedDocument: true,
    canMoveSelectedDocument: true,
    canMutateDocumentLinks: true,
    canShareWithPeer: true,
    contextTarget: null,
    currentOrganizationId: "org-1",
    currentSigningFingerprint: "fingerprint-1",
    currentUserId: "user-1",
    databaseError: false,
    documentListRevision: 0,
    documentQueries: {} as ContainerDocumentQueries,
    documentSummaries: [contactDocument],
    domainScope: {} as DomainScope,
    importDroppedFiles: (async () => ({
      completedCount: 0,
      failedCount: 0,
      importedCount: 0,
      importedDocuments: [],
      totalCount: 0,
    })) satisfies ImportExplorerDroppedFiles,
    initialEditingSelectedDocument: false,
    linkedContainerIdsByDocumentId: new Map(),
    loadBlobInfo: async () => ({ rows: [], totalCount: 0 }),
    loadContainerInfo: async () => {
      throw new Error("Container info is not used by this test.");
    },
    loadDocumentInfo: () => new Promise<DocumentInfo>(() => undefined),
    loadDocumentSummary: async () => contactDocument,
    nodes,
    onBackToSelectionRoute: () => undefined,
    onBackToSyncLanesRoute: () => undefined,
    onCancelBlobPick: () => undefined,
    onContainerContextMenu: () => undefined,
    onInitialEditingSelectedDocumentConsumed: () => undefined,
    onItemContextMenu: () => undefined,
    onOpenGrant: () => undefined,
    onOpenSyncLaneDetailRoute: () => undefined,
    onPickBlob: () => undefined,
    onRetryDatabase: () => undefined,
    online: true,
    openBlobBrowserRoute: () => undefined,
    openDocumentInfoRoute: () => undefined,
    openInlineDocument: () => undefined,
    openLinkDocumentModal: () => undefined,
    openMoveDocumentModal: () => undefined,
    peerUserId: null,
    ready: true,
    refreshError: null,
    route: {
      containerId: "contacts-container",
      localId: "you-contact",
      view: "document-info",
    },
    selectDocumentProjection: () => undefined,
    selectedDocument: undefined,
    selectedNode: nodes[1],
    setSelectedId: () => undefined,
    shareWithGroup: async () => false,
    shareWithUser: async () => false,
    unlinkDocument: async () => null,
    visibleSystemSlots: new Set(),
    ...overrides,
  };
}

test("document info back button returns to the document projection", () => {
  const selectedDocuments: Array<[string, string]> = [];
  const genericBackRoutes: string[] = [];
  const view = render(
    createElement(
      ExplorerDetailPanel,
      createBaseExplorerDetailPanelProps({
        onBackToSelectionRoute: () => genericBackRoutes.push("selection"),
        selectDocumentProjection: (localId, containerId) => {
          selectedDocuments.push([localId, containerId]);
        },
      }),
    ),
  );

  fireEvent.click(view.getByRole("button", { name: "Back to Document" }));

  expect(selectedDocuments).toEqual([["you-contact", "contacts-container"]]);
  expect(genericBackRoutes).toEqual([]);
});
