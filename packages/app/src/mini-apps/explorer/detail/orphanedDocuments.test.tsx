import { afterEach, expect, test } from "bun:test";
import type { ContainerDocumentQueries } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createExplorerOrphanedDocumentsNode } from "../../../stores/explorer/orphanedDocuments";
import type { ExplorerUploadManager } from "../hooks/useExplorerUploadManager";
import { EXPLORER_LABELS } from "../labels";
import { ExplorerContainerDetail } from "./container/ExplorerContainerDetail";

afterEach(() => cleanup());

test("the orphan recovery collection queries null scope without folder actions", async () => {
  const calls: Array<
    Parameters<ContainerDocumentQueries["listContainerItemWindow"]>[0]
  > = [];
  const documentQueries = {
    listContainerItemWindow: async (
      input: Parameters<ContainerDocumentQueries["listContainerItemWindow"]>[0],
    ) => {
      calls.push(input);
      return { rows: [], totalCount: 0 };
    },
  } as unknown as ContainerDocumentQueries;
  const node = createExplorerOrphanedDocumentsNode(
    "org-1",
    EXPLORER_LABELS.orphanedDocumentsName,
  );
  const contextMenuContainerIds: string[] = [];
  const importedContainerIds: string[] = [];
  const uploadManager: ExplorerUploadManager = {
    cancel: () => undefined,
    cancelForContainer: () => undefined,
    isImporting: false,
    items: [],
    queuedFileCount: 0,
    queuedFileCounts: new Map(),
    run: null,
    startImport: (containerId) => importedContainerIds.push(containerId),
  };
  const view = render(
    <ExplorerContainerDetail
      containerNodes={[node]}
      contactAvatarUrlByLocalId={{}}
      contextTarget={null}
      currentOrganizationId="org-1"
      currentSigningFingerprint={null}
      currentSelfContactLocalId={null}
      currentUserId={null}
      documentListRevision={0}
      documentQueries={documentQueries}
      uploadManager={uploadManager}
      online
      onContainerContextMenu={(_event, containerId) => {
        contextMenuContainerIds.push(containerId);
      }}
      onItemContextMenu={() => undefined}
      refreshError={null}
      selectedNode={node}
      selectDocumentProjection={() => undefined}
      setSelectedId={() => undefined}
      showHeaderSyncIndicator
      visibleSystemSlots={new Set()}
    />,
  );

  await waitFor(() => {
    expect(view.getByText(EXPLORER_LABELS.orphanedDocumentsEmpty)).toBeTruthy();
  });
  expect(calls[0]).toMatchObject({
    containerId: null,
    currentOrganizationId: "org-1",
  });
  expect(view.getByText(EXPLORER_LABELS.orphanedDocumentsType)).toBeTruthy();
  expect(
    view.queryByRole("button", {
      name: `${EXPLORER_LABELS.containerHeaderActionsLabel}: ${node.name}`,
    }),
  ).toBeNull();
  const table = view.getByRole("table", {
    name: "Items in Orphaned Documents",
  });
  expect(fireEvent.contextMenu(table)).toBe(false);
  fireEvent.drop(table, {
    dataTransfer: {
      files: [new File(["content"], "note.txt")],
      types: ["Files"],
    },
  });
  expect(contextMenuContainerIds).toEqual([]);
  expect(importedContainerIds).toEqual([]);
});
