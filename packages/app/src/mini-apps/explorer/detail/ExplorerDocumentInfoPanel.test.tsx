import { afterEach, expect, test } from "bun:test";
import type {
  ContainerNode,
  DocumentInfo,
  DocumentSummary,
} from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { ExplorerDocumentInfoPanel } from "./ExplorerDocumentInfoPanel";

afterEach(() => cleanup());

const nodes = [
  {
    id: "container-1",
    kind: "container",
    name: "Root",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  },
  {
    id: "archive-container",
    kind: "container",
    name: "Archive",
    organizationId: "org-1",
    parentId: "container-1",
    syncState: syncedContainerDocumentObjectSyncState,
  },
] satisfies ReadonlyArray<ContainerNode>;

const documentInfo = {
  attachments: [],
  local: {
    accessEpoch: 1,
    accessStateHash: "access-state-hash",
    containerId: "container-1",
    documentId: "document-1",
    documentKind: "note",
    hasContentKeyBundle: true,
    hasDocumentKekTargets: true,
    hasDocumentManifestBundle: true,
    lastCommitLsn: "commit-1",
    localDocumentManifestHash: "local-document-manifest-hash",
    localId: "local-document-1",
    pendingAttachmentByteLength: 0,
    pendingAttachmentCount: 0,
    pendingUpdateCount: 0,
    title: "Document",
    updatedAt: "2026-06-20T10:00:00.000Z",
  },
  remoteInfo: {
    activeAttachmentBindings: [],
    authorizingContainerPaths: [],
    contentKeyEpoch: 1,
    contentKeyTargetCount: 1,
    contentKeyTargetHash: "content-key-target-hash",
    currentManifestHash: "document-manifest-hash",
    documentContainerManifestHistoryCount: 0,
    documentKekTargetCount: 1,
    documentKeyTargetHash: "document-key-target-hash",
    documentManifestContainerPathCount: 0,
    documentManifestHistoryCount: 0,
    linkedContainerKeyEpochCount: 0,
    linkedContainerManifestCount: 0,
    linkSetManifestHash: "link-set-manifest-hash",
    manifestEpoch: 1,
    previousManifestHash: null,
    referencedPrincipalCount: 1,
  },
} satisfies DocumentInfo;

const documentSummary = {
  containerId: "container-1",
  documentId: "document-1",
  id: "local-document-1",
  title: "Document",
  updatedAt: "2026-06-20T10:00:00.000Z",
} satisfies DocumentSummary;

function renderDocumentInfoPanel(input: {
  fallbackDocumentSummary: DocumentSummary | null;
  loadDocumentSummary?: (localId: string) => Promise<DocumentSummary | null>;
}) {
  return render(
    createElement(ExplorerDocumentInfoPanel, {
      activateLinkedContainer: async () => null,
      canActivateLinkedContainer: true,
      canMutateDocumentLinks: true,
      containerId: "container-1",
      documentTitle: undefined,
      fallbackDocumentSummary: input.fallbackDocumentSummary,
      linkedContainerIdsByDocumentId: new Map([
        ["document-1", ["container-1", "archive-container"]],
      ]),
      loadDocumentInfo: async () => documentInfo,
      loadDocumentSummary:
        input.loadDocumentSummary ?? (async () => documentSummary),
      localId: "local-document-1",
      nodes,
      onBackToDocument: () => undefined,
      openBlobBrowserRoute: () => undefined,
      setSelectedId: () => undefined,
      unlinkDocument: async () => null,
    }),
  );
}

test("document info links tab renders linked containers", async () => {
  const view = renderDocumentInfoPanel({
    fallbackDocumentSummary: documentSummary,
  });

  expect(view.queryByText("Linked Containers")).toBeNull();
  fireEvent.click(view.getByRole("tab", { name: "Links" }));

  await waitFor(() => {
    expect(
      view.getByRole("button", {
        name: "Open linked container Archive",
      }),
    ).toBeTruthy();
  });
  expect(view.getByText("Active")).toBeTruthy();
  expect(view.getByText("Authorizing Containers")).toBeTruthy();
});

test("document info loads a summary for the routed document", async () => {
  const loadedLocalIds: string[] = [];
  renderDocumentInfoPanel({
    fallbackDocumentSummary: null,
    loadDocumentSummary: async (localId) => {
      loadedLocalIds.push(localId);
      return documentSummary;
    },
  });

  await waitFor(() => {
    expect(loadedLocalIds).toEqual(["local-document-1"]);
  });
});
